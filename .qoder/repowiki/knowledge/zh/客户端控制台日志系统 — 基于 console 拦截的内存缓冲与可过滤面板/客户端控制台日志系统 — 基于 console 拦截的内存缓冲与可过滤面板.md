---
kind: logging_system
name: 客户端控制台日志系统 — 基于 console 拦截的内存缓冲与可过滤面板
category: logging_system
scope:
    - '**'
source_files:
    - src/utils/consoleLogBuffer.ts
    - src/utils/consoleLogFilters.ts
    - src/components/shared/ConsoleLogPanel.tsx
    - src/components/modal/settings/DeveloperSettingsSubview.tsx
    - src/components/DevDebugOverlay.tsx
    - src/index.tsx
    - docs/client-logging.md
    - test/unit/utils/consoleLogBuffer.test.ts
---

## 1. 系统概览

Folia Player 没有引入第三方日志框架，而是通过**拦截原生 `console` API + 内存环形缓冲 + 内置 UI 面板**的方式实现客户端日志系统。核心动机是：打包后的 Electron 桌面端默认无 DevTools、无边框窗口，用户无法直接打开控制台；因此必须把日志保存在内存中并提供应用内读取入口。

该系统的调用点非常轻量——业务代码只需写 `console.log/info/warn/error/debug`，无需 import logger，也无需注册模块。所有结构化信息（级别、时间戳、作用域）由拦截层在写入时解析并持久化到内存条目中。

## 2. 关键文件与职责

- `src/utils/consoleLogBuffer.ts`：核心拦截器。定义 `ConsoleLevel`、`ConsoleLogEntry` 类型；用 `LIMIT = 1000` 维护有界数组；通过正则 `/^\[([^\]\s]{1,40})\]/` 从每行文本开头提取 `[Module]` 前缀作为 `scope`；捕获 `window error` 和 `unhandledrejection` 事件以记录未走 `console` 的异常；暴露 `installConsoleLogCapture()`、`setConsoleLogSink()`、`getConsoleLogEntries()`、`subscribeToConsoleLog()`、`clearConsoleLog()`、`formatConsoleLog()` 等 API；默认开启录制，可通过 `localStorage.console_log_capture` 关闭。
- `src/utils/consoleLogFilters.ts`：过滤器持久化。使用 `localStorage.console_log_filters` 保存 `hiddenScopes` 和 `hiddenLevels`，采用“白名单的反面”策略——只存被隐藏的项，新子系统上线后不会因旧配置被静默过滤掉。
- `src/components/shared/ConsoleLogPanel.tsx`：统一日志面板。提供搜索、按 Level/Module 下拉筛选、多选复制、清空、显示隐藏计数等功能；通过 `useSyncExternalStore` 订阅 buffer 变更；同时挂载到开发者设置页和调试覆盖层两个宿主。
- `src/components/modal/settings/DeveloperSettingsSubview.tsx`：设置页中的开关与面板宿主。
- `src/components/DevDebugOverlay.tsx`：播放器页面的 Alt+Shift+D 调试覆盖层，提供 Console tab。
- `src/index.tsx`：应用启动入口，尽早调用 `installConsoleLogCapture()`，确保尽可能多的日志被记录。
- `test/unit/utils/consoleLogBuffer.test.ts`：针对 scope 解析、buffer 行为等的单元测试。
- `docs/client-logging.md`：面向贡献者的规范文档，规定日志写法、内容取舍原则与面板用法。

## 3. 架构与约定

### 3.1 数据流

```
业务代码 console.*
  → consoleLogBuffer 拦截 (push)
    → 格式化 args → JSON.stringify(带 circular 检测)
    → 解析 [Module] 前缀为 scope
    → 推入 entries 数组（最多 1000 条）
    → 可选转发给 sink（如 services/debug/runtimeLogSink.ts）
    → 通知 listeners（ConsoleLogPanel / DevDebugOverlay）
```

### 3.2 作用域约定（Scope 命名）

根据 `docs/client-logging.md` 与 `consoleLogBuffer.ts` 注释，日志行必须以方括号模块名开头，例如 `[Prefetch]`、`[KugouProvider]`、`[LocalLibrary]`。规则包括：
- 单词、无空格（解析器遇到第一个空格即停止）。
- 命名子系统而非具体文件。
- 拼写一致，避免同一模块出现多个 scope。
- 必须位于行首，否则被视为 `(untagged)`。

### 3.3 级别体系

仅使用浏览器原生五个级别：`log`、`info`、`warn`、`error`、`debug`。面板中 `error` 用 rose 色、`warn` 用 amber 色、其余半透明区分。

### 3.4 存储与生命周期

- 录制开关：`localStorage.console_log_capture`，默认 on；关闭时立即清空已缓存条目，避免保留用户明确拒绝的记录。
- 过滤器：`localStorage.console_log_filters`，跨会话持久化 `hiddenScopes` 与 `hiddenLevels`。
- Buffer：内存中最多 1000 条，超出则 `slice(entries.length - LIMIT)`。
- Sink 机制：通过 `setConsoleLogSink` 注入外部消费者（如远程上报），但 buffer 本身不依赖任何上层模块，保证安装顺序不受限制。

### 3.5 错误捕获扩展

除了拦截 `console.*`，还监听 `window error` 与 `unhandledrejection`，将未捕获异常以 `error` 级别写入同一条目，解决“真正重要的异常不走 console”的问题。

## 4. 约定与约束

| 类别 | 约定 / 约束 | 来源 |
|---|---|---|
| 写入方式 | 直接使用 `console.log/info/warn/error/debug`，不 import logger | `docs/client-logging.md` 第 8–17 行 |
| 模块前缀 | 每行必须以 `[OneWord]` 形式开头，用于自动 scope 分组 | `docs/client-logging.md` 第 12–29 行；`consoleLogBuffer.ts` 第 31 行正则 |
| 内容取舍 | 记录决策而非到达；成功也要记录；一次事件一条；用数字而非形容词 | `docs/client-logging.md` 第 31–46 行 |
| 录制默认 | 默认开启，因为打包桌面端无控制台，提前开关等于没开 | `consoleLogBuffer.ts` 第 64–81 行注释 |
| 面板访问 | 设置页 → 开发者；或播放器页面 Alt+Shift+D 打开调试覆盖层 Console tab | `docs/client-logging.md` 第 47–56 行 |
| 过滤器语义 | 只存“被隐藏的”，新模块上线不会被旧配置静默过滤 | `consoleLogFilters.ts` 第 24–31 行注释 |
| 安装时机 | 必须在应用启动早期调用 `installConsoleLogCapture()`，之前记录的日志不可见 | `consoleLogBuffer.ts` 第 159 行注释；`src/index.tsx` 第 10 行调用 |
| 容量上限 | 内存 buffer 固定 1000 条，防止长会话无限增长 | `consoleLogBuffer.ts` 第 34 行常量 |
| 异常安全 | format 对循环引用、Error 对象做特殊处理；sink 调用 try/catch；storage 读写 catch 后降级 | `consoleLogBuffer.ts` 第 48–62、126–130、74–81 行 |

## 5. 适用性说明

本仓库属于前端/Electron 应用，不存在后端集中式日志服务（如 Winston、Pino、ELK）。日志系统是纯客户端方案，聚焦于“如何在无 DevTools 的打包产物中收集、展示、导出日志”。因此该分类在本仓库中高度适用，证据来自多处源码与独立文档的强耦合实现。