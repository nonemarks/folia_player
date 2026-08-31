// electron/whisperAlign.cjs
// Whisper-based word-level lyric alignment for Folia.
// Runs in Electron main process, communicates with renderer via IPC.

const { spawn, spawnSync } = require('child_process');
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
const FFMPEG_DIR_NAME = 'ffmpeg';

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
let ffmpegPath = null;
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

    // Try to find ffmpeg in common locations (synchronous check for app-installed)
    ffmpegPath = findFfmpegInstalled();

    // Asynchronously check system PATH for ffmpeg (updates ffmpegPath if found)
    if (!ffmpegPath) {
        findFfmpeg().then((found) => {
            if (found) {
                ffmpegPath = found;
                console.log(`[WhisperAlign] Found ffmpeg in system PATH: ${found}`);
            }
        }).catch(() => {
            // Ignore errors - ffmpeg is optional
        });
    }
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

    // Log audio file info for diagnostics
    try {
        const stats = fs.statSync(audioPath);
        const ext = path.extname(audioPath).toLowerCase();
        console.log(`[WhisperAlign] Audio file: ${audioPath} (${ext}, ${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        
        // Warn about suspicious file sizes
        if (stats.size === 0) {
            throw new Error(`Audio file is empty (0 bytes): ${audioPath}. The audio data may not have been downloaded correctly.`);
        }
        if (stats.size < 1024) {
            console.warn(`[WhisperAlign] Audio file is very small (${stats.size} bytes), may be corrupted or empty`);
        }
    } catch (e) {
        if (e.message.includes('empty') || e.message.includes('0 bytes')) throw e;
        console.warn(`[WhisperAlign] Could not stat audio file: ${e.message}`);
    }

    // Convert audio to WAV format for maximum compatibility with whisper-cli.
    // whisper-cli works best with WAV (16kHz, 16-bit, mono). While some builds
    // support MP3/FLAC via dr_mp3/dr_flac, conversion ensures reliability.
    let effectiveAudioPath = audioPath;
    let convertedWavPath = null;
    const audioExt = path.extname(audioPath).toLowerCase();

    if (audioExt !== '.wav') {
        if (onProgress) onProgress({ status: 'starting', model, audioPath, detail: 'converting-audio' });

        const wavResult = await convertToWav(audioPath, jobId);
        if (wavResult) {
            effectiveAudioPath = wavResult;
            convertedWavPath = wavResult;
            console.log(`[WhisperAlign] Converted audio to WAV: ${wavResult}`);
        } else {
            // ffmpeg not available — try original file; whisper-cli may still support it
            console.warn(`[WhisperAlign] ffmpeg not available, using original audio format (${audioExt}). ` +
                `If transcription fails, install ffmpeg for audio conversion.`);
        }
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
        '-f', effectiveAudioPath,
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

            // Clean up converted WAV file if we created one
            if (convertedWavPath) {
                try { fs.unlinkSync(convertedWavPath); } catch {}
            }

            const job = activeJobs.get(jobId);
            if (job?.cancelled) {
                // Clean up temp file
                try { fs.unlinkSync(outputFile); } catch {}
                reject(new Error('Transcription cancelled'));
                return;
            }

            if (code !== 0) {
                console.error(`[WhisperAlign] Process exited with code ${code}. stderr: ${stderr}`);
                // Provide more helpful error messages for common failures
                let errorMsg = `Whisper transcription failed (exit code ${code})`;
                if (stderr.includes('failed to open') || stderr.includes('cannot open') || stderr.includes('No such file')) {
                    errorMsg += ': Audio file could not be read. Try installing ffmpeg for audio format conversion.';
                } else if (stderr.includes('unsupported format') || stderr.includes('unknown format')) {
                    errorMsg += ': Unsupported audio format. Install ffmpeg for automatic WAV conversion.';
                } else if (stderr.length > 0) {
                    errorMsg += `: ${stderr.slice(-300)}`;
                }
                reject(new Error(errorMsg));
                return;
            }

            // Parse JSON output
            try {
                if (!fs.existsSync(outputFile)) {
                    console.error(`[WhisperAlign] Output file not found: ${outputFile}`);
                    // Check if output file was created with a different extension
                    const dir = path.dirname(outputBase);
                    const base = path.basename(outputBase);
                    try {
                        const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
                        console.error(`[WhisperAlign] Files found matching output base: [${files.join(', ')}]`);
                    } catch {}
                    reject(new Error(`Whisper output file not found at ${outputFile}. stderr: ${stderr.slice(-200)}`));
                    return;
                }

                const rawContent = fs.readFileSync(outputFile, 'utf-8');
                console.log(`[WhisperAlign] Output file size: ${rawContent.length} bytes`);
                
                let rawResult;
                try {
                    rawResult = JSON.parse(rawContent);
                } catch (parseErr) {
                    console.error(`[WhisperAlign] JSON parse error: ${parseErr.message}`);
                    console.error(`[WhisperAlign] First 500 chars of output: ${rawContent.slice(0, 500)}`);
                    reject(new Error(`Failed to parse Whisper JSON output: ${parseErr.message}`));
                    return;
                }

                // Log the structure for diagnostics
                const topLevelKeys = rawResult && typeof rawResult === 'object' ? Object.keys(rawResult) : ['not-an-object'];
                console.log(`[WhisperAlign] Output JSON top-level keys: [${topLevelKeys.join(', ')}]`);
                if (rawResult?.result && typeof rawResult.result === 'object') {
                    console.log(`[WhisperAlign] result keys: [${Object.keys(rawResult.result).join(', ')}]`);
                }
                if (Array.isArray(rawResult?.transcription)) {
                    console.log(`[WhisperAlign] raw.transcription length: ${rawResult.transcription.length}`);
                }

                // Clean up temp file
                try { fs.unlinkSync(outputFile); } catch {}

                // Convert whisper.cpp JSON to our WhisperResult format
                const whisperResult = parseWhisperCppOutput(rawResult);

                console.log(`[WhisperAlign] Transcription complete: ${whisperResult.segments.length} segments, ` +
                    `${whisperResult.segments.filter(s => s.words && s.words.length > 0).length} segments with word timing`);

                // If no segments were produced, throw with diagnostic info
                if (whisperResult.segments.length === 0) {
                    const diag = whisperResult.diagnostic || 'Unknown reason';
                    const errorMsg = `Whisper transcription produced no valid segments. ${diag}`;
                    console.error(`[WhisperAlign] ${errorMsg}`);
                    reject(new Error(errorMsg));
                    return;
                }

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
 * Supports multiple whisper.cpp output format versions.
 */
function parseWhisperCppOutput(raw) {
    const segments = [];

    // whisper.cpp --output-json --word-timestamps 1 format (varies by version):
    // v1: { "systeminfo": {...}, "transcription": [ { "timestamps": {...}, "offsets": {...}, "text": "...", "tokens": [...] } ] }
    // v2: { "systeminfo": {...}, "result": { "transcription": [...] } }
    // Some builds: top-level array or nested under different keys

    // Resolve the transcription array from various possible JSON structures
    let transcription = null;

    if (Array.isArray(raw)) {
        // Rare: top-level array
        transcription = raw;
    } else if (raw && typeof raw === 'object') {
        // Standard v1 format: raw.transcription
        if (Array.isArray(raw.transcription)) {
            transcription = raw.transcription;
        }
        // v2 format: raw.result.transcription
        else if (raw.result && Array.isArray(raw.result.transcription)) {
            transcription = raw.result.transcription;
        }
        // Fallback: look for any key containing an array of objects with 'text' property
        if (!transcription) {
            for (const key of Object.keys(raw)) {
                if (Array.isArray(raw[key]) && raw[key].length > 0 && raw[key][0] && typeof raw[key][0].text === 'string') {
                    transcription = raw[key];
                    console.log(`[WhisperAlign] Found transcription array under key "${key}" (fallback discovery)`);
                    break;
                }
            }
        }
    }

    if (!transcription || !Array.isArray(transcription)) {
        // Diagnostic: log the actual structure to help debug format mismatches
        const topLevelKeys = raw && typeof raw === 'object' ? Object.keys(raw) : ['not-an-object'];
        const nestedKeys = raw?.result && typeof raw.result === 'object' ? Object.keys(raw.result) : [];
        const rawPreview = JSON.stringify(raw).slice(0, 1000);
        const diagnostic = `Could not find transcription array. Top-level keys: [${topLevelKeys.join(', ')}], ` +
            `result keys: [${nestedKeys.join(', ')}], Type: ${typeof raw}. ` +
            `Raw preview: ${rawPreview}`;
        console.error(`[WhisperAlign] ${diagnostic}`);
        return { segments: [], diagnostic };
    }

    // Check for empty transcription array
    if (transcription.length === 0) {
        const diagnostic = `Transcription array is empty (0 segments). The whisper model may not have detected any speech.`;
        console.warn(`[WhisperAlign] ${diagnostic}`);
        return { segments: [], diagnostic };
    }

    console.log(`[WhisperAlign] Found ${transcription.length} transcription segments`);

    for (let i = 0; i < transcription.length; i++) {
        const seg = transcription[i];

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

        // Diagnostic: warn about zero-timing segments
        if (segStart === 0 && segEnd === 0 && i < 3) {
            console.warn(`[WhisperAlign] Segment ${i} has zero timing (no offsets/timestamps). ` +
                `Segment keys: [${Object.keys(seg).join(', ')}], ` +
                `Has offsets: ${!!seg.offsets}, Has timestamps: ${!!seg.timestamps}`);
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

    // Summary diagnostic
    const segmentsWithTiming = segments.filter(s => s.start > 0 || s.end > 0).length;
    const segmentsWithWords = segments.filter(s => s.words && s.words.length > 0).length;
    console.log(`[WhisperAlign] Parsed ${segments.length} segments: ` +
        `${segmentsWithTiming} with timing, ${segmentsWithWords} with word-level timestamps`);

    if (segmentsWithTiming === 0 && segments.length > 0) {
        const firstSegSample = JSON.stringify(transcription[0]).slice(0, 500);
        console.error(`[WhisperAlign] WARNING: All segments have zero timing! ` +
            `This usually means the whisper.cpp output format has changed. ` +
            `First segment sample: ${firstSegSample}`);
        return {
            segments,
            diagnostic: `All ${segments.length} segments have zero timing (no offsets/timestamps). ` +
                `First segment sample: ${firstSegSample}`,
        };
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
    // Check app-installed ffmpeg (synchronous, fast)
    const appFfmpeg = findFfmpegInstalled();
    const ffmpegAvail = !!(ffmpegPath && fs.existsSync(ffmpegPath)) || !!appFfmpeg;

    // Also synchronously check if ffmpeg is in PATH by looking for the executable
    // This is a best-effort check - the async findFfmpeg() does a more thorough check
    let systemFfmpegFound = false;
    if (!ffmpegAvail) {
        try {
            const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
            // Quick synchronous check - just see if the command exists
            const result = spawnSync(ffmpegName, ['-version'], {
                timeout: 3000,
                stdio: 'ignore',
                shell: true,
            });
            systemFfmpegFound = result.status === 0;
            if (systemFfmpegFound) {
                ffmpegPath = ffmpegName; // Update global for later use
            }
        } catch {
            // Ignore - ffmpeg not in PATH
        }
    }

    return {
        available: isWhisperAvailable(),
        modelsDirectory,
        models: getAvailableModels(),
        activeJobs: Array.from(activeJobs.keys()),
        ffmpegAvailable: ffmpegAvail || systemFfmpegFound,
    };
}

// ---------------------------------------------------------------------------
// Fetch audio from URL in main process (bypasses CORS restrictions)
// ---------------------------------------------------------------------------

/**
 * Fetch audio data from a URL in the main process.
 * This bypasses CORS restrictions that would block fetch() in the renderer.
 * @param {string} url - The audio URL to fetch
 * @returns {Promise<{data: Buffer, mimeType: string} | null>} Audio data and MIME type, or null on failure
 */
async function fetchAudioBuffer(url) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(url);
            const mod = urlObj.protocol === 'https:' ? https : http;

            const req = mod.get(url, {
                headers: {
                    'User-Agent': 'Folia-Whisper-Align',
                    'Accept': 'audio/*,*/*',
                },
                timeout: 30000,
            }, (res) => {
                // Follow redirects (up to 5)
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = new URL(res.headers.location, url).toString();
                    console.log(`[WhisperAlign] Audio fetch redirect to: ${redirectUrl}`);
                    return fetchAudioBuffer(redirectUrl).then(resolve);
                }

                if (res.statusCode !== 200) {
                    console.warn(`[WhisperAlign] Audio fetch failed: HTTP ${res.statusCode} for ${url}`);
                    res.resume();
                    resolve(null);
                    return;
                }

                const mimeType = res.headers['content-type'] || 'audio/mpeg';
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    if (buffer.length > 0) {
                        console.log(`[WhisperAlign] Fetched audio: ${buffer.length} bytes, type: ${mimeType}`);
                        resolve({ data: buffer, mimeType });
                    } else {
                        console.warn('[WhisperAlign] Fetched audio but got 0 bytes');
                        resolve(null);
                    }
                });
                res.on('error', (err) => {
                    console.warn(`[WhisperAlign] Audio fetch stream error: ${err.message}`);
                    resolve(null);
                });
            });

            req.on('error', (err) => {
                console.warn(`[WhisperAlign] Audio fetch request error: ${err.message}`);
                resolve(null);
            });

            req.on('timeout', () => {
                console.warn('[WhisperAlign] Audio fetch timeout');
                req.destroy();
                resolve(null);
            });
        } catch (err) {
            console.warn(`[WhisperAlign] Audio fetch error: ${err.message}`);
            resolve(null);
        }
    });
}

// ---------------------------------------------------------------------------
// Audio conversion (ffmpeg → WAV for whisper-cli compatibility)
// ---------------------------------------------------------------------------

/**
 * Find ffmpeg installed by the app (in userData directory).
 * @returns {string|null} Path to ffmpeg if found in app directory, null otherwise
 */
function findFfmpegInstalled() {
    const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const installedPath = path.join(app.getPath('userData'), FFMPEG_DIR_NAME, ffmpegName);
    if (fs.existsSync(installedPath)) return installedPath;
    return null;
}

/**
 * Check if ffmpeg is available on the system.
 * Checks: installed by app, then PATH.
 * @returns {Promise<string|null>} Path to ffmpeg if found, null otherwise
 */
async function findFfmpeg() {
    // 1. Check app-installed ffmpeg first (fast, synchronous)
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
        return ffmpegPath;
    }

    // Re-check in case it was installed after init
    const installed = findFfmpegInstalled();
    if (installed) {
        ffmpegPath = installed;
        return installed;
    }

    // 2. Check system PATH
    return new Promise((resolve) => {
        const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        const proc = spawn(ffmpegName, ['-version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });
        proc.on('close', (code) => {
            const found = code === 0 ? ffmpegName : null;
            if (found) ffmpegPath = found; // Update global for later use
            resolve(found);
        });
        proc.on('error', () => {
            resolve(null);
        });
        // Timeout after 3 seconds
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve(null);
        }, 3000);
    });
}

/**
 * Convert an audio file to WAV format (16kHz, 16-bit, mono) using ffmpeg.
 * This ensures maximum compatibility with whisper-cli, which works best with WAV.
 * If ffmpeg is not available, returns null (caller should try original file).
 *
 * @param {string} inputPath - Path to the input audio file
 * @param {string} jobId - Job ID for temp file naming
 * @returns {Promise<string|null>} Path to the converted WAV file, or null if ffmpeg unavailable
 */
async function convertToWav(inputPath, jobId) {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) {
        console.log('[WhisperAlign] ffmpeg not found, skipping WAV conversion');
        return null;
    }

    const tmpDir = os.tmpdir();
    const outputPath = path.join(tmpDir, `folia-whisper-converted-${jobId}.wav`);

    return new Promise((resolve) => {
        const proc = spawn(ffmpeg, [
            '-i', inputPath,
            '-ar', '16000',     // 16kHz sample rate (whisper optimal)
            '-ac', '1',         // Mono
            '-sample_fmt', 's16', // 16-bit
            '-y',               // Overwrite output
            outputPath,
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });

        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 0) {
                    console.log(`[WhisperAlign] ffmpeg conversion successful: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                    resolve(outputPath);
                } else {
                    console.warn('[WhisperAlign] ffmpeg produced empty WAV file');
                    try { fs.unlinkSync(outputPath); } catch {}
                    resolve(null);
                }
            } else {
                console.warn(`[WhisperAlign] ffmpeg conversion failed (exit ${code}): ${stderr.slice(-300)}`);
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
                resolve(null);
            }
        });

        proc.on('error', (err) => {
            console.warn(`[WhisperAlign] ffmpeg spawn error: ${err.message}`);
            resolve(null);
        });

        // Timeout after 60 seconds for large files
        setTimeout(() => {
            try { proc.kill(); } catch {}
            console.warn('[WhisperAlign] ffmpeg conversion timed out after 60s');
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
            resolve(null);
        }, 60000);
    });
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

    // Log the prepared audio file for diagnostics
    try {
        const stats = fs.statSync(audioPath);
        console.log(`[WhisperAlign] Prepared audio file: ${audioPath} (${ext}, ${(stats.size / 1024).toFixed(1)} KB)`);
        if (stats.size === 0) {
            console.error(`[WhisperAlign] WARNING: Prepared audio file is empty!`);
        }
    } catch {}

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
    'https://js.jiangss.shop',
    'https://ghfast.top',
    'https://gh-proxy.com',
    'https://ghproxy.net',
];

