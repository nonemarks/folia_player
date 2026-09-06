import React from 'react';
import { useTranslation } from 'react-i18next';
import { useWhisperSettingsStore } from '../../stores/useWhisperSettingsStore';

// src/components/shared/WhisperAutoAlignToggle.tsx
// Whisper 自动对齐开关行，供 Whisper 独立设置页与歌词匹配 Whisper 标签复用。
// 自行订阅 store，调用方只需负责外层分区容器。

type WhisperAutoAlignToggleProps = {
    isDaylight: boolean;
};

const WhisperAutoAlignToggle: React.FC<WhisperAutoAlignToggleProps> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const whisperAlignEnabled = useWhisperSettingsStore(state => state.whisperAlignEnabled);
    const onToggleWhisperAlign = useWhisperSettingsStore(state => state.handleToggleWhisperAlign);

    return (
        <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.whisperAlign')}
                </div>
                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.whisperAlignDesc')}
                </div>
            </div>
            <button
                type="button"
                onClick={() => onToggleWhisperAlign(!whisperAlignEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    whisperAlignEnabled
                        ? 'bg-blue-500'
                        : isDaylight ? 'bg-zinc-300' : 'bg-white/10'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        whisperAlignEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
};

export default WhisperAutoAlignToggle;
