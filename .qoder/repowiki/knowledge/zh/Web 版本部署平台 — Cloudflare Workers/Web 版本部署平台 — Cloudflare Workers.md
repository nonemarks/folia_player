---
kind: external_dependency
name: Web 版本部署平台 — Cloudflare Workers
slug: cloudflare-workers-durable-objects-d1
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - wrangler.jsonc
    - sync-server/wrangler.toml
    - docs/qq-music-deployment.md
---

Folia 同时支持部署到 Cloudflare Workers，并提供内置 serverless 入口（/api/qq）。默认仅支持微信扫码；启用 QQ 扫码需绑定 Durable Object QQ_QR_CHANNEL → QqQrChannel，在二维码有效期内维持 MQTT WebSocket。Sync Server 可部署到 Cloudflare Workers + D1（wrangler.toml 中定义 FOLIA_SYNC_DB 绑定）。