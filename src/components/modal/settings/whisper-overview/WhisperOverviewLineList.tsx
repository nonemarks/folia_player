import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { WhisperOverviewLineRow } from './buildWhisperLyricOverviewModel';
import { formatOverviewTime } from './buildWhisperLyricOverviewModel';

// src/components/modal/settings/whisper-overview/WhisperOverviewLineList.tsx
// Left-hand panel: every lyric line with its start/end/duration and word count. Each row
// expands to reveal the per-word timestamps, so a line that was evenly distributed (the
// "line-averaged" symptom) is obvious at a glance versus one with real Whisper timing.

interface Props {
    rows: WhisperOverviewLineRow[];
    isDaylight: boolean;
    isLoading?: boolean;
}

const WhisperOverviewLineList: React.FC<Props> = ({ rows, isDaylight, isLoading }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState<number | null>(null);
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const chipBg = isDaylight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)';

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className={`animate-spin ${mutedText}`} size={28} />
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className={`flex h-full items-center justify-center text-sm ${mutedText}`}>
                {t('whisperOverview.noLyrics')}
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {rows.map(row => {
                const isOpen = expanded === row.index;
                const hasWords = row.words.length > 0;
                return (
                    <div key={row.index} className={`overflow-hidden rounded-lg border ${borderColor}`}>
                        <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : row.index)}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/5"
                        >
                            <span className={`shrink-0 tabular-nums text-[11px] ${textSecondary}`}>{String(row.index + 1).padStart(2, '0')}</span>
                            {hasWords
                                ? (isOpen
                                    ? <ChevronDown size={14} className={`shrink-0 ${textSecondary}`} />
                                    : <ChevronRight size={14} className={`shrink-0 ${textSecondary}`} />)
                                : <span className="w-[14px] shrink-0" />}
                            <div className="min-w-0 flex-1">
                                <div className={`truncate text-sm ${textPrimary}`}>
                                    {row.fullText || <span className={mutedText}>{t('whisperOverview.emptyLine')}</span>}
                                </div>
                                {row.translation && <div className={`truncate text-[11px] ${textSecondary}`}>{row.translation}</div>}
                            </div>
                            <div className="shrink-0 text-right">
                                <div className={`tabular-nums text-[11px] ${textSecondary}`}>
                                    {formatOverviewTime(row.startTime)} → {formatOverviewTime(row.endTime)}
                                </div>
                                <div className={`tabular-nums text-[10px] ${mutedText}`}>
                                    {row.duration.toFixed(2)}s · {hasWords ? t('whisperOverview.nWords', { count: row.words.length }) : t('whisperOverview.noWords')}
                                </div>
                            </div>
                        </button>
                        {isOpen && hasWords && (
                            <div className={`border-t ${borderColor} px-3 py-2`}>
                                <div className="flex flex-wrap gap-1.5">
                                    {row.words.map((w, wi) => (
                                        <span
                                            key={wi}
                                            className={`inline-flex items-center gap-1 rounded-md border ${borderColor} px-2 py-1 text-[11px]`}
                                            style={{ backgroundColor: chipBg }}
                                        >
                                            <span className={textPrimary}>{w.text}</span>
                                            <span className={`tabular-nums ${mutedText}`}>{formatOverviewTime(w.startTime)}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default WhisperOverviewLineList;
