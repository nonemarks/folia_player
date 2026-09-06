// src/stores/useWhisperSettingsStore.ts
// Fork-only Whisper word-by-word lyric alignment settings: whether auto-align is on, which
// whisper.cpp model and language to transcribe with, and whether to run htdemucs vocal separation
// (optionally on the GPU) before aligning.
//
// Split out of the former useSettingsUiStore during the upstream store decomposition. Kept as a
// dedicated store because Whisper alignment is a fork feature that upstream does not ship, so it
// has no home in any of the upstream-split stores. The localStorage keys are unchanged from the
// god-store version, so a listener's existing Whisper preferences carry over untouched.

import { create } from 'zustand';
import i18n from '../i18n/config';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

export type WhisperSettingsState = {
    whisperAlignEnabled: boolean;
    whisperAlignModel: string;
    whisperAlignLanguage: string;
    whisperAlignVocalSeparation: boolean;
    whisperAlignVocalSeparationGpu: boolean;
    handleToggleWhisperAlign: (enable: boolean) => void;
    handleSetWhisperAlignModel: (model: string) => void;
    handleSetWhisperAlignLanguage: (language: string) => void;
    handleSetWhisperAlignVocalSeparation: (enable: boolean) => void;
    handleSetWhisperAlignVocalSeparationGpu: (enable: boolean) => void;
};

export const useWhisperSettingsStore = create<WhisperSettingsState>((set) => ({
    whisperAlignEnabled: getStoredBoolean('whisper_align_enabled', false),
    whisperAlignModel: getStoredString('whisper_align_model', 'base'),
    whisperAlignLanguage: getStoredString('whisper_align_language', 'auto'),
    // Off by default: whole-track htdemucs isolation is expensive and its benefit is unproven for
    // every track. GPU on by default so that when a listener does turn isolation on, it is fast on a
    // machine that can (the runner falls back to the CPU EP where it cannot) - see htdemucs_runner.py.
    whisperAlignVocalSeparation: getStoredBoolean('whisper_align_vocal_separation', false),
    whisperAlignVocalSeparationGpu: getStoredBoolean('whisper_align_vocal_separation_gpu', true),
    handleToggleWhisperAlign: (enable) => {
        setStoredBoolean('whisper_align_enabled', enable);
        set({ whisperAlignEnabled: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'whisperAlignOn' : 'whisperAlignOff')),
        });
    },
    handleSetWhisperAlignModel: (model) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('whisper_align_model', model);
        }
        set({ whisperAlignModel: model });
    },
    handleSetWhisperAlignLanguage: (language) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('whisper_align_language', language);
        }
        set({ whisperAlignLanguage: language });
    },
    handleSetWhisperAlignVocalSeparation: (enable) => {
        setStoredBoolean('whisper_align_vocal_separation', enable);
        set({ whisperAlignVocalSeparation: enable });
    },
    handleSetWhisperAlignVocalSeparationGpu: (enable) => {
        setStoredBoolean('whisper_align_vocal_separation_gpu', enable);
        set({ whisperAlignVocalSeparationGpu: enable });
    },
}));

/** The Whisper-alignment half of the former settings snapshot, for surfaces that edit the whole domain at once. */
export const selectWhisperSettingsSnapshot = (state: WhisperSettingsState) => ({
    whisperAlignEnabled: state.whisperAlignEnabled,
    whisperAlignModel: state.whisperAlignModel,
    whisperAlignLanguage: state.whisperAlignLanguage,
    whisperAlignVocalSeparation: state.whisperAlignVocalSeparation,
    whisperAlignVocalSeparationGpu: state.whisperAlignVocalSeparationGpu,
    handleToggleWhisperAlign: state.handleToggleWhisperAlign,
    handleSetWhisperAlignModel: state.handleSetWhisperAlignModel,
    handleSetWhisperAlignLanguage: state.handleSetWhisperAlignLanguage,
    handleSetWhisperAlignVocalSeparation: state.handleSetWhisperAlignVocalSeparation,
    handleSetWhisperAlignVocalSeparationGpu: state.handleSetWhisperAlignVocalSeparationGpu,
});
