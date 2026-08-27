// electron/whisperAlign.cjs
// Whisper-based word-level lyric alignment for Folia.
// Runs in Electron main process, communicates with renderer via IPC.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WHISPER_MODELS_DIR_NAME = 'whisper-models';
const WHISPER_CACHE_DIR_NAME = 'whisper-cache';

// Supported models (tiny through medium for reasonable performance)
const SUPPORTED_MODELS = {
    'tiny':    { size: '~75MB',  multilingual: true,  recommended: false },
    'base':    { size: '~142MB', multilingual: true,  recommended: false },
    'small':   { size: '~466MB', multilingual: true,  recommended: true  },
    'medium':  { size: '~1.5GB', multilingual: true,  recommended: false },
};

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/** @type {Map<string, { process: import('child_process').ChildProcess, cancelled: boolean }>} */
const activeJobs = new Map();

let whisperCliPath = null;
let modelsDirectory = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the Whisper align module.
 * @param {object} options
 * @param {string} [options.customModelsDir] - Custom directory for Whisper models
 */
function initWhisperAlign(options = {}) {
    modelsDirectory = options.customModelsDir || path.join(app.getPath('userData'), WHISPER_MODELS_DIR_NAME);

    // Ensure models directory exists
    if (!fs.existsSync(modelsDirectory)) {
        fs.mkdirSync(modelsDirectory, { recursive: true });
    }

    // Try to find whisper-cli in common locations
    whisperCliPath = findWhisperCli();
}

/**
 * Find the whisper-cli executable.
 * Checks: bundled binary, PATH, common install locations.
 */
function findWhisperCli() {
    // 1. Bundled with the app (future: ship whisper.cpp binary)
    const bundledPath = path.join(process.resourcesPath || '', 'whisper-cli', getWhisperCliName());
    if (fs.existsSync(bundledPath)) return bundledPath;

    // 2. In PATH
    // We'll rely on spawn without full path to find it
    return null; // Will use PATH lookup via shell
}

