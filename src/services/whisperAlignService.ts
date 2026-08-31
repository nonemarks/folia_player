// src/services/whisperAlignService.ts
// Frontend service for Whisper-based word-level lyric alignment.
// Orchestrates: detect missing word timing → get audio → IPC call whisper →
// run wordAligner → update LyricData.

import type { LyricData, Line, LocalSong, SongResult } from '../types';
import { alignWhisperToLyrics, needsWordAlignment, hasLineTimingButNoWordTiming, type WhisperResult } from '../utils/lyrics/wordAligner';
import type { AudioQualityPreference } from '../types/onlineMusic';

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
let installFfmpegProgressUnsubscribe: (() => void) | null = null;

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
 * Get audio data for an online song (from cache or online source).
 * Returns the audio blob if available.
 */
async function getOnlineSongAudioBlob(song: { id: string | number; name?: string; artists?: any[] }): Promise<{ data: ArrayBuffer | null; mimeType?: string; reason?: string; failures?: string[] } | null> {
    const failures: string[] = [];

    try {
        // Try to get from Electron audio cache
        if (window.electron?.getAudioCache) {
            const cacheKey = `whisper-audio-${song.id}`;
            try {
                const cached = await window.electron.getAudioCache(cacheKey);
                if (cached?.found && cached.data) {
                    if (cached.data instanceof ArrayBuffer) {
                        console.log(`[WhisperAlign] Got audio from Electron cache for song ${song.id}`);
                        return { data: cached.data, mimeType: 'audio/mpeg' };
                    }
                    failures.push('electron-cache: invalid data type');
                } else {
                    failures.push('electron-cache: not found');
                }
            } catch (err) {
                failures.push(`electron-cache: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            failures.push('electron-cache: IPC not available');
        }

        // Try to get from resource cache (online playback cache)
        try {
            const { getCachedSongAudioBlob } = await import('./onlineMusic/resourceCache');
            const blob = await getCachedSongAudioBlob(song as any);
            if (blob) {
                console.log(`[WhisperAlign] Got audio from resource cache for song ${song.id}`);
                return { data: await blob.arrayBuffer(), mimeType: blob.type || 'audio/mpeg' };
            }
            failures.push('resourceCache: not found');
        } catch (err) {
            failures.push(`resourceCache: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Try to fetch from online source directly
        try {
            const { omni } = await import('./onlineMusic/omni');
            const { useSettingsUiStore } = await import('../stores/useSettingsUiStore');
            const audioQuality = useSettingsUiStore.getState().audioQuality || 'standard';

            console.log(`[WhisperAlign] Attempting omni.getAudioSource for song ${song.id} (quality: ${audioQuality})`);
            const source = await omni.getAudioSource(song as SongResult, audioQuality as AudioQualityPreference);

            if (source?.url) {
                console.log(`[WhisperAlign] Got audio URL from provider, fetching...`);

                // Use IPC to fetch audio in main process (bypasses CORS)
                if (window.electron?.whisperAlignFetchAudio) {
                    console.log(`[WhisperAlign] Using main-process fetch (CORS-safe)`);
                    try {
                        const result = await window.electron.whisperAlignFetchAudio(source.url);
                        if (result?.data && result.data.byteLength > 0) {
                            console.log(`[WhisperAlign] Fetched audio via IPC: ${result.data.byteLength} bytes, type: ${result.mimeType}`);
                            return { data: result.data, mimeType: result.mimeType };
                        }
                        failures.push(`ipc-fetch: returned empty (bytes=${result?.data?.byteLength ?? 0})`);
                    } catch (err) {
                        failures.push(`ipc-fetch: ${err instanceof Error ? err.message : String(err)}`);
                    }
                } else {
                    failures.push('ipc-fetch: IPC not available');
                }

                // Fallback: try renderer fetch (may fail due to CORS)
                try {
                    const response = await fetch(source.url);
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        if (arrayBuffer.byteLength > 0) {
                            console.log(`[WhisperAlign] Fetched online audio: ${arrayBuffer.byteLength} bytes`);
                            const ct = response.headers.get('content-type') || 'audio/mpeg';
                            return { data: arrayBuffer, mimeType: ct };
                        }
                        failures.push('renderer-fetch: 0 bytes');
                    } else {
                        failures.push(`renderer-fetch: HTTP ${response.status}`);
                    }
                } catch (err) {
                    failures.push(`renderer-fetch: ${err instanceof Error ? err.message : String(err)}`);
                }
            } else {
                failures.push(`omni.getAudioSource: no URL returned (source=${source ? JSON.stringify(Object.keys(source)) : 'null'})`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push(`omni: ${msg}`);
        }

        console.error(`[WhisperAlign] All audio sources failed for song ${song.id}:`);
        failures.forEach((f, i) => console.error(`  [${i + 1}] ${f}`));
        // Return detailed failure info so the UI can display the actual reasons
        const failureSummary = failures.length > 0 ? failures.slice(0, 5).join('; ') : 'no sources attempted';
        return { data: null as any, reason: `All sources failed: ${failureSummary}`, failures };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[WhisperAlign] getOnlineSongAudioBlob error: ${msg}`);
        return { data: null as any, reason: `Error: ${msg}`, failures: [`fatal: ${msg}`] };
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
    /** FFmpeg is available for audio conversion. */
    ffmpegAvailable: boolean;
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
            ffmpegAvailable: false,
            reason: 'not-electron',
        };
    }
    try {
        const status = await window.electron.whisperAlignGetStatus();
        const cliInstalled = status.available;
        const hasModel = status.models?.some((m: any) => m.downloaded) || false;
        const ffmpegAvailable = status.ffmpegAvailable || false;
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
            ffmpegAvailable,
            reason,
        };
    } catch {
        return {
            available: false,
            cliInstalled: false,
            hasModel: false,
            models: [],
            ffmpegAvailable: false,
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
 * Auto-install FFmpeg for the current platform.
 * Downloads a static build and installs it to the app's userData directory.
 *
 * @param onProgress - Progress callback: { status, progress, ... }
 * @returns Installation result with path
 */
export async function installFfmpeg(onProgress?: (progress: any) => void): Promise<{ success: boolean; path: string }> {
    if (!window.electron?.whisperAlignInstallFfmpeg) {
        throw new Error('FFmpeg installation is not available in this environment.');
    }

    // Subscribe to install progress
    if (onProgress && window.electron.onWhisperAlignInstallFfmpegProgress) {
        installFfmpegProgressUnsubscribe = window.electron.onWhisperAlignInstallFfmpegProgress(onProgress);
    }

    try {
        const result = await window.electron.whisperAlignInstallFfmpeg();
        return result;
    } finally {
        if (installFfmpegProgressUnsubscribe) {
            installFfmpegProgressUnsubscribe();
            installFfmpegProgressUnsubscribe = null;
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
        const isLocalSong = 'filePath' in song && !!song.filePath;
        const songName = ('title' in song ? song.title : ('name' in song ? song.name : undefined)) ?? String(song.id);

        console.log(`[WhisperAlign] Preparing audio for: "${songName}" (id=${song.id}, local=${isLocalSong})`);

        // For local songs, use the file path directly
        if (isLocalSong) {
            audioPath = song.filePath!;
            console.log(`[WhisperAlign] Using local file path: ${audioPath}`);
        }

        // For online songs, try to get cached audio or fetch from online source
        let audioFailureReason = '';
        if (!audioPath) {
            console.log(`[WhisperAlign] No local file path, trying online audio sources for song ${song.id}`);
            const audioResult = await getOnlineSongAudioBlob(song);
            if (audioResult && audioResult.data && audioResult.data.byteLength > 0 && window.electron?.whisperAlignPrepareAudio) {
                const mimeType = audioResult.mimeType || 'audio/mpeg';
                audioPath = await window.electron.whisperAlignPrepareAudio(audioResult.data, mimeType);
                console.log(`[WhisperAlign] Prepared audio file: ${audioPath}`);
            } else if (audioResult && audioResult.data && audioResult.data.byteLength > 0 && !window.electron?.whisperAlignPrepareAudio) {
                console.error(`[WhisperAlign] whisperAlignPrepareAudio IPC not available (not in Electron?)`);
                audioFailureReason = 'IPC not available';
            } else {
                // Build detailed failure reason from the failures array
                const detailFailures = audioResult?.failures;
                if (detailFailures && detailFailures.length > 0) {
                    audioFailureReason = detailFailures.slice(0, 5).join('; ');
                } else {
                    audioFailureReason = audioResult?.reason || (audioResult ? 'empty audio data' : 'no audio source available');
                }
                console.error(`[WhisperAlign] getOnlineSongAudioBlob failed for song ${song.id}. Reason: ${audioFailureReason}`);
            }
        }

        if (!audioPath) {
            const reason = isLocalSong
                ? 'options.whisperAlignNoAudioLocal'
                : 'options.whisperAlignNoAudioOnline';
            const error = new Error(reason);
            (error as any).audioFailureReason = audioFailureReason;
            (error as any).songInfo = { id: song.id, name: songName, isLocal: isLocalSong };
            throw error;
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
            // The main process now throws with diagnostic info when segments are empty,
            // so this is a safety fallback. If we reach here, the error came from elsewhere.
            const diag = (whisperResult as any).diagnostic || '';
            console.error(`[WhisperAlign] No segments in transcription result. ` +
                `Result keys: ${whisperResult ? Object.keys(whisperResult).join(',') : 'null'}, ` +
                `Segments: ${whisperResult?.segments?.length ?? 'undefined'}` +
                (diag ? `, Diagnostic: ${diag}` : ''));
            const error = new Error('options.whisperAlignNoSegments');
            (error as any).diagnostic = diag;
            throw error;
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
        // Re-throw so the UI can display the actual error message with diagnostic info
        // instead of a generic "no segments" message
        throw err;
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