import { describe, expect, it } from 'vitest';
import { alignWhisperToLyrics, type WhisperResult } from '@/utils/lyrics/wordAligner';
import type { Line } from '@/types';

// test/unit/lyrics/wordAlignerLineLock.test.ts
// The line-level timeline is the lyric's, not Whisper's.
//
// A listener reported word-by-word lyrics that still sat offset from the singing after alignment.
// The cause was cumulative: step 5 back-fills token times under a GLOBAL monotonic clamp, so a
// Whisper that runs a little late ratchets every following line a little later still, and the old
// "force calibration" only pulled a line back once it had drifted more than 1.5s. Every smaller
// per-line error - the common case - survived, and they stacked into a visible offset by the chorus.
//
// The fix locks each line's start to its ORIGINAL LRC timestamp with no threshold: the first word is
// pinned there and the rest of the line shifts by the same amount, so Whisper still shapes the rhythm
// inside a line but can never move where the line begins. These tests pin that invariant down: the
// drift here is deliberately UNDER the old 1.5s gate on every line, which is exactly what used to slip
// through.
//
// A second tier covers the OTHER way a lyric sits off the singing: a CONSTANT whole-timeline offset
// (the source LRC is a fixed Δ from the audio, as when an online track is matched to another
// provider's LRC). The line lock faithfully preserves that Δ, so a separate post-pass slides the
// entire timeline onto the singing — one uniform shift, gated on the per-line corrections clustering
// tightly (low MAD) so cumulative drift is never mistaken for a constant offset and double-corrected.

/** A minimal Line with the fields the aligner reads; `words` empty so it builds them from tokens. */
const line = (fullText: string, startTime: number, endTime: number): Line => ({
    words: [], startTime, endTime, fullText,
});

// Whisper heard the same words but a little late on every line: +0.6s, +1.0s, +1.5s. None of these
// exceeds the retired 1.5s threshold (the last is exactly on it, and the old test was `> threshold`),
// so the old aligner would have left all three lines drifted.
const driftedWhisper: WhisperResult = {
    segments: [
        { start: 10.6, end: 11.4, text: 'hello world', words: [
            { word: 'hello', start: 10.6, end: 10.9 },
            { word: 'world', start: 11.0, end: 11.4 },
        ] },
        { start: 16.0, end: 17.0, text: 'goodbye friend', words: [
            { word: 'goodbye', start: 16.0, end: 16.4 },
            { word: 'friend', start: 16.6, end: 17.0 },
        ] },
        { start: 21.5, end: 22.0, text: 'thanks', words: [
            { word: 'thanks', start: 21.5, end: 22.0 },
        ] },
    ],
};

const lyricLines = [
    line('hello world', 10.0, 14.0),
    line('goodbye friend', 15.0, 19.0),
    line('thanks', 20.0, 24.0),
];