function getWhisperCliName() {
    return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

/**
 * Get the list of available (downloaded) models.
 */
function getAvailableModels() {
    if (!modelsDirectory || !fs.existsSync(modelsDirectory)) {
        return [];
    }

    const models = [];
    for (const [name, info] of Object.entries(SUPPORTED_MODELS)) {
        const modelFile = path.join(modelsDirectory, `ggml-${name}.bin`);
        const exists = fs.existsSync(modelFile);
        models.push({
            name,
            ...info,
            downloaded: exists,
            path: exists ? modelFile : null,
        });
    }
    return models;
}

/**
 * Get the path to a model file.
 * @param {string} modelName - Model name (tiny, base, small, medium)
 * @returns {string|null} Path to the model file, or null if not downloaded
 */
function getModelPath(modelName) {
    if (!SUPPORTED_MODELS[modelName]) {
        throw new Error(`Unknown model: ${modelName}. Supported: ${Object.keys(SUPPORTED_MODELS).join(', ')}`);
    }
    const modelFile = path.join(modelsDirectory, `ggml-${modelName}.bin`);
    return fs.existsSync(modelFile) ? modelFile : null;
}

/**
 * Download a Whisper model using the whisper.cpp download script.
 * For now, returns instructions for manual download.
 * In the future, this could use the huggingface API.
 */
async function downloadModel(modelName, onProgress) {
    if (!SUPPORTED_MODELS[modelName]) {
        throw new Error(`Unknown model: ${modelName}`);
    }

    const modelFile = path.join(modelsDirectory, `ggml-${modelName}.bin`);
    if (fs.existsSync(modelFile)) {
        return { success: true, path: modelFile, message: 'Model already downloaded' };
    }

    // Use the whisper.cpp download script if available
    // Otherwise, provide download URL for manual download
    const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;

    if (onProgress) {
        onProgress({ status: 'downloading', model: modelName, url: downloadUrl, progress: 0 });
    }

    // Try to download using fetch (Node.js 18+)
    try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download model: HTTP ${response.status}`);
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(modelFile);
        const reader = response.body.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            fileStream.write(value);
            downloadedBytes += value.length;

            if (onProgress && contentLength > 0) {
                onProgress({
                    status: 'downloading',
                    model: modelName,
                    url: downloadUrl,
                    progress: Math.round((downloadedBytes / contentLength) * 100),
                    downloadedBytes,
                    totalBytes: contentLength,
                });
            }
        }

        fileStream.end();

        await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });

        if (onProgress) {
            onProgress({ status: 'downloaded', model: modelName, path: modelFile, progress: 100 });
        }

        return { success: true, path: modelFile, message: 'Model downloaded successfully' };
    } catch (err) {
        // Clean up partial download
        if (fs.existsSync(modelFile)) {
            fs.unlinkSync(modelFile);
        }
        throw new Error(`Failed to download model ${modelName}: ${err.message}. You can manually download from ${downloadUrl} and place it at ${modelFile}`);
    }
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Run Whisper transcription on an audio file.
 * @param {string} audioPath - Path to the audio file
 * @param {object} options
 * @param {string} [options.model='base'] - Model name to use
 * @param {string} [options.language] - Language code (auto-detect if omitted)
 * @param {boolean} [options.wordTimestamps=true] - Enable word-level timestamps
 * @param {string} [options.modelPath] - Override model path
 * @param {string} [options.jobId] - Job ID for cancellation
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Promise<object>} Whisper transcription result
 */
async function transcribeAudio(audioPath, options = {}) {
    const {
        model = 'base',
        language,
        wordTimestamps = true,
        modelPath: customModelPath,
        jobId = `job-${Date.now()}`,
        onProgress,
    } = options;

    // Validate audio file
    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    // Get model path
    const modelPath = customModelPath || getModelPath(model);
    if (!modelPath) {
        const available = getAvailableModels().filter(m => m.downloaded).map(m => m.name);
        throw new Error(
            `Model '${model}' is not downloaded. Available models: ${available.join(', ') || 'none'}. ` +
            `Please download a model first using the 'Download Model' button in settings.`
        );
    }

    if (onProgress) onProgress({ status: 'starting', model, audioPath });

    // Build whisper-cli arguments
    const args = [
        '-m', modelPath,
        '-f', audioPath,
        '--output-json',
        '--no-timestamps',  // We'll parse word timestamps ourselves
    ];

    if (wordTimestamps) {
        args.push('--max-len', '1');  // Force word-level output
    }

    if (language) {
        args.push('-l', language);
    } else {
        args.push('-l', 'auto');
    }

    // Add threads based on CPU count
    const cpuCount = os.cpus().length;
    args.push('-t', String(Math.min(cpuCount, 8)));

    // Output to temp file
    const tmpDir = os.tmpdir();
    const outputBase = path.join(tmpDir, `folia-whisper-${jobId}`);
    const outputFile = `${outputBase}.json`;

    args.push('-of', outputBase);

    // Find whisper-cli
    const cliName = getWhisperCliName();
    const cliPath = whisperCliPath || cliName;

    if (onProgress) onProgress({ status: 'transcribing', model, progress: 0 });

    // Spawn whisper-cli process
    return new Promise((resolve, reject) => {
        const proc = spawn(cliPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: !whisperCliPath, // Use shell if relying on PATH
        });

        // Register for cancellation
        activeJobs.set(jobId, { process: proc, cancelled: false });

        let stderr = '';
        let lastProgress = 0;

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            // Parse progress from whisper-cli output
            const progressMatch = text.match(/progress:\s*(\d+)%/i);
            if (progressMatch) {
                lastProgress = parseInt(progressMatch[1], 10);
                if (onProgress) {
                    onProgress({ status: 'transcribing', model, progress: lastProgress });
                }
            }
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            // Also check stderr for progress
            const progressMatch = stderr.match(/progress:\s*(\d+)%/i);
            if (progressMatch) {
                const p = parseInt(progressMatch[1], 10);
                if (p > lastProgress) {
                    lastProgress = p;
                    if (onProgress) {
                        onProgress({ status: 'transcribing', model, progress: lastProgress });
                    }
                }
            }
        });

        proc.on('close', (code) => {
            activeJobs.delete(jobId);

            const job = activeJobs.get(jobId);
            if (job?.cancelled) {
                // Clean up temp file
                try { fs.unlinkSync(outputFile); } catch {}
                reject(new Error('Transcription cancelled'));
                return;
            }

            if (code !== 0) {
                reject(new Error(`Whisper transcription failed (exit code ${code}): ${stderr}`));
                return;
            }

            // Parse JSON output
            try {
                if (!fs.existsSync(outputFile)) {
                    reject(new Error('Whisper output file not found'));
                    return;
                }

                const result = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));

                // Clean up temp file
                try { fs.unlinkSync(outputFile); } catch {}

                // Convert whisper.cpp JSON to our WhisperResult format
                const whisperResult = parseWhisperCppOutput(result);

                if (onProgress) onProgress({ status: 'completed', model, progress: 100 });

                resolve(whisperResult);
            } catch (err) {
                reject(new Error(`Failed to parse Whisper output: ${err.message}`));
            }
        });

        proc.on('error', (err) => {
            activeJobs.delete(jobId);
            if (err.code === 'ENOENT') {
                reject(new Error(
                    `whisper-cli not found. Please install whisper.cpp and ensure '${cliName}' is in your PATH, ` +
                    `or place it in the app's resources directory.`
                ));
            } else {
                reject(new Error(`Failed to start whisper-cli: ${err.message}`));
            }
        });
    });
}

