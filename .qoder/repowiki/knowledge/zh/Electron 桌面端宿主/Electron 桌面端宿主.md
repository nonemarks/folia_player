---
kind: external_dependency
name: Electron 桌面端宿主
slug: electron
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - electron/main.cjs
    - electron/preload.cjs
    - package.json
---

Folia 的桌面端基于 Electron（main: electron/main.cjs），提供 Windows/macOS/Linux 三平台打包，使用 electron-builder 生成 NSIS、Portable、dmg、deb、rpm 等产物。主进程通过 preload 暴露 IPC 给渲染进程，并内嵌 Whisper.cpp 对齐、壁纸模式辅助程序、系统锁屏控制等原生能力。开发时通过 npm run dev:electron 启动 Vite + Electron 联调。