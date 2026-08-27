// src/utils/lyrics/wordAligner.ts
// Port of REATK's lrc_aligner_v2.py — global sequence alignment for word-level lyric timing.
// Aligns Whisper transcription results against user-provided lyric text to produce
// accurate per-character / per-word timestamps for Folia's LyricData.

import type { Line, Word, LyricData } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single word-level result from Whisper transcription. */
export interface WhisperWord {
    word: string;
    start: number;
    end: number;
}

/** A segment from Whisper transcription. */
export interface WhisperSegment {
    start: number;
    end: number;
    text: string;
    words?: WhisperWord[];
}

/** The full Whisper transcription result. */
export interface WhisperResult {
    segments: WhisperSegment[];
}

/** Internal token produced by the tokenizer. */
interface AlignToken {
    text: string;
    pre: string;         // whitespace / punctuation preceding this token
    time: number | null; // assigned start time (null = not yet assigned)
    endIdx: number;      // end index in the original line string
    lineIdx: number;     // which source line this token belongs to
    cleanText: string;   // normalised form for matching
}

/** Internal AI token with timing from Whisper. */
interface AiToken {
    text: string;
    start: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MIN_DURATION = 0.04;   // minimum gap between consecutive timestamps (s)
const HALLUCINATION_GAP = 3.0; // gap threshold for hallucination detection (s)
const CALIBRATION_THRESHOLD = 1.5; // force-calibration threshold (s)
const SMOOTH_INTERP_GAP = 2.5;   // above this gap, use right-adsorption strategy

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CJK unified ideographs + Hiragana + Katakana ranges. */
const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/;

/** Tokenise a line into per-character CJK tokens and per-word English/number tokens. */
const TOKENIZE_REGEX = /([a-zA-Z0-9']+|[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])/g;

/** Clean a token for matching: strip punctuation, lowercase. */
function cleanToken(text: string): string {
    if (!text) return '';
    return text.replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '').toLowerCase();
}

/** Simple longest-common-subsequence based sequence matcher (ported from difflib.SequenceMatcher). */
class SequenceMatcher<T> {
    private a: T[];
    private b: T[];

    constructor(a: T[], b: T[]) {
        this.a = a;
        this.b = b;
    }

    /** Returns opcodes describing how to turn a into b. */
    getOpcodes(): Array<[tag: 'equal' | 'replace' | 'delete' | 'insert', i1: number, i2: number, j1: number, j2: number]> {
        // Build LCS table
        const m = this.a.length;
        const n = this.b.length;

        // Use the classic DP approach for LCS, then backtrack for opcodes
        const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (this.a[i - 1] === this.b[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to produce opcodes
        const opcodes: Array<[tag: 'equal' | 'replace' | 'delete' | 'insert', i1: number, i2: number, j1: number, j2: number]> = [];
        let i = m;
        let j = n;

        // Collect raw operations in reverse
        const rawOps: Array<{ tag: 'equal' | 'replace' | 'delete' | 'insert'; i: number; j: number }> = [];

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && this.a[i - 1] === this.b[j - 1]) {
                rawOps.push({ tag: 'equal', i: i - 1, j: j - 1 });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                rawOps.push({ tag: 'insert', i: i, j: j - 1 });
                j--;
            } else {
                rawOps.push({ tag: 'delete', i: i - 1, j: j });
                i--;
            }
        }

        rawOps.reverse();

        // Merge consecutive operations into opcode ranges
        for (const op of rawOps) {
            if (opcodes.length > 0) {
                const last = opcodes[opcodes.length - 1];
                if (last[0] === op.tag) {
                    // Extend the range
                    if (op.tag === 'equal' || op.tag === 'replace') {
                        last[2] = op.i + 1;
                        last[4] = op.j + 1;
                    } else if (op.tag === 'delete') {
                        last[2] = op.i + 1;
                    } else {
                        last[4] = op.j + 1;
                    }
                    continue;
                }
            }

            // Start a new opcode
            if (op.tag === 'equal') {
                opcodes.push(['equal', op.i, op.i + 1, op.j, op.j + 1]);
            } else if (op.tag === 'delete') {
                opcodes.push(['delete', op.i, op.i + 1, op.j, op.j]);
            } else if (op.tag === 'insert') {
                opcodes.push(['insert', op.i, op.i, op.j, op.j + 1]);
            }
        }

        // Merge adjacent delete+insert into replace
        const merged: typeof opcodes = [];
        for (const op of opcodes) {
            if (merged.length > 0) {
                const prev = merged[merged.length - 1];
                const prevIsDel = prev[0] === 'delete';
                const prevIsIns = prev[0] === 'insert';
                const curIsIns = op[0] === 'insert';
                const curIsDel = op[0] === 'delete';

                if (prevIsDel && curIsIns) {
                    merged[merged.length - 1] = ['replace', prev[1], prev[2], prev[3], op[4]];
                    continue;
                }
                if (prevIsIns && curIsDel) {
                    merged[merged.length - 1] = ['replace', op[1], op[2], prev[3], prev[4]];
                    continue;
                }
            }
            merged.push(op);
        }

        return merged;
    }

    ratio(): number {
        const m = this.a.length;
        const n = this.b.length;
        if (m === 0 && n === 0) return 1.0;
        const total = m + n;
        // Quick approximation via LCS length from DP
        const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (this.a[i - 1] === this.b[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        return (2.0 * dp[m][n]) / total;
    }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenizeLine(line: string): Array<{ text: string; pre: string; endIdx: number }> {
    const tokens: Array<{ text: string; pre: string; endIdx: number }> = [];
    let lastEndIdx = 0;
    let match: RegExpExecArray | null;

    TOKENIZE_REGEX.lastIndex = 0;
    while ((match = TOKENIZE_REGEX.exec(line)) !== null) {
        const preText = line.slice(lastEndIdx, match.index).replace(/\n/g, '');
        const tokenText = match[0];
        lastEndIdx = match.index + match[0].length;
        tokens.push({ text: tokenText, pre: preText, endIdx: lastEndIdx });
    }

    return tokens;
}

// ---------------------------------------------------------------------------
// Main aligner
// ---------------------------------------------------------------------------

export interface WordAlignerOptions {
    /** Enable force calibration against original line timestamps. Default: true */
    enableForceCalibration?: boolean;
    /** Enable average distribution after force calibration. Default: false */
    enableAvgDistribution?: boolean;
    /** Calibration threshold in seconds. Default: 1.5 */
    calibrationThreshold?: number;
}

/**
 * Aligns Whisper transcription against user-provided lyric lines to produce
 * word-level timestamps suitable for Folia's `LyricData`.
 *
 * @param whisperResult  - Whisper transcription with word-level timing
 * @param lyricLines     - The lyric lines to align (must have startTime / endTime)
 * @param options        - Alignment tuning options
 * @returns Updated LyricData with populated `words[]` and `isWordByWord = true`
 */
export function alignWhisperToLyrics(
    whisperResult: WhisperResult,
    lyricLines: Line[],
    options?: WordAlignerOptions,
): LyricData {
    const enableForceCalibration = options?.enableForceCalibration ?? true;
    const enableAvgDistribution = options?.enableAvgDistribution ?? false;
    const calibrationThreshold = options?.calibrationThreshold ?? CALIBRATION_THRESHOLD;

    // -----------------------------------------------------------------------
    // 1. Extract AI word pool from Whisper result
    // -----------------------------------------------------------------------
    const aiWordsPool: WhisperWord[] = [];
    for (const seg of whisperResult.segments) {
        if (seg.words && seg.words.length > 0) {
            aiWordsPool.push(...seg.words);
            continue;
        }
        // Fallback: segment-level timing, split text into tokens
        const cleanText = cleanToken(seg.text || '');
        const tokens = tokenizeLine(cleanText);
        if (tokens.length === 0) continue;

        const segStart = seg.start ?? 0;
        const segEnd = seg.end ?? segStart;
        const duration = Math.max(0, segEnd - segStart);
        const totalChars = tokens.reduce((sum, t) => sum + t.text.length, 0);
        let charCursor = 0;

        for (const token of tokens) {
            const offset = charCursor;
            charCursor += token.text.length;
            const tokenStart = totalChars > 0 && duration > 0
                ? segStart + (offset / totalChars) * duration
                : segStart;
            const tokenEnd = totalChars > 0 && duration > 0
                ? segStart + (charCursor / totalChars) * duration
                : segStart;
            aiWordsPool.push({ word: token.text, start: tokenStart, end: tokenEnd });
        }
    }

    // No lyrics text → return original with no word-level timing
    if (lyricLines.length === 0) {
        return { lines: lyricLines, isWordByWord: false };
    }

    // -----------------------------------------------------------------------
    // 2. Prepare user token sequence
    // -----------------------------------------------------------------------
    const userCharSequence: AlignToken[] = [];
    for (let lineIdx = 0; lineIdx < lyricLines.length; lineIdx++) {
        const lineText = lyricLines[lineIdx].fullText;
        const tokens = tokenizeLine(lineText);
        for (const token of tokens) {
            userCharSequence.push({
                text: token.text,
                pre: token.pre,
                time: null,
                endIdx: token.endIdx,
                lineIdx,
                cleanText: cleanToken(token.text),
            });
        }
    }

    // -----------------------------------------------------------------------
    // 3. Prepare AI token sequence (matching user tokenization granularity)
    // -----------------------------------------------------------------------
    const aiCharSequence: AiToken[] = [];
    for (const wObj of aiWordsPool) {
        const text = wObj.word || '';
        const start = wObj.start ?? 0;
        const end = wObj.end ?? start;
        const cleanText = cleanToken(text);
        if (!cleanText) continue;

        const tokens = tokenizeLine(cleanText);
        const duration = Math.max(0, end - start);
        const totalChars = cleanText.length;
        let charCursor = 0;

        for (const token of tokens) {
            const tokenStartOffset = cleanText.indexOf(token.text, charCursor);
            const effectiveOffset = tokenStartOffset >= 0 ? tokenStartOffset : charCursor;
            charCursor = effectiveOffset + token.text.length;

            const tokenStart = totalChars > 0 && duration > 0
                ? start + (effectiveOffset / totalChars) * duration
                : start;

            aiCharSequence.push({ text: token.text, start: tokenStart });
        }
    }

    // -----------------------------------------------------------------------
    // 4. Global sequence alignment
    // -----------------------------------------------------------------------
    const userTokensStr = userCharSequence.map(t => t.cleanText);
    const aiTokensStr = aiCharSequence.map(t => t.text);

    const matcher = new SequenceMatcher(userTokensStr, aiTokensStr);
    const opcodes = matcher.getOpcodes();

    // -----------------------------------------------------------------------
    // 5. Back-fill timestamps from alignment
    // -----------------------------------------------------------------------
    let lastValidTime = 0.0;

    for (const [tag, i1, i2, j1, j2] of opcodes) {
        if (tag === 'equal') {
            for (let k = 0; k < i2 - i1; k++) {
                const userIdx = i1 + k;
                const aiIdx = j1 + k;
                let matchedTime = aiCharSequence[aiIdx].start;
                if (matchedTime < lastValidTime) {
                    matchedTime = lastValidTime;
                }
                userCharSequence[userIdx].time = matchedTime;
                lastValidTime = matchedTime;
            }
        } else if (tag === 'replace') {
            // Local sub-alignment to salvage matchable tokens within replace region
            lastValidTime = matchReplaceRegion(
                userCharSequence, aiCharSequence,
                i1, i2, j1, j2, lastValidTime,
            );
        }
        // 'delete': user has token but AI doesn't → leave for interpolation
        // 'insert': AI has token but user doesn't → ignore
    }

    // -----------------------------------------------------------------------
    // 6. Per-line post-processing: hallucination cleanup + interpolation + calibration
    // -----------------------------------------------------------------------
    const linesTokensMap: Map<number, AlignToken[]> = new Map();
    for (let i = 0; i < lyricLines.length; i++) {
        linesTokensMap.set(i, []);
    }
    for (const token of userCharSequence) {
        const arr = linesTokensMap.get(token.lineIdx);
        if (arr) arr.push(token);
    }

    let currentLastTime = 0.0;
    const resultLines: Line[] = [];

    for (let i = 0; i < lyricLines.length; i++) {
        const lineTokens = linesTokensMap.get(i) ?? [];
        const originalLine = lyricLines[i];
        const originalTs = originalLine.startTime;

        // Determine next line start for boundary constraints
        let nextLineStart: number | null = null;
        if (i + 1 < lyricLines.length) {
            const nextTs = lyricLines[i + 1].startTime;
            if (nextTs > 0) nextLineStart = nextTs;
        }

        // 6a. Hallucination cleanup
        cleanHallucinations(lineTokens);

        // 6b. Interpolation
        interpolateTimestamps(lineTokens, currentLastTime);

        const validTimes = lineTokens
            .map(t => t.time)
            .filter((t): t is number => t !== null);
        if (validTimes.length > 0) {
            currentLastTime = validTimes[validTimes.length - 1]!;
        }

        // 6c. Force calibration
        if (enableForceCalibration && originalTs > 0) {
            let isForceCalibrated = false;

            if (validTimes.length === 0) {
                // No valid times at all — fallback to even distribution from line start
                if (lineTokens.length > 0) {
                    for (let k = 0; k < lineTokens.length; k++) {
                        lineTokens[k].time = originalTs + k * 0.25;
                    }
                    currentLastTime = lineTokens[lineTokens.length - 1]!.time!;
                    isForceCalibrated = true;
                }
            } else {
                const generatedStart = validTimes[0]!;
                const diff = generatedStart - originalTs;
                if (Math.abs(diff) > calibrationThreshold) {
                    const correction = originalTs - generatedStart;
                    for (const t of lineTokens) {
                        if (t.time !== null) {
                            t.time += correction;
                        }
                    }
                    const lastToken = lineTokens[lineTokens.length - 1];
                    if (lastToken && lastToken.time !== null) {
                        currentLastTime = lastToken.time;
                    }
                    isForceCalibrated = true;
                }
            }

            // Boundary check: this line must not overlap with next line
            if (!enableAvgDistribution && nextLineStart !== null && lineTokens.length > 0) {
                const lastToken = lineTokens[lineTokens.length - 1];
                if (lastToken?.time !== null && lastToken!.time! > nextLineStart - 0.1) {
                    const startToken = lineTokens.find(t => t.time !== null);
                    const startTime = startToken?.time ?? originalTs;
                    let targetEnd = nextLineStart - 0.1;
                    if (targetEnd <= startTime) targetEnd = startTime + 0.1;
                    const duration = targetEnd - startTime;
                    const step = duration / lineTokens.length;
                    for (let k = 0; k < lineTokens.length; k++) {
                        lineTokens[k].time = startTime + k * step;
                    }
                    currentLastTime = lineTokens[lineTokens.length - 1]!.time!;
                    isForceCalibrated = true;
                }
            }

            // Average distribution after calibration
            if (isForceCalibrated && enableAvgDistribution) {
                const tokenCount = lineTokens.length;
                if (tokenCount > 0) {
                    const startTime = originalTs;
                    let targetEnd = startTime + tokenCount * 0.3;
                    if (nextLineStart !== null) {
                        const limit = nextLineStart - 0.1;
                        if (limit - startTime < 0.2) {
                            targetEnd = startTime + tokenCount * 0.25;
                        } else {
                            targetEnd = limit;
                        }
                    }
                    const currentShiftedEnd = lineTokens[lineTokens.length - 1]?.time;
                    if (currentShiftedEnd !== null && currentShiftedEnd !== undefined) {
                        if (currentShiftedEnd - startTime > tokenCount * 0.5) {
                            let potentialEnd = Math.max(targetEnd, currentShiftedEnd);
                            if (nextLineStart !== null && potentialEnd > nextLineStart - 0.1) {
                                potentialEnd = nextLineStart - 0.1;
                            }
                            targetEnd = potentialEnd;
                        }
                    }
                    const dur = Math.max(0.2, targetEnd - startTime);
                    const step = dur / tokenCount;
                    for (let k = 0; k < lineTokens.length; k++) {
                        lineTokens[k].time = startTime + k * step;
                    }
                    currentLastTime = lineTokens[lineTokens.length - 1]!.time!;
                }
            }
        }

        // 6d. Final hard boundary safety check
        if (nextLineStart !== null) {
            const hardLimit = nextLineStart - 0.05;
            let lastValidIdx = -1;
            let lastValidTime2: number | null = null;
            for (let k = lineTokens.length - 1; k >= 0; k--) {
                if (lineTokens[k].time !== null) {
                    lastValidIdx = k;
                    lastValidTime2 = lineTokens[k].time;
                    break;
                }
            }
            if (lastValidIdx !== -1 && lastValidTime2 !== null && lastValidTime2 > hardLimit) {
                let startValidIdx = 0;
                let startT = 0.0;
                for (let k = 0; k < lineTokens.length; k++) {
                    if (lineTokens[k].time !== null) {
                        startValidIdx = k;
                        startT = lineTokens[k].time!;
                        break;
                    }
                }
                if (startT >= hardLimit) startT = Math.max(0, hardLimit - 0.2);
                let dur = hardLimit - startT;
                if (dur < 0.1) dur = 0.1;
                const count = lastValidIdx - startValidIdx + 1;
                if (count > 0) {
                    const step = dur / count;
                    for (let k = 0; k < count; k++) {
                        lineTokens[startValidIdx + k].time = startT + k * step;
                    }
                }
                currentLastTime = lineTokens[lastValidIdx]!.time!;
            }
        }

        // 6e. Build output Line with Word[] from aligned tokens
        const words = buildWordsFromTokens(lineTokens, originalLine);
        const lineStartTime = words.length > 0 ? words[0].startTime : originalLine.startTime;
        const lineEndTime = words.length > 0 ? words[words.length - 1].endTime : originalLine.endTime;

        resultLines.push({
            ...originalLine,
            words,
            startTime: lineStartTime,
            endTime: lineEndTime,
        });
    }

    return {
        lines: resultLines,
        isWordByWord: true,
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchReplaceRegion(
    userSeq: AlignToken[],
    aiSeq: AiToken[],
    i1: number, i2: number,
    j1: number, j2: number,
    lastValidTime: number,
): number {
    const userSlice = userSeq.slice(i1, i2).map(t => t.cleanText);
    const aiSlice = aiSeq.slice(j1, j2).map(t => t.text);
    if (userSlice.length === 0 || aiSlice.length === 0) return lastValidTime;

    const subMatcher = new SequenceMatcher(userSlice, aiSlice);
    for (const [tag, si1, si2, sj1, sj2] of subMatcher.getOpcodes()) {
        if (tag !== 'equal') continue;
        for (let k = 0; k < si2 - si1; k++) {
            const userIdx = i1 + si1 + k;
            const aiIdx = j1 + sj1 + k;
            let matchedTime = aiSeq[aiIdx].start;
            if (matchedTime < lastValidTime) {
                matchedTime = lastValidTime;
            }
            userSeq[userIdx].time = matchedTime;
            lastValidTime = matchedTime;
        }
    }
    return lastValidTime;
}

function cleanHallucinations(lineTokens: AlignToken[]): void {
    const count = lineTokens.length;
    if (count < 2) return;

    for (let k = 0; k < count - 1; k++) {
        const t1 = lineTokens[k].time;
        let t2: number | null = null;
        for (let j = k + 1; j < count; j++) {
            if (lineTokens[j].time !== null) {
                t2 = lineTokens[j].time;
                break;
            }
        }
        if (t1 !== null && t2 !== null && t2 - t1 > HALLUCINATION_GAP) {
            lineTokens[k].time = null;
        }
    }
}

function interpolateTimestamps(lineTokens: AlignToken[], prevLineEndTime: number): void {
    const count = lineTokens.length;
    for (let k = 0; k < count; k++) {
        if (lineTokens[k].time !== null) continue;

        let prevTime = prevLineEndTime;
        for (let j = k - 1; j >= 0; j--) {
            if (lineTokens[j].time !== null) {
                prevTime = lineTokens[j].time!;
                break;
            }
        }

        let nextTime: number | null = null;
        let stepsToNext = 0;
        for (let j = k + 1; j < count; j++) {
            if (lineTokens[j].time !== null) {
                nextTime = lineTokens[j].time;
                break;
            }
            stepsToNext++;
        }

        if (nextTime !== null) {
            const gap = nextTime - prevTime;
            if (gap > SMOOTH_INTERP_GAP) {
                // Right-adsorption strategy
                const estDuration = 0.3;
                const backCalcTime = nextTime - (stepsToNext + 1) * estDuration;
                lineTokens[k].time = Math.max(prevTime + 0.1, backCalcTime);
            } else {
                // Smooth interpolation
                const steps = stepsToNext + 1;
                let stepGap = gap / (steps + 1);
                stepGap = Math.max(MIN_DURATION, Math.min(stepGap, 0.4));
                lineTokens[k].time = prevTime + stepGap;
            }
        } else {
            // Left-adsorption
            lineTokens[k].time = prevTime + 0.25;
        }
    }
}

/**
 * Build Folia Word[] from aligned tokens.
 * Groups consecutive tokens into words based on the original line's word boundaries,
 * or creates one word per token if the original line had no word-level data.
 */
function buildWordsFromTokens(tokens: AlignToken[], originalLine: Line): Word[] {
    if (tokens.length === 0) return [];

    // If the original line already has words, try to map tokens back to those words
    if (originalLine.words.length > 0) {
        return mapTokensToExistingWords(tokens, originalLine);
    }

    // No existing words: create one Word per token group (consecutive tokens with no space-pre)
    const words: Word[] = [];
    let currentWordText = '';
    let currentWordStart: number | null = null;
    let currentWordEnd: number | null = null;

    const flushWord = () => {
        if (currentWordText && currentWordStart !== null && currentWordEnd !== null) {
            words.push({
                text: currentWordText,
                startTime: currentWordStart,
                endTime: currentWordEnd,
            });
        }
        currentWordText = '';
        currentWordStart = null;
        currentWordEnd = null;
    };

    for (const token of tokens) {
        const tokenTime = token.time ?? 0;
        const tokenEnd = tokenTime + 0.1; // estimate end time

        // If this token has leading whitespace, it starts a new word
        if (token.pre.trim().length > 0 && currentWordText) {
            flushWord();
            currentWordText = token.pre + token.text;
        } else if (token.pre.includes(' ') && currentWordText) {
            // Space before token = new word
            flushWord();
            currentWordText = token.text;
        } else {
            currentWordText += token.pre + token.text;
        }

        if (currentWordStart === null) {
            currentWordStart = tokenTime;
        }
        currentWordEnd = tokenEnd;
    }

    flushWord();
    return words;
}

/**
 * Map aligned tokens back to existing Word boundaries in the original line.
 * This preserves the original word grouping while updating timestamps.
 */
function mapTokensToExistingWords(tokens: AlignToken[], originalLine: Line): Word[] {
    const result: Word[] = [];
    let tokenCursor = 0;

    for (const word of originalLine.words) {
        const wordText = word.text;
        if (!wordText) {
            result.push({ ...word });
            continue;
        }

        // Find tokens that correspond to this word
        const wordStartTime = findWordStartTime(tokens, tokenCursor, wordText);
        const wordEndTime = findWordEndTime(tokens, tokenCursor, wordText, wordStartTime);

        result.push({
            ...word,
            startTime: wordStartTime ?? word.startTime,
            endTime: wordEndTime ?? word.endTime,
        });

        // Advance cursor past tokens consumed for this word
        tokenCursor = advanceCursorPastWord(tokens, tokenCursor, wordText);
    }

    return result;
}

function findWordStartTime(
    tokens: AlignToken[],
    startCursor: number,
    wordText: string,
): number | null {
    // Try to find the first token whose text matches the start of wordText
    const cleanWord = cleanToken(wordText);
    for (let i = startCursor; i < tokens.length; i++) {
        if (cleanToken(tokens[i].text) && tokens[i].cleanText === cleanWord.slice(0, tokens[i].cleanText.length)) {
            return tokens[i].time;
        }
        // Also check if the token text is contained in the word
        if (cleanWord.includes(tokens[i].cleanText) && tokens[i].cleanText) {
            return tokens[i].time;
        }
    }
    // Fallback: return the first available time after cursor
    for (let i = startCursor; i < tokens.length; i++) {
        if (tokens[i].time !== null) return tokens[i].time;
    }
    return null;
}

function findWordEndTime(
    tokens: AlignToken[],
    startCursor: number,
    wordText: string,
    startTime: number | null,
): number | null {
    // Estimate end time as start + small offset, or find next word's start
    if (startTime === null) return null;

    const cleanWord = cleanToken(wordText);
    let lastMatchIdx = startCursor;
    for (let i = startCursor; i < tokens.length; i++) {
        if (cleanWord.includes(tokens[i].cleanText) && tokens[i].cleanText) {
            lastMatchIdx = i;
        } else if (tokens[i].cleanText && !cleanWord.includes(tokens[i].cleanText)) {
            break;
        }
    }

    // End time = next token's start, or start + 0.3s
    if (lastMatchIdx + 1 < tokens.length && tokens[lastMatchIdx + 1].time !== null) {
        return tokens[lastMatchIdx + 1].time;
    }
    return startTime + 0.3;
}

function advanceCursorPastWord(
    tokens: AlignToken[],
    startCursor: number,
    wordText: string,
): number {
    const cleanWord = cleanToken(wordText);
    let matchedChars = 0;
    for (let i = startCursor; i < tokens.length; i++) {
        if (cleanWord.slice(matchedChars).startsWith(tokens[i].cleanText)) {
            matchedChars += tokens[i].cleanText.length;
            if (matchedChars >= cleanWord.length) {
                return i + 1;
            }
        }
    }
    return startCursor + 1; // fallback: advance by 1
}

// ---------------------------------------------------------------------------
// Convenience: check if a LyricData needs word-level alignment
// ---------------------------------------------------------------------------

/**
 * Returns true if the given LyricData lacks word-level timing and could
 * benefit from Whisper-based alignment.
 */
export function needsWordAlignment(lyrics: LyricData | null): boolean {
    if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) return false;
    if (lyrics.isWordByWord) return false;

    // Check if any line has words with actual timing
    const hasAnyWords = lyrics.lines.some(
        line => line.words && line.words.length > 0 && line.words.some(w => w.endTime > w.startTime)
    );
    return !hasAnyWords;
}

/**
 * Returns true if the lyrics have line-level timestamps but no word-level detail.
 * This is the ideal candidate for Whisper alignment.
 */
export function hasLineTimingButNoWordTiming(lyrics: LyricData | null): boolean {
    if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) return false;

    const hasLineTiming = lyrics.lines.some(
        line => line.startTime > 0 && line.endTime > line.startTime
    );
    if (!hasLineTiming) return false;

    // No meaningful word timing
    const hasWordTiming = lyrics.lines.some(
        line => line.words && line.words.length > 0 && line.words.some(w => w.endTime > w.startTime + 0.01)
    );

    return !hasWordTiming;
}