/**
 * Parse whisper.cpp JSON output into our WhisperResult format.
 */
function parseWhisperCppOutput(raw) {
    const segments = [];

    // whisper.cpp output format:
    // { "transcription": [ { "timestamps": { "from": "00:00:00.000", "to": "00:00:05.000" }, "offsets": { "from": 0, "to": 5000 }, "text": "...", "tokens": [ { "text": "...", "timestamps": { "from": ..., "to": ... } } ] } ] }
    // Or the simpler format: { "systeminfo": {...}, "transcription": [...] }

    const transcription = raw.transcription || [];

    for (const seg of transcription) {
        const segStart = (seg.offsets?.from ?? seg.timestamps?.from ?? 0) / 1000; // ms to s
        const segEnd = (seg.offsets?.to ?? seg.timestamps?.to ?? 0) / 1000;
        const text = seg.text || '';

        const words = [];

        // Extract word-level tokens if available
        if (seg.tokens && Array.isArray(seg.tokens)) {
            for (const token of seg.tokens) {
                if (token.timestamps) {
                    const wordStart = (token.timestamps.from ?? 0) / 1000;
                    const wordEnd = (token.timestamps.to ?? 0) / 1000;
                    words.push({
                        word: token.text || '',
                        start: wordStart,
                        end: wordEnd,
                    });
                }
            }
        }

        segments.push({
            start: segStart,
            end: segEnd,
            text: text.trim(),
            words: words.length > 0 ? words : undefined,
        });
    }

    return { segments };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel an active transcription job.
 * @param {string} jobId
 */
function cancelTranscription(jobId) {
    const job = activeJobs.get(jobId);
    if (job) {
        job.cancelled = true;
        try {
            job.process.kill('SIGTERM');
        } catch {}
        activeJobs.delete(jobId);
        return true;
    }
    return false;
}

/**
 * Check if whisper-cli is available.
 */
function isWhisperAvailable() {
    return whisperCliPath !== null; // Will be expanded to actually check
}

/**
 * Get the status of the Whisper alignment system.
 */
function getWhisperStatus() {
    return {
        available: isWhisperAvailable(),
        modelsDirectory,
        models: getAvailableModels(),
        activeJobs: Array.from(activeJobs.keys()),
    };
}

// ---------------------------------------------------------------------------
// Audio file preparation
// ---------------------------------------------------------------------------

/**
 * Convert an audio Blob/Buffer to a WAV file suitable for whisper.cpp.
 * whisper.cpp supports WAV, MP3, FLAC, etc. natively.
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} mimeType - MIME type of the audio
 * @param {string} jobId - Job ID for temp file naming
 * @returns {string} Path to the temp audio file
 */
async function prepareAudioFile(audioBuffer, mimeType, jobId) {
    const tmpDir = os.tmpdir();

    // Determine extension from MIME type
    let ext = 'wav';
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) ext = 'mp3';
    else if (mimeType.includes('flac')) ext = 'flac';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('webm')) ext = 'webm';
    else if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'm4a';

    const audioPath = path.join(tmpDir, `folia-whisper-audio-${jobId}.${ext}`);
    fs.writeFileSync(audioPath, audioBuffer);

    return audioPath;
}

/**
 * Clean up temp audio file.
 */
function cleanupAudioFile(audioPath) {
    try {
        if (audioPath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }
    } catch {}
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    initWhisperAlign,
    transcribeAudio,
    cancelTranscription,
    getWhisperStatus,
    getAvailableModels,
    getModelPath,
    downloadModel,
    isWhisperAvailable,
    prepareAudioFile,
    cleanupAudioFile,
    SUPPORTED_MODELS,
};