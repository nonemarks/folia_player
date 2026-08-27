import React, { useState, useEffect, useCallback } from 'react';
import { AudioLines, ChevronRight, Monitor, PlayCircle, RefreshCw, Settings2, Timer, Sparkles, AlertCircle, Download, ExternalLink, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { LocalLyricsPriority, QueueAddBehavior, ReplayGainMode, Theme } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { useAudioOutputDevices } from '../../../hooks/useAudioOutputDevices';
import { CustomSelect } from '../../shared/CustomSelect';
import { LYRIC_MATCH_SOURCES } from '../../../utils/lyrics/lyricMatchSources';
import { getLyricProviderPreferenceLabel } from '../../../utils/lyrics/lyricSourceLabels';
import { getWhisperAvailabilityDetail, downloadWhisperModel, type WhisperAvailabilityDetail } from '../../../services/whisperAlignService';

// src/components/modal/settings/PlaybackSettingsSubview.tsx
// Playback behavior and output-device settings extracted from the global settings modal.

interface MediaDevicesWithAudioOutput extends MediaDevices {
    selectAudioOutput?: (options?: { deviceId?: string; }) => Promise<{ deviceId: string; label?: string; }>;
}

type PlaybackSettingsSubviewProps = {
    isDaylight: boolean;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    onOpenGlobalLyricOffsetSettings: () => void;
    replayGainMode: ReplayGainMode;
    onReplayGainModeChange: (mode: ReplayGainMode) => void;
    settingsCardClass: string;
    theme?: Theme;
    utilityGhostButtonClass: string;
};

const PlaybackSettingsSubview: React.FC<PlaybackSettingsSubviewProps> = ({
    isDaylight,
    onAudioOutputDeviceChange,
    onOpenGlobalLyricOffsetSettings,
    replayGainMode,
    onReplayGainModeChange,
    settingsCardClass,
    theme,
    utilityGhostButtonClass,
}) => {
    const { t } = useTranslation();
    const {
        audioOutputDeviceId,
        autoUseBestLyric,
        preferredAlternativeLyricSource,
        localLyricsPriority,
        queueAddBehavior,
        globalLyricTimelineOffsetMs,
        whisperAlignEnabled,
        whisperAlignModel,
        onToggleAutoUseBestLyric,
        onPreferredAlternativeLyricSourceChange,
        onLocalLyricsPriorityChange,
        onQueueAddBehaviorChange,
        onToggleWhisperAlign,
        onSetWhisperAlignModel,
    } = useSettingsUiStore(useShallow(state => ({
        audioOutputDeviceId: state.audioOutputDeviceId,
        autoUseBestLyric: state.autoUseBestLyric,
        preferredAlternativeLyricSource: state.preferredAlternativeLyricSource,
        localLyricsPriority: state.localLyricsPriority,
        queueAddBehavior: state.queueAddBehavior,
        globalLyricTimelineOffsetMs: state.globalLyricTimelineOffsetMs,
        whisperAlignEnabled: state.whisperAlignEnabled,
        whisperAlignModel: state.whisperAlignModel,
        onToggleAutoUseBestLyric: state.handleToggleAutoUseBestLyric,
        onPreferredAlternativeLyricSourceChange: state.handleSetPreferredAlternativeLyricSource,
        onLocalLyricsPriorityChange: state.handleSetLocalLyricsPriority,
        onQueueAddBehaviorChange: state.handleSetQueueAddBehavior,
        onToggleWhisperAlign: state.handleToggleWhisperAlign,
        onSetWhisperAlignModel: state.handleSetWhisperAlignModel,
    })));
    const {
        devices: audioOutputDevices,
        ensureLoaded: ensureAudioOutputDevicesLoaded,
        errorKey: audioOutputDevicesErrorKey,
        hasLoaded: hasLoadedAudioOutputDevices,
        isLoading: isAudioOutputDevicesLoading,
        isSupported: supportsAudioOutputSelection,
        refresh: refreshAudioOutputDevices,
        selectedDeviceLabel: selectedAudioOutputLabel,
        setErrorKey: setAudioOutputDevicesErrorKey,
    } = useAudioOutputDevices(audioOutputDeviceId);
    const [isSelectingAudioOutput, setIsSelectingAudioOutput] = useState(false);
    const mediaDevicesWithAudioOutput = navigator.mediaDevices as MediaDevicesWithAudioOutput | undefined;
    const accentOutlineColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-300/90' : 'bg-white/10';

    const renderToggle = (checked: boolean, onChange: () => void) => (
        <button
            type="button"
            onClick={onChange}
            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${checked ? '' : toggleOffBackgroundClass}`}
            style={{ backgroundColor: checked ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
            aria-pressed={checked}
        >
            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );

    const getAccentOptionStyle = (selected: boolean) => (
        selected
            ? {
                borderColor: accentOutlineColor,
                boxShadow: `inset 0 0 0 1px ${accentOutlineColor}`,
                backgroundColor: isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`,
            }
            : {
                borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.05)',
            }
    );

    const handleSelectAudioOutputDevice = async (deviceId: string) => {
        setAudioOutputDevicesErrorKey(null);

        if (!deviceId) {
            await onAudioOutputDeviceChange('');
            return;
        }

        if (!mediaDevicesWithAudioOutput?.selectAudioOutput) {
            await onAudioOutputDeviceChange(deviceId);
            return;
        }

        setIsSelectingAudioOutput(true);
        try {
            const selected = await mediaDevicesWithAudioOutput.selectAudioOutput({ deviceId });
            const applied = await onAudioOutputDeviceChange(selected.deviceId);
            if (applied) {
                await refreshAudioOutputDevices();
            } else {
                setAudioOutputDevicesErrorKey('options.audioOutputSelectFailed');
            }
        } catch (error) {
            console.error('[PlaybackSettingsSubview] Failed to select audio output device', error);
            setAudioOutputDevicesErrorKey('options.audioOutputSelectFailed');
        } finally {
            setIsSelectingAudioOutput(false);
        }
    };

    const audioOutputOptions = [
        { value: '', label: t('options.audioOutputDefault') },
        ...audioOutputDevices.map((device, index) => ({
            value: device.deviceId,
            label: device.label || `${t('options.audioOutputUnnamed')} ${index + 1}`,
        })),
    ];

    // The list is enumerated on demand, so a device saved in an earlier session needs its own entry
    // until then; without it the picker would look empty while a non-default output is active.
    if (audioOutputDeviceId && !audioOutputDevices.some(device => device.deviceId === audioOutputDeviceId)) {
        audioOutputOptions.push({
            value: audioOutputDeviceId,
            label: selectedAudioOutputLabel || t('options.audioOutputUnnamed'),
        });
    }

    return (
        <div className="space-y-5">
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <PlayCircle size={14} />                    {t('options.queueSettings')}

                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.queueDefaultBehavior')}
                        </div>
                        <div className="text-[11px] opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.queueDefaultBehaviorDesc')}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {([
                            { value: 'append', label: t('options.queueAppendLabel'), desc: t('options.queueAppendDesc') },
                            { value: 'next', label: t('options.queueNextLabel'), desc: t('options.queueNextDesc') },
                        ] as Array<{ value: QueueAddBehavior; label: string; desc: string }>).map((option) => {
                            const selected = queueAddBehavior === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => onQueueAddBehaviorChange(option.value)}
                                    className="rounded-xl border px-3 py-3 text-left transition-colors"
                                    style={getAccentOptionStyle(selected)}
                                >
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {option.label}
                                    </div>
                                    <div className="mt-1 text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {option.desc}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <AudioLines size={14} /> {t('options.replayGainSettings')}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.replayGainMode')}
                        </div>
                        <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.replayGainModeDesc')}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { value: 'off', label: t('localMusic.replayGainOff') },
                            { value: 'track', label: t('localMusic.replayGainTrack') },
                            { value: 'album', label: t('localMusic.replayGainAlbum') },
                        ] as Array<{ value: ReplayGainMode; label: string }>).map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => onReplayGainModeChange(option.value)}
                                className="rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition-colors"
                                style={getAccentOptionStyle(replayGainMode === option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Settings2 size={14} /> {t('options.lyrics')}
                </h3>
                <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <Settings2 size={14} />
                                {t('options.autoUseBestLyric')}
                            </div>
                            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.autoUseBestLyricDesc')}
                            </div>
                        </div>
                        {renderToggle(autoUseBestLyric, () => onToggleAutoUseBestLyric(!autoUseBestLyric))}
                    </div>
                    <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.localLyricsPriority')}
                            </div>
                            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.localLyricsPriorityDesc')}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {([
                                { value: 'local', label: t('options.localLyricsPriorityLocal'), desc: t('options.localLyricsPriorityLocalDesc') },
                                { value: 'online', label: t('options.localLyricsPriorityOnline'), desc: t('options.localLyricsPriorityOnlineDesc') },
                            ] as Array<{ value: LocalLyricsPriority; label: string; desc: string }>).map((option) => {
                                const selected = localLyricsPriority === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => onLocalLyricsPriorityChange(option.value)}
                                        className="rounded-xl border px-3 py-3 text-left transition-colors"
                                        style={getAccentOptionStyle(selected)}
                                    >
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {option.label}
                                        </div>
                                        <div className="mt-1 text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                            {option.desc}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('settings.lyricMatchPriority')}
                                </div>
                                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('settings.lyricMatchPriorityDesc')}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                                {LYRIC_MATCH_SOURCES
                                    .filter(source => source !== 'whisper' || whisperAlignEnabled)
                                    .map((source) => {
                                    const option = { value: source, label: getLyricProviderPreferenceLabel(source) };
                                    const selected = preferredAlternativeLyricSource === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => onPreferredAlternativeLyricSourceChange(option.value)}
                                            className="rounded-xl border px-3 py-2 text-center transition-colors"
                                            style={getAccentOptionStyle(selected)}
                                        >
                                            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {option.label}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                    </div>
                    <button
                        type="button"
                        onClick={onOpenGlobalLyricOffsetSettings}
                        className="w-full p-4 border-t text-left transition-colors hover:bg-white/8"
                        style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}
                    >
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <Timer size={14} />
                                    {t('options.globalLyricTimelineOffset')}
                                </div>
                                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.globalLyricTimelineOffsetDesc')}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-xs opacity-70" style={{ color: 'var(--text-primary)' }}>
                                    {globalLyricTimelineOffsetMs > 0 ? `+${globalLyricTimelineOffsetMs}` : globalLyricTimelineOffsetMs}ms
                                </span>
                                <ChevronRight size={18} className="opacity-60" style={{ color: 'var(--text-primary)' }} />
                            </div>
                        </div>
                    </button>
                    <div className="p-4 flex items-center justify-between gap-4 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <Sparkles size={14} />
                                {t('options.whisperAlign')}
                            </div>
                            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.whisperAlignDesc')}
                            </div>
                        </div>
                        {renderToggle(whisperAlignEnabled, () => onToggleWhisperAlign(!whisperAlignEnabled))}
                    </div>
                    {whisperAlignEnabled && (
                        <WhisperEnvCheck>
                            <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                                <div className="space-y-1">
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.whisperAlignModel')}
                                    </div>
                                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.whisperAlignModelDesc')}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {([
                                        { value: 'tiny', label: t('options.whisperAlignModelTiny') },
                                        { value: 'base', label: t('options.whisperAlignModelBase') },
                                        { value: 'small', label: t('options.whisperAlignModelSmall') },
                                        { value: 'medium', label: t('options.whisperAlignModelMedium') },
                                    ] as Array<{ value: string; label: string }>).map((option) => {
                                        const selected = whisperAlignModel === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => onSetWhisperAlignModel(option.value)}
                                                className="rounded-xl border px-3 py-2 text-center transition-colors"
                                                style={getAccentOptionStyle(selected)}
                                            >
                                                <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {option.label}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </WhisperEnvCheck>
                    )}
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Monitor size={14} /> {t('options.audioOutputSettings')}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.audioOutputDevice')}
                            </div>
                            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.audioOutputDeviceDesc')}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => void refreshAudioOutputDevices()}
                            disabled={!supportsAudioOutputSelection || isAudioOutputDevicesLoading || isSelectingAudioOutput}
                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors ${utilityGhostButtonClass} disabled:cursor-not-allowed disabled:opacity-45`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <RefreshCw size={13} className={isAudioOutputDevicesLoading ? 'animate-spin' : ''} />
                            <span>{t('options.audioOutputRefresh')}</span>
                        </button>
                    </div>

                    {!supportsAudioOutputSelection ? (
                        <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.audioOutputUnsupported')}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <CustomSelect
                                value={audioOutputDeviceId}
                                onChange={(val) => {
                                    void handleSelectAudioOutputDevice(val);
                                }}
                                options={audioOutputOptions}
                                onOpen={ensureAudioOutputDevicesLoaded}
                                disabled={isSelectingAudioOutput}
                                isDaylight={isDaylight}
                                theme={theme}
                            />

                            <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {isSelectingAudioOutput
                                    ? (t('options.audioOutputSelecting'))
                                    : isAudioOutputDevicesLoading
                                        ? (t('options.audioOutputLoading'))
                                        : (t('options.audioOutputDefaultDesc'))}
                            </div>

                            {audioOutputDevicesErrorKey && (
                                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t(audioOutputDevicesErrorKey)}
                                </div>
                            )}

                            {hasLoadedAudioOutputDevices && !isAudioOutputDevicesLoading && audioOutputDevices.length === 0 && !audioOutputDevicesErrorKey && (
                                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.audioOutputEmpty')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
};

export default PlaybackSettingsSubview;

// ---------------------------------------------------------------------------
// WhisperEnvCheck: Shows environment status and setup guidance when Whisper
// is enabled but the CLI or models are not ready.
// ---------------------------------------------------------------------------

type WhisperModelDownloadState = {
    modelName: string;
    status: 'idle' | 'downloading' | 'done' | 'error';
    progress: number;
    error?: string;
};

const WhisperEnvCheck: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { t } = useTranslation();
    const [availability, setAvailability] = useState<WhisperAvailabilityDetail | null>(null);
    const [downloadStates, setDownloadStates] = useState<Record<string, WhisperModelDownloadState>>({});

    useEffect(() => {
        getWhisperAvailabilityDetail().then(setAvailability);
    }, []);

    const refreshAvailability = useCallback(() => {
        getWhisperAvailabilityDetail().then(setAvailability);
    }, []);

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
            // Refresh availability after download
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
        return <>{children}</>;
    }

    // If everything is ready, just render children
    if (availability.available) {
        return <>{children}</>;
    }

    const isElectron = typeof window !== 'undefined' && !!window.electron;

    return (
        <div className="border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
            {/* Status warnings */}
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

            {isElectron && !availability.cliInstalled && (
                <div className="p-4 space-y-2">
                    <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                        <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.whisperAlignCliNotFoundTitle')}
                            </div>
                            <div className="opacity-60 mt-0.5">
                                {t('options.whisperAlignCliNotFoundDesc')}
                            </div>
                            <a
                                href="https://github.com/ggerganov/whisper.cpp"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 mt-1 underline opacity-80 hover:opacity-100"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <ExternalLink size={10} />
                                whisper.cpp
                            </a>
                        </div>
                    </div>
                </div>
            )}

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

            {/* Still render children (model selector) when CLI is available but no model */}
            {isElectron && availability.cliInstalled && !availability.hasModel && children}
            {/* Don't render children when CLI is not available (no point selecting a model) */}
        </div>
    );
};
