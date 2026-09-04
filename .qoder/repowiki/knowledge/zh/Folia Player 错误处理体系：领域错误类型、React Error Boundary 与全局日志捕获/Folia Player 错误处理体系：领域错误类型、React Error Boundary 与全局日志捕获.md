---
kind: error_handling
name: Folia Player 错误处理体系：领域错误类型、React Error Boundary 与全局日志捕获
category: error_handling
scope:
    - '**'
source_files:
    - src/types/onlineMusic.ts
    - src/services/sync/syncClient.ts
    - src/services/onlineMusic/omni.ts
    - src/services/onlineMusic/providerRegistry.ts
    - src/services/onlineMusic/qqProvider.ts
    - src/components/shared/ErrorBoundary.tsx
    - src/utils/consoleLogBuffer.ts
    - src/components/shared/ConsoleLogPanel.tsx
    - src/services/netease.ts
---

## 1. 整体方案

Folia Player 采用「领域专用 `Error` 子类 + React Error Boundary + 全局 console/异常缓冲」的组合方式，将运行时错误分为三层处理：

- **业务/协议层**：通过自定义 `Error` 子类携带结构化字段（如 HTTP 状态码、提供者错误码），在调用链中向上抛出，由上层决定重试、降级或提示。
- **渲染层**：使用 React `ErrorBoundary` 捕获组件树渲染期异常，避免整棵 UI 树崩溃，并提供可重试的 fallback UI。
- **诊断层**：通过拦截 `console.*`、`window.error`、`unhandledrejection` 把运行期错误以带时间戳和模块前缀的日志形式缓存到内存，供调试面板查看与复制。

该仓库没有统一的错误码枚举文件、也没有全局中间件式错误处理器；错误处理是分散在各服务模块中的约定式实践。

## 2. 关键文件与位置

| 职责 | 文件 | 说明 |
|---|---|---|
| 在线音乐提供者错误类型 | `src/types/onlineMusic.ts` | 定义 `ProviderErrorCode` 联合类型与 `OnlineProviderError` 类 |
| 同步客户端错误类型 | `src/services/sync/syncClient.ts` | 定义 `SyncClientError`，封装 HTTP status |
| 在线音乐统一入口 | `src/services/onlineMusic/omni.ts` | 通过 `withActiveProvider` 用 `DOMException('AbortError')` 取消过期请求，并集中抛 `OnlineProviderError` |
| 提供者注册校验 | `src/services/onlineMusic/providerRegistry.ts` | 未注册的 provider 直接抛 `OnlineProviderError('unavailable' / 'unsupported')` |
| React 渲染错误边界 | `src/components/shared/ErrorBoundary.tsx` | 捕获渲染异常，打印 stack，提供 Retry 按钮 |
| 全局日志捕获 | `src/utils/consoleLogBuffer.ts` | 拦截 `console.log/info/warn/error/debug`、`window error`、`unhandledrejection` |
| 日志展示面板 | `src/components/shared/ConsoleLogPanel.tsx` | 按模块 `[Prefix]` 过滤、按级别过滤、支持选择复制 |
| QQ 音乐提供者 | `src/services/onlineMusic/qqProvider.ts` | 消费 `OnlineProviderError`，对 `auth-required` 做静默降级 |
| NetEase 旧接口适配 | `src/services/netease.ts` | 配置失败时抛裸 `Error`，网络错误走 `console.warn` 降级 |

## 3. 架构与约定

### 3.1 领域错误类型

- `OnlineProviderError`（`src/types/onlineMusic.ts`）：构造函数签名为 `(code: ProviderErrorCode, message: string, providerId?: OnlineProviderId, cause?: unknown)`。`ProviderErrorCode` 是字面量联合：`'auth-required' | 'unsupported' | 'unavailable' | 'not-playable' | 'network' | 'invalid-response'`。所有在线音乐相关异常都通过它表达，调用方通过 `error instanceof OnlineProviderError && error.code === 'auth-required'` 进行分支判断（见 `qqProvider.ts` 登录态检查与播放链路）。
- `SyncClientError`（`src/services/sync/syncClient.ts`）：仅用于同步客户端 HTTP 层，构造时传入 `status: number`，在 `requestJson` 中统一把非 `response.ok` 转为该错误抛出。

这些错误类不继承任何框架错误，而是直接 `extends Error`，并通过 `this.name = '...'` 设置可读名称，便于日志识别。

### 3.2 错误传播策略

