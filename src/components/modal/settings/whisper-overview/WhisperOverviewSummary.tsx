import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle, CheckCircle2, Gauge, XCircle } from 'lucide-react';
import type { WhisperOverviewSummary, WhisperOverviewQuality } from './buildWhisperLyricOverviewModel';
import { formatOverviewTime } from './buildWhisperLyricOverviewModel';

// src/components/modal/settings/whisper-overview/WhisperOverviewSummary.tsx
// Right-hand panel of the Whisper lyric overview: aggregate structure stats, the alignment
// quality report (match rate + forced-calibration counts) and the run info (model/segments).

interface Props {
    summary: WhisperOverviewSummary;
    isDaylight: boolean;
}

const QUALITY_META: Record<WhisperOverviewQuality, { color: string; i18n: string }> = {
    excellent: { color: 'text-emerald-400', i18n: 'whisperOverview.qualityExcellent' },
    good: { color: 'text-green-400', i18n: 'whisperOverview.qualityGood' },
    fair: { color: 'text-amber-400', i18n: 'whisperOverview.qualityFair' },
    poor: { color: 'text-red-400', i18n: 'whisperOverview.qualityPoor' },
    unknown: { color: 'text-zinc-400', i18n: 'whisperOverview.qualityUnknown' },
};

const WhisperOverviewSummaryPanel: React.FC<Props> = ({ summary, isDaylight }) => {
    const { t } = useTranslation();
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const cardBg = isDaylight ? 'bg-black/[0.03]' : 'bg-white/[0.04]';

    const diag = summary.diagnostics;
    const quality = QUALITY_META[summary.quality];

    if (!summary.hasLyrics) {
        return (
            <div className={`flex items-center gap-2 rounded-xl border ${borderColor} ${cardBg} p-4 text-sm ${textSecondary}`}>
                <AlertCircle size={16} />
                {t('whisperOverview.noLyrics')}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Quality badge + match rate */}
            <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
                <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${textSecondary}`}>{t('whisperOverview.alignQuality')}</span>
                    <span className={`flex items-center gap-1.5 text-sm font-semibold ${quality.color}`}>
                        {summary.quality === 'poor'
                            ? <XCircle size={15} />
                            : summary.quality === 'unknown'
                                ? <AlertCircle size={15} />
                                : <CheckCircle2 size={15} />}
                        {t(quality.i18n)}
                    </span>
                </div>
                {diag ? (
                    <div className="mt-3">
                        <div className="flex items-center justify-between text-xs">
                            <span className={textSecondary}>{t('whisperOverview.matchRate')}</span>
                            <span className={`tabular-nums font-semibold ${quality.color}`}>{diag.matchRate.toFixed(1)}%</span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}>
                            <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${Math.max(2, Math.min(100, diag.matchRate))}%`, backgroundColor: 'var(--accent-color, rgba(99,102,241,0.85))' }}
                            />
                        </div>
                        <p className={`mt-2 text-[11px] leading-relaxed ${textSecondary}`}>{t('whisperOverview.matchRateHint')}</p>
                    </div>
                ) : (
                    <p className={`mt-2 text-[11px] leading-relaxed ${textSecondary}`}>{t('whisperOverview.noDiagnostics')}</p>
                )}
            </div>

            {/* Structure stats */}
            <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
                <div className={`mb-3 flex items-center gap-2 text-xs font-medium ${textSecondary}`}>
                    <Gauge size={14} />
                    {t('whisperOverview.structure')}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Stat label={t('whisperOverview.lineCount')} value={String(summary.lineCount)} textPrimary={textPrimary} textSecondary={textSecondary} />
                    <Stat label={t('whisperOverview.totalDuration')} value={formatOverviewTime(summary.totalDuration)} textPrimary={textPrimary} textSecondary={textSecondary} />
                    <Stat label={t('whisperOverview.avgLineDuration')} value={`${summary.avgLineDuration.toFixed(2)}s`} textPrimary={textPrimary} textSecondary={textSecondary} />
                    <Stat label={t('whisperOverview.totalWords')} value={String(summary.totalWords)} textPrimary={textPrimary} textSecondary={textSecondary} />
                    <Stat label={t('whisperOverview.avgWordsPerLine')} value={summary.avgWordsPerLine.toFixed(1)} textPrimary={textPrimary} textSecondary={textSecondary} />
                    <Stat label={t('whisperOverview.wordByWord')} value={summary.isWordByWord ? t('whisperOverview.yes') : t('whisperOverview.no')} textPrimary={textPrimary} textSecondary={textSecondary} />
                </div>
            </div>

            {/* Diagnostics detail */}
            {diag && (
                <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
                    <div className={`mb-3 flex items-center gap-2 text-xs font-medium ${textSecondary}`}>
                        <Activity size={14} />
                        {t('whisperOverview.diagnostics')}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Stat label={t('whisperOverview.matchedTokens')} value={String(diag.matchedTokens)} textPrimary={textPrimary} textSecondary={textSecondary} />
                        <Stat label={t('whisperOverview.deletedTokens')} value={String(diag.deletedTokens)} textPrimary={textPrimary} textSecondary={textSecondary} />
                        <Stat label={t('whisperOverview.insertedTokens')} value={String(diag.insertedTokens)} textPrimary={textPrimary} textSecondary={textSecondary} />
                        <Stat label={t('whisperOverview.noAnchorLines')} value={String(diag.noAnchorLines)} textPrimary={textPrimary} textSecondary={textSecondary} />
                        <Stat label={t('whisperOverview.shiftLines')} value={String(diag.shiftCalibratedLines)} textPrimary={textPrimary} textSecondary={textSecondary} />
                        <Stat label={t('whisperOverview.boundaryLines')} value={String(diag.boundaryRespacedLines)} textPrimary={textPrimary} textSecondary={textSecondary} />
                        <Stat label={t('whisperOverview.globalOffset')} value={`${diag.globalOffsetMs ?? 0}ms`} textPrimary={textPrimary} textSecondary={textSecondary} />
                    </div>
                </div>
            )}

            {/* Run info */}
            {diag && (diag.model || diag.segments !== undefined) && (
                <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
                    <div className={`mb-3 text-xs font-medium ${textSecondary}`}>{t('whisperOverview.runInfo')}</div>
                    <div className="grid grid-cols-2 gap-3">
                        {diag.model && <Stat label={t('whisperOverview.model')} value={diag.model} textPrimary={textPrimary} textSecondary={textSecondary} />}
                        {diag.language && <Stat label={t('whisperOverview.language')} value={diag.language} textPrimary={textPrimary} textSecondary={textSecondary} />}
                        {diag.segments !== undefined && <Stat label={t('whisperOverview.segments')} value={String(diag.segments)} textPrimary={textPrimary} textSecondary={textSecondary} />}
                        {diag.alignedAt && <Stat label={t('whisperOverview.alignedAt')} value={new Date(diag.alignedAt).toLocaleTimeString()} textPrimary={textPrimary} textSecondary={textSecondary} />}
                    </div>
                </div>
            )}
        </div>
    );
};

const Stat: React.FC<{ label: string; value: string; textPrimary: string; textSecondary: string }> = ({ label, value, textPrimary, textSecondary }) => (
    <div>
        <div className={`text-[11px] ${textSecondary}`}>{label}</div>
        <div className={`mt-0.5 text-sm font-semibold tabular-nums ${textPrimary}`}>{value}</div>
    </div>
);

export default WhisperOverviewSummaryPanel;
