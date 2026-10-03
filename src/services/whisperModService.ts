// src/services/whisperModService.ts
// Service layer for communicating with the whisper-align mod via the mod command system.
// Keeps the Whisper feature behind the whisper-align mod boundary.

import type { WhisperAvailabilityDetail } from './whisperAlignService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModCommandResult<T = unknown> = {
    ok: boolean;
    result?: T;
    error?: string;
};

export type WhisperModStatus = {
    available: boolean;
    cliInstalled: boolean;
    hasModel: boolean;
    models: Array<{ name: string; size?: string; multilingual?: boolean; recommended?: boolean; downloaded: boolean; path?: string | null }>;
    ffmpegAvailable: boolean;
    modelsDirectory?: string;
    reason?: string;
    error?: string;
};

export type DownloadProgress = {
    model: string;
    progress: number;
    status: 'idle' | 'downloading' | 'done' | 'error';
    error?: string;
};

export type InstallProgress = {
    status: 'idle' | 'installing' | 'done' | 'error';
    progress: number;
    step?: string;
    error?: string;
    version?: string;
};

export type TranscriptionStatus = {
    status: 'idle' | 'transcribing' | 'completed' | 'cancelled' | 'error' | 'not-found';
    progress: number;
    step?: string;
    error?: string;
    result?: unknown;
};

// ---------------------------------------------------------------------------
// Mod availability check
// ---------------------------------------------------------------------------

const MOD_ID = 'whisper-align';

/**
 * Check if the whisper-align mod is available and enabled.
 */
export async function isWhisperModAvailable(): Promise<boolean> {
    if (!window.electron?.mods?.listMods) return false;
    try {
        const result = await window.electron.mods.listMods();
        const mods = result?.mods;
        const whisperMod = mods?.find((m: any) => m.id === MOD_ID);
        return whisperMod?.status === 'loaded' && whisperMod?.enabled === true;
    } catch {
        return false;
    }
}

/**
 * Check if the mod system itself is available (even if whisper-align mod isn't enabled).
 */
export function isModSystemAvailable(): boolean {
    return !!window.electron?.mods?.invokeModRpc;
}

// ---------------------------------------------------------------------------
// Mod command invocation helper
// ---------------------------------------------------------------------------

