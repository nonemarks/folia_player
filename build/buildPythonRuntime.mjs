import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, unzipSync, zip } from 'fflate';

// build/buildPythonRuntime.mjs
// Builds the Python runtime that htdemucs separation runs in, one archive per platform.
//
// WHY there is a Python here at all is at the top of htdemucs_runner.py: `enable_mem_reuse` is
// bound only by onnxruntime's Python API, and turning it off is what takes a separation from
// 2543MB to under 500MB. onnxruntime-node cannot reach the flag, so the model runs in an
// interpreter we ship rather than in the one Electron already has.
//
// This file exists because the first runtime was assembled BY HAND. It worked, and it was
// unreproducible and undocumented and lived in a temp folder, which meant the other three
// platforms could not be built at all and the Windows one could not be rebuilt. A hand-made
// binary artifact that the app downloads is exactly the thing that should have a recipe.
//
//   node build/buildPythonRuntime.mjs                # every platform
//   node build/buildPythonRuntime.mjs win32-x64      # just one
//
// Writes dist-runtime/folia-runtime-<platform>.zip and prints the manifest block to paste into
// shared/modelManifest.json. Cross-building is the point: every platform is assembled from this
// one machine, out of prebuilt CPython distributions and platform-tagged wheels, so no step
// needs the target OS. Nothing is COMPILED here - it is download, unpack, delete, re-archive.

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'dist-runtime');
const CACHE = join(OUT, '.cache');

/**
 * The CPython build. python-build-standalone publishes relocatable interpreters for every
 * platform - the same thing uv installs - which is what makes cross-building possible.
 *
 * `install_only_stripped` rather than `install_only`: same interpreter with debug symbols
 * removed, and on Windows that alone is 48MB against 26MB. Nothing here ever debugs CPython.
 */
const CPYTHON = { release: '20260825', version: '3.11.16' };
const PBS = (triple) => 'https://github.com/astral-sh/python-build-standalone/releases/download'
    + `/${CPYTHON.release}/cpython-${CPYTHON.version}+${CPYTHON.release}-${triple}-install_only_stripped.tar.gz`;

/**
 * Pinned, because this is a binary artifact users download and a floating version would mean two
 * listeners on the same app version running different inference.
 *
 * onnxruntime's floor is not a free choice, and there are TWO floors. The model's iSTFT is a real
 * DFT operator with `inverse` and `onesided` both set: ORT refused to even LOAD that combination, as
 * a shape-inference error, until 1.25 (measured - 1.22 and 1.23 both reject the model). But loading
 * is not running. 1.26 loads it and then MIS-RUNS the iSTFT: its Reshape comes out {1376,1025,2}
 * against a requested {8,172,4096} and the session throws during inference - on the CPU EP exactly as
 * on CUDA, measured here - so 1.26 breaks EVERY separation, not just the GPU ones. The RUN floor is
 * therefore 1.27+, and this recipe pins 1.29.0, whose CPU build runs the model clean (measured: 3s of
 * stereo in, correctly-sized stems out). 1.25 is separately where the macOS x86_64 wheel stops
 * existing, which is what decides the platform table below.
 *
 * The onnxruntime wheel is chosen PER PLATFORM, and Windows alone gets the GPU build:
 *   - win32-x64 -> onnxruntime-gpu==1.29.0 from the Azure onnxruntime-cuda-12 feed, NOT PyPI. Since
 *     1.27, PyPI's onnxruntime-gpu is built against CUDA 13.0; Microsoft publishes the CUDA-12 build
 *     of those same versions on that feed instead. We want the CUDA-12 one: CUDA 12.8 is the first
 *     toolkit that knows Blackwell (sm_120), and by NVIDIA's minor-version compatibility a 12.x build
 *     runs on any CUDA 12.x host - so the 12.9 the RTX 50-series listener already has is covered,
 *     with no CUDA 13 runtime they would otherwise never install. The wheel is fetched in its own pip
 *     call pinned to that index (see `ortIndex`): pip will not deterministically prefer one index over
 *     another for an identical version string, so one mixed call could silently pull the CUDA-13 wheel.
 *     The CUDA/cuDNN runtime DLLs are NOT bundled - the runner resolves them off the system and falls
 *     back to the CPU EP when they are missing, so a box without CUDA still separates, just on the CPU.
 *   - darwin-arm64 / linux-x64 -> onnxruntime==1.29.0. There is no onnxruntime-gpu wheel for macOS
 *     at all (its GPU path is CoreML, which ships in the plain package), and this build's GPU target
 *     is the Windows/CUDA listener; the plain package's CPU EP is what those two have always run.
 *
 * The dependency list is explicit and installed with --no-deps. onnxruntime declares more than it
 * needs to import (protobuf, sympy, coloredlogs); these are what the runner actually touches,
 * and it is the set the hand-built runtime shipped with and ran on.
 */
