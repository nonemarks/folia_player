---
kind: external_dependency
name: AI 主题生成 — OpenAI 兼容接口
slug: openai-compatible-api
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - docs/technical.md
---

除 Gemini 外，项目也支持通过 OpenAI 兼容接口接入第三方 LLM（如 DeepSeek、ChatGPT），通过 VITE_AI_PROVIDER=openai 配合 OPENAI_API_KEY、OPENAI_API_URL、OPENAI_API_MODEL、OPENAI_API_TEMPERATURE 配置。部分模型对温度有特殊约束（例如 kimi-k3 要求温度为 1）。