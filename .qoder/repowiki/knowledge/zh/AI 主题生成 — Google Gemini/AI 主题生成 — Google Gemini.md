---
kind: external_dependency
name: AI 主题生成 — Google Gemini
slug: google-gemini
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - docs/technical.md
---

AI 主题与歌词相关 AI 能力首选 Google Gemini，通过 VITE_AI_PROVIDER=google 与 GEMINI_API_KEY 环境变量接入。文档指出 Gemini JSON 输出更稳定，适合当前项目的主题生成场景。OpenAI 兼容接口可作为备选。