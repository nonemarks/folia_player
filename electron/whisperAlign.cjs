// electron/whisperAlign.cjs
// Whisper-based word-level lyric alignment for Folia.
// Runs in Electron main process, communicates with renderer via IPC.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { app, net } = require('electron');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WHISPER_MODELS_DIR_NAME = 'whisper-models';
const WHISPER_CACHE_DIR_NAME = 'whisper-cache';
const WHISPER_CLI_DIR_NAME = 'whisper-cli';

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
 * Checks: installed by app, bundled binary, PATH.
 */
function findWhisperCli() {
    const cliName = getWhisperCliName();

    // 1. Installed by the app (userData directory)
    const installedPath = path.join(app.getPath('userData'), WHISPER_CLI_DIR_NAME, cliName);
    if (fs.existsSync(installedPath)) return installedPath;

    // 2. Bundled with the app (future: ship whisper.cpp binary)
    const bundledPath = path.join(process.resourcesPath || '', 'whisper-cli', cliName);
    if (fs.existsSync(bundledPath)) return bundledPath;

    // 3. In PATH
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

    const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;

    if (onProgress) {
        onProgress({ status: 'downloading', model: modelName, url: downloadUrl, progress: 0 });
    }

    // Download using https module with mirror fallback
    try {
        await downloadModelWithMirrors(downloadUrl, modelFile, modelName, onProgress);

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

/**
 * Download a model file with mirror fallback for HuggingFace URLs.
 */
async function downloadModelWithMirrors(downloadUrl, destPath, modelName, onProgress) {
    // HuggingFace mirrors for users in China
    const hfMirrors = [
        '',  // direct
        'https://hf-mirror.com',
    ];

    for (const mirror of hfMirrors) {
        const url = mirror
            ? downloadUrl.replace('https://huggingface.co', mirror)
            : downloadUrl;

        try {
            await new Promise((resolve, reject) => {
                const urlObj = new URL(url);
                const mod = urlObj.protocol === 'https:' ? https : http;

                const req = mod.get(url, {
                    headers: { 'User-Agent': 'Folia-Whisper-Installer' },
                    timeout: 120000,
                }, (res) => {
                    // Follow redirects
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        const redirectUrl = new URL(res.headers.location, url).toString();
                        downloadModelWithMirrors(redirectUrl, destPath, modelName, onProgress).then(resolve, reject);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }

                    const contentLength = parseInt(res.headers['content-length'] || '0', 10);
                    let downloadedBytes = 0;
                    const fileStream = fs.createWriteStream(destPath);

                    res.on('data', (chunk) => {
                        fileStream.write(chunk);
                        downloadedBytes += chunk.length;

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
                    });

                    res.on('end', () => {
                        fileStream.end();
                        fileStream.on('finish', resolve);
                        fileStream.on('error', reject);
                    });

                    res.on('error', (err) => {
                        try { fileStream.close(); } catch {}
                        reject(err);
                    });
                });

                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Download timeout'));
                });
            });

            return; // success
        } catch (err) {
            console.warn(`[WhisperInstaller] Model download failed from ${mirror || 'direct'}: ${err.message}`);
            try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
            // Try next mirror
        }
    }

    throw new Error('Unable to download model from any source. Please check your network connection.');
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
    ];

    if (wordTimestamps) {
        args.push('--word-timestamps', '1');  // Enable word-level timestamps in JSON output
    }

    // Language: omit -l flag for auto-detection (whisper.cpp default)
    // Only pass -l when a specific language is provided
    if (language) {
        args.push('-l', language);
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
    console.log(`[WhisperAlign] Spawning: ${cliPath} ${args.join(' ')}`);

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
            const text = data.toString();
            stderr += text;
            // Log stderr for debugging (whisper.cpp prints progress/info to stderr)
            console.log(`[WhisperAlign] stderr: ${text.trim()}`);
            // Also check stderr for progress
            const progressMatch = text.match(/progress:\s*(\d+)%/i);
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
                console.error(`[WhisperAlign] Process exited with code ${code}. stderr: ${stderr}`);
                reject(new Error(`Whisper transcription failed (exit code ${code}): ${stderr.slice(-500)}`));
                return;
            }

            // Parse JSON output
            try {
                if (!fs.existsSync(outputFile)) {
                    console.error(`[WhisperAlign] Output file not found: ${outputFile}`);
                    reject(new Error(`Whisper output file not found at ${outputFile}. stderr: ${stderr.slice(-200)}`));
                    return;
                }

                const rawResult = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));

                // Clean up temp file
                try { fs.unlinkSync(outputFile); } catch {}

                // Convert whisper.cpp JSON to our WhisperResult format
                const whisperResult = parseWhisperCppOutput(rawResult);

                console.log(`[WhisperAlign] Transcription complete: ${whisperResult.segments.length} segments, ` +
                    `${whisperResult.segments.filter(s => s.words && s.words.length > 0).length} segments with word timing`);

                if (onProgress) onProgress({ status: 'completed', model, progress: 100 });

                resolve(whisperResult);
            } catch (err) {
                console.error(`[WhisperAlign] Failed to parse output: ${err.message}`);
                reject(new Error(`Failed to parse Whisper output: ${err.message}`));
            }
        });

        proc.on('error', (err) => {
            activeJobs.delete(jobId);
            console.error(`[WhisperAlign] Process error: ${err.message}`);
            if (err.code === 'ENOENT') {
                reject(new Error(
                    `whisper-cli not found at '${cliPath}'. Please install whisper.cpp and ensure '${cliName}' is in your PATH, ` +
                    `or use the auto-install button in settings.`
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

    // whisper.cpp --output-json --word-timestamps 1 format:
    // { "systeminfo": {...}, "transcription": [ { "timestamps": { "from": "00:00:00.000", "to": "00:00:05.000" }, "offsets": { "from": 0, "to": 5000 }, "text": "...", "tokens": [ { "text": "...", "timestamps": { "from": 100, "to": 200 } } ] } ] }
    // Note: offsets are in milliseconds; token timestamps are also in milliseconds.

    const transcription = raw.transcription || [];

    for (const seg of transcription) {
        // Segment timing: prefer offsets (ms integers) over timestamps (formatted strings)
        let segStart = 0;
        let segEnd = 0;

        if (seg.offsets) {
            segStart = (typeof seg.offsets.from === 'number' ? seg.offsets.from : 0);
            segEnd = (typeof seg.offsets.to === 'number' ? seg.offsets.to : 0);
        } else if (seg.timestamps) {
            // Fallback: parse "HH:MM:SS.mmm" format
            segStart = parseTimestamp(seg.timestamps.from);
            segEnd = parseTimestamp(seg.timestamps.to);
        }

        const text = seg.text || '';
        const words = [];

        // Extract word-level tokens if available
        if (seg.tokens && Array.isArray(seg.tokens)) {
            for (const token of seg.tokens) {
                if (token.timestamps) {
                    const wordStart = (typeof token.timestamps.from === 'number' ? token.timestamps.from : parseTimestamp(token.timestamps.from)) / 1000;
                    const wordEnd = (typeof token.timestamps.to === 'number' ? token.timestamps.to : parseTimestamp(token.timestamps.to)) / 1000;
                    const wordText = (token.text || '').trim();
                    if (wordText) {
                        words.push({
                            word: wordText,
                            start: wordStart,
                            end: wordEnd,
                        });
                    }
                }
            }
        }

        segments.push({
            start: segStart / 1000,
            end: segEnd / 1000,
            text: text.trim(),
            words: words.length > 0 ? words : undefined,
        });
    }

    return { segments };
}

/**
 * Parse a whisper.cpp timestamp string "HH:MM:SS.mmm" into milliseconds.
 */
function parseTimestamp(ts) {
    if (typeof ts === 'number') return ts;
    if (typeof ts !== 'string') return 0;
    const parts = ts.split(':');
    if (parts.length === 3) {
        const [h, m, s] = parts;
        return (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s)) * 1000;
    }
    return 0;
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
// Auto-install whisper-cli
// ---------------------------------------------------------------------------

// GitHub mirror prefixes for users behind firewalls (tried in order)
const GITHUB_MIRRORS = [
    '',  // direct (no mirror)
    'https://ghfast.top',
    'https://gh-proxy.com',
    'https://ghproxy.net',
];

/**
 * Determine the platform-specific asset pattern and archive type for downloading whisper-cli.
 */
function getPlatformAssetInfo() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32' && arch === 'x64') {
        return { pattern: /whisper-bin-x64\.zip$/, type: 'zip' };
    }
    if (platform === 'win32' && arch === 'arm64') {
        // No pre-built ARM64 Windows binary yet
        return null;
    }
    if (platform === 'linux' && arch === 'x64') {
        return { pattern: /whisper-bin-ubuntu-x64\.tar\.gz$/, type: 'tar.gz' };
    }
    if (platform === 'linux' && arch === 'arm64') {
        return { pattern: /whisper-bin-ubuntu-arm64\.tar\.gz$/, type: 'tar.gz' };
    }
    // macOS: no pre-built CLI binary in releases; user needs Homebrew or build from source
    return null;
}

/**
 * Make an HTTP/HTTPS GET request and return the response body as a buffer.
 * Supports redirect following and custom headers.
 */
function httpGet(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const mod = urlObj.protocol === 'https:' ? https : http;
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Folia-Whisper-Installer',
                ...options.headers,
            },
            timeout: options.timeout || 30000,
        };

        const req = mod.request(reqOptions, (res) => {
            // Follow redirects (up to 5)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).toString();
                return httpGet(redirectUrl, options).then(resolve, reject);
            }

            if (res.statusCode !== 200) {
                res.resume(); // drain response
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout for ${url}`));
        });
        req.end();
    });
}

/**
 * Apply a GitHub mirror prefix to a URL.
 * For API URLs: mirror + '/' + original_url
 * For download URLs: mirror + '/' + original_url
 */
function applyMirror(url, mirrorPrefix) {
    if (!mirrorPrefix) return url;
    return mirrorPrefix + '/' + url;
}

/**
 * Fetch the latest release from the whisper.cpp GitHub repo.
 * Tries direct connection first, then falls back to mirrors.
 */
async function fetchLatestWhisperRelease() {
    const apiUrl = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest';

    for (const mirror of GITHUB_MIRRORS) {
        const url = applyMirror(apiUrl, mirror);
        try {
            const data = await httpGet(url, { timeout: 15000 });
            return JSON.parse(data.toString('utf-8'));
        } catch (err) {
            console.warn(`[WhisperInstaller] Failed to fetch from ${url}: ${err.message}`);
            // Try next mirror
        }
    }

    throw new Error(
        'Unable to connect to GitHub to fetch the latest whisper.cpp release. ' +
        'Please check your network connection or try again later. ' +
        'You can also manually download whisper-cli from https://github.com/ggerganov/whisper.cpp/releases'
    );
}

/**
 * Download a file from URL to a local path with progress reporting.
 * Tries direct connection first, then falls back to mirrors.
 */
async function downloadFileToPath(downloadUrl, destPath, onProgress, mirrorPrefix = '') {
    const url = applyMirror(downloadUrl, mirrorPrefix);

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const mod = urlObj.protocol === 'https:' ? https : http;

        const req = mod.get(url, {
            headers: { 'User-Agent': 'Folia-Whisper-Installer' },
            timeout: 60000,
        }, (res) => {
            // Follow redirects (up to 5)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).toString();
                return downloadFileToPath(redirectUrl, destPath, onProgress, '').then(resolve, reject);
            }

            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }

            const contentLength = parseInt(res.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;

            const fileStream = fs.createWriteStream(destPath);

            res.on('data', (chunk) => {
                fileStream.write(chunk);
                downloadedBytes += chunk.length;

                if (onProgress && contentLength > 0) {
                    onProgress(downloadedBytes / contentLength);
                }
            });

            res.on('end', () => {
                fileStream.end();
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
            });

            res.on('error', (err) => {
                try { fileStream.close(); } catch {}
                reject(err);
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Download timeout for ${url}`));
        });
    });
}

