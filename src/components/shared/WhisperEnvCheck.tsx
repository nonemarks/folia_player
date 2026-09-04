// src/components/shared/WhisperEnvCheck.tsx
// Reusable Whisper environment check component.
// Shows CLI install status, model download buttons, and setup guidance.

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Download, ExternalLink, Check, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getWhisperAvailabilityDetail, installWhisperCli, installFfmpeg, type WhisperAvailabilityDetail } from '../../services/whisperAlignService';
import { getWhisperAvailabilityUnified, isWhisperModAvailable } from '../../services/whisperModService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    const [loadError, setLoadError] = useState<string | null>(null);
    const [cliInstallState, setCliInstallState] = useState<WhisperCliInstallState>({ status: 'idle', progress: 0 });
    const [ffmpegInstallState, setFfmpegInstallState] = useState<FfmpegInstallState>({ status: 'idle', progress: 0 });

    const loadAvailability = useCallback(() => {
        setLoadError(null);
        // Timeout protection: if IPC doesn't respond within 8s, treat as error
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout: Whisper status check took too long')), 8000)
        );
        Promise.race([getWhisperAvailabilityUnified(), timeout])
            .then(setAvailability)
            .catch((err) => {
                console.error('[WhisperEnvCheck] Failed to get availability:', err);
                setLoadError(err instanceof Error ? err.message : String(err));
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

    useEffect(() => {
        loadAvailability();
    }, [loadAvailability]);

    const refreshAvailability = useCallback(() => {
        loadAvailability();
    }, [loadAvailability]);

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

    if (!availability) {
        return alwaysShow ? (
            <div className={className}>
                <div className="flex flex-col items-center justify-center p-6 gap-3">
                    <Loader2 size={24} className="animate-spin opacity-50" />
                    <span className="text-xs opacity-40" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.whisperAlignEnvChecking') || 'Checking environment...'}
                    </span>
                </div>
            </div>
        ) : <>{children}</>;
    }

    // Debug: log availability state (removed — was too noisy)

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
            {/* Timeout / IPC error retry */}
            {loadError && (
                <div className="p-3 mb-2 space-y-2 rounded-lg" style={{ backgroundColor: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    <div className="flex items-start gap-2 text-xs text-red-400">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                        <span>{loadError}</span>
                    </div>
                    <button
                        type="button"
                        onClick={loadAvailability}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors opacity-80 hover:opacity-100"
                        style={{ borderColor: 'rgba(248,113,113,0.3)', color: 'var(--text-primary)' }}
                    >
                        <RefreshCw size={10} />
                        {t('options.whisperAlignInstallRetry') || 'Retry'}
                    </button>
                </div>
            )}

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
                    {/* Model download now lives in WhisperModelSelector (rendered as children
                        below), so this panel keeps only the guidance header. The old grid was
                        gated on !hasModel and vanished once any model existed, which stranded
                        users who had selected an undownloaded model with no way to fetch it. */}
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

            {/* Render children (the model selector) whenever the CLI is installed, regardless of
                hasModel — the selector is now the persistent model select + download entry. */}
            {isElectron && availability.cliInstalled && children}
        </div>
    );
};

export default WhisperEnvCheck;