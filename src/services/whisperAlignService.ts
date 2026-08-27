// src/services/whisperAlignService.ts
// Frontend service for Whisper-based word-level lyric alignment.
// Orchestrates: detect missing word timing → get audio → IPC call whisper →
// run wordAligner → update LyricData.

import type { LyricData, Line, LocalSong, SongResult } from '../types';
import { alignWhisperToLyrics, needsWordAlignment, hasLineTimingButNoWordTiming, type WhisperResult } from '../utils/lyrics/wordAligner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhisperAlignJob {
    id: string;
    songId: string;
    songName: string;
    status: 'pending' | 'downloading-model' | 'preparing-audio' | 'transcribing' | 'aligning' | 'completed' | 'error' | 'cancelled';
    progress: number;
    error?: string;
    result?: LyricData;
}

export type WhisperAlignProgressCallback = (job: WhisperAlignJob) => void;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeJob: WhisperAlignJob | null = null;
let progressUnsubscribe: (() => void) | null = null;
let downloadProgressUnsubscribe: (() => void) | null = null;
let installProgressUnsubscribe: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Audio source helpers
// ---------------------------------------------------------------------------

/**
 * Get audio data for a local song (direct file path).
 */
function getLocalSongAudioPath(song: LocalSong): string | null {
    if (!song.filePath) return null;
    return song.filePath;
}

/**
 * Get audio data for an online song (from cache).
 * Returns the cached audio blob if available.
 */
