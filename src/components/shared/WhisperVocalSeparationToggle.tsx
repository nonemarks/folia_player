import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { modelsPresent, subscribeModelAvailability } from '../../services/automix/modelAvailability';

// src/components/shared/WhisperVocalSeparationToggle.tsx
// 人声分离开关（主开关 + GPU 子开关 + 依赖未就绪提示），供 Whisper 独立设置页与歌词匹配
// Whisper 标签复用。自行订阅 store 与 modelAvailability，无需 props —— 与相邻的
// WhisperLanguageSelector / WhisperModelSelector 一致，调用方只负责外层分区容器。
//
// 开启后，所有 Whisper 对齐在转录前先用 htdemucs 分离人声，把 vocals 喂给 whisper 以去除伴奏
// 干扰。它复用 Automix 的 htdemucs.onnx + Python runtime（同一 modelPaths 解析），未就绪 / 分离
// 失败 / GPU 初始化失败时主进程自动回退混音对齐，绝不阻断对齐（见 electron/whisperAlign.cjs
// 的 separateVocals）。GPU 子开关仅在分离开启时出现，交给 runner 决定能否真走 CUDA。

/** 开关滑块。定义在组件外，避免每次渲染都成为新的组件类型而被 React 重新挂载、丢掉过渡动画。 */
const ToggleSwitch: React.FC<{ on: boolean; onClick: () => void }> = ({ on, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
        style={{
            backgroundColor: on
                ? 'var(--accent-color, rgba(99, 102, 241, 0.8))'
                : 'var(--border-primary, rgba(255,255,255,0.12))',
        }}
    >
        <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                on ? 'translate-x-6' : 'translate-x-1'
            }`}
        />
    </button>
);

const WhisperVocalSeparationToggle: React.FC = () => {
    const { t } = useTranslation();
    const vocalSeparation = useSettingsUiStore(state => state.whisperAlignVocalSeparation);
    const vocalSeparationGpu = useSettingsUiStore(state => state.whisperAlignVocalSeparationGpu);
    const onSetVocalSeparation = useSettingsUiStore(state => state.handleSetWhisperAlignVocalSeparation);
    const onSetVocalSeparationGpu = useSettingsUiStore(state => state.handleSetWhisperAlignVocalSeparationGpu);

    // htdemucs 就绪 === 权重 AND Python runtime 都在磁盘（见 modelPaths.modelsPresent 的口径）。
    // 实时快照：下载落地后无需重启即翻转，与 Automix 引擎徽章同源。
    const present = useSyncExternalStore(subscribeModelAvailability, modelsPresent, modelsPresent);
    const ready = present.htdemucs;

    return (
        <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
            {/* 主开关：人声分离 */}
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.whisperAlignVocalSeparation')}
                    </div>
                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.whisperAlignVocalSeparationDesc')}
                    </div>
                </div>
                <ToggleSwitch on={vocalSeparation} onClick={() => onSetVocalSeparation(!vocalSeparation)} />
            </div>

            {/* 依赖未就绪提示：仅在开启但未就绪时出现，引导去 Automix 模型区下载，不阻断（会自动回退混音） */}
            {vocalSeparation && !ready && (
                <div className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    <AlertCircle size={12} className="shrink-0 mt-0.5 text-amber-400" />
                    <span>{t('options.whisperAlignVocalSeparationMissing')}</span>
                </div>
            )}

            {/* GPU 子开关：仅在分离开启时出现 */}
            {vocalSeparation && (
                <div className="flex items-center justify-between gap-4 pl-1">
                    <div className="space-y-1">
                        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.whisperAlignVocalSeparationGpu')}
                        </div>
                        <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.whisperAlignVocalSeparationGpuDesc')}
                        </div>
                    </div>
                    <ToggleSwitch on={vocalSeparationGpu} onClick={() => onSetVocalSeparationGpu(!vocalSeparationGpu)} />
                </div>
            )}
        </div>
    );
};

export default WhisperVocalSeparationToggle;
