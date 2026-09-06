import { useEffect, useRef, useCallback } from 'react';
import type { LyricData } from '../types';
import type { LocalSong, SongResult } from '../types';
import { autoAlignIfNeeded, cancelAlignment } from '../services/whisperAlignService';
import { useWhisperSettingsStore } from '../stores/useWhisperSettingsStore';

type AnySong = LocalSong | SongResult;

/**
 * Hook that automatically triggers Whisper word-level alignment
 * when lyrics are loaded without word-level timing.
 */
export function useWhisperAutoAlign(
    lyrics: LyricData | null,
    currentSong: AnySong | null,
    setLyrics: (lyrics: LyricData | null) => void,
) {
    const whisperAlignEnabled = useWhisperSettingsStore(state => state.whisperAlignEnabled);
    // Respect the user's chosen model on the automatic path too. This hook previously passed no
    // model, so alignLyricsWithWhisper fell back to 'base' regardless of the setting. On
    // instrumental-heavy tracks (e.g. EDM) base under-detects badly — a 227s song yielded only 8
    // segments vs 86 for medium — leaving most lyric lines with no Whisper time, so force
    // calibration fell back to evenly spreading the original LRC line time and the whole timeline
    // ended up misaligned.
    const whisperAlignModel = useWhisperSettingsStore(state => state.whisperAlignModel);
    const lastAlignedSongIdRef = useRef<string | null>(null);
    const isAligningRef = useRef(false);

    const handleAligned = useCallback(
        (alignedLyrics: LyricData) => {
            isAligningRef.current = false;
            setLyrics(alignedLyrics);
        },
        [setLyrics],
    );

    useEffect(() => {
        const songId: string | null = currentSong?.id ? String(currentSong.id) : null;

        // Reset alignment state when song changes
        if (songId !== lastAlignedSongIdRef.current) {
            lastAlignedSongIdRef.current = songId;
            isAligningRef.current = false;
        }

        // Don't auto-align if disabled, no song, no lyrics, or already aligning
        if (!whisperAlignEnabled || !currentSong || !lyrics || isAligningRef.current) {
            return;
        }

        // Only attempt alignment if lyrics have line timing but no word timing
        // and haven't been aligned yet for this song
        if (lyrics.isWordByWord) {
            return;
        }

        // Check if lyrics have any timing at all (need at least line-level timing)
        const hasLineTiming = lyrics.lines.some(line => line.startTime != null && line.endTime != null);
        if (!hasLineTiming) {
            return;
        }

        isAligningRef.current = true;

        let cancelled = false;
        const runAlignment = async () => {
            try {
                const alignedLyrics = await autoAlignIfNeeded(currentSong, lyrics, {
                    model: whisperAlignModel,
                    onProgress: () => {
                        // Progress updates - could be used for UI feedback
                    },
                });

                if (!cancelled && alignedLyrics) {
                    handleAligned(alignedLyrics);
                } else {
                    isAligningRef.current = false;
                }
            } catch (error) {
                console.warn('[WhisperAutoAlign] Auto-alignment failed:', error);
                isAligningRef.current = false;
            }
        };

        runAlignment();

        return () => {
            cancelled = true;
            cancelAlignment();
        };
    }, [lyrics, currentSong, whisperAlignEnabled, whisperAlignModel, handleAligned]);
}