import type { LyricData } from '../../types';

// src/utils/lyrics/detectLyricLanguage.ts
// Infers the transcription language for a Whisper word-level alignment pass from the lyric text.
//
// Whisper's own auto-detect samples the audio head, which on songs is often an instrumental
// intro — it then falls back to English and transcribes a Chinese/Japanese/Korean track in the
// wrong language (matchRate=0). The lyric text is a far more reliable signal for the CJK family
// because their scripts are visually unique:
//   - Kana (hiragana/katakana) appear only in Japanese, never in Chinese lyrics.
//   - Hangul is Korean-only.
//   - Han characters shared by Chinese/Japanese are disambiguated by the presence of kana.
//
// Only the CJK family is resolved here (scripts are unambiguous). Pure-Latin or otherwise
// undeterminable lyrics return undefined, leaving Whisper's auto-detect in charge — correct for
// English and usually fine for other European languages. Callers may still override this via an
// explicit language option or the whisperAlignLanguage user setting.

// Minimum number of Han characters required before declaring Chinese, so an occasional single
// borrowed ideograph in an otherwise Latin/Japanese line does not misclassify the whole track.
const CJK_HAN_THRESHOLD = 4;

/**
 * Detect the likely transcription language from lyric text.
 *
 * @param lyrics - Parsed lyric data; its lines' fullText (falling back to joined word text) is scanned.
 * @returns A Whisper language code ('ja' | 'ko' | 'zh'), or undefined when the script gives no
 *          reliable CJK signal (pure-Latin / undetermined) and auto-detect should be used.
 */
export function detectLyricLanguage(lyrics: LyricData | null | undefined): string | undefined {
    if (!lyrics?.lines?.length) return undefined;

    // Concatenate every line's text. Prefer the canonical fullText; fall back to joining word
    // fragments so parsers that only populate Line.words still yield a scannable string.
    const sample = lyrics.lines
        .map(line => line.fullText || (line.words?.map(w => w.text).join('') ?? ''))
        .join('\n');

    if (!sample) return undefined;

    let kana = 0;    // Hiragana + Katakana — Japanese-exclusive script.
    let hangul = 0;  // Korean-exclusive script.
    let han = 0;     // CJK Unified Ideographs — shared by Chinese and Japanese.

    for (const ch of sample) {
        const code = ch.codePointAt(0)!;
        if (code >= 0x3040 && code <= 0x30ff) kana++;        // Hiragana + Katakana
        else if (code >= 0xac00 && code <= 0xd7af) hangul++;  // Hangul syllables
        else if (code >= 0x4e00 && code <= 0x9fff) han++;    // CJK Unified Ideographs
    }

    // Kana is the strongest Japanese marker: Japanese lyrics mix kanji (Han) with kana, while
    // Chinese lyrics never contain kana. Check it before Han so kanji-heavy Japanese stays 'ja'.
    if (kana > 0) return 'ja';
    if (hangul > 0) return 'ko';
    // Han alone (no kana) with enough occurrences is Chinese. Below the threshold we cannot tell
    // an ideograph-borrowing Latin lyric from a very short Chinese one, so defer to auto-detect.
    if (han >= CJK_HAN_THRESHOLD) return 'zh';

    return undefined;
}