/**
 * Download a file with mirror fallback.
 */
async function downloadWithMirrors(downloadUrl, destPath, onProgress) {
    for (const mirror of GITHUB_MIRRORS) {
        try {
            await downloadFileToPath(downloadUrl, destPath, onProgress, mirror);
            return; // success
        } catch (err) {
            console.warn(`[WhisperInstaller] Download failed from mirror ${mirror || 'direct'}: ${err.message}`);
            // Clean up partial file
            try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
            // Try next mirror
        }
    }

    throw new Error(
        'Unable to download whisper-cli from any source. ' +
        'Please check your network connection or download manually from ' +
        'https://github.com/ggerganov/whisper.cpp/releases'
    );
}

/**
 * Extract a ZIP archive using system tools.
 */
async function extractZip(zipPath, destDir) {
    if (process.platform === 'win32') {
        // Use PowerShell Expand-Archive
        return new Promise((resolve, reject) => {
            const ps = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-Command',
                `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
            ], { stdio: 'pipe' });
            let stderr = '';
            ps.stderr.on('data', (data) => { stderr += data.toString(); });
            ps.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`PowerShell Expand-Archive failed (exit ${code}): ${stderr}`));
            });
            ps.on('error', reject);
        });
    }
    // macOS / Linux: try unzip first, then python3
    return new Promise((resolve, reject) => {
        const proc = spawn('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'pipe' });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`unzip failed with exit code ${code}`));
        });
        proc.on('error', reject);
    });
}

/**
 * Extract a tar.gz archive.
 */
async function extractTarGz(tarPath, destDir) {
    return new Promise((resolve, reject) => {
        const proc = spawn('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'pipe' });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tar failed with exit code ${code}`));
        });
        proc.on('error', reject);
    });
}

