---
kind: configuration_system
name: Folia 多环境配置系统：Vite 构建变量 + Docker 运行时注入 + Electron Store
category: configuration_system
scope:
    - '**'
source_files:
    - vite.config.ts
    - public/runtime-config.js
    - src/services/runtimeConfig.ts
    - deploy/docker/.env.example
    - deploy/docker/compose.yaml
    - deploy/docker/backend/server.mjs
    - wrangler.jsonc
    - vercel.json
    - electron/main.cjs
    - sync-server/src/app.ts
    - package.json
---

## 1. 整体方案

Folia 的“配置”不是单一文件，而是按运行阶段分层注入的组合：

| 阶段 | 机制 | 典型用途 |
|---|---|---|
| 开发/构建期 | Vite `import.meta.env.VITE_*`、`vite.config.ts` 的 `define` 常量 | AI 提供商、Git 版本、发布通道、PWA manifest |
| Web 部署期（Docker） | 容器环境变量 → Nginx 网关 → 前端 `window.__FOLIA_RUNTIME_CONFIG__` 与后端 `process.env.*` | 运行时可覆盖的 AI 提供商、端口、同步服务地址等 |
| Electron 桌面端 | `electron-store` + `process.env.*` + 平台命令开关 | 用户设置、壁纸模式、Linux 图形后端、更新通道 |
| 云端 Worker / Vercel | `wrangler.jsonc` define、`vercel.json` rewrites、`process.env.*` | Cloudflare Assets 路由、Node 运行时环境变量 |
| 同步服务端 | Hono `Env` bindings (`SYNC_TOKEN`、`DASHBOARD_TOKEN`) 或 Node `process.env` | 鉴权令牌、数据库路径 |

核心原则：**构建期常量不可变，运行时配置通过环境变量或注入对象在部署时生效**。

## 2. 关键文件与职责

- `vite.config.ts`：集中定义构建期常量（`__COMMIT_HASH__`、`__GIT_BRANCH__`、`__APP_VERSION__`、`__APP_VERSION_LABEL__`、`__APP_RELEASE_CHANNEL__`、`__DOCKER_STACK_VERSION__`），并通过 `base` 区分 Electron (`./`) 与 Web (`/`)；同时注册 PWA 插件并排除 `runtime-config.js` 不被 precache。
- `public/runtime-config.js`：Web 部署时的运行时配置占位文件，默认空对象，由部署脚本注入实际值后由前端读取。
- `src/services/runtimeConfig.ts`：统一读取 AI 提供商——优先读 `window.__FOLIA_RUNTIME_CONFIG__.aiProvider`，回退到 `import.meta.env.VITE_AI_PROVIDER`，实现“部署时覆盖构建时”。
- `deploy/docker/.env.example`：Compose 用户配置模板，声明所有可注入的环境变量（`FOLIA_HTTP_PORT`、`FOLIA_AI_PROVIDER`、`GEMINI_API_KEY`、`OPENAI_*`、`SYNC_TOKEN` 等）。
- `deploy/docker/compose.yaml`：把 `.env` 中的变量映射到各容器（gateway/backend/netease-api/kugou-api/qq-api/sync-server），并对每个服务配置 healthcheck、只读文件系统、networks 与安全选项。
- `deploy/docker/backend/server.mjs`：将 `api/*.js` 处理器装配为 Express 服务，监听 `PORT`，暴露 `/api/healthz`。
- `wrangler.jsonc`：Cloudflare Workers 配置，通过 `define` 注入 `process.env.NODE_ENV`、`JEST_WORKER_ID`、`LOG_LEVEL`，并将 `/api/*` 交由 worker 处理，静态资源走 `ASSETS` binding。
- `vercel.json`：Vercel Edge 上把 `/api/qq/:path*` 重写为 `/api/qq?path=:path*`，屏蔽平台差异。
- `electron/main.cjs`：Electron 主进程配置入口。使用 `electron-store` 持久化用户设置；通过 `process.env.ELECTRON_LINUX_PACKAGED_GRAPHICS`、`FOLIA_WINDOWTOLAYER_PATH`、`FOLIA_WALLPAPER_HELPER_PATH` 等控制 Linux 图形后端、壁纸模式子进程路径；启动时根据平台追加 Chromium command-line switches（Wayland/Vulkan/SwiftShader 等）。
- `sync-server/src/app.ts`：Hono 应用，从 `c.env.SYNC_TOKEN`、`DASHBOARD_TOKEN`、`FOLIA_SYNC_DB` 读取配置，并在中间件里强制校验 `SYNC_TOKEN` 长度 ≥ 8。

