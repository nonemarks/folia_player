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

// ---------------------------------------------------------------------------
// Mod entry point
// ---------------------------------------------------------------------------

module.exports = function activate(api) {
    api.log.info('whisper-align mod loaded');

    // Register all commands
    api.commands.register({
        id: 'check-status',
        label: { 'zh-CN': '检查 Whisper 环境', en: 'Check Whisper environment' },
        description: { 'zh-CN': '检测 whisper-cli、模型和 FFmpeg 的安装状态', en: 'Check whisper-cli, models, and FFmpeg installation status' },
        permissions: [],
        params: [],
        run: cmdCheckStatus,
    });

    api.commands.register({
        id: 'list-models',
        label: { 'zh-CN': '列出可用模型', en: 'List available models' },
        description: { 'zh-CN': '获取所有支持的 Whisper 模型及其下载状态', en: 'Get all supported Whisper models and their download status' },
        permissions: [],
        params: [],
        run: cmdListModels,
    });

    api.commands.register({
        id: 'download-model',
        label: { 'zh-CN': '下载模型', en: 'Download model' },
        description: { 'zh-CN': '下载指定的 Whisper 模型', en: 'Download a specific Whisper model' },
        permissions: ['filesystem.data'],
        params: [
            { key: 'modelName', label: { 'zh-CN': '模型名称', en: 'Model name' }, type: 'select', options: [
                { value: 'tiny', label: { 'zh-CN': 'Tiny (~75MB)', en: 'Tiny (~75MB)' } },
                { value: 'base', label: { 'zh-CN': 'Base (~142MB)', en: 'Base (~142MB)' } },
                { value: 'small', label: { 'zh-CN': 'Small (~466MB)', en: 'Small (~466MB)' } },
                { value: 'medium', label: { 'zh-CN': 'Medium (~1.5GB)', en: 'Medium (~1.5GB)' } },
                { value: 'large-v3', label: { 'zh-CN': 'Large v3 (~3.1GB)', en: 'Large v3 (~3.1GB)' } },
                { value: 'large-v3-turbo', label: { 'zh-CN': 'Large v3 Turbo (~1.6GB)', en: 'Large v3 Turbo (~1.6GB)' } },
            ], defaultValue: 'small' },
        ],
        run: cmdDownloadModel,
    });

    api.commands.register({
        id: 'get-download-progress',
        label: { 'zh-CN': '获取下载进度', en: 'Get download progress' },
        description: { 'zh-CN': '获取当前模型下载的进度状态', en: 'Get current model download progress status' },
        permissions: [],
        params: [],
        run: cmdGetDownloadProgress,
    });

    api.commands.register({
        id: 'install-cli',
        label: { 'zh-CN': '安装 whisper-cli', en: 'Install whisper-cli' },
        description: { 'zh-CN': '自动下载并安装 whisper-cli', en: 'Automatically download and install whisper-cli' },
        permissions: ['filesystem.data'],
        params: [],
        run: cmdInstallCli,
    });

    api.commands.register({
        id: 'get-cli-install-progress',
        label: { 'zh-CN': '获取安装进度', en: 'Get install progress' },
        description: { 'zh-CN': '获取 whisper-cli 安装的进度状态', en: 'Get whisper-cli install progress status' },
        permissions: [],
        params: [],
        run: cmdGetCliInstallProgress,
    });

    api.commands.register({
        id: 'install-ffmpeg',
        label: { 'zh-CN': '安装 FFmpeg', en: 'Install FFmpeg' },
        description: { 'zh-CN': '自动下载并安装 FFmpeg', en: 'Automatically download and install FFmpeg' },
        permissions: ['filesystem.data'],
        params: [],
        run: cmdInstallFfmpeg,
    });

    api.commands.register({
        id: 'get-ffmpeg-install-progress',
        label: { 'zh-CN': '获取 FFmpeg 安装进度', en: 'Get FFmpeg install progress' },
        description: { 'zh-CN': '获取 FFmpeg 安装的进度状态', en: 'Get FFmpeg install progress status' },
        permissions: [],
        params: [],
        run: cmdGetFfmpegInstallProgress,
    });

    api.commands.register({
        id: 'transcribe',
        label: { 'zh-CN': '转录音频', en: 'Transcribe audio' },
        description: { 'zh-CN': '使用 Whisper 转录音频文件', en: 'Transcribe an audio file using Whisper' },
        permissions: ['runtime.playback'],
        params: [
            { key: 'audioPath', label: { 'zh-CN': '音频路径', en: 'Audio path' }, type: 'text', defaultValue: '' },
            { key: 'model', label: { 'zh-CN': '模型', en: 'Model' }, type: 'select', options: [
                { value: 'tiny', label: { en: 'Tiny' } },
                { value: 'base', label: { en: 'Base' } },
                { value: 'small', label: { en: 'Small' } },
                { value: 'medium', label: { en: 'Medium' } },
                { value: 'large-v3', label: { en: 'Large v3' } },
                { value: 'large-v3-turbo', label: { en: 'Large v3 Turbo' } },
            ], defaultValue: 'base' },
            { key: 'language', label: { 'zh-CN': '语言', en: 'Language' }, type: 'text', defaultValue: '' },
        ],
        run: cmdTranscribe,
    });

    api.commands.register({
        id: 'cancel-transcription',
        label: { 'zh-CN': '取消转录', en: 'Cancel transcription' },
        description: { 'zh-CN': '取消正在进行的转录任务', en: 'Cancel an active transcription job' },
        permissions: [],
        params: [
            { key: 'jobId', label: { 'zh-CN': '任务ID', en: 'Job ID' }, type: 'text', defaultValue: '' },
        ],
        run: cmdCancelTranscription,
    });

    api.commands.register({
        id: 'get-transcription-status',
        label: { 'zh-CN': '获取转录状态', en: 'Get transcription status' },
        description: { 'zh-CN': '获取转录任务的当前状态和进度', en: 'Get current status and progress of a transcription job' },
        permissions: [],
        params: [
            { key: 'jobId', label: { 'zh-CN': '任务ID', en: 'Job ID' }, type: 'text', defaultValue: '' },
        ],
        run: cmdGetTranscriptionStatus,
    });

    api.commands.register({
        id: 'prepare-audio',
        label: { 'zh-CN': '准备音频', en: 'Prepare audio' },
        description: { 'zh-CN': '将音频数据转换为 WAV 格式', en: 'Convert audio data to WAV format' },
        permissions: ['filesystem.data'],
        params: [],
        run: cmdPrepareAudio,
    });

    api.commands.register({
        id: 'fetch-audio',
        label: { 'zh-CN': '获取音频', en: 'Fetch audio' },
        description: { 'zh-CN': '从 URL 获取音频数据（绕过 CORS）', en: 'Fetch audio data from URL (bypass CORS)' },
        permissions: [],
        params: [
            { key: 'url', label: { 'zh-CN': 'URL', en: 'URL' }, type: 'text', defaultValue: '' },
        ],
        run: cmdFetchAudio,
    });

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