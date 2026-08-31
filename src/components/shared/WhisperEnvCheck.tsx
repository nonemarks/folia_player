// src/components/shared/WhisperEnvCheck.tsx
// Reusable Whisper environment check component.
// Shows CLI install status, model download buttons, and setup guidance.

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Download, ExternalLink, Check, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getWhisperAvailabilityDetail, downloadWhisperModel, installWhisperCli, installFfmpeg, type WhisperAvailabilityDetail } from '../../services/whisperAlignService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WhisperModelDownloadState = {
    modelName: string;
    status: 'idle' | 'downloading' | 'done' | 'error';
    progress: number;
    error?: string;
};

export type WhisperCliInstallState = {
    status: 'idle' | 'installing' | 'done' | 'error';
    progress: number;
    step?: string;
    error?: string;
    version?: string;
};

export type FfmpegInstallState = {
    status: 'idle' | 'installing' | 'done' | 'error';
    progress: number;
    step?: string;
    error?: string;
};

export type WhisperEnvCheckProps = {
    /** Optional children rendered when CLI is installed but no model yet */
    children?: React.ReactNode;
    /** If true, always show the full panel (even when available), useful for settings/monitoring view */
    alwaysShow?: boolean;
    /** Optional className for the root container */
    className?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WhisperEnvCheck: React.FC<WhisperEnvCheckProps> = ({
    children,
    alwaysShow = false,
    className,
}) => {
    const { t } = useTranslation();
    const [availability, setAvailability] = useState<WhisperAvailabilityDetail | null>(null);
    const [downloadStates, setDownloadStates] = useState<Record<string, WhisperModelDownloadState>>({});
    const [cliInstallState, setCliInstallState] = useState<WhisperCliInstallState>({ status: 'idle', progress: 0 });
    const [ffmpegInstallState, setFfmpegInstallState] = useState<FfmpegInstallState>({ status: 'idle', progress: 0 });

    useEffect(() => {
        getWhisperAvailabilityDetail()
            .then(setAvailability)
            .catch((err) => {
                console.error('[WhisperEnvCheck] Failed to get availability:', err);
                setAvailability({
                    available: false,
                    cliInstalled: false,
                    hasModel: false,
                    models: [],
                    ffmpegAvailable: false,
                    reason: 'error',
                });
            });
    }, []);

    const refreshAvailability = useCallback(() => {
        getWhisperAvailabilityDetail().then(setAvailability);
    }, []);

    const handleInstallCli = useCallback(async () => {
        setCliInstallState({ status: 'installing', progress: 0 });
        try {
            const result = await installWhisperCli((progress) => {
                const stepLabel = progress.status === 'fetching-release' ? t('options.whisperAlignInstallFetching')
                    : progress.status === 'downloading' ? t('options.whisperAlignInstallDownloading')
                    : progress.status === 'extracting' ? t('options.whisperAlignInstallExtracting')
                    : progress.status === 'installing' ? t('options.whisperAlignInstallInstalling')
                    : progress.status;
                setCliInstallState(prev => ({
                    ...prev,
                    progress: progress.progress ?? prev.progress,
                    step: stepLabel,
                }));
            });
            setCliInstallState({ status: 'done', progress: 100, version: result.version });
            setTimeout(refreshAvailability, 500);
        } catch (err) {
            setCliInstallState({
                status: 'error',
                progress: 0,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, [refreshAvailability, t]);

    const handleInstallFfmpeg = useCallback(async () => {
        setFfmpegInstallState({ status: 'installing', progress: 0 });
        try {
            await installFfmpeg((progress) => {
                const stepLabel = progress.status === 'preparing' ? t('options.whisperAlignFfmpegInstallPreparing')
                    : progress.status === 'downloading' ? t('options.whisperAlignFfmpegInstallDownloading')
                    : progress.status === 'extracting' ? t('options.whisperAlignFfmpegInstallExtracting')
                    : progress.status === 'installing' ? t('options.whisperAlignFfmpegInstallInstalling')
                    : progress.status;
                setFfmpegInstallState(prev => ({
                    ...prev,
                    progress: progress.progress ?? prev.progress,
                    step: stepLabel,
                }));
            });
            setFfmpegInstallState({ status: 'done', progress: 100 });
            setTimeout(refreshAvailability, 500);
        } catch (err) {
            setFfmpegInstallState({
                status: 'error',
                progress: 0,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, [refreshAvailability, t]);

    const handleDownloadModel = useCallback(async (modelName: string) => {
        setDownloadStates(prev => ({
            ...prev,
            [modelName]: { modelName, status: 'downloading', progress: 0 },
        }));
        try {
            await downloadWhisperModel(modelName, (progress) => {
                setDownloadStates(prev => ({
                    ...prev,
                    [modelName]: {
                        modelName,
                        status: 'downloading',
                        progress: progress.progress ?? 0,
                    },
                }));
            });
            setDownloadStates(prev => ({
                ...prev,
                [modelName]: { modelName, status: 'done', progress: 100 },
            }));
            setTimeout(refreshAvailability, 500);
        } catch (err) {
            setDownloadStates(prev => ({
                ...prev,
                [modelName]: {
                    modelName,
                    status: 'error',
                    progress: 0,
                    error: err instanceof Error ? err.message : String(err),
                },
            }));
        }
    }, [refreshAvailability]);

    if (!availability) {
        return alwaysShow ? (
            <div className={className}>
                <div className="flex items-center justify-center p-4">
                    <Loader2 size={16} className="animate-spin opacity-50" />
                </div>
            </div>
        ) : <>{children}</>;
    }

    // If everything is ready and not forced show, just render children
    if (availability.available && !alwaysShow) {
        return <>{children}</>;
    }

    const isElectron = typeof window !== 'undefined' && !!window.electron;
    const canAutoInstall = isElectron && (
        (navigator.platform?.startsWith('Win') || navigator.platform?.startsWith('Linux'))
    );

    // When alwaysShow and available, render a compact status + children
    if (alwaysShow && availability.available) {
        return (
            <div className={className}>
                {/* Compact ready status */}
                <div className="flex items-center gap-2 p-3">
                    <Check size={14} className="text-green-400" />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.whisperAlignInstallDone')}
                    </span>
                </div>

                {/* FFmpeg status in alwaysShow mode */}
                {isElectron && !availability.ffmpegAvailable && (
                    <div className="px-3 pb-3 space-y-2">
                        <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                            <div>
                                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.whisperAlignFfmpegNotFoundTitle')}
                                </div>
                                <div className="opacity-60 mt-0.5">
                                    {t('options.whisperAlignFfmpegNotFoundDesc')}
                                </div>
                            </div>
                        </div>
                        {canAutoInstall && (
                            <div className="space-y-2">
                                {ffmpegInstallState.status === 'idle' && (
                                    <button
                                        type="button"
                                        onClick={handleInstallFfmpeg}
                                        className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
                                        style={{
                                            borderColor: 'var(--accent-color, rgba(99, 102, 241, 0.5))',
                                            backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.1))',
                                            color: 'var(--text-primary)',
                                        }}
                                    >
                                        <Download size={14} />
                                        {t('options.whisperAlignFfmpegAutoInstall')}
                                    </button>
                                )}
                                {ffmpegInstallState.status === 'installing' && (
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                                            <Loader2 size={12} className="animate-spin" />
                                            <span>{ffmpegInstallState.step || t('options.whisperAlignFfmpegInstallDownloading')}</span>
                                            <span className="opacity-50">{ffmpegInstallState.progress}%</span>
                                        </div>
                                        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                                            <div
                                                className="h-full rounded-full transition-all duration-300"
                                                style={{
                                                    width: `${ffmpegInstallState.progress}%`,
                                                    backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.8))',
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                                {ffmpegInstallState.status === 'done' && (
                                    <div className="flex items-center gap-2 text-xs text-green-400">
                                        <Check size={12} />
                                        <span>{t('options.whisperAlignFfmpegInstallDone')}</span>
                                    </div>
                                )}
                                {ffmpegInstallState.status === 'error' && (
                                    <div className="space-y-2">
                                        <div className="flex items-start gap-2 text-xs text-red-400">
                                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                            <span>{ffmpegInstallState.error}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleInstallFfmpeg}
                                            className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors opacity-80 hover:opacity-100"
                                            style={{ borderColor: 'rgba(248, 113, 113, 0.4)', color: 'var(--text-primary)' }}
                                        >
                                            <RefreshCw size={10} />
                                            {t('options.whisperAlignFfmpegInstallRetry')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        {!canAutoInstall && (
                            <a
                                href="https://ffmpeg.org/download.html"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs underline opacity-80 hover:opacity-100"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <ExternalLink size={10} />
                                ffmpeg.org
                            </a>
                        )}
                    </div>
                )}
                {isElectron && availability.ffmpegAvailable && (
                    <div className="flex items-center gap-2 px-3 pb-1.5">
                        <Check size={12} className="text-green-400" />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            FFmpeg {t('options.whisperAlignFfmpegInstallDone')}
                        </span>
                    </div>
                )}

                {children}
            </div>
        );
    }

    return (
        <div className={className}>
            {/* Not Electron warning */}
            {!isElectron && (
                <div className="p-4 space-y-2">
                    <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                        <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.whisperAlignNotElectronTitle')}
                            </div>
                            <div className="opacity-60 mt-0.5">
                                {t('options.whisperAlignNotElectronDesc')}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* CLI not installed */}
            {isElectron && !availability.cliInstalled && (
                <div className="p-4 space-y-3">
                    <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                        <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.whisperAlignCliNotFoundTitle')}
                            </div>
                            <div className="opacity-60 mt-0.5">
                                {t('options.whisperAlignCliNotFoundDesc')}
                            </div>
                        </div>
                    </div>

                    {/* Auto-install button */}
                    {canAutoInstall && (
                        <div className="space-y-2">
                            {cliInstallState.status === 'idle' && (
                                <button
                                    type="button"
                                    onClick={handleInstallCli}
                                    className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
                                    style={{
                                        borderColor: 'var(--accent-color, rgba(99, 102, 241, 0.5))',
                                        backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.1))',
                                        color: 'var(--text-primary)',
                                    }}
                                >
                                    <Download size={14} />
                                    {t('options.whisperAlignAutoInstall')}
                                </button>
                            )}
                            {cliInstallState.status === 'installing' && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>{cliInstallState.step || t('options.whisperAlignInstallDownloading')}</span>
                                        <span className="opacity-50">{cliInstallState.progress}%</span>
                                    </div>
                                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                                        <div
                                            className="h-full rounded-full transition-all duration-300"
                                            style={{
                                                width: `${cliInstallState.progress}%`,
                                                backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.8))',
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                            {cliInstallState.status === 'done' && (
                                <div className="flex items-center gap-2 text-xs text-green-400">
                                    <Check size={12} />
                                    <span>{t('options.whisperAlignInstallDone')}</span>
                                </div>
                            )}
                            {cliInstallState.status === 'error' && (
                                <div className="space-y-2">
                                    <div className="flex items-start gap-2 text-xs text-red-400">
                                        <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                        <span>{cliInstallState.error}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleInstallCli}
                                        className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors opacity-80 hover:opacity-100"
                                        style={{ borderColor: 'rgba(248, 113, 113, 0.4)', color: 'var(--text-primary)' }}
                                    >
                                        <RefreshCw size={10} />
                                        {t('options.whisperAlignInstallRetry')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Manual install link for unsupported platforms */}
                    {!canAutoInstall && (
                        <a
                            href="https://github.com/ggerganov/whisper.cpp"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs underline opacity-80 hover:opacity-100"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <ExternalLink size={10} />
                            whisper.cpp
                        </a>
                    )}
                </div>
            )}

            {/* CLI installed but no model */}
            {isElectron && availability.cliInstalled && !availability.hasModel && (
                <div className="p-4 space-y-3">
                    <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                        <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.whisperAlignNoModelTitle')}
                            </div>
                            <div className="opacity-60 mt-0.5">
                                {t('options.whisperAlignNoModelDesc')}
                            </div>
                        </div>
                    </div>
                    {/* Model download buttons */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {availability.models.map((model) => {
                            const dlState = downloadStates[model.name];
                            const isDownloading = dlState?.status === 'downloading';
                            const isDone = model.downloaded || dlState?.status === 'done';
                            const isError = dlState?.status === 'error';

                            return (
                                <button
                                    key={model.name}
                                    type="button"
                                    onClick={() => !isDone && !isDownloading && handleDownloadModel(model.name)}
                                    disabled={isDownloading || isDone}
                                    className={`rounded-xl border px-3 py-2 text-center transition-colors ${
                                        isDone ? 'opacity-60' : isError ? 'opacity-80' : ''
                                    }`}
                                    style={
                                        isDone
                                            ? { borderColor: 'rgba(74, 222, 128, 0.4)', backgroundColor: 'rgba(74, 222, 128, 0.08)' }
                                            : isError
                                            ? { borderColor: 'rgba(248, 113, 113, 0.4)', backgroundColor: 'rgba(248, 113, 113, 0.08)' }
                                            : undefined
                                    }
                                >
                                    <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {model.name.charAt(0).toUpperCase() + model.name.slice(1)}
                                    </div>
                                    <div className="text-[10px] opacity-50 mt-0.5">
                                        {isDone ? (
                                            <span className="text-green-400 flex items-center justify-center gap-0.5">
                                                <Check size={8} /> {t('options.whisperAlignModelDownloaded')}
                                            </span>
                                        ) : isDownloading ? (
                                            <span className="flex items-center justify-center gap-0.5">
                                                <Loader2 size={8} className="animate-spin" /> {dlState.progress}%
                                            </span>
                                        ) : isError ? (
                                            <span className="text-red-400">{t('options.whisperAlignModelDownloadError')}</span>
                                        ) : (
                                            <span className="flex items-center justify-center gap-0.5">
                                                <Download size={8} /> {model.size}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* FFmpeg status */}
            {isElectron && availability.cliInstalled && !availability.ffmpegAvailable && (
                <div className="p-4 space-y-3">
                    <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                        <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.whisperAlignFfmpegNotFoundTitle')}
                            </div>
                            <div className="opacity-60 mt-0.5">
                                {t('options.whisperAlignFfmpegNotFoundDesc')}
                            </div>
                        </div>
                    </div>

                    {/* Auto-install button */}
                    {canAutoInstall && (
                        <div className="space-y-2">
                            {ffmpegInstallState.status === 'idle' && (
                                <button
                                    type="button"
                                    onClick={handleInstallFfmpeg}
                                    className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
                                    style={{
                                        borderColor: 'var(--accent-color, rgba(99, 102, 241, 0.5))',
                                        backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.1))',
                                        color: 'var(--text-primary)',
                                    }}
                                >
                                    <Download size={14} />
                                    {t('options.whisperAlignFfmpegAutoInstall')}
                                </button>
                            )}
                            {ffmpegInstallState.status === 'installing' && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>{ffmpegInstallState.step || t('options.whisperAlignFfmpegInstallDownloading')}</span>
                                        <span className="opacity-50">{ffmpegInstallState.progress}%</span>
                                    </div>
                                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                                        <div
                                            className="h-full rounded-full transition-all duration-300"
                                            style={{
                                                width: `${ffmpegInstallState.progress}%`,
                                                backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.8))',
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                            {ffmpegInstallState.status === 'done' && (
                                <div className="flex items-center gap-2 text-xs text-green-400">
                                    <Check size={12} />
                                    <span>{t('options.whisperAlignFfmpegInstallDone')}</span>
                                </div>
                            )}
                            {ffmpegInstallState.status === 'error' && (
                                <div className="space-y-2">
                                    <div className="flex items-start gap-2 text-xs text-red-400">
                                        <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                        <span>{ffmpegInstallState.error}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleInstallFfmpeg}
                                        className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors opacity-80 hover:opacity-100"
                                        style={{ borderColor: 'rgba(248, 113, 113, 0.4)', color: 'var(--text-primary)' }}
                                    >
                                        <RefreshCw size={10} />
                                        {t('options.whisperAlignFfmpegInstallRetry')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Manual install link for unsupported platforms */}
                    {!canAutoInstall && (
                        <a
                            href="https://ffmpeg.org/download.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs underline opacity-80 hover:opacity-100"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <ExternalLink size={10} />
                            ffmpeg.org
                        </a>
                    )}
                </div>
            )}

            {/* Render children when CLI is available but no model */}
            {isElectron && availability.cliInstalled && !availability.hasModel && children}
        </div>
    );
};

export default WhisperEnvCheck;