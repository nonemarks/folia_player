---
kind: external_dependency
name: 逐字歌词对齐引擎 — Whisper.cpp
slug: whisper-cpp
category: external_dependency
category_hints:
    - sdk_real_api
    - framework_behavior
scope:
    - '**'
source_files:
    - mods/whisper-align/mod.json
    - mods/whisper-align/index.cjs
    - src/services/whisperModService.ts
    - electron/whisperAlign.cjs
---

Whisper.cpp 作为可选扩展以 mod 形式集成（mods/whisper-align/），通过 whisperModService.ts 统一调用：优先走 mod 命令（check-status/list-models/download-model/transcribe 等），未启用时回退到直接 IPC。mod 采用 fail-closed 设计，新模组需经信任对话框确认内容指纹后才 enabled；进度通过轮询 get-download-progress / get-transcription-status 获取，无事件推送。运行时依赖 onnxruntime-node 及 FFmpeg。