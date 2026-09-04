---
kind: build_system
name: Folia Player 构建与发布体系：Vite + Electron Builder + Docker Compose + GitHub Actions
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - build-electron.cjs
    - .github/workflows/electron-release.yml
    - .github/workflows/docker-stack-publish.yml
    - .github/workflows/pr-unit-tests.yml
    - deploy/docker/compose.yaml
    - deploy/docker/images/backend.Dockerfile
    - deploy/docker/images/gateway.Dockerfile
    - deploy/docker/images/netease-api.Dockerfile
    - deploy/docker/images/kugou-api.Dockerfile
    - deploy/docker/images/qq-api.Dockerfile
    - deploy/docker/VERSION
    - packaging/linux/build-windowtolayer.mjs
    - packaging/windows/build-wallpaper-helper.mjs
    - vercel.json
    - sync-server/package.json
---

## 1. 使用的构建系统与工具链

本项目采用多阶段、多目标的构建体系，核心由以下组件构成：

- **前端构建**：基于 Vite（`vite.config.ts`），输出三个入口 `index.html`（主应用）、`stage-client.html`（舞台客户端）、`mod-export.html`（模组导出页面）。通过 `manualChunks` 将 `three.js` 单独拆包以规避 PWA 预缓存大小限制。
- **Electron 打包**：使用 `electron-builder`（配置位于 `package.json#build`），目标平台包括 macOS（dmg/zip x64+arm64）、Windows（nsis/portable x64）、Linux（tar.gz/deb/rpm），产物统一输出到 `release/` 目录，并通过 `publish.provider: github` 自动发布更新元数据。
- **原生辅助程序构建**：Linux 侧的 `windowtolayer` 通过 `packaging/linux/build-windowtolayer.mjs` 拉取上游源码并应用 `packaging/linux/patches/` 下的补丁；Windows 侧的 `folia-wallpaper-helper.exe` 通过 `packaging/windows/build-wallpaper-helper.mjs` 调用 Cargo 编译 Rust 子项目 `packaging/windows/wallpaper-helper`。两者均作为 `extraResources` 打入最终安装包。
- **Docker 镜像构建**：`deploy/docker/images/*.Dockerfile` 为 Web 网关、后端 API、网易/QQ/酷狗 API 适配服务、同步服务器分别提供多架构（amd64/arm64）镜像构建脚本，配合 `docker-compose.yaml` 一键编排部署。
- **CI/CD**：GitHub Actions 管理全部流水线，见 `.github/workflows/`。
- **版本来源**：桌面端版本来自 `package.json#version`，Web/Docker Stack 版本来自 `deploy/docker/VERSION`，二者独立演进。

## 2. 关键文件与脚本

| 文件 | 作用 |
|---|---|
| `package.json` | 定义 Node ≥24 环境、所有 npm scripts、electron-builder 配置、依赖与覆盖策略 |
| `vite.config.ts` | Vite 构建配置、PWA、开发歌词代理中间件、注入 `__COMMIT_HASH__` / `__GIT_BRANCH__` / `__APP_VERSION__` / `__APP_RELEASE_CHANNEL__` / `__DOCKER_STACK_VERSION__` 等编译期常量 |
| `build-electron.cjs` | 绕过企业代理 SSL 校验并调用 electron-builder 的便捷包装脚本 |
| `packaging/linux/build-windowtolayer.mjs` | 拉取上游 windowtolayer 源码并打补丁 |
| `packaging/windows/build-wallpaper-helper.mjs` | 编译 Windows 壁纸辅助程序 |
| `deploy/docker/compose.yaml` | 完整 Folia Web 栈编排（gateway/backend/netease-api/kugou-api/qq-api/sync-server） |
| `deploy/docker/images/*.Dockerfile` | 各服务的多架构镜像构建定义 |
| `deploy/docker/VERSION` | Docker Stack 版本号，变更触发 docker-stack-publish workflow |
| `.github/workflows/electron-release.yml` | Realeco 桌面端发布：验证版本 → 三平台并行构建 → 上传 artifact → 创建 GitHub Draft Release → 推送 AUR |
| `.github/workflows/docker-stack-publish.yml` | Docker Stack 发布：校验 `deploy/docker/VERSION` 递增 → 多架构 buildx 构建 → 推送到 Docker Hub 并 promote major/minor/latest 标签 |
| `.github/workflows/pr-unit-tests.yml` | PR 检查：typecheck + vitest 单元测试 + sync-server TypeScript 编译 |
| `vercel.json` | Vercel Edge 路由重写规则 |
| `sync-server/package.json` | 同步服务端独立工程，支持 Cloudflare Workers (`wrangler`) 与 Node.js 两种运行模式 |