/**
 * Recursively find a file by name in a directory tree.
 */
function findFileRecursive(dir, fileName) {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const result = findFileRecursive(fullPath, fileName);
                if (result) return result;
            } else if (entry.name === fileName) {
                return fullPath;
            }
        }
    } catch {}
    return null;
}

/**
 * Auto-install whisper-cli from GitHub releases.
 * Downloads the latest release binary for the current platform and installs it
 * to the app's userData directory.
 *
 * @param {function} [onProgress] - Progress callback: { status, progress, ... }
 * @returns {Promise<{ success: boolean, path: string, version: string }>}
 */
async function installWhisperCli(onProgress) {
    const assetInfo = getPlatformAssetInfo();
    if (!assetInfo) {
        throw new Error(`Auto-install is not supported on ${process.platform}-${process.arch}. Please install whisper-cli manually.`);
    }

    // 1. Fetch latest release info
    if (onProgress) onProgress({ status: 'fetching-release', progress: 0 });

    const release = await fetchLatestWhisperRelease();
    const asset = release.assets.find((a) => assetInfo.pattern.test(a.name));
    if (!asset) {
        throw new Error(
            `No matching binary found for ${process.platform}-${process.arch} in whisper.cpp release ${release.tag_name}. ` +
            `Available assets: ${release.assets.map((a) => a.name).join(', ')}`
        );
    }

    // 2. Prepare directories
    const cliDir = path.join(app.getPath('userData'), WHISPER_CLI_DIR_NAME);
    if (!fs.existsSync(cliDir)) {
        fs.mkdirSync(cliDir, { recursive: true });
    }

    const tmpDir = path.join(os.tmpdir(), `folia-whisper-install-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const archiveExt = assetInfo.type === 'zip' ? '.zip' : '.tar.gz';
    const archivePath = path.join(tmpDir, `whisper-cli${archiveExt}`);

    try {
        // 3. Download the archive
        if (onProgress) onProgress({ status: 'downloading', progress: 5, url: asset.browser_download_url, size: asset.size });

        await downloadWithMirrors(asset.browser_download_url, archivePath, (ratio) => {
            if (onProgress) onProgress({ status: 'downloading', progress: 5 + Math.round(ratio * 65) });
        });

        // 4. Extract
        if (onProgress) onProgress({ status: 'extracting', progress: 70 });

        const extractDir = path.join(tmpDir, 'extracted');
        fs.mkdirSync(extractDir, { recursive: true });

        if (assetInfo.type === 'zip') {
            await extractZip(archivePath, extractDir);
        } else {
            await extractTarGz(archivePath, extractDir);
        }

        // 5. Find the whisper-cli executable
        const cliName = getWhisperCliName();
        let cliSourcePath = findFileRecursive(extractDir, cliName);

        // Fallback: older whisper.cpp versions named the binary 'main'
        if (!cliSourcePath) {
            const mainName = process.platform === 'win32' ? 'main.exe' : 'main';
            cliSourcePath = findFileRecursive(extractDir, mainName);
        }

        if (!cliSourcePath) {
            // List what we found for debugging
            const foundFiles = [];
            try {
                const walkDir = (d, depth = 0) => {
                    if (depth > 3) return;
                    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                        const p = path.join(d, entry.name);
                        if (entry.isDirectory()) walkDir(p, depth + 1);
                        else foundFiles.push(path.relative(extractDir, p));
                    }
                };
                walkDir(extractDir);
            } catch {}
            throw new Error(
                `Could not find ${cliName} in the downloaded archive. ` +
                `Files found: ${foundFiles.slice(0, 20).join(', ')}`
            );
        }

        // 6. Copy to target location
        if (onProgress) onProgress({ status: 'installing', progress: 90 });

        const targetPath = path.join(cliDir, cliName);

        // Remove old files in the cli directory (clean upgrade)
        for (const oldFile of fs.readdirSync(cliDir)) {
            try { fs.unlinkSync(path.join(cliDir, oldFile)); } catch {}
        }

        fs.copyFileSync(cliSourcePath, targetPath);

        // Copy required DLL/SO files alongside the executable
        const sourceDir = path.dirname(cliSourcePath);
        for (const file of fs.readdirSync(sourceDir)) {
            const ext = path.extname(file).toLowerCase();
            if (ext === '.dll' || ext === '.so' || ext === '.dylib') {
                try {
                    fs.copyFileSync(path.join(sourceDir, file), path.join(cliDir, file));
                } catch {}
            }
        }

        // Make executable on non-Windows
        if (process.platform !== 'win32') {
            try { fs.chmodSync(targetPath, 0o755); } catch {}
        }

        // 7. Update the global whisperCliPath
        whisperCliPath = targetPath;

        if (onProgress) onProgress({ status: 'installed', progress: 100, path: targetPath, version: release.tag_name });

        return { success: true, path: targetPath, version: release.tag_name };
    } finally {
        // Clean up temp directory
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
    }
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
    installWhisperCli,
    SUPPORTED_MODELS,
};