const ORT_CPU = 'onnxruntime==1.29.0';
const ORT_GPU = 'onnxruntime-gpu==1.29.0';
/** The CUDA-12 build of ORT_GPU. PyPI's onnxruntime-gpu at this version is the CUDA-13 build; the
 *  CUDA-12 one - the one that runs on a listener's existing CUDA 12.x - is only on this Azure feed. */
const ORT_GPU_INDEX = 'https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/';
const COMMON_WHEELS = ['numpy==2.4.6', 'flatbuffers', 'packaging', 'psutil'];
const PY_TAG = '3.11';

/**
 * Keyed by `${process.platform}-${process.arch}`, which is what the app asks for at runtime.
 *
 * darwin-x64 is deliberately ABSENT rather than broken. Every onnxruntime that can load this model
 * is arm64-only on macOS, and every onnxruntime with an Intel Mac wheel refuses the model, so there
 * is no build to make. A missing key is how the settings page knows to say the machine is not
 * supported instead of offering a download that could not work. Same for the arm64 Linux and
 * Windows wheels that exist upstream: electron-builder does not target those, so neither do we.
 */
const TARGETS = {
    'win32-x64': {
        triple: 'x86_64-pc-windows-msvc',
        wheelTag: 'win_amd64',
        exe: 'python.exe',
        sitePackages: ['Lib', 'site-packages'],
        ort: ORT_GPU,
        ortIndex: ORT_GPU_INDEX,
    },
    'darwin-arm64': {
        triple: 'aarch64-apple-darwin',
        wheelTag: 'macosx_14_0_arm64',
        exe: join('bin', 'python3'),
        sitePackages: ['lib', `python${PY_TAG}`, 'site-packages'],
        ort: ORT_CPU,
    },
    'linux-x64': {
        triple: 'x86_64-unknown-linux-gnu',
        wheelTag: 'manylinux_2_28_x86_64',
        exe: join('bin', 'python3'),
        sitePackages: ['lib', `python${PY_TAG}`, 'site-packages'],
        ort: ORT_CPU,
    },
};

/**
 * Deleted from every build. Two thirds of this is tkinter, which a headless inference process will
 * never draw with, and pip/setuptools, which nothing installs anything with after we are done - and
 * which are the only parts of the bundle that could fetch and execute more code.
 */
const DROP_DIRS = new Set([
    '__pycache__', 'test', 'tests', 'idlelib', 'lib2to3', 'ensurepip', 'distutils',
    'tkinter', 'turtledemo', 'pip', 'setuptools', '_distutils_hack',
    'tcl', 'tcl8', 'tcl8.6', 'tk8.6', 'include', 'libs', 'share', 'man', 'Scripts', 'pkgconfig',
]);
/**
 * Matched against the file name. The tk shared libraries are several megabytes and unreachable.
 *
 * `distutils-precedence.pth` is here because a .pth is EXECUTED at interpreter startup: setuptools
 * leaves one behind that imports `_distutils_hack`, which the directory list above removes, and the
 * result was a traceback on stderr before every single run. The sidecar forwards the runner's stderr
 * to the app log, so a harmless one is worse than it sounds - it is the noise a real failure has to
 * be spotted against.
 */
const DROP_FILES = [
    /^_tkinter\./, /^tcl\d/i, /^tk\d/i, /^libtcl/i, /^libtk/i,
    /^pythonw\.exe$/i, /\.pdb$/i, /^BUILD$/,
    /^distutils-precedence\.pth$/,
];