describe('alignWhisperToLyrics locks the line-level timeline', () => {
    const result = alignWhisperToLyrics(driftedWhisper, lyricLines, { enableForceCalibration: true });

    it('emits each line at its ORIGINAL LRC start, not Whisper’s drifted one', () => {
        // Exact equality: line.startTime is passed straight through from the lyric, never recomputed
        // from words[0]. This is the invariant the whole fix rests on.
        expect(result.lines[0].startTime).toBe(10.0);
        expect(result.lines[1].startTime).toBe(15.0);
        expect(result.lines[2].startTime).toBe(20.0);
    });

    it('pins the first word of every line to that original start', () => {
        // Word times go through float arithmetic (a shift by the drift), so allow rounding noise.
        expect(result.lines[0].words[0].startTime).toBeCloseTo(10.0, 5);
        expect(result.lines[1].words[0].startTime).toBeCloseTo(15.0, 5);
        expect(result.lines[2].words[0].startTime).toBeCloseTo(20.0, 5);
    });

    it('keeps Whisper’s rhythm INSIDE the line, measured from the locked start', () => {
        // "hello"->"world" was 0.4s apart in Whisper; the lock shifts both, so the gap survives.
        const [w0, w1] = result.lines[0].words;
        expect(w1.startTime - w0.startTime).toBeCloseTo(0.4, 5);
    });

    it('never lets a line’s words run into the next line’s start', () => {
        for (let i = 0; i + 1 < result.lines.length; i++) {
            const lastWord = result.lines[i].words[result.lines[i].words.length - 1];
            expect(lastWord.startTime).toBeLessThan(result.lines[i + 1].startTime);
        }
    });

    it('still reports the result as真逐字 (isWordByWord)', () => {
        expect(result.isWordByWord).toBe(true);
    });

    it('leaves the line starts alone when Whisper already agrees with the LRC', () => {
        // A zero-drift run must be a no-op on the timeline, not a source of new jitter.
        const aligned: WhisperResult = { segments: [
            { start: 10.0, end: 11.0, text: 'hello world', words: [
                { word: 'hello', start: 10.0, end: 10.4 },
                { word: 'world', start: 10.5, end: 11.0 },
            ] },
        ] };
        const r = alignWhisperToLyrics(aligned, [line('hello world', 10.0, 14.0)], {});
        expect(r.lines[0].startTime).toBe(10.0);
        expect(r.lines[0].words[0].startTime).toBeCloseTo(10.0, 5);
        expect(r.lines[0].words[1].startTime).toBeCloseTo(10.5, 5);
    });

    it('treats that cumulative drift as NOT a global offset (MAD gate stands down)', () => {
        // The drifts here (+0.6/+1.0/+1.5) spread into a trend, not a constant Δ, so the global
        // correction must stand down (spread 0.4s > the 0.35s gate) and leave the pure LRC lock intact.
        expect(result.alignDiagnostics?.globalOffsetMs).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tier 2: a CONSTANT whole-timeline offset (the source LRC sits a fixed Δ from the audio)
// ---------------------------------------------------------------------------

describe('alignWhisperToLyrics corrects a constant whole-timeline offset', () => {
    // Whisper hears the actual singing at ~8.5/13.5/18.5/23.5; the source LRC sits a near-constant
    // 1.5s LATE on every line (10/15/20/25) — the signature of an online track matched to another
    // provider's LRC. Per-line jitter is tiny (±0.05s), so this is a systematic offset, not drift.
    const constantOffsetWhisper: WhisperResult = {
        segments: [
            { start: 8.5, end: 9.3, text: 'hello world', words: [
                { word: 'hello', start: 8.5, end: 8.9 },
                { word: 'world', start: 9.0, end: 9.3 },
            ] },
            { start: 13.55, end: 14.3, text: 'goodbye friend', words: [
                { word: 'goodbye', start: 13.55, end: 13.9 },
                { word: 'friend', start: 14.0, end: 14.3 },
            ] },
            { start: 18.45, end: 19.3, text: 'thanks again', words: [
                { word: 'thanks', start: 18.45, end: 18.9 },
                { word: 'again', start: 19.0, end: 19.3 },
            ] },
            { start: 23.5, end: 24.3, text: 'my friend', words: [
                { word: 'my', start: 23.5, end: 23.9 },
                { word: 'friend', start: 24.0, end: 24.3 },
            ] },
        ],
    };

    const offsetLyricLines = [
        line('hello world', 10.0, 14.0),
        line('goodbye friend', 15.0, 19.0),
        line('thanks again', 20.0, 24.0),
        line('my friend', 25.0, 29.0),
    ];

    const corrected = alignWhisperToLyrics(constantOffsetWhisper, offsetLyricLines, { enableForceCalibration: true });

    it('slides every line onto the singing by the one constant Δ', () => {
        // LRC 10/15/20/25 minus Δ(1.5) → the Whisper-heard 8.5/13.5/18.5/23.5.
        expect(corrected.lines[0].startTime).toBeCloseTo(8.5, 5);
        expect(corrected.lines[1].startTime).toBeCloseTo(13.5, 5);
        expect(corrected.lines[2].startTime).toBeCloseTo(18.5, 5);
        expect(corrected.lines[3].startTime).toBeCloseTo(23.5, 5);
    });

    it('reports the applied shift in the diagnostics', () => {
        expect(corrected.alignDiagnostics?.globalOffsetMs).toBe(1500);
    });

    it('keeps the LRC’s RELATIVE line spacing exactly — a uniform shift, not a re-time', () => {
        // The 5s gaps of the source LRC survive untouched; only the global position moved.
        expect(corrected.lines[1].startTime - corrected.lines[0].startTime).toBeCloseTo(5.0, 5);
        expect(corrected.lines[2].startTime - corrected.lines[1].startTime).toBeCloseTo(5.0, 5);
        expect(corrected.lines[3].startTime - corrected.lines[2].startTime).toBeCloseTo(5.0, 5);
    });

    it('moves the first word of each line together with its line', () => {
        expect(corrected.lines[0].words[0].startTime).toBeCloseTo(8.5, 5);
        expect(corrected.lines[3].words[0].startTime).toBeCloseTo(23.5, 5);
    });

    it('stands down when turned off, keeping the pure LRC lock', () => {
        const off = alignWhisperToLyrics(constantOffsetWhisper, offsetLyricLines, {
            enableForceCalibration: true, enableGlobalOffsetCorrection: false,
        });
        expect(off.lines[0].startTime).toBe(10.0);
        expect(off.alignDiagnostics?.globalOffsetMs).toBe(0);
    });

    it('ignores a sub-perceptual offset (below the 0.25s floor)', () => {
        // The LRC is only 0.1s late on every line — under GLOBAL_OFFSET_MIN_SHIFT, so not worth
        // touching; the timeline stays exactly on the LRC.
        const tiny: WhisperResult = { segments: [
            { start: 9.9, end: 10.3, text: 'hello world', words: [
                { word: 'hello', start: 9.9, end: 10.1 }, { word: 'world', start: 10.2, end: 10.3 }] },
            { start: 14.9, end: 15.3, text: 'goodbye friend', words: [
                { word: 'goodbye', start: 14.9, end: 15.1 }, { word: 'friend', start: 15.2, end: 15.3 }] },
            { start: 19.9, end: 20.3, text: 'thanks again', words: [
                { word: 'thanks', start: 19.9, end: 20.1 }, { word: 'again', start: 20.2, end: 20.3 }] },
        ] };
        const r = alignWhisperToLyrics(tiny, [
            line('hello world', 10.0, 14.0),
            line('goodbye friend', 15.0, 19.0),
            line('thanks again', 20.0, 24.0),
        ], {});
        expect(r.lines[0].startTime).toBe(10.0);
        expect(r.alignDiagnostics?.globalOffsetMs).toBe(0);
    });
});
