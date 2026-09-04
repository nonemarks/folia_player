---
kind: dependency_management
name: 多子工程 npm + Cargo 依赖管理（锁定文件、远程 tarball、overrides 与 Docker 隔离）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - .npmrc
    - sync-server/package.json
    - deploy/docker/backend/package.json
    - deploy/docker/netease-api/package.json
    - deploy/docker/kugou-api/package.json
    - deploy/docker/qq-api/package.json
    - packaging/windows/wallpaper-helper/Cargo.toml
    - packaging/windows/wallpaper-helper/Cargo.lock
---

## 1. 使用的系统与工具

- **包管理器**：npm（由根 `package-lock.json` 与 `.npmrc` 确认），Node.js 版本通过 `.nvmrc` 与各项目 `engines.node >=24.0.0` 约束。
- **构建/打包**：Vite + Electron Builder（根 `package.json` 的 `build` 字段），Playwright UI 测试，Vitest 单元测试。
- **同步服务端**：基于 Hono 的 Node.js 服务，使用 `wrangler` 部署到 Cloudflare Workers，本地用 `tsx` 运行；同时支持 `better-sqlite3` 原生模块（通过 `allowScripts` 显式放行）。
- **Rust 原生辅助程序**：Windows 壁纸助手位于 `packaging/windows/wallpaper-helper/`，使用 Cargo 管理依赖（`Cargo.toml` + `Cargo.lock`）。
- **容器化**：`deploy/docker/` 下每个后端服务（backend、netease-api、kugou-api、qq-api、sync-server）均拥有独立的 `package.json` + `package-lock.json`，通过 Docker Compose 编排。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 根工程依赖声明、Electron 打包配置、脚本入口 |
| `package-lock.json` | 根工程完整依赖树锁定 |
| `.npmrc` | 允许根级远程 tarball、指定 npm registry、跳过 onnxruntime-node 的 CUDA/TensorRT postinstall |
| `sync-server/package.json` | 同步服务端依赖（Hono / better-sqlite3 / wrangler） |
| `deploy/docker/backend/package.json` | Vercel Edge 后端 API（@google/genai + express） |
| `deploy/docker/netease-api/package.json` | 网易云音乐 API 适配 |
| `deploy/docker/kugou-api/package.json` | 酷狗音乐 API 适配 |
| `deploy/docker/qq-api/package.json` | QQ 音乐 API 适配 |
| `packaging/windows/wallpaper-helper/Cargo.toml` | Rust 原生辅助程序依赖 |
| `packaging/windows/wallpaper-helper/Cargo.lock` | Rust 依赖锁定 |

## 3. 架构与约定

### 3.1 单仓库多 package.json 结构
项目采用“一个仓库、多个独立 npm 工程”的组织方式：
- 根 `package.json` 管理桌面端 Electron 应用及其前端依赖。
- `sync-server/` 是独立的 Node.js 服务，有自己独立的依赖与 `tsconfig.json`。
- `deploy/docker/` 下每个子目录是一个最小化的运行时镜像依赖集，仅包含该服务实际需要的依赖，避免把整个根工程的依赖打入镜像。

各子工程之间**没有使用 npm workspace**（搜索 `workspace:|file:|link:` 无匹配），而是通过 Git 仓库引用或版本号保持对齐。例如根工程与 `deploy/docker/qq-api` 都依赖 `@yakult-green-tea/qq-music-api`，且版本号保持一致（`3.1.0`）。

### 3.2 依赖来源策略
- **npm registry**：绝大多数依赖来自官方 npm registry（`.npmrc` 中 `registry=https://registry.npmjs.org/`）。
- **GitHub 直接 tarball**：`kugoumusicapi` 通过 GitHub 标签 tarball 引用（`https://github.com/MakcRe/KuGouMusicApi/archive/refs/tags/v1.6.0.tar.gz`），并在根与 `deploy/docker/kugou-api` 两处保持一致。`.npmrc` 中 `allow-remote=root` 明确允许根 `package.json` 声明此类远程 tarball。
- **私有/内部包**：未发现私有 npm registry 或 `GOPRIVATE` 等配置，所有依赖均来自公开源。

