import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Sparkles } from 'lucide-react';
import type { LyricData } from '../../../types';
import { buildWhisperLyricOverviewModel } from './whisper-overview/buildWhisperLyricOverviewModel';
import WhisperOverviewSummaryPanel from './whisper-overview/WhisperOverviewSummary';
import WhisperOverviewLineList from './whisper-overview/WhisperOverviewLineList';

// src/components/modal/settings/WhisperLyricOverviewModal.tsx
// Read-only overview of the current song's lyric timeline and Whisper alignment quality.
// Mirrors LyricFilterSettingsModal's two-column shell: per-line timing on the left, the
// aggregate structure stats + alignment diagnostics + run info on the right.

interface WhisperLyricOverviewModalProps {
    isOpen: boolean;
    isDaylight: boolean;
    currentSongTitle?: string | null;
    lyrics: LyricData | null;
    onClose: () => void;
}

const shellTransition = {
    duration: 0.28,
    ease: [0.22, 1, 0.36, 1] as const,
};

const panelMotion = {
    initial: { y: 24, opacity: 0, scale: 0.985 },
    animate: { y: 0, opacity: 1, scale: 1 },
    exit: { y: 24, opacity: 0, scale: 0.985 },
};

const WhisperLyricOverviewModal: React.FC<WhisperLyricOverviewModalProps> = ({
    isOpen,
    isDaylight,
    currentSongTitle,
    lyrics,
    onClose,
}) => {
    const { t } = useTranslation();
    const model = useMemo(() => buildWhisperLyricOverviewModel(lyrics), [lyrics]);

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
                    className="fixed inset-0 z-[140] backdrop-blur-xl p-3 sm:p-5"
                    style={{ backgroundColor: overlayBackground }}
                    onClick={onClose}
                >
                    <motion.div
                        {...panelMotion}
                        transition={shellTransition}
                        className={`mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
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
                                    <div className="flex items-center gap-2 truncate text-lg font-semibold sm:text-xl" style={{ color: 'var(--text-primary)' }}>
                                        <Sparkles size={18} />
                                        {t('whisperOverview.title')}
                                    </div>
                                    <div className={`mt-1 text-xs ${mutedText}`}>
                                        {currentSongTitle
                                            ? t('whisperOverview.currentSong', { title: currentSongTitle })
                                            : t('whisperOverview.noSong')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Body: per-line timeline (left) + summary/diagnostics (right) */}
                        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.15fr_0.85fr]">
                            <div className={`flex min-h-0 flex-col border-b ${borderColor} lg:border-b-0 lg:border-r`}>
                                <div className="flex items-center justify-between px-4 py-4 sm:px-6">
                                    <div>
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('whisperOverview.timeline')}
                                        </div>
                                        <div className={`mt-1 text-xs ${mutedText}`}>
                                            {t('whisperOverview.timelineHint')}
                                        </div>
                                    </div>
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 custom-scrollbar sm:px-6">
                                    <WhisperOverviewLineList isDaylight={isDaylight} rows={model.rows} />
                                </div>
                            </div>

                            <div className="min-h-0 overflow-y-auto px-4 py-5 custom-scrollbar sm:px-6">
                                <WhisperOverviewSummaryPanel isDaylight={isDaylight} summary={model.summary} />
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default WhisperLyricOverviewModal;