// FFmpeg download mirrors (tried in order)
// gyan.dev and johnvansickle.com may be inaccessible in some regions;
// BtbN/FFmpeg-Builds on GitHub provides equivalent static builds.
const FFMPEG_MIRRORS = [
    '',  // direct (no mirror)
    'https://js.jiangss.shop',
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

// ---------------------------------------------------------------------------
// Segmented (parallel range) download for large files
// ---------------------------------------------------------------------------

const SEGMENTED_DOWNLOAD_THRESHOLD = 10 * 1024 * 1024; // 10MB - use segmented for files larger than this
const SEGMENTED_DOWNLOAD_CHUNKS = 4; // Number of parallel segments
const SEGMENTED_CHUNK_TIMEOUT = 120000; // 2 minutes per segment

/**
 * Check if the server supports Range requests and get the content length.
 * @returns {Promise<{ acceptRanges: boolean, contentLength: number } | null>}
 */
async function probeRangeSupport(url) {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const mod = urlObj.protocol === 'https:' ? https : http;

        const req = mod.request(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Folia-Installer' },
            timeout: 15000,
        }, (res) => {
            // Follow redirects (up to 3)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).toString();
                return probeRangeSupport(redirectUrl).then(resolve, () => resolve(null));
            }

            if (res.statusCode !== 200) {
                resolve(null);
                return;
            }

            const acceptRanges = (res.headers['accept-ranges'] || '').toLowerCase() === 'bytes';
            const contentLength = parseInt(res.headers['content-length'] || '0', 10);

            resolve({ acceptRanges, contentLength });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

/**
 * Download a single segment (byte range) of a file.
 * @param {string} url - The URL to download from
 * @param {number} start - Start byte offset
 * @param {number} end - End byte offset (inclusive)
 * @param {number} segmentIndex - Segment index for logging
 * @param {Buffer} buffer - Shared buffer to write segment into (at correct offset)
 * @param {function} onSegmentProgress - Called with (segmentIndex, bytesDownloaded, segmentSize)
 */
async function downloadSegment(url, start, end, segmentIndex, buffer, bufferOffset, onSegmentProgress) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const mod = urlObj.protocol === 'https:' ? https : http;

        const req = mod.get(url, {
            headers: {
                'User-Agent': 'Folia-Installer',
                'Range': `bytes=${start}-${end}`,
            },
            timeout: SEGMENTED_CHUNK_TIMEOUT,
        }, (res) => {
            // Follow redirects (up to 3)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).toString();
                return downloadSegment(redirectUrl, start, end, segmentIndex, buffer, bufferOffset, onSegmentProgress)
                    .then(resolve, reject);
            }

            // 206 = Partial Content, 200 = OK (server ignored range, return full)
            if (res.statusCode !== 206 && res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for segment ${segmentIndex}`));
                return;
            }

            let downloadedBytes = 0;
            const segmentSize = end - start + 1;

            res.on('data', (chunk) => {
                chunk.copy(buffer, bufferOffset + downloadedBytes);
                downloadedBytes += chunk.length;
                if (onSegmentProgress) {
                    onSegmentProgress(segmentIndex, downloadedBytes, segmentSize);
                }
            });

            res.on('end', () => {
                if (downloadedBytes < segmentSize * 0.9) {
                    // Segment downloaded significantly less than expected
                    reject(new Error(`Segment ${segmentIndex} incomplete: ${downloadedBytes}/${segmentSize} bytes`));
                } else {
                    resolve(downloadedBytes);
                }
            });

            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Segment ${segmentIndex} download timeout`));
        });
    });
}

