import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';

// src/components/shared/WhisperLanguageSelector.tsx
// Whisper 转录语言选择器（标题 + 说明 + auto/zh/en/ja/ko 网格），供 Whisper 独立设置页与
// 歌词匹配 Whisper 标签复用。自行订阅 store。auto 表示按歌词脚本自动推断（见
// detectLyricLanguage），其余为强制指定语言，覆盖自动推断（纯音乐前奏、中英混排等场景）。

const WHISPER_LANGUAGE_OPTIONS = ['auto', 'zh', 'en', 'ja', 'ko'] as const;

// 由语言值推导 i18n 标签键，首字母大写：auto -> whisperAlignLanguageAuto，zh -> whisperAlignLanguageZh
const languageLabelKey = (value: string) =>
    `options.whisperAlignLanguage${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const WhisperLanguageSelector: React.FC = () => {
    const { t } = useTranslation();
    const whisperAlignLanguage = useSettingsUiStore(state => state.whisperAlignLanguage);
    const onSetWhisperAlignLanguage = useSettingsUiStore(state => state.handleSetWhisperAlignLanguage);

    // Selected option gets the accent highlight; others keep the neutral border. No download
    // state here (unlike the model selector) — languages are just Whisper -l flags, nothing to fetch.
    const getOptionStyle = (selected: boolean) =>
        selected
            ? { borderColor: 'var(--accent-color, rgba(99, 102, 241, 0.5))', backgroundColor: 'var(--accent-color, rgba(99, 102, 241, 0.1))' }
            : { borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' };

    return (
        <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.whisperAlignLanguage')}
                </div>
                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.whisperAlignLanguageDesc')}
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {WHISPER_LANGUAGE_OPTIONS.map((value) => {
                    const selected = whisperAlignLanguage === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onSetWhisperAlignLanguage(value)}
                            className="rounded-xl border px-3 py-2 text-center transition-colors"
                            style={getOptionStyle(selected)}
                        >
                            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t(languageLabelKey(value))}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default WhisperLanguageSelector;