async function getOnlineSongAudioBlob(song: { id: string }): Promise<ArrayBuffer | null> {
    try {
        // Try to get from Electron audio cache
        if (window.electron?.getAudioCache) {
            const cacheKey = `whisper-audio-${song.id}`;
            const cached = await window.electron.getAudioCache(cacheKey);
            if (cached?.found && cached.data) {
                return cached.data instanceof ArrayBuffer ? cached.data : null;
            }
        }

        // Try to get from resource cache (online playback cache)
        const { getCachedSongAudioBlob } = await import('./onlineMusic/resourceCache');
        const blob = await getCachedSongAudioBlob(song as any);
        if (blob) {
            return await blob.arrayBuffer();
        }

        return null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detailed availability status for the Whisper alignment system.
 */
export type WhisperAvailabilityDetail = {
    /** Whether the full Whisper pipeline is ready to use. */
    available: boolean;
    /** Whisper-cli is installed and discoverable. */
    cliInstalled: boolean;
    /** At least one model has been downloaded. */
    hasModel: boolean;
    /** The list of available models (may be empty). */
    models: WhisperAlignModel[];
    /** Human-readable reason when not available (for error messages). */
    reason?: string;
};

/**
 * Check if the Whisper alignment system is available (simple boolean).
 */
export async function isWhisperAlignAvailable(): Promise<boolean> {
    const detail = await getWhisperAvailabilityDetail();
    return detail.available;
}

/**
 * Get detailed availability information for the Whisper alignment system.
 */
export async function getWhisperAvailabilityDetail(): Promise<WhisperAvailabilityDetail> {
    if (!window.electron?.whisperAlignGetStatus) {
        return {
            available: false,
            cliInstalled: false,
            hasModel: false,
            models: [],
            reason: 'not-electron',
        };
    }
    try {
        const status = await window.electron.whisperAlignGetStatus();
        const cliInstalled = status.available;
        const hasModel = status.models?.some((m: any) => m.downloaded) || false;
        let reason: string | undefined;
        if (!cliInstalled && !hasModel) {
            reason = 'no-cli-no-model';
        } else if (!cliInstalled) {
            reason = 'no-cli';
        } else if (!hasModel) {
            reason = 'no-model';
        }
        return {
            available: cliInstalled && hasModel,
            cliInstalled,
            hasModel,
            models: status.models || [],
            reason,
        };
    } catch {
        return {
            available: false,
            cliInstalled: false,
            hasModel: false,
            models: [],
            reason: 'error',
        };
    }
}

/**
 * Get the list of available Whisper models.
 */
export async function getWhisperModels(): Promise<any[]> {
    if (!window.electron?.whisperAlignGetModels) return [];
    try {
        return await window.electron.whisperAlignGetModels();
    } catch {
        return [];
    }
}

/**
 * Download a Whisper model.
 */
export async function downloadWhisperModel(modelName: string, onProgress?: (progress: any) => void): Promise<{ success: boolean; path: string; message: string }> {
    if (!window.electron?.whisperAlignDownloadModel) {
        throw new Error('Whisper alignment is not available in this environment.');
    }

    // Subscribe to download progress
    if (onProgress && window.electron.onWhisperAlignDownloadProgress) {
        downloadProgressUnsubscribe = window.electron.onWhisperAlignDownloadProgress(onProgress);
    }

    try {
        const result = await window.electron.whisperAlignDownloadModel(modelName);
        return result;
    } finally {
        if (downloadProgressUnsubscribe) {
            downloadProgressUnsubscribe();
            downloadProgressUnsubscribe = null;
        }
    }
}

/**
 * Auto-install whisper-cli from GitHub releases.
 * Downloads the latest pre-built binary for the current platform and installs
 * it to the app's userData directory.
 *
 * @param onProgress - Progress callback: { status, progress, ... }
 * @returns Installation result with path and version
 */
export async function installWhisperCli(onProgress?: (progress: any) => void): Promise<{ success: boolean; path: string; version: string }> {
    if (!window.electron?.whisperAlignInstallCli) {
        throw new Error('Whisper CLI installation is not available in this environment.');
    }

    // Subscribe to install progress
    if (onProgress && window.electron.onWhisperAlignInstallProgress) {
        installProgressUnsubscribe = window.electron.onWhisperAlignInstallProgress(onProgress);
    }

    try {
        const result = await window.electron.whisperAlignInstallCli();
        return result;
    } finally {
        if (installProgressUnsubscribe) {
            installProgressUnsubscribe();
            installProgressUnsubscribe = null;
        }
    }
}

/**
 * Check if a LyricData needs word-level alignment.
 */
export function shouldAlignLyrics(lyrics: LyricData | null): boolean {
    return hasLineTimingButNoWordTiming(lyrics);
}

/**
 * Run Whisper alignment on a song's lyrics.
 *
 * @param song - The song object (LocalSong or online song)
 * @param lyrics - The current lyrics with line-level timing
 * @param options - Alignment options
 * @returns Updated LyricData with word-level timing, or null if alignment failed
 */
export async function alignLyricsWithWhisper(
    song: LocalSong | SongResult | { id: string | number; title?: string; name?: string; filePath?: string },
    lyrics: LyricData,
    options?: {
        language?: string;
        model?: string;
        onProgress?: WhisperAlignProgressCallback;
    },
): Promise<LyricData | null> {
    const { language, model, onProgress } = options || {};

    // Check if alignment is needed
    if (!shouldAlignLyrics(lyrics)) {
        return null;
    }

    // Check if Whisper is available
    const availability = await getWhisperAvailabilityDetail();
    if (!availability.available) {
        // Return a structured error so the UI can show a helpful message
        const error = new Error(getWhisperUnavailableMessage(availability.reason));
        (error as any).whisperReason = availability.reason;
        throw error;
    }

    // Create job
    const jobId = `whisper-${song.id}-${Date.now()}`;
    activeJob = {
        id: jobId,
        songId: String(song.id),
        songName: ('title' in song ? song.title : ('name' in song ? song.name : undefined)) ?? String(song.id),
        status: 'pending',
        progress: 0,
    };

    const updateJob = (update: Partial<WhisperAlignJob>) => {
        if (activeJob) {
            Object.assign(activeJob, update);
            onProgress?.(activeJob);
        }
    };

    // Subscribe to progress events
    if (window.electron?.onWhisperAlignProgress) {
        progressUnsubscribe = window.electron.onWhisperAlignProgress((progress) => {
            if (progress.jobId === jobId) {
                updateJob({
                    status: progress.status === 'transcribing' ? 'transcribing' :
                            progress.status === 'starting' ? 'preparing-audio' :
                            progress.status === 'completed' ? 'completed' : 'transcribing',
                    progress: progress.progress ?? 0,
                });
            }
        });
    }

    try {
        // Step 1: Get audio source
        updateJob({ status: 'preparing-audio', progress: 5 });

        let audioPath: string | null = null;

        // For local songs, use the file path directly
        if ('filePath' in song && song.filePath) {
            audioPath = song.filePath;
        }

        // For online songs, try to get cached audio
        if (!audioPath) {
            const audioBlob = await getOnlineSongAudioBlob({ id: String(song.id) });
            if (audioBlob && window.electron?.whisperAlignPrepareAudio) {
                audioPath = await window.electron.whisperAlignPrepareAudio(audioBlob, 'audio/mpeg');
            }
        }

        if (!audioPath) {
            throw new Error('Could not obtain audio for transcription. The song may not be cached locally.');
        }

        // Step 2: Run Whisper transcription
        updateJob({ status: 'transcribing', progress: 10 });

        const whisperResult: WhisperResult = await window.electron!.whisperAlignTranscribe!(audioPath, {
            model: model || 'base',
            language,
            jobId,
        });

        if ((whisperResult as any).cancelled) {
            updateJob({ status: 'cancelled', progress: 0 });
            return null;
        }

        if (!whisperResult.segments || whisperResult.segments.length === 0) {
            throw new Error('Whisper transcription produced no results.');
        }

        // Step 3: Run alignment algorithm
        updateJob({ status: 'aligning', progress: 90 });

        const alignedLyrics = alignWhisperToLyrics(whisperResult, lyrics.lines, {
            enableForceCalibration: true,
            enableAvgDistribution: false,
        });

        // Step 4: Complete
        updateJob({ status: 'completed', progress: 100, result: alignedLyrics });

        // Clean up temp audio file if we created one
        if (audioPath && !('filePath' in song && song.filePath === audioPath)) {
            try {
                // The main process handles cleanup, but we could also request it
            } catch {}
        }

        return alignedLyrics;
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        updateJob({ status: 'error', progress: 0, error: errorMessage });
        console.error('[WhisperAlign] Alignment failed:', errorMessage);
        return null;
    } finally {
        if (progressUnsubscribe) {
            progressUnsubscribe();
            progressUnsubscribe = null;
        }
        activeJob = null;
    }
}

/**
 * Cancel the active alignment job.
 */
export async function cancelAlignment(): Promise<boolean> {
    if (!activeJob || !window.electron?.whisperAlignCancel) return false;
    try {
        return await window.electron.whisperAlignCancel(activeJob.id);
    } catch {
        return false;
    }
}

/**
 * Get the current active alignment job.
 */
export function getActiveJob(): WhisperAlignJob | null {
    return activeJob;
}

/**
 * Auto-align lyrics if they lack word-level timing.
 * This is the main entry point for automatic alignment after lyrics are loaded.
 *
 * @param song - The song object
 * @param lyrics - The current lyrics
 * @param options - Alignment options
 * @returns Updated LyricData with word-level timing, or the original if no alignment needed/possible
 */
export async function autoAlignIfNeeded(
    song: LocalSong | SongResult | { id: string | number; title?: string; name?: string; filePath?: string },
    lyrics: LyricData | null,
    options?: {
        language?: string;
        model?: string;
        enabled?: boolean;
        onProgress?: WhisperAlignProgressCallback;
    },
): Promise<LyricData | null> {
    if (!lyrics) return null;

    // Check if auto-align is enabled
    if (options?.enabled === false) return lyrics;

    // Check if alignment is needed
    if (!shouldAlignLyrics(lyrics)) return lyrics;

    // Run alignment
    const result = await alignLyricsWithWhisper(song, lyrics, options);
    return result || lyrics;
}

/**
 * Get a human-readable i18n key for the Whisper unavailable reason.
 */
export function getWhisperUnavailableMessage(reason?: string): string {
    switch (reason) {
        case 'not-electron':
            return 'options.whisperAlignNotElectron';
        case 'no-cli-no-model':
            return 'options.whisperAlignNotInstalled';
        case 'no-cli':
            return 'options.whisperAlignCliNotFound';
        case 'no-model':
            return 'options.whisperAlignNoModel';
        case 'error':
            return 'options.whisperAlignCheckError';
        default:
            return 'options.whisperAlignNoAudio';
    }
}