async function invokeCommand<T = unknown>(commandId: string, params: Record<string, unknown> = {}): Promise<ModCommandResult<T>> {
    if (!isModSystemAvailable()) return { ok: false, error: 'mod-system-not-available' };
    try {
        const response = await window.electron!.mods!.invokeModRpc(MOD_ID, 'command', [commandId, params]);
        return response as ModCommandResult<T>;
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ---------------------------------------------------------------------------
// Whisper operations via mod commands
// ---------------------------------------------------------------------------

/**
 * Get Whisper environment status via the mod.
 */
export async function getWhisperStatusViaMod(): Promise<WhisperModStatus | null> {
    const result = await invokeCommand<WhisperModStatus>('check-status');
    if (result.ok && result.result) return result.result;
    console.warn('[whisperModService] check-status failed:', result.error);
    return null;
}

/**
 * List available Whisper models via the mod.
 */
export async function listModelsViaMod(): Promise<Array<{ name: string; size?: string; downloaded: boolean }>> {
    const result = await invokeCommand<Array<{ name: string; size?: string; downloaded: boolean }>>('list-models');
    if (result.ok && result.result) return result.result;
    console.warn('[whisperModService] list-models failed:', result.error);
    return [];
}

/**
 * Download a Whisper model via the mod.
 */
export async function downloadModelViaMod(modelName: string): Promise<{ success: boolean; path: string; message: string } | null> {
    const result = await invokeCommand<{ success: boolean; path: string; message: string }>('download-model', { modelName });
    if (result.ok) return result.result ?? null;
    throw new Error(result.error || 'Download failed');
}

/**
 * Get current model download progress via the mod.
 */
export async function getDownloadProgressViaMod(): Promise<DownloadProgress> {
    const result = await invokeCommand<DownloadProgress>('get-download-progress');
    if (result.ok && result.result) return result.result;
    return { model: '', progress: 0, status: 'idle' };
}

/**
 * Install whisper-cli via the mod.
 */
export async function installCliViaMod(): Promise<{ version: string } | null> {
    const result = await invokeCommand<{ version: string }>('install-cli');
    if (result.ok) return result.result ?? null;
    throw new Error(result.error || 'Install failed');
}

/**
 * Get CLI install progress via the mod.
 */
export async function getCliInstallProgressViaMod(): Promise<InstallProgress> {
    const result = await invokeCommand<InstallProgress>('get-cli-install-progress');
    if (result.ok && result.result) return result.result;
    return { status: 'idle', progress: 0 };
}

/**
 * Install FFmpeg via the mod.
 */
export async function installFfmpegViaMod(): Promise<{ success: boolean } | null> {
    const result = await invokeCommand<{ success: boolean }>('install-ffmpeg');
    if (result.ok) return result.result ?? null;
    throw new Error(result.error || 'Install failed');
}

/**
 * Get FFmpeg install progress via the mod.
 */
export async function getFfmpegInstallProgressViaMod(): Promise<InstallProgress> {
    const result = await invokeCommand<InstallProgress>('get-ffmpeg-install-progress');
    if (result.ok && result.result) return result.result;
    return { status: 'idle', progress: 0 };
}

/**
 * Transcribe audio via the mod.
 */
export async function transcribeViaMod(params: {
    audioPath: string;
    model?: string;
    language?: string;
    jobId?: string;
    vocalSeparation?: boolean;
    vocalSeparationGpu?: boolean;
}): Promise<unknown> {
    const result = await invokeCommand('transcribe', params);
    if (result.ok) return result.result;
    throw new Error(result.error || 'Transcription failed');
}

/**
 * Cancel a transcription job via the mod.
 */
export async function cancelTranscriptionViaMod(jobId: string): Promise<{ cancelled: boolean } | null> {
    const result = await invokeCommand<{ cancelled: boolean }>('cancel-transcription', { jobId });
    if (result.ok) return result.result ?? null;
    return null;
}

/**
 * Get transcription status via the mod (for polling).
 */
export async function getTranscriptionStatusViaMod(jobId?: string): Promise<TranscriptionStatus | TranscriptionStatus[]> {
    const result = await invokeCommand<TranscriptionStatus | TranscriptionStatus[]>('get-transcription-status', { jobId: jobId || '' });
    if (result.ok && result.result) return result.result;
    return { status: 'not-found', progress: 0 };
}

/**
 * Prepare audio data via the mod. Returns the temp file path written by the main
 * process; the caller is responsible for cleanup (a callback cannot cross IPC).
 */
export async function prepareAudioViaMod(arrayBuffer: ArrayBuffer, mimeType: string, jobId?: string): Promise<{ path: string; jobId: string } | null> {
    // Convert ArrayBuffer to base64 for IPC serialization
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const result = await invokeCommand<{ path: string; jobId: string }>('prepare-audio', { arrayBuffer: base64, mimeType, jobId: jobId || '' });
    if (result.ok) return result.result ?? null;
    throw new Error(result.error || 'Prepare audio failed');
}

/**
 * Fetch audio from URL via the mod.
 */
export async function fetchAudioViaMod(url: string): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
    const result = await invokeCommand<{ data: string; mimeType: string }>('fetch-audio', { url });
    if (result.ok && result.result) {
        // Decode base64 back to ArrayBuffer
        const binaryString = atob(result.result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return { data: bytes.buffer, mimeType: result.result.mimeType };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Unified API: uses the enabled mod only
// ---------------------------------------------------------------------------

/**
 * Get Whisper availability detail through the mod only.
 */
export async function getWhisperAvailabilityUnified(): Promise<WhisperAvailabilityDetail> {
    const modAvailable = await isWhisperModAvailable();
    if (modAvailable) {
        const status = await getWhisperStatusViaMod();
        if (status) {
            return {
                available: status.available,
                cliInstalled: status.cliInstalled,
                hasModel: status.hasModel,
                models: status.models as any[],
                ffmpegAvailable: status.ffmpegAvailable,
                reason: status.reason,
            };
        }
    }

    return {
        available: false,
        cliInstalled: false,
        hasModel: false,
        models: [],
        ffmpegAvailable: false,
        reason: 'mod-not-loaded',
    };
}

/**
 * Whether the Whisper feature SURFACE is present - NOT whether CLI+model are ready.
 * True only when the whisper-align mod is loaded and enabled.
 */
export async function isWhisperFeaturePresent(): Promise<boolean> {
    return isWhisperModAvailable();
}