/** Any constant would do; this is the zip timestamp every entry gets. See the note at `zip`. */
const EPOCH = new Date('2020-01-01T00:00:00Z');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)}MB`;

/**
 * The only subprocess this build runs, and it only ever runs pip.
 *
 * Given a `cwd` and relative paths rather than absolute ones, because a Windows path carries a
 * colon and not every tool reads that as a drive letter - the tar this used to shell out to read
 * `C:` as a remote HOST and tried to ssh to it. Unpacking is done in-process now (see readTar),
 * so pip is all that is left, but the habit is worth keeping for the next tool.
 */
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { stdio: 'inherit', cwd });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
};

/** The host's Python, only ever used to run `pip download`. Never the one being packaged. */
const HOST_PYTHON = ['py', 'python3', 'python'].find(candidate => {
    const probe = spawnSync(candidate, ['-c', 'import pip'], { stdio: 'ignore' });
    return !probe.error && probe.status === 0;
});
if (!HOST_PYTHON) throw new Error('no host python with pip on PATH');

/** Cached: a rebuild of three platforms would otherwise pull the same 26MB three times. */
const fetchCached = async (url) => {
    const file = join(CACHE, url.split('/').pop());
    if (existsSync(file)) return file;
    console.log(`  fetching ${url.split('/').pop()}`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    return file;
};

/**
 * Reads a ustar archive into `path -> { body }` / `path -> { link }`.
 *
 * Written out rather than shelled to `tar`, which failed this job twice for reasons that are not
 * bugs: the GNU tar in a unix shell reads `C:\...` as a remote HOST and tries to ssh to it, and on
 * Windows it cannot create the symlinks these archives contain, so it aborts half way through a
 * macOS build. Both are "which tar am I" problems, and there is no tar that is all of them.
 *
 * ustar and nothing else, because that is what these archives are - checked, not assumed: every
 * entry in all three is typeflag 0 or 2, magic `ustar\\0`, no GNU long names and no pax records.
 * A format this does not handle throws rather than silently dropping files.
 */
const readTar = (raw) => {
    const entries = new Map();
    const str = (from, length) => {
        const end = raw.indexOf(0, from);
        return Buffer.from(raw.subarray(from, end === -1 || end > from + length ? from + length : end)).toString();
    };
    for (let at = 0; at + 512 <= raw.length;) {
        const header = raw.subarray(at, at + 512);
        if (header.every(byte => byte === 0)) break;
        if (str(at + 257, 6) !== 'ustar') throw new Error(`unsupported tar format at offset ${at}`);
        const name = str(at, 100);
        const prefix = str(at + 345, 155);
        const size = parseInt(str(at + 124, 12).trim() || '0', 8);
        const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
        const path = prefix ? `${prefix}/${name}` : name;
        if (type === '0') entries.set(path, { body: raw.subarray(at + 512, at + 512 + size) });
        else if (type === '2') entries.set(path, { link: str(at + 157, 100) });
        else if (type !== '5') throw new Error(`unsupported tar entry type ${type} for ${path}`);
        at += 512 + Math.ceil(size / 512) * 512;
    }
    return entries;
};

/** Whether the drop lists say this path is not worth shipping. */
const dropped = (path) => path.split('/').some(part => DROP_DIRS.has(part))
    || DROP_FILES.some(pattern => pattern.test(path.split('/').pop()));

const buildOne = async (platform) => {
    const target = TARGETS[platform];
    if (!target) throw new Error(`unknown platform ${platform}`);
    console.log(`\n=== ${platform} ===`);

    // python-build-standalone archives all unpack to a single `python/` directory, which is the
    // level the runtime folder is rooted at - so that prefix comes off here.
    const tarball = await fetchCached(PBS(target.triple));
    const source = readTar(Buffer.from(gunzipSync(await readFile(tarball))));
    const entries = {};
    for (const [path, entry] of source) {
        if (!path.startsWith('python/') || !entry.body) continue;
        const rel = path.slice('python/'.length);
        if (!dropped(rel)) entries[rel] = entry.body;
    }

    // ONE symlink is resolved into a real file: the interpreter the app spawns. A zip carries
    // symlinks only by convention, fflate does not restore them, and Windows cannot create them
    // without a privilege the build machine may not have, so leaving them would mean the unix
    // bundles had no `bin/python3` at all.
    //
    // Only one, because resolving them all is how this first went wrong: `bin/python`,
    // `bin/python3` and `lib/libpython3.11.so` are each a link to a file that is already in the
    // archive, and copying every one of them added 62MB of byte-identical duplicates to the Linux
    // bundle. Everything else in bin/ goes with them - 2to3, idle3, pydoc3, python3-config are
    // developer tools, and the app spawns an absolute path, never a name off PATH.
    const exe = target.exe.split(sep).join('/');
    const link = source.get(`python/${exe}`)?.link;
    if (link) entries[exe] = entries[`${exe.split('/').slice(0, -1).join('/')}/${link}`];
    for (const path of Object.keys(entries)) {
        if (path.startsWith('bin/') && path !== exe) delete entries[path];
    }

    // --no-deps with an explicit list: see ORT_CPU/ORT_GPU/COMMON_WHEELS. Downloaded rather than
    // installed, because the interpreter these wheels are FOR cannot run on the machine fetching
    // them - so pip is never asked to resolve or build anything, only to pick the right prebuilt
    // file for a platform tag. The onnxruntime spec is this target's own (GPU on Windows, CPU else).
    console.log('  fetching wheels');
    const wheelDir = join(CACHE, `wheels-${platform}`);
    await rm(wheelDir, { recursive: true, force: true });
    await mkdir(wheelDir, { recursive: true });
    const pipDownload = ['-m', 'pip', 'download', '--quiet', '--no-deps', '--only-binary=:all:',
        '--platform', target.wheelTag, '--python-version', PY_TAG, '-d', `wheels-${platform}`];
    if (target.ortIndex) {
        // The ORT wheel comes from its own index ONLY (see ORT_GPU_INDEX): the same version string on
        // PyPI is a different CUDA build, and pip does not deterministically prefer one index over
        // another for an equal version, so the two are fetched apart to keep the CUDA-12 wheel the one
        // we get. The rest are CPU-only and index-agnostic, so they come from the default PyPI.
        run(HOST_PYTHON, [...pipDownload, '--index-url', target.ortIndex, target.ort], CACHE);
        run(HOST_PYTHON, [...pipDownload, ...COMMON_WHEELS], CACHE);
    } else {
        run(HOST_PYTHON, [...pipDownload, target.ort, ...COMMON_WHEELS], CACHE);
    }
    const site = target.sitePackages.join('/');
    for (const wheel of await readdir(wheelDir)) {
        for (const [name, body] of Object.entries(unzipSync(await readFile(join(wheelDir, wheel))))) {
            if (name.endsWith('/') || dropped(name)) continue;
            entries[`${site}/${name}`] = body;
        }
    }
    await rm(wheelDir, { recursive: true, force: true });

    // The one check that matters: a bundle without an interpreter installs cleanly and then fails
    // at the first separation, which is the shape of failure this whole subsystem is built to avoid.
    if (!entries[exe]) throw new Error(`${platform}: ${exe} missing after build`);
    const raw = Object.values(entries).reduce((sum, body) => sum + body.length, 0);

    // A fixed mtime, so the same inputs produce the same bytes. Without one fflate stamps the
    // current time into every entry and two builds of identical content hash differently - which
    // would make the manifest's sha256 something only this machine at this minute could produce.
    // With it, anyone can re-run this file and check the published archive against their own.
    await mkdir(OUT, { recursive: true });
    const archive = join(OUT, `folia-runtime-${platform}.zip`);
    const packed = await new Promise((resolve, reject) => {
        zip(entries, { level: 9, mtime: EPOCH }, (error, data) => (error ? reject(error) : resolve(data)));
    });
    await writeFile(archive, packed);

    console.log(`  ${Object.keys(entries).length} files, ${mb(raw)} unpacked -> ${mb(packed.length)} zipped`);
    return { platform, file: `folia-runtime-${platform}.zip`, bytes: packed.length, sha256: sha256(packed) };
};

const wanted = process.argv.slice(2);
const platforms = wanted.length ? wanted : Object.keys(TARGETS);
await mkdir(CACHE, { recursive: true });

const built = [];
for (const platform of platforms) built.push(await buildOne(platform));

console.log('\n=== paste into shared/modelManifest.json under runtime.platforms ===');
console.log(JSON.stringify(Object.fromEntries(built.map(
    ({ platform, file, bytes, sha256: digest }) => [platform, { file, bytes, sha256: digest }],
)), null, 2));
