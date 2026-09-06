import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Loader2 } from 'lucide-react';
import { useWhisperSettingsStore } from '../../stores/useWhisperSettingsStore';
import { getWhisperAvailabilityUnified } from '../../services/whisperModService';
import { downloadWhisperModel, type WhisperAvailabilityDetail } from '../../services/whisperAlignService';

// src/components/shared/WhisperModelSelector.tsx
// Whisper 模型选择器（标题 + 说明 + tiny/base/small/medium/large-v3/large-v3-turbo 网格），
// 供 Whisper 独立设置页与歌词匹配 Whisper 标签复用。自行订阅 store。

const WHISPER_MODEL_OPTIONS = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'] as const;

// 由模型值推导 i18n 标签键，连字符分段转驼峰：tiny -> whisperAlignModelTiny，large-v3-turbo -> whisperAlignModelLargeV3Turbo
const modelLabelKey = (value: string) =>
    `options.whisperAlignModel${value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`;

const WhisperModelSelector: React.FC = () => {
    const { t } = useTranslation();
    const whisperAlignModel = useWhisperSettingsStore(state => state.whisperAlignModel);
    const onSetWhisperAlignModel = useWhisperSettingsStore(state => state.handleSetWhisperAlignModel);

    // Model download is owned here (not by WhisperEnvCheck's old grid) so this stays a persistent
    // "select + download + status" entry. The previous grid was gated behind "no model downloaded
    // yet", so once any model existed the user could still select an undownloaded one (e.g. medium)
    // with no way to fetch it — surfacing only later as a hard 'model not downloaded' transcribe error.
    const isElectron = typeof window !== 'undefined' && !!window.electron;
    const [availability, setAvailability] = useState<WhisperAvailabilityDetail | null>(null);
    const [downloadStates, setDownloadStates] = useState<Record<string, { status: 'downloading' | 'done' | 'error'; progress: number }>>({});

    const loadAvailability = useCallback(() => {
        if (!isElectron) return;
        getWhisperAvailabilityUnified().then(setAvailability).catch(() => setAvailability(null));
    }, [isElectron]);

    useEffect(() => { loadAvailability(); }, [loadAvailability]);

    // Download a model and track its progress; refresh availability afterwards so the status flips.
    const handleDownload = useCallback(async (modelName: string) => {
        setDownloadStates(prev => ({ ...prev, [modelName]: { status: 'downloading', progress: 0 } }));
        try {
            await downloadWhisperModel(modelName, (progress) => {
                setDownloadStates(prev => ({ ...prev, [modelName]: { status: 'downloading', progress: progress.progress ?? 0 } }));
            });
            setDownloadStates(prev => ({ ...prev, [modelName]: { status: 'done', progress: 100 } }));
            setTimeout(loadAvailability, 500);
        } catch (err) {
            console.error('[WhisperModelSelector] Download failed:', err);
            setDownloadStates(prev => ({ ...prev, [modelName]: { status: 'error', progress: 0 } }));
        }
    }, [loadAvailability]);

    const downloadedSet = new Set((availability?.models ?? []).filter(m => m.downloaded).map(m => m.name));
    const isDownloaded = (name: string) => downloadedSet.has(name) || downloadStates[name]?.status === 'done';
    // Only surface download status once real availability is known (Electron); elsewhere stay a plain picker.
    const showStatus = isElectron && !!availability;

    const getOptionStyle = (selected: boolean, downloaded: boolean) => {
        if (selected) return { borderColor: 'var(--accent-color, rgba(99, 102, 241, 0.5))', backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.1))' };
        if (downloaded) return { borderColor: 'rgba(74, 222, 128, 0.35)' };
        return { borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' };
    };

    return (
        <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.whisperAlignModel')}
                </div>
                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.whisperAlignModelDesc')}
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {WHISPER_MODEL_OPTIONS.map((value) => {
                    const selected = whisperAlignModel === value;
                    const downloaded = isDownloaded(value);
                    const dl = downloadStates[value];
                    const downloading = dl?.status === 'downloading';
                    const errored = dl?.status === 'error';
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => {
                                onSetWhisperAlignModel(value);
                                // Selecting an undownloaded model also fetches it, so the choice is
                                // never stranded behind a 'model not downloaded' error at align time.
                                if (isElectron && !downloaded && !downloading) void handleDownload(value);
                            }}
                            className="rounded-xl border px-3 py-2 text-center transition-colors"
                            style={getOptionStyle(selected, downloaded)}
                        >
                            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t(modelLabelKey(value))}
                            </div>
                            {showStatus && (
                                <div className="text-[10px] mt-0.5 flex items-center justify-center gap-0.5">
                                    {downloaded ? (
                                        <span className="text-green-400 flex items-center gap-0.5"><Check size={8} /> {t('options.whisperAlignModelDownloaded')}</span>
                                    ) : downloading ? (
                                        <span className="flex items-center gap-0.5" style={{ color: 'var(--text-secondary)' }}><Loader2 size={8} className="animate-spin" /> {dl.progress}%</span>
                                    ) : errored ? (
                                        <span className="text-red-400">{t('options.whisperAlignModelDownloadError')}</span>
                                    ) : (
                                        <span className="opacity-50 flex items-center gap-0.5" style={{ color: 'var(--text-secondary)' }}><Download size={8} /></span>
                                    )}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default WhisperModelSelector;
