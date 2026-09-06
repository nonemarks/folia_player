// src/components/shared/WhisperAlignButton.tsx
// Manual trigger button for Whisper word-level lyric alignment.

import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2, Check, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LyricData, LocalSong, SongResult } from '../../types';
import { alignLyricsWithWhisper, cancelAlignment, shouldAlignLyrics, type WhisperAlignJob } from '../../services/whisperAlignService';
import { useWhisperSettingsStore } from '../../stores/useWhisperSettingsStore';

interface WhisperAlignButtonProps {
    song: LocalSong | SongResult;
    lyrics: LyricData | null;
    onLyricsUpdated: (lyrics: LyricData | null) => void;
    isDaylight: boolean;
}

type AlignStatus = 'idle' | 'aligning' | 'success' | 'error';

const WhisperAlignButton: React.FC<WhisperAlignButtonProps> = ({
    song,
    lyrics,
    onLyricsUpdated,
    isDaylight,
}) => {
    const { t } = useTranslation();
    // Respect the user's chosen model on this inline button too. It previously passed no model, so
    // alignLyricsWithWhisper fell back to 'base' regardless of the setting — the same miss already
    // fixed on the other four align entry points (settings panel / auto-align / force-regenerate / auto-match).
    const whisperAlignModel = useWhisperSettingsStore(state => state.whisperAlignModel);
    const [status, setStatus] = useState<AlignStatus>('idle');
    const [progressLabel, setProgressLabel] = useState('');
    const [progressPercent, setProgressPercent] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');

    // Mirror the alignment service's predicate so the button is only offered when the service
    // will actually run; otherwise a click silently returns null and the bar disappears.
    const canAlign = shouldAlignLyrics(lyrics);
    // Only genuine word-level sources set isWordByWord; the averaged pseudo-words the LRC
    // parser synthesises do not, so line-level tracks still offer the align button.
    const alreadyAligned = !!lyrics?.isWordByWord;

    const handleAlign = useCallback(async () => {
        if (status === 'aligning') {
            cancelAlignment();
            setStatus('idle');
            setProgressLabel('');
            return;
        }

        setStatus('aligning');
        setProgressLabel(t('options.whisperAlignPreparing'));
        setProgressPercent(0);
        setErrorMsg('');

        // Yield to React to ensure the progress bar renders before the async work starts.
        // Without this, if alignLyricsWithWhisper throws quickly (e.g. Whisper not available),
        // React batches the 'aligning'→'error' state updates and the progress bar never appears.
        await new Promise(resolve => setTimeout(resolve, 50));

        // Track start time to ensure the progress bar is visible for at least 1.5 seconds
        // so the user gets visual feedback even if the operation completes instantly.
        const startTime = Date.now();
        const minVisibleMs = 1500;

        const ensureMinVisible = async () => {
            const elapsed = Date.now() - startTime;
            if (elapsed < minVisibleMs) {
                await new Promise(resolve => setTimeout(resolve, minVisibleMs - elapsed));
            }
        };

        try {
            const result = await alignLyricsWithWhisper(song, lyrics!, {
                model: whisperAlignModel,
                onProgress: (job: WhisperAlignJob) => {
                    setProgressPercent(job.progress ?? 0);
                    switch (job.status) {
                        case 'preparing-audio':
                            setProgressLabel(t('options.whisperAlignPreparing'));
                            break;
                        case 'transcribing':
                            setProgressLabel(t('options.whisperAlignTranscribing'));
                            break;
                        case 'aligning':
                            setProgressLabel(t('options.whisperAlignAligning'));
                            break;
                        case 'completed':
                            setProgressLabel(t('options.whisperAlignCompleted'));
                            break;
                        case 'error':
                            setProgressLabel(t('options.whisperAlignError', { error: job.error || 'Unknown' }));
                            break;
                        default:
                            break;
                    }
                },
            });

            // Ensure progress bar is visible for at least minVisibleMs
            await ensureMinVisible();

            if (result) {
                onLyricsUpdated(result);
                setStatus('success');
                setTimeout(() => setStatus('idle'), 3000);
            } else {
                // result is null — this means the job was cancelled (not an error)
                // Errors are now thrown and handled in the catch block
                setStatus('idle');
            }
        } catch (err) {
            // Ensure progress bar is visible for at least minVisibleMs before showing error
            await ensureMinVisible();

            setStatus('error');
            const rawMsg = err instanceof Error ? err.message : String(err);
            const failureDetail = (err as any)?.audioFailureReason;
            // Check if the error message contains diagnostic info from the main process
            // For i18n keys like 'options.whisperAlignNoSegments', use translation;
            // for diagnostic messages from main process, display directly
            const isI18nKey = rawMsg.startsWith('options.');
            const baseMsg = isI18nKey ? t(rawMsg) : rawMsg;
            setErrorMsg(failureDetail ? `${baseMsg} (${failureDetail})` : baseMsg);
            // Don't auto-dismiss error — let the user read it and retry manually
        }
    }, [song, lyrics, onLyricsUpdated, status, t, whisperAlignModel]);

    // Don't render if already word-by-word or there is nothing alignable
    if (alreadyAligned || !canAlign) {
        return null;
    }

    const buttonBaseClass = `p-1 rounded-md transition-all ${
        isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'
    }`;

    if (status === 'aligning') {
        return (
            <div className="flex items-center gap-1.5" title={progressLabel}>
                <Loader2 size={14} className="animate-spin opacity-70" />
                <div className="flex flex-col gap-0.5 min-w-[60px]">
                    <span className="text-[10px] opacity-70 truncate leading-none">{progressLabel}</span>
                    <div className="h-1 w-full rounded-full overflow-hidden" style={{ backgroundColor: isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)' }}>
                        <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                                width: `${Math.max(5, progressPercent)}%`,
                                backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.8))',
                            }}
                        />
                    </div>
                </div>
                <span className="text-[9px] opacity-50 tabular-nums">{progressPercent}%</span>
            </div>
        );
    }

    if (status === 'success') {
        return (
            <button
                className={`${buttonBaseClass} opacity-80`}
                title={t('options.whisperAlignCompleted')}
            >
                <Check size={14} className="text-green-400" />
            </button>
        );
    }

    if (status === 'error') {
        const displayMsg = errorMsg || t('options.whisperAlignError', { error: 'Unknown' });
        return (
            <div
                className="flex items-start gap-1.5 max-w-[280px] cursor-pointer"
                onClick={handleAlign}
                title={displayMsg}
            >
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-red-400 leading-tight line-clamp-3">{displayMsg}</span>
            </div>
        );
    }

    return (
        <button
            onClick={handleAlign}
            className={`${buttonBaseClass} opacity-40 hover:opacity-100`}
            title={t('options.whisperAlignTriggerDesc')}
        >
            <Sparkles size={14} />
        </button>
    );
};

export default WhisperAlignButton;