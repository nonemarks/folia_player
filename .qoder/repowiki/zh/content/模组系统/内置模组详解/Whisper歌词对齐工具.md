# Whisper歌词对齐工具

<cite>
**本文引用的文件**
- [electron/whisperAlign.cjs](file://electron/whisperAlign.cjs)
- [src/services/whisperAlignService.ts](file://src/services/whisperAlignService.ts)
- [src/utils/lyrics/wordAligner.ts](file://src/utils/lyrics/wordAligner.ts)
- [src/utils/lyrics/detectLyricLanguage.ts](file://src/utils/lyrics/detectLyricLanguage.ts)
- [electron/analysis/sidecar.cjs](file://electron/analysis/sidecar.cjs)
- [mods/whisper-align/index.cjs](file://mods/whisper-align/index.cjs)
- [mods/whisper-align/mod.json](file://mods/whisper-align/mod.json)
- [src/components/shared/WhisperSettingsPanel.tsx](file://src/components/shared/WhisperSettingsPanel.tsx)
- [src/components/shared/WhisperEnvCheck.tsx](file://src/components/shared/WhisperEnvCheck.tsx)
- [src/components/shared/WhisperAlignButton.tsx](file://src/components/shared/WhisperAlignButton.tsx)
- [src/components/shared/WhisperVocalSeparationToggle.tsx](file://src/components/shared/WhisperVocalSeparationToggle.tsx)
- [src/components/shared/WhisperModelSelector.tsx](file://src/components/shared/WhisperModelSelector.tsx)
- [src/stores/useSettingsUiStore.ts](file://src/stores/useSettingsUiStore.ts)
</cite>

## 更新摘要
**所做更改**
- 新增 GPU 加速人声分离功能，支持 CUDA EP 自动回退 CPU
- 添加 large-v3 模型支持，提升中文等多语言转录准确率
- 实现歌词文本语言自动推断，解决 CJK 歌曲误判为英语的问题
- 增强模组扩展系统，支持独立设置模态框和命令面板集成
- 优化内存管理和错误处理机制，避免 OOM 问题

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量与调优](#性能考量与调优)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录：API与扩展](#附录api与扩展)

## 简介
本工具基于 OpenAI Whisper（通过 whisper.cpp 的命令行工具）实现"自动歌词时间轴对齐"，将歌曲音频转录为带词级时间戳的结果，并与用户提供的行级歌词进行全局序列对齐，最终输出逐字/逐词时间轴，用于 Folia 播放器的歌词渲染。系统包含以下关键能力：
- 音频处理流程：本地文件直读、在线音频缓存/抓取、格式转换（WAV）。
- 语音识别集成：调用 whisper-cli 执行转录，解析 JSON 输出并标准化为内部结果。
- 时间戳生成算法：基于全局序列对齐、幻觉清理、插值与强制校准，产出稳定且可回退的时间轴。
- 多语言支持：自动检测或指定语言；模型选择 tiny/base/small/medium/large-v3/large-v3-turbo。
- **新增 GPU 加速人声分离**：在转录前使用 htdemucs 分离人声，提升 CJK 歌曲转录准确率。
- **增强语言检测**：基于歌词文本自动推断中日韩语言，解决英文默认误判问题。
- 错误处理与重试：环境检查、下载失败重试、进程异常诊断、取消与清理。
- 批量处理能力：服务层按歌曲逐个处理，具备缓存命中避免重复计算。
- 配置选项：模型、语言、是否启用强制校准、人声分离开关等。
- API 与扩展：Electron IPC 命令、模组命令、前端 Hook 与服务接口。

## 项目结构
围绕 Whisper 对齐的关键代码分布在 Electron 主进程、前端服务、对齐算法与 UI 面板中：
- 主进程核心：负责 whisper-cli 发现、模型管理、音频准备、转录执行、JSON 解析、任务取消。
- 前端服务：编排获取音频、调用 IPC 转录、运行对齐算法、缓存结果、暴露进度与取消。
- 对齐算法：将 Whisper 词级时间戳与用户歌词文本进行全局序列匹配，后处理得到最终时间轴。
- **新增人声分离模块**：通过 sidecar.cjs 调用 htdemucs 进行 GPU/CPU 分离。
- 模组封装：提供命令式入口，便于在 Folia 插件体系内使用。
- UI 面板：环境检查、模型下载、FFmpeg 安装、手动/自动对齐按钮与进度展示。

```mermaid
graph TB
UI["UI 面板<br/>WhisperSettingsPanel / EnvCheck"] --> Service["前端服务<br/>whisperAlignService.ts"]
Service --> IPC["Electron IPC<br/>whisperAlign.cjs"]
IPC --> CLI["whisper-cli<br/>外部进程"]
IPC --> Sidecar["htdemucs 分离<br/>sidecar.cjs"]
Sidecar --> Python["Python Runtime<br/>CUDA EP/CPU"]
CLI --> JSON["JSON 输出<br/>segments/words"]
Service --> Align["对齐算法<br/>wordAligner.ts"]
Service --> LangDetect["语言检测<br/>detectLyricLanguage.ts"]
Align --> Output["LyricData<br/>逐字时间轴"]
```

**图表来源**
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [electron/whisperAlign.cjs:282-537](file://electron/whisperAlign.cjs#L282-L537)
- [electron/analysis/sidecar.cjs:93-128](file://electron/analysis/sidecar.cjs#L93-L128)
- [src/utils/lyrics/wordAligner.ts:241-549](file://src/utils/lyrics/wordAligner.ts#L241-L549)

章节来源
- [electron/whisperAlign.cjs:1-2148](file://electron/whisperAlign.cjs#L1-L2148)
- [src/services/whisperAlignService.ts:1-761](file://src/services/whisperAlignService.ts#L1-L761)
- [src/utils/lyrics/wordAligner.ts:1-840](file://src/utils/lyrics/wordAligner.ts#L1-L840)
- [src/utils/lyrics/detectLyricLanguage.ts:1-62](file://src/utils/lyrics/detectLyricLanguage.ts#L1-L62)
- [electron/analysis/sidecar.cjs:1-129](file://electron/analysis/sidecar.cjs#L1-L129)
- [mods/whisper-align/index.cjs:1-409](file://mods/whisper-align/index.cjs#L1-L409)
- [mods/whisper-align/mod.json:1-11](file://mods/whisper-align/mod.json#L1-L11)
- [src/components/shared/WhisperSettingsPanel.tsx:1-265](file://src/components/shared/WhisperSettingsPanel.tsx#L1-L265)
- [src/components/shared/WhisperEnvCheck.tsx:1-613](file://src/components/shared/WhisperEnvCheck.tsx#L1-L613)
- [src/components/shared/WhisperAlignButton.tsx:58-86](file://src/components/shared/WhisperAlignButton.tsx#L58-L86)

## 核心组件
- 主进程模块（electron/whisperAlign.cjs）
  - 初始化与路径发现：查找 whisper-cli、ffmpeg、模型目录。
  - 模型管理：列出可用模型（含 large-v3）、下载模型（含镜像回退）、校验已下载模型。
  - **新增人声分离**：通过 sidecar.cjs 调用 htdemucs，支持 GPU CUDA EP 和 CPU 自动回退。
  - 转录执行：参数构建、子进程启动、进度解析、错误诊断、临时文件清理。
  - JSON 解析：兼容不同版本输出结构，提取 segments 与 words，统一为内部格式。
  - 任务控制：活跃任务 Map、取消机制（SIGTERM）。
- 前端服务（src/services/whisperAlignService.ts）
  - 可用性检查：CLI、模型、FFmpeg 状态聚合。
  - 音频源获取：本地路径、Electron 缓存、资源缓存、在线抓取（IPC 绕过 CORS）。
  - **新增语言检测**：基于歌词文本自动推断 CJK 语言，解决英文默认误判。
  - **新增人声分离控制**：传递 vocalSeparation 和 vocalSeparationGpu 选项。
  - 对齐编排：缓存键生成、跳过无需对齐、调用 IPC 转录、运行对齐算法、持久化缓存。
  - 进度与取消：订阅 IPC 事件、更新 job 状态、取消当前任务。
- 对齐算法（src/utils/lyrics/wordAligner.ts）
  - 全局序列对齐：LCS 动态规划 + opcodes，匹配用户歌词与 AI 词序列。
  - 后处理：幻觉清理、插值、强制校准、边界安全限制、平均分布可选。
  - 输出构造：按原词边界合并为 Word[]，标记 isWordByWord。
- **新增人声分离模块（electron/analysis/sidecar.cjs）**
  - Python 运行时管理：通过 resolveRuntime 找到 htdemucs Python 解释器。
  - GPU/CPU 切换：通过 HTDEMUCS_PROVIDER 环境变量控制 CUDA EP 或 CPU。
  - 内存安全：严格串行执行，避免与 whisper-cli 同时占用大量内存。
- 模组封装（mods/whisper-align/index.cjs）
  - 命令注册：环境检查、模型下载、CLI/FFmpeg 安装、转录、取消、状态查询、音频准备与抓取。
  - 生命周期：激活时加载核心、停用取消所有任务。
- UI 面板
  - 环境检查：可视化提示缺失项并提供一键安装/下载。
  - 设置面板：触发对齐、显示进度与错误信息。
  - 对齐按钮：最小可见时长保证用户体验。
  - **新增人声分离开关**：WhisperVocalSeparationToggle 提供主开关和 GPU 子开关。

章节来源
- [electron/whisperAlign.cjs:45-177](file://electron/whisperAlign.cjs#L45-L177)
- [electron/whisperAlign.cjs:282-537](file://electron/whisperAlign.cjs#L282-L537)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)
- [src/services/whisperAlignService.ts:161-332](file://src/services/whisperAlignService.ts#L161-L332)
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [src/services/whisperAlignService.ts:470-486](file://src/services/whisperAlignService.ts#L470-L486)
- [src/utils/lyrics/wordAligner.ts:241-549](file://src/utils/lyrics/wordAligner.ts#L241-L549)
- [src/utils/lyrics/detectLyricLanguage.ts:30-61](file://src/utils/lyrics/detectLyricLanguage.ts#L30-L61)
- [electron/analysis/sidecar.cjs:93-128](file://electron/analysis/sidecar.cjs#L93-L128)
- [mods/whisper-align/index.cjs:54-244](file://mods/whisper-align/index.cjs#L54-L244)
- [src/components/shared/WhisperVocalSeparationToggle.tsx:37-88](file://src/components/shared/WhisperVocalSeparationToggle.tsx#L37-L88)
- [src/components/shared/WhisperEnvCheck.tsx:92-176](file://src/components/shared/WhisperEnvCheck.tsx#L92-L176)
- [src/components/shared/WhisperSettingsPanel.tsx:54-87](file://src/components/shared/WhisperSettingsPanel.tsx#L54-L87)
- [src/components/shared/WhisperAlignButton.tsx:58-86](file://src/components/shared/WhisperAlignButton.tsx#L58-L86)

## 架构总览
整体数据流与控制流如下：
- 用户在 UI 触发对齐 → 前端服务判断是否需要对齐 → 尝试从缓存返回 → 否则获取音频 → **可选人声分离** → IPC 调用主进程转录 → 主进程执行 whisper-cli → 解析 JSON → 前端运行对齐算法 → 持久化缓存并返回结果。

```mermaid
sequenceDiagram
participant U as "用户"
participant UI as "UI 面板"
participant S as "前端服务"
participant E as "Electron IPC"
participant M as "主进程核心"
participant V as "人声分离"
participant C as "whisper-cli"
participant A as "对齐算法"
U->>UI : 点击"对齐"
UI->>S : alignLyricsWithWhisper(song, lyrics, options)
S->>S : 检查缓存/可用性
alt 有缓存
S-->>UI : 直接返回缓存结果
else 无缓存
S->>E : whisperAlignPrepareAudio / fetchAudio
E->>M : 准备音频/抓取音频
M-->>E : 返回音频路径或数据
opt 启用 vocalSeparation
S->>E : whisperAlignTranscribe(audioPath, {vocalSeparation, vocalSeparationGpu})
E->>M : transcribeAudio(...)
M->>V : separateVocals()
V-->>M : vocals.wav 或 null
end
M->>C : 启动子进程执行转录
C-->>M : stdout/stderr 进度与退出码
M->>M : 解析 JSON -> WhisperResult
M-->>E : 返回 segments/words
E-->>S : WhisperResult
S->>A : alignWhisperToLyrics(WhisperResult, lines, options)
A-->>S : LyricData(逐字时间轴)
S->>S : 保存缓存
S-->>UI : 完成并返回结果
end
```

**图表来源**
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [electron/whisperAlign.cjs:282-537](file://electron/whisperAlign.cjs#L282-L537)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)
- [src/utils/lyrics/wordAligner.ts:241-549](file://src/utils/lyrics/wordAligner.ts#L241-L549)

## 详细组件分析

### 主进程核心（whisperAlign.cjs）
- 初始化与路径发现
  - 支持 userData 目录、打包资源目录、PATH 三种方式定位 whisper-cli。
  - 同步与异步探测 ffmpeg，提升兼容性。
- 模型管理
  - 列出 tiny/base/small/medium/**large-v3/large-v3-turbo**，支持下载与镜像回退（hf-mirror.com），断点续传与超时保护。
- **新增人声分离功能**
  - 在转录前先调用 separateVocals()，使用 htdemucs 分离人声。
  - 支持 GPU CUDA EP 和 CPU 自动回退，严格串行避免 OOM。
  - 分离失败不影响对齐流程，自动回退到混音转录。
- 转录执行
  - 非 WAV 自动转 WAV（需要 ffmpeg），构建参数包括模型、语言、线程数、输出 JSON。
  - 子进程 stdout/stderr 解析进度，close 事件处理退出码与错误诊断。
  - 输出文件清理与临时 WAV 清理。
- JSON 解析
  - 兼容 v1/v2 结构与多种嵌套键，提取 segments 与 words，统一为内部格式。
  - 零时序片段诊断与警告。
- 任务控制
  - activeJobs Map 记录进程与取消标志，cancelTranscription 发送 SIGTERM。

```mermaid
flowchart TD
Start(["开始转录"]) --> CheckFile{"音频文件存在?"}
CheckFile --> |否| ErrFile["抛出文件不存在错误"]
CheckFile --> |是| VocalSep{"启用 vocalSeparation?"}
VocalSep --> |是| Separate["调用 separateVocals()"]
VocalSep --> |否| Convert{"需要转WAV?"}
Separate --> SepSuccess{"分离成功?"}
SepSuccess --> |是| UseVocals["使用 vocals.wav"]
SepSuccess --> |否| Convert
Convert --> |是| ToWav["调用ffmpeg转WAV"]
Convert --> |否| BuildArgs["构建whisper-cli参数"]
UseVocals --> BuildArgs
ToWav --> BuildArgs
BuildArgs --> Spawn["spawn whisper-cli"]
Spawn --> Progress["解析stdout/stderr进度"]
Progress --> Close{"进程关闭"}
Close --> |非0| DiagErr["收集stderr并诊断错误"]
Close --> |0| Parse["读取JSON输出并解析"]
Parse --> Segments{"是否有segments?"}
Segments --> |否| NoSeg["抛出无有效片段错误"]
Segments --> |是| Clean["清理临时文件"]
Clean --> Done(["返回WhisperResult"])
```

**图表来源**
- [electron/whisperAlign.cjs:282-537](file://electron/whisperAlign.cjs#L282-L537)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)
- [electron/whisperAlign.cjs:543-684](file://electron/whisperAlign.cjs#L543-L684)

章节来源
- [electron/whisperAlign.cjs:45-177](file://electron/whisperAlign.cjs#L45-L177)
- [electron/whisperAlign.cjs:282-537](file://electron/whisperAlign.cjs#L282-L537)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)
- [electron/whisperAlign.cjs:543-684](file://electron/whisperAlign.cjs#L543-L684)
- [electron/whisperAlign.cjs:690-750](file://electron/whisperAlign.cjs#L690-L750)

### 前端服务（whisperAlignService.ts）
- 可用性检查
  - 聚合 CLI、模型、FFmpeg 状态，返回结构化 reason 供 UI 提示。
- 音频源获取
  - 优先 Electron 缓存 → 资源缓存 → omni.getAudioSource（质量策略）→ IPC 抓取（绕过 CORS）→ 浏览器 fetch 回退。
  - 失败时记录详细 failures 数组，便于 UI 展示具体原因。
- **新增语言检测与人声分离控制**
  - 在 alignLyricsWithWhisper 中解析生效语言，优先级：调用方显式 language > 用户设置 whisperAlignLanguage（非 auto）> 歌词文字自动推断。
  - 传递 vocalSeparation 和 vocalSeparationGpu 选项给主进程。
- 对齐编排
  - 缓存键由 songId + model + 歌词指纹构成，命中则直接返回。
  - 步骤：准备音频 → **可选人声分离** → 转录 → 对齐 → 缓存 → 返回。
  - 支持语言与模型选项，默认 base。
- 进度与取消
  - 订阅 onWhisperAlignProgress，映射到 job.status（preparing/transcribing/aligning/completed）。
  - cancelAlignment 通过 IPC 取消主进程任务。

```mermaid
sequenceDiagram
participant S as "前端服务"
participant C as "缓存"
participant E as "Electron IPC"
participant O as "在线源"
S->>C : getFromCache(key)
alt 命中
C-->>S : 返回缓存LyricData
else 未命中
S->>E : whisperAlignPrepareAudio / fetchAudio
E-->>S : 音频路径或数据
opt 启用 vocalSeparation
S->>E : whisperAlignTranscribe(audioPath, {model, language, jobId, vocalSeparation, vocalSeparationGpu})
else 不启用 vocalSeparation
S->>E : whisperAlignTranscribe(audioPath, {model, language, jobId})
end
E-->>S : WhisperResult
S->>S : alignWhisperToLyrics(...)
S->>C : saveToCache(key, result)
S-->>S : 返回LyricData
end
```

**图表来源**
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [src/services/whisperAlignService.ts:470-486](file://src/services/whisperAlignService.ts#L470-L486)

章节来源
- [src/services/whisperAlignService.ts:161-332](file://src/services/whisperAlignService.ts#L161-L332)
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [src/services/whisperAlignService.ts:470-486](file://src/services/whisperAlignService.ts#L470-L486)

### 对齐算法（wordAligner.ts）
- 输入
  - WhisperResult（segments 与 words），用户歌词行（Line[]，含 startTime/endTime/fullText）。
- 核心步骤
  - 提取 AI 词池（优先 word-level，否则按字符粒度估算）。
  - 对用户歌词进行分词（CJK 单字、英文单词）。
  - 全局序列对齐（LCS DP + opcodes），回填时间戳。
  - 后处理：幻觉清理（大间隔丢弃）、插值（平滑或右吸附）、强制校准（偏移阈值校正）、边界安全限制（不重叠下一行）、平均分布（可选）。
  - 输出：按原词边界合并为 Word[]，标记 isWordByWord。
- 复杂度
  - LCS DP 时间复杂度 O(mn)，m/n 为用户与 AI 词序列长度；空间优化可通过滚动数组降低内存占用（当前实现为二维表）。
- 可调参数
  - MIN_DURATION、HALLUCINATION_GAP、CALIBRATION_THRESHOLD、SMOOTH_INTERP_GAP。
  - 选项 enableForceCalibration、enableAvgDistribution、calibrationThreshold。

```mermaid
flowchart TD
A["输入: WhisperResult + 歌词行"] --> B["提取AI词池"]
B --> C["用户歌词分词"]
C --> D["全局序列对齐(LCS)"]
D --> E["回填时间戳"]
E --> F{"幻觉清理"}
F --> G["插值(平滑/吸附)"]
G --> H{"强制校准"}
H --> I["边界安全检查"]
I --> J{"平均分布(可选)"}
J --> K["构建Word[]并输出"]
```

**图表来源**
- [src/utils/lyrics/wordAligner.ts:241-549](file://src/utils/lyrics/wordAligner.ts#L241-L549)
- [src/utils/lyrics/wordAligner.ts:555-800](file://src/utils/lyrics/wordAligner.ts#L555-L800)

章节来源
- [src/utils/lyrics/wordAligner.ts:1-840](file://src/utils/lyrics/wordAligner.ts#L1-L840)

### 新增人声分离模块（sidecar.cjs）
- Python 运行时管理
  - 通过 resolveRuntime 找到 htdemucs Python 解释器。
  - 支持 asar 打包环境的脚本路径重写。
- GPU/CPU 切换
  - 通过 HTDEMUCS_PROVIDER 环境变量控制 CUDA EP 或 CPU。
  - 默认 'cpu'，whisperAlign 传入 'cuda'。
- 内存安全
  - 严格串行执行，避免与 whisper-cli 同时占用大量内存。
  - 超时保护：默认 120s，根据音频时长动态调整。
- 音频格式处理
  - 解码为 44100Hz 立体声 f32le 格式。
  - 分离后编码为 16kHz 单声道 s16 WAV。

章节来源
- [electron/analysis/sidecar.cjs:1-129](file://electron/analysis/sidecar.cjs#L1-L129)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)

### 新增语言检测（detectLyricLanguage.ts）
- CJK 语言推断
  - 假名（ひらがな/カタカナ）出现 → 'ja'（日文独有，中文歌词不含）。
  - 谚文（한글）出现 → 'ko'。
  - CJK 汉字达到阈值（>=4 字）且无假名 → 'zh'。
  - 其余（纯拉丁/无法判定）→ undefined，交 whisper auto-detect。
- 解决中文歌被当英语转录的问题
  - 基于歌词文本比音频开头更可靠的信号。
  - 避免 instrumental intro 误导语言检测。

章节来源
- [src/utils/lyrics/detectLyricLanguage.ts:1-62](file://src/utils/lyrics/detectLyricLanguage.ts#L1-L62)
- [src/services/whisperAlignService.ts:470-486](file://src/services/whisperAlignService.ts#L470-L486)

### 模组封装（mods/whisper-align/index.cjs）
- 命令注册
  - check-status、list-models、download-model、install-cli、install-ffmpeg、transcribe、cancel-transcription、get-transcription-status、prepare-audio、fetch-audio。
- 状态跟踪
  - activeJobStatus Map 维护各任务状态与进度；下载/安装进度对象。
- 生命周期
  - 激活时加载 electron/whisperAlign.cjs 并初始化；停用取消所有任务。

章节来源
- [mods/whisper-align/index.cjs:54-244](file://mods/whisper-align/index.cjs#L54-L244)
- [mods/whisper-align/index.cjs:250-409](file://mods/whisper-align/index.cjs#L250-L409)
- [mods/whisper-align/mod.json:1-11](file://mods/whisper-align/mod.json#L1-L11)

### UI 面板与环境检查
- WhisperEnvCheck
  - 检查 CLI、模型、FFmpeg 状态，提供一键安装/下载，支持平台差异与超时保护。
- WhisperSettingsPanel
  - 触发对齐、显示进度与错误，支持最小可见时长保证体验。
- WhisperAlignButton
  - 简化调用，统一进度标签与状态映射。
- **新增人声分离开关**
  - WhisperVocalSeparationToggle 提供主开关和 GPU 子开关。
  - 实时显示 htdemucs 就绪状态，引导用户下载依赖。
  - GPU 子开关仅在分离开启时出现。

章节来源
- [src/components/shared/WhisperEnvCheck.tsx:92-176](file://src/components/shared/WhisperEnvCheck.tsx#L92-L176)
- [src/components/shared/WhisperSettingsPanel.tsx:54-87](file://src/components/shared/WhisperSettingsPanel.tsx#L54-L87)
- [src/components/shared/WhisperAlignButton.tsx:58-86](file://src/components/shared/WhisperAlignButton.tsx#L58-L86)
- [src/components/shared/WhisperVocalSeparationToggle.tsx:37-88](file://src/components/shared/WhisperVocalSeparationToggle.tsx#L37-L88)

## 依赖关系分析
- 组件耦合
  - 前端服务依赖 Electron IPC 与在线音乐资源缓存；主进程依赖 whisper-cli 与 ffmpeg。
  - 对齐算法独立于运行时环境，仅依赖输入数据结构。
  - **新增依赖**：sidecar.cjs 依赖 Python 运行时和 htdemucs.onnx 模型。
- 外部依赖
  - whisper.cpp 预编译二进制（whisper-cli），通过 GitHub Releases 或 PATH 获取。
  - FFmpeg 用于音频格式转换（WAV）。
  - HuggingFace 模型仓库（含 hf-mirror 镜像）。
  - **新增依赖**：onnxruntime-gpu（CUDA 12.8+）用于 GPU 加速人声分离。
- 潜在循环依赖
  - 前端服务与主进程通过 IPC 解耦；模组封装仅作为命令入口，不形成循环。
- 接口契约
  - IPC 方法：whisperAlignGetStatus、whisperAlignDownloadModel、whisperAlignInstallCli、whisperAlignInstallFfmpeg、whisperAlignTranscribe、whisperAlignPrepareAudio、whisperAlignFetchAudio、onWhisperAlignProgress、whisperAlignCancel。
  - 模组命令：check-status、list-models、download-model、install-cli、install-ffmpeg、transcribe、cancel-transcription、get-transcription-status、prepare-audio、fetch-audio。

```mermaid
graph LR
UI["UI 面板"] --> SVC["前端服务"]
SVC --> IPC["Electron IPC"]
IPC --> CORE["主进程核心"]
CORE --> CLI["whisper-cli"]
CORE --> FFMPEG["ffmpeg"]
CORE --> SIDECAR["htdemucs 分离"]
SIDECAR --> PYTHON["Python Runtime"]
SVC --> ALG["对齐算法"]
SVC --> LANG["语言检测"]
```

**图表来源**
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [electron/whisperAlign.cjs:282-537](file://electron/whisperAlign.cjs#L282-L537)
- [electron/analysis/sidecar.cjs:93-128](file://electron/analysis/sidecar.cjs#L93-L128)
- [mods/whisper-align/index.cjs:250-409](file://mods/whisper-align/index.cjs#L250-L409)

章节来源
- [src/services/whisperAlignService.ts:161-332](file://src/services/whisperAlignService.ts#L161-L332)
- [electron/whisperAlign.cjs:45-177](file://electron/whisperAlign.cjs#L45-L177)
- [mods/whisper-align/index.cjs:250-409](file://mods/whisper-align/index.cjs#L250-L409)

## 性能考量与调优
- 模型选择
  - tiny/base/small/medium/**large-v3/large-v3-turbo**：small 推荐平衡速度与精度；medium 更高精度但耗时更长；**large-v3 中文等多语言准确率最高**。
- 线程数
  - 根据 CPU 核心数设置线程（上限 8），提升并行度。
- 音频格式
  - 优先 WAV（16kHz、16-bit、mono）以获得最佳兼容性；非 WAV 需 ffmpeg 转换。
- 缓存策略
  - 基于 songId + model + 歌词指纹的缓存键，避免重复转录与对齐。
- 对齐算法
  - 启用强制校准可减少偏移误差；平均分布可在必要时均匀分配时间。
- 批处理
  - 服务层按歌曲串行处理，建议在前端队列化多个歌曲的对齐请求，避免阻塞 UI。
- 网络与下载
  - 模型下载支持 hf-mirror 回退；设置合理超时与重试。
- **新增人声分离性能优化**
  - GPU CUDA EP 加速分离过程，CPU 自动回退。
  - 严格串行执行，避免与 whisper-cli 同时占用大量内存导致 OOM。
  - 超时保护：根据音频时长动态调整超时时间。
- **新增语言检测优化**
  - 基于歌词文本的语言推断比音频开头更可靠，减少误判。
  - CJK 语言检测阈值避免偶发字符干扰。

[本节为通用指导，不直接分析具体文件]

## 故障排查指南
- 常见错误与诊断
  - 音频文件为空或损坏：检查文件大小与格式，确保 ffmpeg 可用以转换。
  - 不支持的音频格式：安装 ffmpeg 或使用 WAV。
  - whisper-cli 未找到：安装 CLI 或加入 PATH。
  - 无有效片段：检查音频内容、模型、语言设置；查看 stderr 诊断信息。
  - 网络下载失败：切换镜像或检查网络连接。
  - **新增人声分离故障**：检查 htdemucs.onnx 和 Python runtime 是否安装，GPU CUDA/cuDNN 是否正确配置。
- 取消与清理
  - 使用 cancelAlignment 取消主进程任务；临时文件会在进程关闭时清理。
- 环境检查
  - 使用 WhisperEnvCheck 可视化检查 CLI、模型、FFmpeg 状态，并按提示安装。
  - **新增检查**：WhisperVocalSeparationToggle 显示 htdemucs 就绪状态和依赖缺失提示。
- **新增语言检测问题**
  - 如果语言推断不准确，可以手动设置 whisperAlignLanguage 覆盖自动推断。
  - 检查歌词文本是否包含足够的 CJK 字符用于推断。

章节来源
- [electron/whisperAlign.cjs:444-537](file://electron/whisperAlign.cjs#L444-L537)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)
- [src/services/whisperAlignService.ts:571-578](file://src/services/whisperAlignService.ts#L571-L578)
- [src/components/shared/WhisperEnvCheck.tsx:320-445](file://src/components/shared/WhisperEnvCheck.tsx#L320-L445)
- [src/components/shared/WhisperVocalSeparationToggle.tsx:64-70](file://src/components/shared/WhisperVocalSeparationToggle.tsx#L64-L70)

## 结论
该工具通过主进程与前端服务的协作，结合 whisper-cli 的强大多语言语音识别能力与自研的全局序列对齐算法，实现了稳定、可配置的歌词时间轴对齐。系统具备良好的错误诊断、缓存与可扩展性，适用于 Folia 播放器的歌词增强场景。**新增的 GPU 加速人声分离功能和 enhanced 模型支持进一步提升了 CJK 歌曲的转录准确率，而智能语言检测解决了常见的英文默认误判问题。**

[本节为总结，不直接分析具体文件]

## 附录：API与扩展

### 配置选项详解
- 模型：tiny/base/small/medium/**large-v3/large-v3-turbo**（small 推荐，**large-v3 中文最准**）。
- 语言：留空自动检测，或传入 ISO 语言代码；**新增 whisperAlignLanguage 设置项支持手动覆盖**。
- 对齐选项：
  - enableForceCalibration：启用强制校准（默认 true）。
  - enableAvgDistribution：启用平均分布（默认 false）。
  - calibrationThreshold：校准阈值（秒，默认 1.5）。
- 线程数：根据 CPU 核心数自动设置（上限 8）。
- **新增人声分离选项**：
  - whisperAlignVocalSeparation：主开关，启用后转录前先做人声分离。
  - whisperAlignVocalSeparationGpu：GPU 加速开关，需要 CUDA 12.8+/cuDNN 9.x。
  - 分离失败自动回退混音转录，不阻断对齐流程。

章节来源
- [electron/whisperAlign.cjs:282-369](file://electron/whisperAlign.cjs#L282-L369)
- [electron/whisperAlign.cjs:32-41](file://electron/whisperAlign.cjs#L32-L41)
- [src/utils/lyrics/wordAligner.ts:223-249](file://src/utils/lyrics/wordAligner.ts#L223-L249)
- [src/stores/useSettingsUiStore.ts:1516-1519](file://src/stores/useSettingsUiStore.ts#L1516-L1519)

### 性能调优建议
- 选择合适的模型与线程数。
- 确保 ffmpeg 可用以提升格式兼容性。
- 利用缓存减少重复计算。
- 对长音频考虑分段处理（需自行扩展）。
- **新增人声分离调优**：
  - 启用 GPU 加速可显著提升分离速度，但需要系统 CUDA/cuDNN 支持。
  - 分离失败会自动回退 CPU，不影响对齐流程。
  - 严格串行执行避免内存溢出。
- **新增语言检测调优**：
  - 对于复杂混合语言歌曲，建议手动设置 whisperAlignLanguage。
  - 确保歌词文本包含足够的 CJK 字符用于准确推断。

[本节为通用指导，不直接分析具体文件]

### 常见问题解决方案
- 无法检测到 whisper-cli：安装 CLI 或加入 PATH。
- 音频格式不支持：安装 ffmpeg 并转换为 WAV。
- 下载模型失败：切换 hf-mirror 或检查网络。
- 无有效片段：检查音频内容与模型设置，查看诊断信息。
- **新增人声分离问题**：
  - 检查 htdemucs.onnx 和 Python runtime 是否已下载。
  - 确认系统安装了正确的 CUDA 12.8+ 和 cuDNN 9.x。
  - 分离失败会自动回退混音转录，不影响基本功能。
- **新增语言检测问题**：
  - 如果自动推断不准确，设置 whisperAlignLanguage 为具体语言代码。
  - 检查歌词文本是否包含足够的目标语言字符。

章节来源
- [electron/whisperAlign.cjs:444-537](file://electron/whisperAlign.cjs#L444-L537)
- [electron/whisperAlign.cjs:1149-1235](file://electron/whisperAlign.cjs#L1149-L1235)
- [src/components/shared/WhisperEnvCheck.tsx:355-445](file://src/components/shared/WhisperEnvCheck.tsx#L355-L445)
- [src/components/shared/WhisperVocalSeparationToggle.tsx:64-70](file://src/components/shared/WhisperVocalSeparationToggle.tsx#L64-L70)

### API 调用示例
- 前端服务
  - alignLyricsWithWhisper(song, lyrics, { model, language, onProgress })
  - autoAlignIfNeeded(song, lyrics, { enabled, model, language, onProgress })
  - getWhisperAvailabilityDetail()
  - downloadWhisperModel(modelName, onProgress)
  - installWhisperCli(onProgress)
  - installFfmpeg(onProgress)
- 模组命令
  - check-status、list-models、download-model、install-cli、install-ffmpeg、transcribe、cancel-transcription、get-transcription-status、prepare-audio、fetch-audio
- **新增人声分离 API**
  - whisperAlignTranscribe(audioPath, { model, language, jobId, vocalSeparation, vocalSeparationGpu })
  - vocalSeparated 字段指示是否实际使用了人声分离。

章节来源
- [src/services/whisperAlignService.ts:161-332](file://src/services/whisperAlignService.ts#L161-L332)
- [src/services/whisperAlignService.ts:370-557](file://src/services/whisperAlignService.ts#L370-L557)
- [src/services/whisperAlignService.ts:616-622](file://src/services/whisperAlignService.ts#L616-L622)
- [mods/whisper-align/index.cjs:250-409](file://mods/whisper-align/index.cjs#L250-L409)

### 自定义对齐算法的扩展方法
- 替换对齐逻辑：修改 wordAligner.ts 中的 alignWhisperToLyrics 函数，保留输入输出接口。
- 调整参数：通过 WordAlignerOptions 调整校准阈值、是否启用平均分布等。
- 新增后处理：在序列对齐后插入自定义步骤（如语义重排、噪声过滤）。
- 集成到服务：在服务层调用新的对齐函数，并保持缓存键一致以避免失效。
- **新增人声分离扩展**：
  - 可以通过修改 sidecar.cjs 支持其他分离模型或算法。
  - 支持自定义 provider 参数控制 GPU/CPU 行为。
  - 分离失败自动回退机制确保系统稳定性。

章节来源
- [src/utils/lyrics/wordAligner.ts:241-549](file://src/utils/lyrics/wordAligner.ts#L241-L549)
- [src/services/whisperAlignService.ts:529-543](file://src/services/whisperAlignService.ts#L529-L543)
- [electron/analysis/sidecar.cjs:93-128](file://electron/analysis/sidecar.cjs#L93-L128)