const { spawn } = require('child_process');
const path = require('path');

const serverPath = 'C:/Program Files/Qoder/Qoder CN/resources/extensions/qoder.knowledge.center/cli/qoder-qmind/dist/qoder-qmind-mcp-server.cjs';
const notebookId = '01a066d9-5f85-74ec-991b-a54126154638';
const basePath = 'C:/Users/Nomarks/folia_player/.qoder/repowiki/zh/content';

// Get batch info from command line args
const batchIndex = parseInt(process.argv[2] || '0');
const batchSize = parseInt(process.argv[3] || '15');

// All files to import with their titles
const allFiles = [
  // 在线音乐集成 remaining - 网易云音乐集成
  { path: "在线音乐集成/网易云音乐集成/网易云音乐集成.md", title: "网易云音乐集成" },
  { path: "在线音乐集成/网易云音乐集成/认证与授权.md", title: "网易云音乐-认证与授权" },
  { path: "在线音乐集成/网易云音乐集成/推荐系统.md", title: "网易云音乐-推荐系统" },
  { path: "在线音乐集成/网易云音乐集成/播放与音源.md", title: "网易云音乐-播放与音源" },
  { path: "在线音乐集成/网易云音乐集成/数据修改.md", title: "网易云音乐-数据修改" },
  { path: "在线音乐集成/网易云音乐集成/歌词系统.md", title: "网易云音乐-歌词系统" },
  { path: "在线音乐集成/网易云音乐集成/目录浏览.md", title: "网易云音乐-目录浏览" },
  { path: "在线音乐集成/网易云音乐集成/音乐库管理.md", title: "网易云音乐-音乐库管理" },
  // 酷狗音乐集成
  { path: "在线音乐集成/酷狗音乐集成/酷狗音乐集成.md", title: "酷狗音乐集成" },
  { path: "在线音乐集成/酷狗音乐集成/API调用实现.md", title: "酷狗音乐-API调用实现" },
  { path: "在线音乐集成/酷狗音乐集成/数据标准化.md", title: "酷狗音乐-数据标准化" },
  { path: "在线音乐集成/酷狗音乐集成/特色功能.md", title: "酷狗音乐-特色功能" },
  { path: "在线音乐集成/酷狗音乐集成/用户认证.md", title: "酷狗音乐-用户认证" },
  // 搜索算法实现
  { path: "在线音乐集成/搜索算法实现/搜索算法实现.md", title: "搜索算法实现" },
  { path: "在线音乐集成/搜索算法实现/关键词处理.md", title: "搜索算法-关键词处理" },
  { path: "在线音乐集成/搜索算法实现/多提供商集成.md", title: "搜索算法-多提供商集成" },
  { path: "在线音乐集成/搜索算法实现/结果排序.md", title: "搜索算法-结果排序" },
  // 资源缓存策略
  { path: "在线音乐集成/资源缓存策略/资源缓存策略.md", title: "资源缓存策略" },
  { path: "在线音乐集成/资源缓存策略/元数据缓存.md", title: "资源缓存-元数据缓存" },
  { path: "在线音乐集成/资源缓存策略/媒体资源缓存.md", title: "资源缓存-媒体资源缓存" },
  { path: "在线音乐集成/资源缓存策略/缓存迁移机制.md", title: "资源缓存-缓存迁移机制" },
  { path: "在线音乐集成/资源缓存策略/缓存键生成算法.md", title: "资源缓存-缓存键生成算法" },
  // 歌词系统
  { path: "歌词系统/歌词系统.md", title: "歌词系统" },
  { path: "歌词系统/歌词格式支持.md", title: "歌词格式支持" },
  { path: "歌词系统/智能歌词匹配.md", title: "智能歌词匹配" },
  { path: "歌词系统/时间轴同步.md", title: "时间轴同步" },
  { path: "歌词系统/歌词编辑器.md", title: "歌词编辑器" },
  { path: "歌词系统/歌词处理与增强.md", title: "歌词处理与增强" },
  // 可视化系统
  { path: "可视化系统/可视化系统.md", title: "可视化系统" },
  { path: "可视化系统/渲染架构.md", title: "渲染架构" },
  { path: "可视化系统/内置可视化模式/内置可视化模式.md", title: "内置可视化模式" },
  { path: "可视化系统/内置可视化模式/Cappella情感动画模式.md", title: "Cappella情感动画模式" },
  { path: "可视化系统/内置可视化模式/Claddagh经典波形模式.md", title: "Claddagh经典波形模式" },
  { path: "可视化系统/内置可视化模式/Pendolo机械美学模式.md", title: "Pendolo机械美学模式" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/Diorama 3D粒子场景.md", title: "Diorama 3D粒子场景" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/几何体生成与渲染.md", title: "Diorama-几何体生成与渲染" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/场景管理与相机控制.md", title: "Diorama-场景管理与相机控制" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/时间轴序列器.md", title: "Diorama-时间轴序列器" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/歌词文本光栅化.md", title: "Diorama-歌词文本光栅化" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/粒子系统与物理模拟.md", title: "Diorama-粒子系统与物理模拟" },
  { path: "可视化系统/内置可视化模式/Diorama 3D粒子场景/调优配置系统.md", title: "Diorama-调优配置系统" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/Monet艺术化视觉效果.md", title: "Monet艺术化视觉效果" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/交互设计与用户体验.md", title: "Monet-交互设计与用户体验" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/歌词轨道展示.md", title: "Monet-歌词轨道展示" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/肖像图像处理.md", title: "Monet-肖像图像处理" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/核心架构与渲染管线/核心架构与渲染管线.md", title: "Monet-核心架构与渲染管线" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/核心架构与渲染管线/渲染管线架构.md", title: "Monet-渲染管线架构" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/核心架构与渲染管线/性能优化策略.md", title: "Monet-核心架构-性能优化策略" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/核心架构与渲染管线/调优系统.md", title: "Monet-核心架构-调优系统" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/背景效果系统/背景效果系统.md", title: "Monet-背景效果系统" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/背景效果系统/动态效果生成.md", title: "Monet-背景-动态效果生成" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/背景效果系统/多层渲染架构.md", title: "Monet-背景-多层渲染架构" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/背景效果系统/性能优化策略.md", title: "Monet-背景-性能优化策略" },
  { path: "可视化系统/内置可视化模式/Monet艺术化视觉效果/背景效果系统/音频可视化引擎.md", title: "Monet-背景-音频可视化引擎" },
  { path: "可视化系统/内置可视化模式/Sonnet电影叙事模式/Sonnet电影叙事模式.md", title: "Sonnet电影叙事模式" },
  { path: "可视化系统/内置可视化模式/Sonnet电影叙事模式/场景构建器系统.md", title: "Sonnet-场景构建器系统" },
  { path: "可视化系统/内置可视化模式/Sonnet电影叙事模式/程序化动画系统.md", title: "Sonnet-程序化动画系统" },
  { path: "可视化系统/内置可视化模式/Sonnet电影叙事模式/转场效果库.md", title: "Sonnet-转场效果库" },
  { path: "可视化系统/内置可视化模式/Sonnet电影叙事模式/运行时环境.md", title: "Sonnet-运行时环境" },
  { path: "可视化系统/性能优化.md", title: "可视化系统-性能优化" },
  { path: "可视化系统/音频到视觉映射.md", title: "音频到视觉映射" },
  { path: "可视化系统/自定义可视化开发/自定义可视化开发.md", title: "自定义可视化开发" },
  { path: "可视化系统/自定义可视化开发/可视化开发规范与接口.md", title: "可视化开发规范与接口" },
  { path: "可视化系统/自定义可视化开发/可视化注册与配置系统.md", title: "可视化注册与配置系统" },
  { path: "可视化系统/自定义可视化开发/完整开发示例教程.md", title: "完整开发示例教程" },
  { path: "可视化系统/自定义可视化开发/调优系统与调试工具.md", title: "可视化调优系统与调试工具" },
  // 音频效果系统
  { path: "音频效果系统/音频效果系统.md", title: "音频效果系统" },
  { path: "音频效果系统/效果链架构设计.md", title: "效果链架构设计" },
  { path: "音频效果系统/3D音频空间化处理.md", title: "3D音频空间化处理" },
  { path: "音频效果系统/自定义效果器开发.md", title: "自定义效果器开发" },
  { path: "音频效果系统/内置效果器详解/内置效果器详解.md", title: "内置效果器详解" },
  { path: "音频效果系统/内置效果器详解/噪音与混响效果.md", title: "噪音与混响效果" },
  { path: "音频效果系统/内置效果器详解/效果参数映射系统.md", title: "效果参数映射系统" },
  { path: "音频效果系统/内置效果器详解/饱和与失真效果.md", title: "饱和与失真效果" },
  { path: "音频效果系统/内置效果器详解/音频效果链架构/音频效果链架构.md", title: "内置效果器-音频效果链架构" },
  { path: "音频效果系统/内置效果器详解/音频效果链架构/效果链管理.md", title: "内置效果器-效果链管理" },
  { path: "音频效果系统/内置效果器详解/音频效果链架构/噪声效果分支.md", title: "内置效果器-噪声效果分支" },
  { path: "音频效果系统/内置效果器详解/音频效果链架构/混响效果分支.md", title: "内置效果器-混响效果分支" },
  { path: "音频效果系统/内置效果器详解/音频效果链架构/颤音效果分支.md", title: "内置效果器-颤音效果分支" },
  // 自动化混音
  { path: "自动化混音/自动化混音.md", title: "自动化混音" },
  { path: "自动化混音/音频信号分析.md", title: "音频信号分析" },
  { path: "自动化混音/混音算法.md", title: "混音算法" },
  { path: "自动化混音/分轨处理.md", title: "分轨处理" },
  { path: "自动化混音/实时处理.md", title: "自动化混音-实时处理" },
  { path: "自动化混音/AI决策系统.md", title: "AI决策系统" },
  // 主题系统
  { path: "主题系统/主题系统.md", title: "主题系统" },
  { path: "主题系统/主题架构设计.md", title: "主题架构设计" },
  { path: "主题系统/双主题模式.md", title: "双主题模式" },
  { path: "主题系统/主题开发指南.md", title: "主题开发指南" },
  { path: "主题系统/AI主题生成/AI主题生成.md", title: "AI主题生成" },
  { path: "主题系统/AI主题生成/AI提示词工程.md", title: "AI主题-AI提示词工程" },
  { path: "主题系统/AI主题生成/Gemini API集成.md", title: "AI主题-Gemini API集成" },
  { path: "主题系统/AI主题生成/主题后处理.md", title: "AI主题-主题后处理" },
  { path: "主题系统/AI主题生成/歌曲分析引擎.md", title: "AI主题-歌曲分析引擎" },
  { path: "主题系统/主题定制工具/主题定制工具.md", title: "主题定制工具" },
  { path: "主题系统/主题定制工具/Theme Park界面.md", title: "Theme Park界面" },
  { path: "主题系统/主题定制工具/导入导出工具.md", title: "主题定制-导入导出工具" },
  { path: "主题系统/主题定制工具/草稿管理系统.md", title: "草稿管理系统" },
  { path: "主题系统/主题定制工具/预览渲染引擎.md", title: "预览渲染引擎" },
  { path: "主题系统/主题定制工具/颜色选择系统.md", title: "颜色选择系统" },
  // 桌面系统集成
  { path: "桌面系统集成/桌面系统集成.md", title: "桌面系统集成" },
  { path: "桌面系统集成/Electron架构设计/Electron架构设计.md", title: "Electron架构设计" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/IPC通信机制.md", title: "IPC通信机制" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/IPC通道注册与管理.md", title: "IPC-通道注册与管理" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/Lyric API通信接口.md", title: "IPC-Lyric API通信接口" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/安全模型与权限控制.md", title: "IPC-安全模型与权限控制" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/性能优化与监控.md", title: "IPC-性能优化与监控" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/Stage API通信接口/Stage API通信接口.md", title: "Stage API通信接口" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/Stage API通信接口/HTTP RESTful接口.md", title: "Stage API-HTTP RESTful接口" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/Stage API通信接口/WebSocket实时通信.md", title: "Stage API-WebSocket实时通信" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/Stage API通信接口/数据格式与协议.md", title: "Stage API-数据格式与协议" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/Stage API通信接口/认证与安全机制.md", title: "Stage API-认证与安全机制" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/远程控制通信/远程控制通信.md", title: "远程控制通信" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/远程控制通信/连接管理.md", title: "远程控制-连接管理" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/远程控制通信/消息路由.md", title: "远程控制-消息路由" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/远程控制通信/状态同步.md", title: "远程控制-状态同步" },
  { path: "桌面系统集成/Electron架构设计/IPC通信机制/远程控制通信/安全机制.md", title: "远程控制-安全机制" },
  { path: "桌面系统集成/Electron架构设计/主进程生命周期管理/主进程生命周期管理.md", title: "主进程生命周期管理" },
  { path: "桌面系统集成/Electron架构设计/主进程生命周期管理/应用启动流程.md", title: "应用启动流程" },
  { path: "桌面系统集成/Electron架构设计/主进程生命周期管理/窗口管理系统.md", title: "主进程-窗口管理系统" },
  { path: "桌面系统集成/Electron架构设计/主进程生命周期管理/系统托盘集成.md", title: "系统托盘集成" },
  { path: "桌面系统集成/Electron架构设计/主进程生命周期管理/进程生命周期事件.md", title: "进程生命周期事件" },
  { path: "桌面系统集成/Electron架构设计/安全模型设计/安全模型设计.md", title: "安全模型设计" },
  { path: "桌面系统集成/Electron架构设计/安全模型设计/沙箱隔离机制.md", title: "安全模型-沙箱隔离机制" },
  { path: "桌面系统集成/Electron架构设计/安全模型设计/用户数据保护.md", title: "安全模型-用户数据保护" },
  { path: "桌面系统集成/Electron架构设计/安全模型设计/第三方集成安全.md", title: "安全模型-第三方集成安全" },
  { path: "桌面系统集成/Electron架构设计/安全模型设计/网络安全策略.md", title: "安全模型-网络安全策略" },
  { path: "桌面系统集成/Electron架构设计/安全模型设计/自定义协议安全.md", title: "安全模型-自定义协议安全" },
  { path: "桌面系统集成/Electron架构设计/窗口管理系统/窗口管理系统.md", title: "窗口管理系统-概述" },
  { path: "桌面系统集成/Electron架构设计/窗口管理系统/主窗口生命周期管理.md", title: "主窗口生命周期管理" },
  { path: "桌面系统集成/Electron架构设计/窗口管理系统/壁纸模式窗口.md", title: "壁纸模式窗口" },
  { path: "桌面系统集成/Electron架构设计/窗口管理系统/窗口状态持久化.md", title: "窗口状态持久化" },
  { path: "桌面系统集成/Electron架构设计/窗口管理系统/视频导出窗口.md", title: "视频导出窗口" },
  { path: "桌面系统集成/Electron架构设计/窗口管理系统/远程窗口管理.md", title: "远程窗口管理" },
  { path: "桌面系统集成/Electron架构设计/跨平台兼容性/跨平台兼容性.md", title: "Electron-跨平台兼容性" },
  { path: "桌面系统集成/Electron架构设计/跨平台兼容性/Linux平台适配.md", title: "Electron-Linux平台适配" },
  { path: "桌面系统集成/Electron架构设计/跨平台兼容性/Windows平台适配.md", title: "Electron-Windows平台适配" },
  { path: "桌面系统集成/Electron架构设计/跨平台兼容性/macOS平台适配.md", title: "Electron-macOS平台适配" },
  { path: "桌面系统集成/Electron架构设计/跨平台兼容性/跨平台工具函数.md", title: "跨平台工具函数" },
  { path: "桌面系统集成/Stage API接口/Stage API接口.md", title: "Stage API接口" },
  { path: "桌面系统集成/Stage API接口/OBS集成接口.md", title: "OBS集成接口" },
  { path: "桌面系统集成/Stage API接口/WebSocket实时通信.md", title: "Stage API-WebSocket实时通信" },
  { path: "桌面系统集成/Stage API接口/认证与安全机制.md", title: "Stage API-认证与安全" },
  { path: "桌面系统集成/Stage API接口/外部控制接口/外部控制接口.md", title: "外部控制接口" },
  { path: "桌面系统集成/Stage API接口/外部控制接口/播放控制API.md", title: "外部控制-播放控制API" },
  { path: "桌面系统集成/Stage API接口/外部控制接口/队列管理API.md", title: "外部控制-队列管理API" },
  { path: "桌面系统集成/Stage API接口/外部控制接口/认证与安全.md", title: "外部控制-认证与安全" },
  { path: "桌面系统集成/Stage API接口/外部控制接口/WebSocket实时通信.md", title: "外部控制-WebSocket实时通信" },
  { path: "桌面系统集成/媒体系统集成/媒体系统集成.md", title: "媒体系统集成" },
  { path: "桌面系统集成/媒体系统集成/Discord Rich Presence集成.md", title: "Discord Rich Presence集成" },
  { path: "桌面系统集成/媒体系统集成/媒体会话API集成.md", title: "媒体会话API集成" },
  { path: "桌面系统集成/媒体系统集成/窗口播放交接.md", title: "窗口播放交接" },
  { path: "桌面系统集成/媒体系统集成/语音输入暂停.md", title: "语音输入暂停" },
  { path: "桌面系统集成/跨平台兼容处理/跨平台兼容处理.md", title: "跨平台兼容处理" },
  { path: "桌面系统集成/跨平台兼容处理/Linux平台特定实现.md", title: "跨平台-Linux平台特定实现" },
  { path: "桌面系统集成/跨平台兼容处理/Windows平台特定实现.md", title: "跨平台-Windows平台特定实现" },
  { path: "桌面系统集成/跨平台兼容处理/macOS平台特定实现.md", title: "跨平台-macOS平台特定实现" },
  { path: "桌面系统集成/跨平台兼容处理/原生模块集成.md", title: "原生模块集成" },
  { path: "桌面系统集成/跨平台兼容处理/图形渲染处理.md", title: "图形渲染处理" },
  { path: "桌面系统集成/跨平台兼容处理/文件系统访问.md", title: "文件系统访问" },
  // 模组系统
  { path: "模组系统/模组系统.md", title: "模组系统" },
  { path: "模组系统/模组API参考.md", title: "模组API参考" },
  { path: "模组系统/模组开发指南.md", title: "模组开发指南" },
  { path: "模组系统/模组安全机制.md", title: "模组安全机制" },
  { path: "模组系统/模组架构设计/模组架构设计.md", title: "模组架构设计" },
  { path: "模组系统/模组架构设计/API接口设计.md", title: "模组架构-API接口设计" },
  { path: "模组系统/模组架构设计/安全机制设计.md", title: "模组架构-安全机制设计" },
  { path: "模组系统/模组架构设计/核心架构原理.md", title: "模组架构-核心架构原理" },
  { path: "模组系统/模组架构设计/生命周期管理.md", title: "模组架构-生命周期管理" },
  { path: "模组系统/内置模组详解/内置模组详解.md", title: "内置模组详解" },
  { path: "模组系统/内置模组详解/Aurora极光可视化器.md", title: "Aurora极光可视化器" },
  { path: "模组系统/内置模组详解/K3Panel深度调优面板.md", title: "K3Panel深度调优面板" },
  { path: "模组系统/内置模组详解/Whisper歌词对齐工具.md", title: "Whisper歌词对齐工具" },
  { path: "模组系统/内置模组详解/透明视频导出模组.md", title: "透明视频导出模组" },
  // 同步服务
  { path: "同步服务/同步服务.md", title: "同步服务" },
  { path: "同步服务/安全机制.md", title: "同步服务-安全机制" },
  { path: "同步服务/数据类型定义.md", title: "数据类型定义" },
  { path: "同步服务/同步架构设计/同步架构设计.md", title: "同步架构设计" },
  { path: "同步服务/同步架构设计/API接口设计.md", title: "同步架构-API接口设计" },
  { path: "同步服务/同步架构设计/同步协议.md", title: "同步协议" },
  { path: "同步服务/同步架构设计/性能优化.md", title: "同步架构-性能优化" },
  { path: "同步服务/同步架构设计/数据库设计.md", title: "同步架构-数据库设计" },
  { path: "同步服务/部署指南/部署指南.md", title: "同步服务-部署指南" },
  { path: "同步服务/部署指南/Cloudflare Workers Serverless部署.md", title: "Cloudflare Workers Serverless部署" },
  { path: "同步服务/部署指南/Docker容器化部署.md", title: "同步服务-Docker容器化部署" },
  { path: "同步服务/部署指南/Node.js自托管部署.md", title: "Node.js自托管部署" },
  { path: "同步服务/部署指南/环境变量与安全配置.md", title: "环境变量与安全配置" },
  // 安装与部署
  { path: "安装与部署/安装与部署.md", title: "安装与部署" },
  { path: "安装与部署/桌面版安装.md", title: "桌面版安装" },
  { path: "安装与部署/Docker部署.md", title: "安装与部署-Docker部署" },
  { path: "安装与部署/QQ音乐配置.md", title: "QQ音乐配置" },
  { path: "安装与部署/Web版部署/Web版部署.md", title: "Web版部署" },
  { path: "安装与部署/Web版部署/Cloudflare部署.md", title: "Web版-Cloudflare部署" },
  { path: "安装与部署/Web版部署/Docker部署.md", title: "Web版-Docker部署" },
  { path: "安装与部署/Web版部署/Vercel部署.md", title: "Vercel部署" },
  // 开发指南
  { path: "开发指南/开发指南.md", title: "开发指南" },
  { path: "开发指南/开发环境搭建.md", title: "开发环境搭建" },
  { path: "开发指南/代码规范与风格.md", title: "代码规范与风格" },
  { path: "开发指南/调试工具与技巧.md", title: "调试工具与技巧" },
  { path: "开发指南/贡献指南.md", title: "贡献指南" },
  { path: "开发指南/构建与部署/构建与部署.md", title: "构建与部署" },
  { path: "开发指南/构建与部署/CI_CD流水线.md", title: "CI/CD流水线" },
  { path: "开发指南/构建与部署/Docker容器化部署.md", title: "开发指南-Docker容器化部署" },
  { path: "开发指南/构建与部署/Electron应用打包.md", title: "Electron应用打包" },
  { path: "开发指南/构建与部署/Web版本构建.md", title: "Web版本构建" },
  { path: "开发指南/构建与部署/版本管理策略.md", title: "版本管理策略" },
  { path: "开发指南/测试策略与实践/测试策略与实践.md", title: "测试策略与实践" },
  { path: "开发指南/测试策略与实践/单元测试.md", title: "单元测试" },
  { path: "开发指南/测试策略与实践/集成测试.md", title: "集成测试" },
  { path: "开发指南/测试策略与实践/UI测试.md", title: "UI测试" },
  { path: "开发指南/测试策略与实践/测试工具与辅助.md", title: "测试工具与辅助" },
  // 故障排除
  { path: "故障排除/故障排除.md", title: "故障排除" },
  { path: "故障排除/常见问题.md", title: "常见问题" },
  { path: "故障排除/日志分析.md", title: "日志分析" },
  { path: "故障排除/性能优化.md", title: "故障排除-性能优化" },
  { path: "故障排除/平台特定问题.md", title: "平台特定问题" },
  // API参考
  { path: "API参考/API参考.md", title: "API参考" },
  { path: "API参考/Lyric API.md", title: "Lyric API" },
  { path: "API参考/Remote Control API.md", title: "Remote Control API" },
  { path: "API参考/Stage API.md", title: "Stage API" },
  { path: "API参考/Web Lyric Source.md", title: "Web Lyric Source" },
];

