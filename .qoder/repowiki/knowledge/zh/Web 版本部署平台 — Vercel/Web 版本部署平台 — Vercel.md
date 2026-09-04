---
kind: external_dependency
name: Web 版本部署平台 — Vercel
slug: vercel
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - vercel.json
    - docs/qq-music-deployment.md
---

Folia Web 版本支持一键部署到 Vercel，通过 vercel.json 中的 /api/qq/:path* rewrite 将 QQ 音乐请求转发至内置 serverless 入口。Vercel 仅支持微信扫码登录，不支持 QQ 扫码（无持久长连接原语）。构建时变量 VITE_QQ_API_BASE 会写入前端资源，修改后必须重新部署。