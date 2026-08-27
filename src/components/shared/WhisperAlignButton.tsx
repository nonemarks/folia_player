// src/components/shared/WhisperAlignButton.tsx
// Manual trigger button for Whisper word-level lyric alignment.

import React, { useState, useCallback, useEffect } from 'react';
import { Sparkles, Loader2, Check, AlertCircle, Download, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LyricData, LocalSong, SongResult } from '../../types';
import { alignLyricsWithWhisper, cancelAlignment, getWhisperAvailabilityDetail, isWhisperAlignAvailable, downloadWhisperModel, type WhisperAlignJob, type WhisperAvailabilityDetail } from '../../services/whisperAlignService';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';

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
    const whisperAlignEnabled = useSettingsUiStore(state => state.whisperAlignEnabled);
    const [status, setStatus] = useState<AlignStatus>('idle');
    const [progressLabel, setProgressLabel] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [whisperAvailability, setWhisperAvailability] = useState<WhisperAvailabilityDetail | null>(null);

    // Check Whisper availability on mount
    useEffect(() => {
        getWhisperAvailabilityDetail().then(setWhisperAvailability);
    }, []);

    // Don't show button if lyrics already have word-level timing
    const isWordByWord = !!lyrics?.isWordByWord;
    // Don't show if no line timing at all (need at least line timing to align)
    const hasLineTiming = lyrics?.lines?.some(l => l.startTime != null && l.endTime != null) ?? false;

    const handleAlign = useCallback(async () => {
        if (status === 'aligning') {
            cancelAlignment();
            setStatus('idle');
            setProgressLabel('');
            return;
        }

        setStatus('aligning');
        setProgressLabel(t('options.whisperAlignPreparing'));
        setErrorMsg('');

        try {
            const result = await alignLyricsWithWhisper(song, lyrics!, {
                onProgress: (job: WhisperAlignJob) => {
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

            if (result) {
                onLyricsUpdated(result);
                setStatus('success');
                setTimeout(() => setStatus('idle'), 3000);
            } else {
                setStatus('error');
                setErrorMsg(t('options.whisperAlignNoAudio'));
                setTimeout(() => { setStatus('idle'); setErrorMsg(''); }, 4000);
            }
        } catch (err) {
            setStatus('error');
            const whisperReason = (err as any)?.whisperReason;
            if (whisperReason) {
                // Use the i18n key from the error
                setErrorMsg(t((err as Error).message));
            } else {
                setErrorMsg(err instanceof Error ? err.message : String(err));
            }
            setTimeout(() => { setStatus('idle'); setErrorMsg(''); }, 6000);
        }
    }, [song, lyrics, onLyricsUpdated, status, t]);

    // Don't render if already word-by-word or no line timing
    if (isWordByWord || !hasLineTiming) {
        return null;
    }

    const buttonBaseClass = `p-1 rounded-md transition-all ${
        isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'
    }`;

    if (status === 'aligning') {
        return (
            <button
                onClick={handleAlign}
                className={`${buttonBaseClass} flex items-center gap-1 opacity-80`}
                title={progressLabel}
            >
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[10px] opacity-70 max-w-[80px] truncate">{progressLabel}</span>
            </button>
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
        return (
            <button
                onClick={handleAlign}
                className={`${buttonBaseClass} opacity-80`}
                title={errorMsg || t('options.whisperAlignError', { error: 'Unknown' })}
            >
                <AlertCircle size={14} className="text-red-400" />
            </button>
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