## 3. 架构与约定

### 3.1 构建流程分层

```
源代码 (src/) ── vite build ── dist/ (静态资源)
                     │
                     ├─ electron-builder ── release/* (桌面安装包)
                     │
                     ├─ Dockerfile (deploy/docker) ── Docker Hub 镜像
                     │
                     └─ vercel deploy (api-ts/) ── Edge 函数
```

### 3.2 环境变量驱动的构建变体

- `ELECTRON=true`：切换 Vite base 为 `./`，用于 Electron 内嵌渲染。
- `APP_VERSION_LABEL` / `APP_RELEASE_CHANNEL`：注入到运行时，区分 Realeco / nightly / canary 等渠道。
- `REQUIRE_COMMIT_NAME=true`：在 Docker 构建中强制要求能解析 commit 名称，否则构建失败。
- `FOLIA_WINDOWTOLAYER_PATH` / `FOLIA_WALLPAPER_HELPER_PATH`：指向原生二进制路径，供 Electron 进程加载。
- `VERCEL_GIT_COMMIT_SHA` / `VERCEL_GIT_COMMIT_REF`：Vercel 部署时注入，替代本地 git 命令获取提交信息。

### 3.3 多目标产物

| 产物 | 构建方式 | 输出位置 |
|---|---|---|
| 桌面安装包 | `npm run build:electron` | `release/` |
| Web 静态资源 | `npm run build` | `dist/` |
| Docker 镜像 | `docker-stack-publish.yml` | Docker Hub `docker.io/<namespace>/folia-*:<version>` |
| Sync Server 镜像 | `sync-server-docker-publish.yml` | Docker Hub `docker.io/<namespace>/folia-sync-server:<version>` |
| Vercel Edge 函数 | `npm run build:vercel-api` | `api/`（由 Vercel 托管） |
| AUR 包 | `packaging/aur/folia-major-bin/update.sh` | Arch Linux AUR |

### 3.4 版本管理策略

- **桌面端**：`package.json#version` 必须为稳定 `A.B.C` 格式；Realeco 发布通过 `realeco-release` 文件 + 提交消息中的版本元数据进行校验，禁止重复 tag 且必须高于已发布版本。
- **Docker Stack**：`deploy/docker/VERSION` 每次 push 到 main 时递增，workflow 会对比上一个版本的 VERSION 确保单调递增，并拒绝已存在的镜像 tag（除非 `force_republish=true`）。
- **Commit 溯源**：构建时通过 `git rev-parse --short HEAD` 或 `VERCEL_GIT_COMMIT_SHA` 注入 `__COMMIT_HASH__`，并在 CI 中尝试调用 `namoe.izuna.top` 解析 commit name 附加到版本标识。

## 4. 约定与约束

- **Node 版本锁定**：根 `package.json` 与 `sync-server/package.json` 均声明 `engines.node >= 24.0.0`，CI 使用 `setup-node@v6` 安装 Node 24。
- **依赖安装**：CI 统一使用 `npm ci`（非 `npm install`），保证可重现构建。
- **PWA 限制**：`maximumFileSizeToCacheInBytes=5M`，因此 `three.js` 被手动拆包以避免单个 chunk 超限；`runtime-config.js` 通过 `globIgnores` 排除预缓存。
- **开发服务器监听**：Vite dev server 监听 `0.0.0.0:3000`，Electron 启动脚本通过 `wait-on tcp:3000` 等待就绪后再 launch。
- **安全基线**：Docker Compose 中所有服务启用 `read_only: true`、`security_opt: no-new privileges:true`，仅必要端口暴露，敏感数据通过 `tmpfs` 或 volume 挂载。
- **更新通道**：electron-builder 配置 `generateUpdatesFilesForAllChannels: true`，CI 通过 `--config.publish.channel=latest` 指定更新通道。
- **测试门禁**：PR 必须通过 `npm run typecheck` 与 `npm run test:unit`；UI 截图测试通过 `playwright test`（`test:ui` / `test:ui:update`）。
- **AUR 发布条件**：仅在 `validate-release.outputs.version_valid == 'true'` 且配置了 `AUR_SSH_PRIVATE_KEY` 与 `AUR_REPO_SSH_URL` 时执行，无变更则跳过推送。
- **Docker 镜像标签**：每个构建同时生成 `<version>-amd64` 与 `<version>-arm64` 单架构镜像，promote 阶段再合并为 `<version>`、`<minor>`、`<major>`、`latest` 四个标签。