---
name: whisper-mod-conversion
description: Whisper功能从内嵌IPC转为mod扩展架构的设计决策和当前状态
type: project
---

## Whisper扩展化改造 (2026-09-02)

**Why:** 用户要求将Whisper功能转为扩展开发模式，使其可独立开发、可选启用/禁用

**架构决策：**
- 创建 `mods/whisper-align/` mod，封装whisperAlign.cjs核心逻辑为mod命令
- mod通过 `require(path.join(app.getAppPath(), 'electron', 'whisperAlign.cjs'))` 懒加载核心模块（非代码复制）
- UI层通过 `src/services/whisperModService.ts` 统一API通信：优先mod命令，回退到直接IPC
- LyricMatchModal根据 `isWhisperAvailable()` 动态显示/隐藏Whisper标签
- WhisperEnvCheck使用 `getWhisperAvailabilityUnified()` 替代直接IPC调用
- 进度更新采用轮询模式（`get-download-progress`/`get-transcription-status`命令）

**已完成的修改：**
- `mods/whisper-align/mod.json` + `index.cjs` — mod manifest和14个命令
- `src/services/whisperModService.ts` — 统一API服务层
- `src/components/shared/WhisperEnvCheck.tsx` — 超时保护+加载状态改善+统一API
- `src/components/modal/LyricMatchModal.tsx` — 动态Whisper标签+清理调试日志
- `electron/preload.cjs` — 修复合并冲突残留的额外闭合花括号

**待完成：**
- 运行dev:electron实际测试mod加载和Whisper标签页
- 验证mod命令的进度轮询是否满足UX需求
- 考虑添加mod事件机制替代轮询（长期优化）