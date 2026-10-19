import React from 'react';
import { BarChart3, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { useAutomixStatsStore } from '../../../stores/useAutomixStatsStore';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';

type AutomixStatsSectionProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
};

const AutomixStatsSection: React.FC<AutomixStatsSectionProps> = ({ isDaylight, settingsCardClass, theme }) => {
    const { t } = useTranslation();
    const { totalTransitions, stemTransitions, masterTransitions, totalOverlapSec, lastTransitionAt, clearStats } = useAutomixStatsStore();
    const accent = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');
    const formatLastTransition = lastTransitionAt
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(lastTransitionAt)
        : t('options.automixStatsNever');
    const averageOverlap = totalTransitions > 0 ? totalOverlapSec / totalTransitions : 0;
    const statItems = [
        [t('options.automixStatsTotal'), totalTransitions],
        [t('options.automixStatsStems'), stemTransitions],
        [t('options.automixStatsMaster'), masterTransitions],
        [t('options.automixStatsAverage'), `${averageOverlap.toFixed(1)}s`],
    ];

    return (
        <SettingsAnchor anchorId="automixStats" label={t('options.automixStats')}>
            <SettingsSectionHeading icon={BarChart3} label={t('options.automixStats')} />
            <div className={`rounded-xl border p-4 space-y-4 ${settingsCardClass}`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {statItems.map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg border p-3" style={{ borderColor: isDaylight ? 'rgba(24,24,27,0.12)' : 'rgba(255,255,255,0.1)' }}>
                            <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
                            <div className="mt-1 text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>{label}</div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    <span>{t('options.automixStatsLast', { value: formatLastTransition })}</span>
                    <button
                        type="button"
                        onClick={clearStats}
                        disabled={totalTransitions === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-opacity disabled:opacity-40"
                        style={{ borderColor: `${accent}40`, color: 'var(--text-primary)' }}
                    >
                        <RotateCcw size={13} />
                        {t('options.automixStatsClear')}
                    </button>
                </div>
            </div>
        </SettingsAnchor>
    );
};

export default AutomixStatsSection;