### 3.3 版本锁定与一致性
- 根工程使用 `package-lock.json` 锁定全部依赖。
- 各 Docker 子工程各自维护自己的 `package-lock.json`，确保镜像内依赖可复现。
- 跨工程共享依赖（如 `@google/genai`、`@neteasecloudmusicapienhanced/api`、`@yakult-green-tea/qq-music-api`）在根与各 Docker 子工程中保持相同主版本，但并未通过 workspace 强制统一——更新时需人工同步。
- Rust 侧通过 `Cargo.lock` 锁定 `packaging/windows/wallpaper-helper` 的依赖。

### 3.4 依赖覆盖与安装优化
- `overrides` 字段用于解决传递依赖冲突：将 `@babel/plugin-transform-runtime` 固定为 `7.29.7`，并将 `@discordjs/rest` 的 `undici` 提升到 `^6.27.0`。
- `.npmrc` 中设置 `onnxruntime-node-install=skip`，跳过 onnxruntime-node 的 CUDA/TensorRT postinstall 下载，因为项目只使用 WebGPU 并回退 CPU，这些二进制不会被加载，从而避免 CI 因网络问题失败。

### 3.5 原生模块处理
- Electron 打包时通过 `asarUnpack` 排除 `electron/analysis/htdemucs_runner.py`，保证 Python 分析脚本不被压缩进 asar。
- `sync-server/package.json` 通过 `allowScripts.better-sqlite3: true` 显式允许安装原生 SQLite 模块。
- Windows 壁纸助手作为独立 Rust crate 编译为 `folia-wallpaper-helper.exe`，由 `packaging/windows/build-wallpaper-helper.mjs` 构建并通过 electron-builder 的 `extraResources` 打入安装包。

### 3.6 容器化依赖隔离
`deploy/docker/images/` 下的 Dockerfile 以对应 `deploy/docker/<service>/package.json` 为依赖入口，每个服务镜像只安装自身所需的最小依赖集合，避免共享根依赖带来的体积膨胀与版本冲突。

## 4. 约定与约束

- **Node 版本约束**：所有 `package.json` 的 `engines.node` 均为 `>=24.0.0`，开发环境通过 `.nvmrc` 锁定。
- **禁止隐式 workspace**：当前仓库未启用 npm workspace，各子工程依赖需手动保持版本一致。
- **远程 tarball 仅限根工程**：`.npmrc` 注释写明 `allow-remote=root`，即只有根 `package.json` 可以声明 GitHub tarball 形式的依赖。
- **CI 友好安装**：通过 `onnxruntime-node-install=skip` 规避不可靠的外部二进制下载，保证 `npm ci` 稳定。
- **Docker 镜像依赖最小化**：每个 Docker 服务目录自带 `package.json` + `package-lock.json`，镜像构建时仅安装该服务所需依赖。
- **原生模块显式授权**：需要执行安装脚本的原生依赖（如 `better-sqlite3`）需在 `allowScripts` 中显式放行。
- **Electron 打包资源清单**：通过 `files`、`extraResources`、`asarUnpack` 精确控制哪些文件进入最终安装包，包括 windowtolayer、wallpaper-helper 等外部构建产物。

## 5. 总结

该项目采用**多 package.json + 多 lockfile** 的依赖管理模式：根工程负责桌面端 Electron 应用，`sync-server` 和 `deploy/docker/*` 各自维护独立的运行时依赖，Rust 原生组件通过 Cargo 管理。依赖来源以 npm registry 为主，辅以 GitHub tarball；通过 `.npmrc` 的 `allow-remote`、`overrides`、`onnxruntime-node-install=skip` 等机制实现安全、可复现且 CI 友好的安装流程；Docker 镜像则通过隔离的依赖声明保证部署环境的确定性。