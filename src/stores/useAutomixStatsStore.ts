import { create } from 'zustand';

const STORAGE_KEY = 'folia_automix_stats';

export type AutomixStats = {
    totalTransitions: number;
    stemTransitions: number;
    masterTransitions: number;
    totalOverlapSec: number;
    lastTransitionAt: number | null;
};

const EMPTY_STATS: AutomixStats = {
    totalTransitions: 0,
    stemTransitions: 0,
    masterTransitions: 0,
    totalOverlapSec: 0,
    lastTransitionAt: null,
};

const readStats = (): AutomixStats => {
    if (typeof window === 'undefined') return EMPTY_STATS;
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<AutomixStats> | null;
        if (!parsed || typeof parsed !== 'object') return EMPTY_STATS;
        return {
            totalTransitions: Number.isFinite(parsed.totalTransitions) ? Math.max(0, Number(parsed.totalTransitions)) : 0,
            stemTransitions: Number.isFinite(parsed.stemTransitions) ? Math.max(0, Number(parsed.stemTransitions)) : 0,
            masterTransitions: Number.isFinite(parsed.masterTransitions) ? Math.max(0, Number(parsed.masterTransitions)) : 0,
            totalOverlapSec: Number.isFinite(parsed.totalOverlapSec) ? Math.max(0, Number(parsed.totalOverlapSec)) : 0,
            lastTransitionAt: Number.isFinite(parsed.lastTransitionAt) ? Number(parsed.lastTransitionAt) : null,
        };
    } catch {
        return EMPTY_STATS;
    }
};

const persist = (stats: AutomixStats) => {
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
};

type AutomixStatsState = AutomixStats & {
    recordTransition: (args: { stemmed: boolean; overlapSec: number }) => void;
    clearStats: () => void;
};

export const useAutomixStatsStore = create<AutomixStatsState>((set) => ({
    ...readStats(),
    recordTransition: ({ stemmed, overlapSec }) => set((state) => {
        const next = {
            ...state,
            totalTransitions: state.totalTransitions + 1,
            stemTransitions: state.stemTransitions + (stemmed ? 1 : 0),
            masterTransitions: state.masterTransitions + (stemmed ? 0 : 1),
            totalOverlapSec: state.totalOverlapSec + Math.max(0, overlapSec),
            lastTransitionAt: Date.now(),
        };
        persist(next);
        return next;
    }),
    clearStats: () => {
        persist(EMPTY_STATS);
        set(EMPTY_STATS);
    },
}));