/**
 * Attempt segmented (parallel range) download for large files.
 * Returns true if segmented download was used and succeeded.
 * Returns false if segmented download is not applicable (file too small or server doesn't support Range).
 * Throws on download failure.
 *
 * @param {string} downloadUrl - Original download URL
 * @param {string} destPath - Destination file path
 * @param {function} onProgress - Progress callback (0-1 ratio)
 * @param {string} mirrorPrefix - Mirror prefix to apply
 * @returns {Promise<boolean>} true if segmented download was used
 */
async function downloadFileSegmented(downloadUrl, destPath, onProgress, mirrorPrefix = '') {
    const url = applyMirror(downloadUrl, mirrorPrefix);

    // Step 1: Probe the server for Range support and content length
    const probe = await probeRangeSupport(url);
    if (!probe || !probe.acceptRanges || probe.contentLength < SEGMENTED_DOWNLOAD_THRESHOLD) {
        // Server doesn't support Range or file is too small - skip segmented download
        return false;
    }

    const totalSize = probe.contentLength;
    console.log(`[Installer] Using segmented download for ${totalSize} bytes file (4 segments)`);

    // Step 2: Calculate segment ranges
    const segmentSize = Math.ceil(totalSize / SEGMENTED_DOWNLOAD_CHUNKS);
    const segments = [];
    for (let i = 0; i < SEGMENTED_DOWNLOAD_CHUNKS; i++) {
        const start = i * segmentSize;
        const end = Math.min(start + segmentSize - 1, totalSize - 1);
        if (start >= totalSize) break;
        segments.push({ index: i, start, end, size: end - start + 1 });
    }

    // Step 3: Allocate buffer and download segments in parallel
    const buffer = Buffer.alloc(totalSize);
    const segmentProgress = new Array(segments.length).fill(0);

    const onSegmentProgress = (segmentIndex, bytesDownloaded, _segmentSize) => {
        segmentProgress[segmentIndex] = bytesDownloaded;
        const totalDownloaded = segmentProgress.reduce((a, b) => a + b, 0);
        if (onProgress) {
            onProgress(totalDownloaded / totalSize);
        }
    };

    // Download all segments in parallel
    const results = await Promise.all(
        segments.map(seg =>
            downloadSegment(url, seg.start, seg.end, seg.index, buffer, seg.start, onSegmentProgress)
                .catch(err => {
                    console.warn(`[Installer] Segment ${seg.index} failed: ${err.message}`);
                    return null;
                })
        )
    );

    // Check if all segments succeeded
    const failedSegments = results.filter(r => r === null);
    if (failedSegments.length > 0) {
        // Some segments failed - fall back to regular download
        console.warn(`[Installer] ${failedSegments.length}/${segments.length} segments failed, falling back to regular download`);
        return false;
    }

    // Step 4: Write the combined buffer to file
    fs.writeFileSync(destPath, buffer);

    if (onProgress) onProgress(1);
    console.log(`[Installer] Segmented download complete: ${destPath} (${totalSize} bytes)`);
    return true;
}

