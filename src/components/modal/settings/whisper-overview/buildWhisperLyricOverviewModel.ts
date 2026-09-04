import type { LyricData, WhisperAlignDiagnostics } from '../../../../types';

// src/components/modal/settings/whisper-overview/buildWhisperLyricOverviewModel.ts
// Turns the current LyricData into a display model for the Whisper lyric overview:
// per-line timing rows plus an aggregate summary carrying the alignment quality report.

/** Format seconds as m:ss.cc for compact timeline display. */
export function formatOverviewTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export interface WhisperOverviewWordRow {
    text: string;
    startTime: number;
    endTime: number;
    duration: number;
}

export interface WhisperOverviewLineRow {
    index: number;
    fullText: string;
    translation?: string;
    startTime: number;
    endTime: number;
    duration: number;
    gapToNext: number | null;
    words: WhisperOverviewWordRow[];
}

export type WhisperOverviewQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface WhisperOverviewSummary {
    hasLyrics: boolean;
    lineCount: number;
    isWordByWord: boolean;
    totalWords: number;
    totalDuration: number;
    avgLineDuration: number;
    avgWordsPerLine: number;
    diagnostics: WhisperAlignDiagnostics | null;
    quality: WhisperOverviewQuality;
}

export interface WhisperLyricOverviewModel {
    summary: WhisperOverviewSummary;
    rows: WhisperOverviewLineRow[];
}

/** Rate the alignment from its match rate; no diagnostics (non-Whisper lyrics) is 'unknown'. */
function rateQuality(diagnostics: WhisperAlignDiagnostics | null): WhisperOverviewQuality {
    if (!diagnostics) return 'unknown';
    const r = diagnostics.matchRate;
    if (r >= 85) return 'excellent';
    if (r >= 70) return 'good';
    if (r >= 40) return 'fair';
    return 'poor';
}

/** Build the overview model from the currently loaded lyrics (null-safe). */
export function buildWhisperLyricOverviewModel(lyrics: LyricData | null): WhisperLyricOverviewModel {
    const lines = lyrics?.lines ?? [];
    const rows: WhisperOverviewLineRow[] = lines.map((line, index) => {
        const words = (line.words ?? []).map(w => ({
            text: w.text,
            startTime: w.startTime,
            endTime: w.endTime,
            duration: Math.max(0, w.endTime - w.startTime),
        }));
        const next = lines[index + 1];
        return {
            index,
            fullText: line.fullText,
            translation: line.translation,
            startTime: line.startTime,
            endTime: line.endTime,
            duration: Math.max(0, line.endTime - line.startTime),
            gapToNext: next ? Math.max(0, next.startTime - line.endTime) : null,
            words,
        };
    });

    const diagnostics = lyrics?.alignDiagnostics ?? null;
    const totalWords = rows.reduce((sum, r) => sum + r.words.length, 0);
    const totalDuration = lines.length > 0 ? Math.max(...lines.map(l => l.endTime)) : 0;
    const lineCount = lines.length;

    const summary: WhisperOverviewSummary = {
        hasLyrics: lineCount > 0,
        lineCount,
        isWordByWord: !!lyrics?.isWordByWord,
        totalWords,
        totalDuration,
        avgLineDuration: lineCount > 0 ? rows.reduce((s, r) => s + r.duration, 0) / lineCount : 0,
        avgWordsPerLine: lineCount > 0 ? totalWords / lineCount : 0,
        diagnostics,
        quality: rateQuality(diagnostics),
    };

    return { summary, rows };
}
