// mods/whisper-align/index.cjs
// Whisper-based word-level lyric alignment mod for Folia.
// Wraps the core whisperAlign engine and exposes it as mod commands.

'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// State — active transcription jobs for polling-based progress
// ---------------------------------------------------------------------------

/** @type {Map<string, { status: string, progress: number, step?: string, error?: string, result?: object }>} */
const activeJobStatus = new Map();

/** @type {string|null} Current download model name, or null */
let currentDownload = null;

/** @type {{ model: string, progress: number, status: string }|null} */
let downloadProgress = null;

/** @type {{ status: string, progress: number, step?: string, error?: string, version?: string }|null} */
let cliInstallProgress = null;

/** @type {{ status: string, progress: number, step?: string, error?: string }|null} */
let ffmpegInstallProgress = null;

// ---------------------------------------------------------------------------
// Lazy-load the core whisperAlign module from the app's electron directory
// ---------------------------------------------------------------------------

let whisperCore = null;

function getCore() {
    if (whisperCore) return whisperCore;
    try {
        // Resolve relative to the app root so this works in both dev and packaged builds
        const { app } = require('electron');
        const corePath = path.join(app.getAppPath(), 'electron', 'whisperAlign.cjs');
        whisperCore = require(corePath);
        // Initialize on first load
        whisperCore.initWhisperAlign();
        return whisperCore;
    } catch (err) {
        console.error('[whisper-align mod] Failed to load core module:', err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function cmdCheckStatus() {
    const core = getCore();
    if (!core) return { available: false, cliInstalled: false, hasModel: false, models: [], ffmpegAvailable: false, reason: 'mod-core-load-failed' };
    try {
        const status = core.getWhisperStatus();
        const cliInstalled = status.available;
        const hasModel = status.models?.some(m => m.downloaded) || false;
        let reason;
        if (!cliInstalled && !hasModel) reason = 'no-cli-no-model';
        else if (!cliInstalled) reason = 'no-cli';
        else if (!hasModel) reason = 'no-model';
        return {
            available: cliInstalled && hasModel,
            cliInstalled,
            hasModel,
            models: status.models || [],
            ffmpegAvailable: status.ffmpegAvailable || false,
            modelsDirectory: status.modelsDirectory,
            reason,
        };
    } catch (err) {
        return { available: false, cliInstalled: false, hasModel: false, models: [], ffmpegAvailable: false, reason: 'error', error: err.message };
    }
}

async function cmdListModels() {
    const core = getCore();
    if (!core) return [];
    return core.getAvailableModels();
}

async function cmdDownloadModel(params) {
    const modelName = params.modelName;
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');
    if (!modelName || !core.SUPPORTED_MODELS[modelName]) {
        throw new Error(`Unknown model: ${modelName}`);
    }

    downloadProgress = { model: modelName, progress: 0, status: 'downloading' };
    currentDownload = modelName;

    try {
        const result = await core.downloadModel(modelName, (progress) => {
            downloadProgress = { model: modelName, progress: progress.progress ?? 0, status: 'downloading' };
        });
        downloadProgress = { model: modelName, progress: 100, status: 'done' };
        currentDownload = null;
        return result;
    } catch (err) {
        downloadProgress = { model: modelName, progress: 0, status: 'error', error: err.message };
        currentDownload = null;
        throw err;
    }
}

async function cmdGetDownloadProgress() {
    return downloadProgress || { status: 'idle' };
}

async function cmdInstallCli() {
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');

    cliInstallProgress = { status: 'installing', progress: 0 };

    try {
        const result = await core.installWhisperCli((progress) => {
            cliInstallProgress = {
                status: 'installing',
                progress: progress.progress ?? 0,
                step: progress.status,
            };
        });
        cliInstallProgress = { status: 'done', progress: 100, version: result.version };
        return result;
    } catch (err) {
        cliInstallProgress = { status: 'error', progress: 0, error: err.message };
        throw err;
    }
}

async function cmdGetCliInstallProgress() {
    return cliInstallProgress || { status: 'idle' };
}

async function cmdInstallFfmpeg() {
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');

    ffmpegInstallProgress = { status: 'installing', progress: 0 };

    try {
        await core.installFfmpeg((progress) => {
            ffmpegInstallProgress = {
                status: 'installing',
                progress: progress.progress ?? 0,
                step: progress.status,
            };
        });
        ffmpegInstallProgress = { status: 'done', progress: 100 };
        return { success: true };
    } catch (err) {
        ffmpegInstallProgress = { status: 'error', progress: 0, error: err.message };
        throw err;
    }
}

async function cmdGetFfmpegInstallProgress() {
    return ffmpegInstallProgress || { status: 'idle' };
}

async function cmdTranscribe(params) {
    const { audioPath, model, language, jobId } = params;
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');

    const id = jobId || `whisper-${Date.now()}`;
    activeJobStatus.set(id, { status: 'transcribing', progress: 0 });

    try {
        const result = await core.transcribeAudio(audioPath, {
            model: model || 'base',
            language,
            wordTimestamps: true,
            jobId: id,
            onProgress: (progress) => {
                activeJobStatus.set(id, {
                    status: 'transcribing',
                    progress: progress.progress ?? 0,
                    step: progress.status,
                });
            },
        });
        activeJobStatus.set(id, { status: 'completed', progress: 100, result });
        return result;
    } catch (err) {
        if (err.message?.includes('cancelled')) {
            activeJobStatus.set(id, { status: 'cancelled', progress: 0 });
            return { cancelled: true };
        }
        activeJobStatus.set(id, { status: 'error', progress: 0, error: err.message });
        throw err;
    }
}

async function cmdCancelTranscription(params) {
    const { jobId } = params;
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');
    core.cancelTranscription(jobId);
    activeJobStatus.set(jobId, { status: 'cancelled', progress: 0 });
    return { cancelled: true };
}

async function cmdGetTranscriptionStatus(params) {
    const { jobId } = params;
    if (!jobId) {
        // Return all active jobs
        return Array.from(activeJobStatus.entries()).map(([id, status]) => ({ jobId: id, ...status }));
    }
    const status = activeJobStatus.get(jobId);
    return status || { status: 'not-found' };
}

async function cmdPrepareAudio(params) {
    const { arrayBuffer, mimeType, jobId } = params;
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');
    // arrayBuffer comes as base64 from the renderer (IPC serialization)
    const buffer = Buffer.from(arrayBuffer, 'base64');
    // prepareAudioFile resolves to a temp file path (string). A cleanup callback
    // cannot cross the IPC boundary, so return the path plus the jobId; the caller
    // cleans up via a separate command / core.cleanupAudioFile.
    const id = jobId || `mod-${Date.now()}`;
    const audioPath = await core.prepareAudioFile(buffer, mimeType, id);
    return { path: audioPath, jobId: id };
}

async function cmdFetchAudio(params) {
    const { url } = params;
    const core = getCore();
    if (!core) throw new Error('Whisper core not loaded');
    const result = await core.fetchAudioBuffer(url);
    if (!result) return null;
    // Serialize buffer as base64 for IPC
    return {
        data: result.data.toString('base64'),
        mimeType: result.mimeType,
    };
}

async function cmdInvoke(commandId, params = {}) {
    const handlers = {
        'check-status': cmdCheckStatus,
        'list-models': cmdListModels,
        'download-model': cmdDownloadModel,
        'get-download-progress': cmdGetDownloadProgress,
        'install-cli': cmdInstallCli,
        'get-cli-install-progress': cmdGetCliInstallProgress,
        'install-ffmpeg': cmdInstallFfmpeg,
        'get-ffmpeg-install-progress': cmdGetFfmpegInstallProgress,
        'transcribe': cmdTranscribe,
        'cancel-transcription': cmdCancelTranscription,
        'get-transcription-status': cmdGetTranscriptionStatus,
        'prepare-audio': cmdPrepareAudio,
        'fetch-audio': cmdFetchAudio,
    };
    const handler = handlers[commandId];
    if (!handler) throw new Error(`Unknown Whisper command: ${commandId}`);
    return handler(params);
}

// ---------------------------------------------------------------------------
// Mod entry point
// ---------------------------------------------------------------------------

module.exports = function activate(api) {
    api.log.info('whisper-align mod loaded');
    api.rpc.handle('command', cmdInvoke);

    // The renderer invokes the command handlers through the mod RPC channel.
    // Cleanup on deactivate
    api.lifecycle.onDeactivate(() => {
        // Cancel all active transcription jobs
        const core = getCore();
        if (core) {
            for (const [jobId] of activeJobStatus) {
                try { core.cancelTranscription(jobId); } catch {}
            }
        }
        activeJobStatus.clear();
        downloadProgress = null;
        currentDownload = null;
        cliInstallProgress = null;
        ffmpegInstallProgress = null;
        api.log.info('whisper-align mod deactivated, all jobs cancelled');
    });
};