- **上游能力缺失**：`providerRegistry.requireOnlineMusicProvider` 在未找到 provider 时抛 `OnlineProviderError('unavailable', ...)`；`omni.ts` 的 `providerForSong`、`providerForCollection` 以及 `updateCollectionTracks` 等路径对不支持的能力调用 `unsupported(providerId, capability)` 内部函数，同样抛 `OnlineProviderError('unsupported', ...)`。
- **请求级取消**：`omni.ts` 的 `withActiveProvider` 在切换活跃账户后，若响应返回时当前 generation 已变化，则抛 `new DOMException('Active online provider changed', 'AbortError')`，让上层 `catch` 能区分“正常失败”和“被新请求覆盖”。
- **HTTP 层统一包装**：`syncClient.ts` 的 `requestJson` 把所有非 2xx 响应包装成 `SyncClientError`，调用方无需重复判断 `response.ok`。
- **静默降级优先**：大量 provider 方法对可选能力采用“不存在即回空值”的策略（如 `getAvailability?.() ?? { configured: true }`、`getChorusRanges?.() ?? []`），只有必须满足的前置条件才抛错。

### 3.3 渲染层错误隔离

`ErrorBoundary`（`src/components/shared/ErrorBoundary.tsx`）是一个类组件，实现 `getDerivedStateFromError` 与 `componentDidCatch`：
- 捕获子树渲染期抛出的任意 `Error`；
- 默认 fallback 显示错误消息和一个内联样式的 “Retry” 按钮（点击重置 state）；
- 可通过 `fallback` prop 替换 UI，通过 `onError` 回调上报给外部监控。

该组件位于 `src/components/shared/`，表明它是跨页面复用的通用兜底组件。

### 3.4 全局日志与异常捕获

`consoleLogBuffer.ts` 在应用启动早期调用 `installConsoleLogCapture()`，完成三件事：
1. 重写 `console.log/info/warn/error/debug`，把每条日志序列化为 `{ id, at, level, text, scope }` 存入最多 1000 条的环形缓冲区；`scope` 从日志文本开头的 `[Module]` 前缀解析。
2. 监听 `window.addEventListener('error', ...)` 与 `unhandledrejection`，把未捕获异常也作为 error 级别条目写入同一缓冲区。
3. 暴露 `setConsoleLogSink` 让调试模块把日志转发到远程 sink（如后端收集）。

`ConsoleLogPanel` 提供按模块、级别过滤、搜索、多选复制的能力，是桌面端无 DevTools 环境下的主要排障界面。

## 4. 约定与约束

| 约定 | 证据来源 | 说明 |
|---|---|---|
| 在线音乐相关异常统一使用 `OnlineProviderError` | `types/onlineMusic.ts`、`providerRegistry.ts`、`omni.ts`、`qqProvider.ts` | 错误码使用字面量联合，调用方通过 `error.code` 分支处理 |
| 同步 HTTP 异常统一使用 `SyncClientError` | `services/sync/syncClient.ts` | 携带 HTTP status，调用方可据此区分 401/404/5xx |
| 未注册 provider 视为不可用而非静默忽略 | `services/onlineMusic/providerRegistry.ts` | 直接抛 `OnlineProviderError('unavailable')` |
| 可选能力缺失返回空结果而非抛错 | `omni.ts`、`neteaseProvider.ts`、`kugouProvider.ts` | 通过 `?.` 与 `?? []` 实现优雅降级 |
| 渲染期异常不向上传播导致整页崩溃 | `components/shared/ErrorBoundary.tsx` | 每个需要隔离的组件树应包裹 `ErrorBoundary` |
| 所有 console 输出自动进入会话日志 | `utils/consoleLogBuffer.ts` | 模块需遵循 `[Prefix]` 命名约定以便过滤 |
| 未捕获异常与 Promise rejection 会被记录 | `utils/consoleLogBuffer.ts` | 通过 `window error` 与 `unhandledrejection` 监听 |
| 切换活跃账户时丢弃过期响应 | `services/onlineMusic/omni.ts` | 抛 `DOMException('AbortError')` 标记取消 |

## 5. 未发现的部分

- 没有统一的错误码常量文件或全局错误中间件。
- 没有 `try/catch` 集中化的 HTTP 拦截器（仅在 `syncClient.ts` 的 `requestJson` 中做了一次）。其他 provider 各自处理网络异常。
- 没有 `panic/recover` 概念（这是 JS/TS 项目）。
- 没有专门的错误报告 SDK；诊断依赖本地 `consoleLogBuffer` 与 `ConsoleLogPanel`。
