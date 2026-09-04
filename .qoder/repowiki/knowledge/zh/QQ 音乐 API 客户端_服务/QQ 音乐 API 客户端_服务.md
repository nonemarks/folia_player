---
kind: external_dependency
name: QQ 音乐 API 客户端/服务
slug: qq-music-api
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - package.json
    - docs/qq-music-deployment.md
    - worker/qq.ts
    - deploy/docker/qq-api/
---

QQ 音乐音源由 npm 包 @yakult-green-tea/qq-music-api 提供，支持两种形态：常驻 Node 进程（Docker/裸 Node/Electron 主进程内嵌）和 serverless（Vercel / Cloudflare Workers）。Electron 桌面版在主进程直接启动该包，无需额外部署；Web 版可通过 VITE_QQ_API_BASE=/api/qq 使用仓库内置入口或自建实例。serverless 形态默认仅支持微信扫码登录，启用 QQ 扫码需在 Cloudflare 绑定 Durable Object QQ_QR_CHANNEL → QqQrChannel。登录态密钥为 QQ_SESSION_SECRET（服务端 Secret，不带 VITE_ 前缀）。