// Select batch
const start = batchIndex * batchSize;
const batch = allFiles.slice(start, start + batchSize);

if (batch.length === 0) {
  console.log('BATCH_EMPTY');
  process.exit(0);
}

console.log(`Processing batch ${batchIndex}: files ${start}-${start + batch.length - 1} of ${allFiles.length}`);

const proc = spawn('node', [serverPath], { 
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});
let buffer = '';
let idCounter = 0;
const pending = new Map();
let successCount = 0;
let failCount = 0;
const results = [];

function send(msg) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function parseResponses() {
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.id !== undefined && pending.has(r.id)) {
        const resolve = pending.get(r.id);
        pending.delete(r.id);
        resolve(r);
      }
    } catch (e) {}
  }
}

proc.stdout.on('data', (d) => {
  buffer += d.toString();
  parseResponses();
});

proc.stderr.on('data', (d) => {
  // Ignore stderr
});

function callTool(name, params, id) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: params }, id });
  });
}

async function run() {
  // Initialize with Qoder request context extension
  const initId = ++idCounter;
  pending.set(initId, () => {});
  send({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'agent', version: '1.0' },
      extensions: {
        'com.qoder/request-context-v1': {
          sessionId: 'b5897638-1f6a-48b3-a018-4f195b991131',
          workspaceDirectory: 'C:\\Users\\Nomarks\\folia_player'
        },
        'com.qoder/auth-state-v1': {}
      }
    },
    id: initId
  });
  
  await new Promise(r => setTimeout(r, 1500));
  
  // Send initialized notification
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  
  await new Promise(r => setTimeout(r, 500));
  
  // Process each file in this batch
  for (const file of batch) {
    const id = ++idCounter;
    const filePath = basePath + '/' + file.path;
    const result = await callTool('add_source', {
      notebookId,
      source: { filePath, kind: 'file', title: file.title }
    }, id);
    
    const isError = result.error || (result.result && result.result.isError);
    if (isError) {
      failCount++;
      const errMsg = result.error ? result.error.message : JSON.stringify(result.result);
      console.error(`FAIL: ${file.title} - ${errMsg}`);
      results.push({ title: file.title, status: 'FAIL', error: errMsg });
    } else {
      successCount++;
      console.log(`OK: ${file.title}`);
      results.push({ title: file.title, status: 'OK' });
    }
    
    // Small delay between calls to avoid overwhelming
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\nBATCH_RESULT: ${successCount} succeeded, ${failCount} failed out of ${batch.length}`);
  
  proc.kill();
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal error:', e);
  proc.kill();
  process.exit(2);
});

// Timeout safety
setTimeout(() => {
  console.log('TIMEOUT - killing process');
  console.log(`PARTIAL_RESULT: ${successCount} succeeded, ${failCount} failed out of ${batch.length}`);
  proc.kill();
  process.exit(3);
}, 120000);
