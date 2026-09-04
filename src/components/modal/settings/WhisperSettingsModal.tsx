import React from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import WhisperEnvCheck from '../../shared/WhisperEnvCheck';
import WhisperAutoAlignToggle from '../../shared/WhisperAutoAlignToggle';
import WhisperModelSelector from '../../shared/WhisperModelSelector';
import WhisperLanguageSelector from '../../shared/WhisperLanguageSelector';
import WhisperVocalSeparationToggle from '../../shared/WhisperVocalSeparationToggle';

// src/components/modal/settings/WhisperSettingsModal.tsx
// Whisper 独立设置页：环境检测、模型选择、自动对齐开关。

type WhisperSettingsModalProps = {
    isOpen: boolean;
    isDaylight: boolean;
    /** Opens the read-only lyric overview (timeline + alignment quality) for the current song. */
    onOpenOverview?: () => void;
    onClose: () => void;
};

const shellTransition = {
    duration: 0.28,
    ease: [0.22, 1, 0.36, 1] as const,
};

const panelMotion = {
    initial: { y: 24, opacity: 0, scale: 0.985 },
    animate: { y: 0, opacity: 1, scale: 1 },
    exit: { y: 24, opacity: 0, scale: 0.985 },
};

const WhisperSettingsModal: React.FC<WhisperSettingsModalProps> = ({
    isOpen,
    isDaylight,
    onOpenOverview,
    onClose,
}) => {
    const { t } = useTranslation();

    const glassBg = isDaylight ? 'bg-white/70' : 'bg-black/40';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const overlayBackground = isDaylight ? 'rgba(244, 244, 245, 0.9)' : 'rgba(10, 10, 12, 0.82)';
    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={shellTransition}
                    className="fixed inset-0 z-[140] flex items-center justify-center backdrop-blur-xl p-3 sm:p-5"
                    style={{ backgroundColor: overlayBackground }}
                    onClick={onClose}
                >
                    <motion.div
                        {...panelMotion}
                        transition={shellTransition}
                        className={`flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {/* Header */}
                        <div className={`flex items-center justify-between border-b ${borderColor} px-4 py-4 sm:px-6`}>
                            <div className="flex min-w-0 items-center gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <div className="min-w-0">
                                    <div className="truncate text-lg font-semibold sm:text-xl flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                        <Sparkles size={18} />
                                        {t('options.whisperAlign')}
                                    </div>
                                    <div className={`mt-1 text-xs ${mutedText}`}>
                                        {t('options.whisperAlignDesc')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex min-h-0 flex-col gap-0 overflow-y-auto custom-scrollbar">
                            {/* Section 1: Auto-align toggle */}
                            <div className={`p-4 border-b ${borderColor}`}>
                                <WhisperAutoAlignToggle isDaylight={isDaylight} />
                            </div>

                            {/* Section 2: Environment check + model selector. Not gated behind the
                                toggle, so the CLI can be installed and a model downloaded before
                                auto-align is turned on. */}
                            <WhisperEnvCheck alwaysShow>
                                <WhisperModelSelector />
                                <WhisperLanguageSelector />
                                <WhisperVocalSeparationToggle />
                            </WhisperEnvCheck>

                            {/* Section 3: Lyric overview entry — inspect the current song's timeline
                                and Whisper alignment quality without reading raw logs. */}
                            {onOpenOverview && (
                                <div className={`border-t ${borderColor} p-4`}>
                                    <button
                                        type="button"
                                        onClick={onOpenOverview}
                                        className="flex w-full items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10"
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            <BarChart3 size={16} className="shrink-0" style={{ color: 'var(--text-primary)' }} />
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('whisperOverview.entryTitle')}
                                                </div>
                                                <div className={`mt-0.5 text-xs ${mutedText}`}>
                                                    {t('whisperOverview.entryDesc')}
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={16} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default WhisperSettingsModal;