/**
 * Download a file with mirror fallback.
 * For large files (>10MB), uses segmented downloading when the server supports Range requests.
 */
async function downloadWithMirrors(downloadUrl, destPath, onProgress) {
    for (const mirror of GITHUB_MIRRORS) {
        try {
            // Try segmented download first for large files
            const segmented = await downloadFileSegmented(downloadUrl, destPath, onProgress, mirror);
            if (segmented) return; // segmented download succeeded
            // Fallback to regular download if segmented not supported
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
// FFmpeg auto-install
// ---------------------------------------------------------------------------

/**
 * Get the platform-specific FFmpeg download info.
 * Uses BtbN/FFmpeg-Builds on GitHub for all platforms (supports mirror acceleration).
 * Falls back to gyan.dev / johnvansickle.com as secondary sources.
 * @returns {{ sources: Array<{ url: string, type: 'zip'|'tar.gz', github: boolean }>, type: 'zip'|'tar.gz' } | null}
 */
function getFfmpegPlatformInfo() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32' && arch === 'x64') {
        return {
            type: 'zip',
            sources: [
                // BtbN/FFmpeg-Builds on GitHub (supports mirror acceleration)
                {
                    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
                    type: 'zip',
                    github: true,
                },
                // gyan.dev as fallback
                {
                    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
                    type: 'zip',
                    github: false,
                },
            ],
        };
    }
    if (platform === 'win32' && arch === 'arm64') {
        // No pre-built ARM64 Windows binary available
        return null;
    }
    if (platform === 'linux' && arch === 'x64') {
        return {
            type: 'tar.gz',
            sources: [
                // BtbN/FFmpeg-Builds on GitHub (supports mirror acceleration)
                {
                    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
                    type: 'tar.gz',
                    github: true,
                },
                // John Van Sickle as fallback
                {
                    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
                    type: 'tar.gz',
                    github: false,
                },
            ],
        };
    }
    if (platform === 'linux' && arch === 'arm64') {
        return {
            type: 'tar.gz',
            sources: [
                // BtbN/FFmpeg-Builds on GitHub (supports mirror acceleration)
                {
                    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz',
                    type: 'tar.gz',
                    github: true,
                },
                // John Van Sickle as fallback
                {
                    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
                    type: 'tar.gz',
                    github: false,
                },
            ],
        };
    }
    // macOS: user should install via Homebrew
    return null;
}

/**
 * Auto-install FFmpeg for the current platform.
 * Downloads a static build and installs it to the app's userData directory.
 * Tries BtbN/FFmpeg-Builds (GitHub, mirror-acceleratable) first,
 * then falls back to gyan.dev / johnvansickle.com.
 *
 * @param {function} [onProgress] - Progress callback: { status, progress, ... }
 * @returns {Promise<{ success: boolean, path: string }>}
 */
async function installFfmpeg(onProgress) {
    const platformInfo = getFfmpegPlatformInfo();
    if (!platformInfo) {
        throw new Error(`Auto-install of FFmpeg is not supported on ${process.platform}-${process.arch}. Please install FFmpeg manually.`);
    }

    // 1. Prepare directories
    if (onProgress) onProgress({ status: 'preparing', progress: 0 });

    const ffmpegDir = path.join(app.getPath('userData'), FFMPEG_DIR_NAME);
    if (!fs.existsSync(ffmpegDir)) {
        fs.mkdirSync(ffmpegDir, { recursive: true });
    }

    const tmpDir = path.join(os.tmpdir(), `folia-ffmpeg-install-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    let lastError = null;

    // 2. Try each download source in order
    for (const source of platformInfo.sources) {
        const archiveExt = source.type === 'zip' ? '.zip' : '.tar.gz';
        const archivePath = path.join(tmpDir, `ffmpeg${archiveExt}`);

        try {
            if (onProgress) onProgress({ status: 'downloading', progress: 5, url: source.url });

            // Use GitHub mirrors for GitHub URLs, otherwise try direct + FFMPEG_MIRRORS
            const mirrors = source.github ? GITHUB_MIRRORS : FFMPEG_MIRRORS;

            for (const mirror of mirrors) {
                try {
                    // Try segmented download first for large files
                    const segmented = await downloadFileSegmented(source.url, archivePath, (ratio) => {
                        if (onProgress) onProgress({ status: 'downloading', progress: 5 + Math.round(ratio * 55) });
                    }, mirror);
                    if (segmented) break; // segmented download succeeded

                    // Fallback to regular download if segmented not supported
                    await downloadFileToPath(source.url, archivePath, (ratio) => {
                        if (onProgress) onProgress({ status: 'downloading', progress: 5 + Math.round(ratio * 55) });
                    }, mirror);
                    break; // download succeeded
                } catch (err) {
                    console.warn(`[FfmpegInstaller] Download failed from ${mirror || 'direct'} (${source.url}): ${err.message}`);
                    try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
                    // If this was the last mirror, the outer catch will handle it
                }
            }

            // Verify the file was downloaded
            if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size === 0) {
                throw new Error(`Download produced empty or missing file for ${source.url}`);
            }

            // 3. Extract
            if (onProgress) onProgress({ status: 'extracting', progress: 60 });

            const extractDir = path.join(tmpDir, 'extracted');
            fs.mkdirSync(extractDir, { recursive: true });

            if (source.type === 'zip') {
                await extractZip(archivePath, extractDir);
            } else {
                await extractTarGz(archivePath, extractDir);
            }

            // 4. Find the ffmpeg executable
            const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
            let ffmpegSourcePath = findFileRecursive(extractDir, ffmpegName);

            if (!ffmpegSourcePath) {
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
                    `Could not find ${ffmpegName} in the downloaded archive. ` +
                    `Files found: ${foundFiles.slice(0, 20).join(', ')}`
                );
            }

            // 5. Copy to target location
            if (onProgress) onProgress({ status: 'installing', progress: 90 });

            const targetPath = path.join(ffmpegDir, ffmpegName);

            // Remove old files in the ffmpeg directory (clean upgrade)
            for (const oldFile of fs.readdirSync(ffmpegDir)) {
                try { fs.unlinkSync(path.join(ffmpegDir, oldFile)); } catch {}
            }

            fs.copyFileSync(ffmpegSourcePath, targetPath);

            // Copy required DLL/SO files alongside the executable
            const sourceDir = path.dirname(ffmpegSourcePath);
            for (const file of fs.readdirSync(sourceDir)) {
                const ext = path.extname(file).toLowerCase();
                if (ext === '.dll' || ext === '.so' || ext === '.dylib') {
                    try {
                        fs.copyFileSync(path.join(sourceDir, file), path.join(ffmpegDir, file));
                    } catch {}
                }
            }

            // Make executable on non-Windows
            if (process.platform !== 'win32') {
                try { fs.chmodSync(targetPath, 0o755); } catch {}
            }

            // 6. Update the global ffmpegPath
            ffmpegPath = targetPath;

            if (onProgress) onProgress({ status: 'installed', progress: 100, path: targetPath });

            // Clean up temp directory
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {}

            return { success: true, path: targetPath };

        } catch (err) {
            lastError = err;
            console.warn(`[FfmpegInstaller] Source ${source.url} failed: ${err.message}`);
            // Clean up and try next source
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {}
            // Recreate tmpDir for next source
            fs.mkdirSync(tmpDir, { recursive: true });
        }
    }

    // All sources failed
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}

    throw new Error(
        `Failed to download FFmpeg from all sources. Last error: ${lastError?.message || 'unknown'}. ` +
        `Please install FFmpeg manually from https://ffmpeg.org/download.html`
    );
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
    installFfmpeg,
    fetchAudioBuffer,
    SUPPORTED_MODELS,
};