## 3. 架构约定

1. **环境变量命名空间**
   - `FOLIA_*`：Folia 自有配置（HTTP 端口、AI 提供商、同步端口、客户端 IP 转发、Linux 图形模式等）。
   - `QQ_*`：QQ 登录态相关（`QQ_AUTH_SESSION_PATH`、`QQ_SESSION_SECRET`、`QQ_SESSION_SECRET_PREVIOUS`）。
   - `OPENAI_*` / `GEMINI_API_KEY`：AI 提供商密钥与模型参数。
   - `SYNC_TOKEN` / `DASHBOARD_TOKEN`：同步服务鉴权。
   - `VITE_*`：仅用于 Vite 构建期注入前端的变量。

2. **构建期常量 vs 运行时覆盖**
   - 构建期常量通过 `vite.config.ts` 的 `define` 写入，编译后不可变，用于版本号、分支、发布通道等。
   - 运行时覆盖通过 `window.__FOLIA_RUNTIME_CONFIG__`（前端）或 `process.env.*`（后端）实现，例如 `getWebAiProvider()` 先查运行时再回退到构建时。

3. **Docker Compose 作为唯一编排入口**
   - 所有服务通过 `compose.yaml` 启动，统一使用 `read_only: true`、`tmpfs`、`security_opt: no-new-privileges:true`，健康检查通过 HTTP 探针验证。
   - 敏感信息（API Key、Token）通过 `.env` 注入，不进入镜像。

4. **Electron 桌面端配置分层**
   - 用户偏好：`electron-store` 持久化（如壁纸模式、窗口透明度、attach mode）。
   - 启动开关：`process.env.*` 控制开发/打包行为（`ELECTRON_DEV`、`ELECTRON`、`FOLIA_WINDOWTOLAYER_PATH`、`FOLIA_WALLPAPER_HELPER_PATH`）。
   - 平台特性：根据 `process.platform` 和 `process.arch` 动态追加 Chromium 命令行开关。

5. **多宿主 API 适配层**
   - `api/`（JS）与 `api-ts/`（TS）两套相同逻辑，分别服务于 Vercel Edge 与 Cloudflare Worker。
   - 通过 `vercel.json` 与 `wrangler.jsonc` 的 rewrite/define 屏蔽平台差异，前端统一以 `VITE_QQ_API_BASE=/api/qq` 访问。

## 4. 约束与规则

- **PWA 缓存排除**：`vite.config.ts` 中明确 `globIgnores: ['**/runtime-config.js']`，确保 Docker 动态注入的运行时配置不会被 Workbox 预缓存。
- **Sync Token 强度校验**：`sync-server/src/app.ts` 中间件强制 `SYNC_TOKEN.length >= 8`，否则返回 500。
- **Compose 安全基线**：所有服务启用 `read_only: true`、`tmpfs` 临时目录、`security_opt: no-new-privileges:true`，禁止提权。
- **Electron 壁纸模式降级**：当 `windowtolayer` 或 `folia-wallpaper-helper.exe` 缺失时，主进程主动关闭壁纸模式并写回 store，避免崩溃。
- **构建产物常量来源**：`__APP_VERSION__` 来自 `package.json` 的 `version` 字段，`__COMMIT_HASH__` 优先取 `VERCEL_GIT_COMMIT_SHA`，否则回退 `git rev-parse --short HEAD`。
- **NPM 引擎锁定**：`package.json` 声明 `engines.node >= 24.0.0`，要求 Node 24+。
- **Worker 构建期常量**：`wrangler.jsonc` 通过 `define` 将 `process.env.NODE_ENV` 固定为 `production`，并注入 `undefined` 给 Jest/日志相关变量。

## 5. 适用场景总结

该配置系统适用于 Folia 的多端部署：本地开发（Vite dev server）、Electron 桌面打包（electron-builder）、Docker Compose 全栈部署、Cloudflare Workers/Vercel 边缘部署以及独立的 Sync Server。不同环境的差异通过环境变量、构建期常量和运行时注入三层面解耦，新增配置项只需在对应位置声明即可。