// src/components/shared/WhisperSettingsPanel.tsx
// Settings and live monitoring panel for Whisper alignment.
// Used in LyricMatchModal when the "Whisper" tab is selected.

import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2, Check, AlertCircle, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong, SongResult, LyricData } from '../../types';
import { useWhisperSettingsStore } from '../../stores/useWhisperSettingsStore';
import { alignLyricsWithWhisper, cancelAlignment, shouldAlignLyrics, type WhisperAlignJob } from '../../services/whisperAlignService';
import WhisperEnvCheck from './WhisperEnvCheck';
import WhisperAutoAlignToggle from './WhisperAutoAlignToggle';
import WhisperModelSelector from './WhisperModelSelector';
import WhisperLanguageSelector from './WhisperLanguageSelector';
import WhisperVocalSeparationToggle from './WhisperVocalSeparationToggle';

interface WhisperSettingsPanelProps {
    song: LocalSong | SongResult;
    lyrics: LyricData | null;
    onLyricsUpdated: (lyrics: LyricData | null) => void;
    isDaylight: boolean;
}

type AlignStatus = 'idle' | 'aligning' | 'success' | 'error';

const WhisperSettingsPanel: React.FC<WhisperSettingsPanelProps> = ({
    song,
    lyrics,
    onLyricsUpdated,
    isDaylight,
}) => {
    const { t } = useTranslation();
    // Only the active model is needed here (for manual alignment); the toggle and
    // model-selector UI read the store themselves via the shared components.
    const whisperAlignModel = useWhisperSettingsStore(state => state.whisperAlignModel);

    // Manual alignment state
    const [alignStatus, setAlignStatus] = useState<AlignStatus>('idle');
    const [progressLabel, setProgressLabel] = useState('');
    const [progressPercent, setProgressPercent] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');

    // Use the exact predicate the alignment service applies, so the UI never offers a click
    // that the service will silently skip (which made the progress bar vanish with no reason).
    const canAlign = shouldAlignLyrics(lyrics);
    // Only a genuine word-level source sets isWordByWord. The averaged pseudo-words the LRC
    // parser synthesises do not, so they must not be shown as "already aligned" — that would
    // block the user from running Whisper to replace the inaccurate averaged timing.
    const alreadyAligned = !!lyrics?.isWordByWord;

    const handleManualAlign = useCallback(async () => {
        if (alignStatus === 'aligning') {
            cancelAlignment();
            setAlignStatus('idle');
            setProgressLabel('');
            return;
        }

        if (!lyrics || !canAlign) return;

        setAlignStatus('aligning');
        setProgressLabel(t('options.whisperAlignPreparing'));
        setProgressPercent(0);
        setErrorMsg('');

        // Yield to React to ensure the progress bar renders before the async work starts
        await new Promise(resolve => setTimeout(resolve, 50));

        // Track start time to ensure the progress bar is visible for at least 1.5 seconds
        const startTime = Date.now();
        const minVisibleMs = 1500;

        const ensureMinVisible = async () => {
            const elapsed = Date.now() - startTime;
            if (elapsed < minVisibleMs) {
                await new Promise(resolve => setTimeout(resolve, minVisibleMs - elapsed));
            }
        };

        try {
            const result = await alignLyricsWithWhisper(song, lyrics, {
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
                setAlignStatus('success');
                setTimeout(() => setAlignStatus('idle'), 3000);
            } else {
                // result is null — this means the job was cancelled (not an error)
                // Errors are now thrown and handled in the catch block
                setAlignStatus('idle');
            }
        } catch (err) {
            // Ensure progress bar is visible for at least minVisibleMs before showing error
            await ensureMinVisible();

            setAlignStatus('error');
            const rawMsg = err instanceof Error ? err.message : String(err);
            const failureDetail = (err as any)?.audioFailureReason;
            // Check if the error message contains diagnostic info from the main process
            const isI18nKey = rawMsg.startsWith('options.');
            const baseMsg = isI18nKey ? t(rawMsg) : rawMsg;
            setErrorMsg(failureDetail ? `${baseMsg} (${failureDetail})` : baseMsg);
            // Don't auto-dismiss error — let the user read it and retry manually
        }
    }, [song, lyrics, canAlign, whisperAlignModel, onLyricsUpdated, alignStatus, t]);

    // Theme helpers
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';

    return (
        <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
            {/* Section 1: Environment Status */}
            <div className={`p-4 border-b ${borderColor}`}>
                <div className="flex items-center gap-2 mb-3">
                    <Activity size={14} className={textSecondary} />
                    <span className={`text-sm font-semibold ${textPrimary}`}>
                        {t('localMusic.whisperTabEnvStatus')}
                    </span>
                </div>
                <WhisperEnvCheck alwaysShow>
                    {/* Model selector - rendered inside WhisperEnvCheck when env is ready */}
                    <WhisperModelSelector />
                    <WhisperLanguageSelector />
                    <WhisperVocalSeparationToggle />
                </WhisperEnvCheck>
            </div>

            {/* Section 2: Auto-align toggle */}
            <div className={`p-4 border-b ${borderColor}`}>
                <WhisperAutoAlignToggle isDaylight={isDaylight} />
            </div>

            {/* Section 3: Manual alignment trigger + live status */}
            <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={14} className={textSecondary} />
                    <span className={`text-sm font-semibold ${textPrimary}`}>
                        {t('localMusic.whisperTabManualAlign')}
                    </span>
                </div>

                {/* Status info */}
                {alreadyAligned && (
                    <div className="flex items-center gap-2 mb-3 text-xs text-green-400">
                        <Check size={12} />
                        <span>{t('localMusic.whisperTabAlreadyAligned')}</span>
                    </div>
                )}

                {!canAlign && !alreadyAligned && (
                    <div className="flex items-start gap-2 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <AlertCircle size={12} className="shrink-0 mt-0.5 text-amber-400" />
                        <span>{t('localMusic.whisperTabNoLineTiming')}</span>
                    </div>
                )}

                {/* Manual align button */}
                {alignStatus === 'idle' && (
                    <button
                        type="button"
                        onClick={handleManualAlign}
                        disabled={!canAlign}
                        className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                            borderColor: 'var(--accent-color, rgba(99, 102, 241, 0.5))',
                            backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.1))',
                            color: 'var(--text-primary)',
                        }}
                    >
                        <Sparkles size={14} />
                        {t('options.whisperAlignTrigger')}
                    </button>
                )}

                {alignStatus === 'aligning' && (
                    <div className="space-y-3">
                        <button
                            type="button"
                            onClick={handleManualAlign}
                            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors opacity-80 hover:opacity-100"
                            style={{
                                borderColor: 'rgba(248, 113, 113, 0.4)',
                                backgroundColor: 'rgba(248, 113, 113, 0.08)',
                                color: 'var(--text-primary)',
                            }}
                        >
                            <Loader2 size={14} className="animate-spin" />
                            {t('localMusic.whisperTabCancel')}
                        </button>
                        {/* Progress bar */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <span className="flex items-center gap-1.5">
                                    <Loader2 size={12} className="animate-spin" />
                                    {progressLabel}
                                </span>
                                <span className="tabular-nums">{progressPercent}%</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}>
                                <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                        width: `${Math.max(3, progressPercent)}%`,
                                        backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.8))',
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {alignStatus === 'success' && (
                    <div className="flex items-center gap-2 text-xs text-green-400">
                        <Check size={12} />
                        <span>{t('options.whisperAlignCompleted')}</span>
                    </div>
                )}

                {alignStatus === 'error' && (
                    <div className="space-y-2">
                        <div className="flex items-start gap-2 text-xs text-red-400">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                            <span>{errorMsg || t('options.whisperAlignError', { error: 'Unknown' })}</span>
                        </div>
                        <button
                            type="button"
                            onClick={handleManualAlign}
                            className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors opacity-80 hover:opacity-100"
                            style={{ borderColor: 'rgba(248, 113, 113, 0.4)', color: 'var(--text-primary)' }}
                        >
                            {t('options.whisperAlignInstallRetry')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WhisperSettingsPanel;