---
kind: external_dependency
name: Discord 状态展示
slug: discord-rich-presence
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - package.json
    - electron/discordPresence.cjs
---

通过 @xhayper/discord-rpc 将当前播放歌曲信息同步到 Discord 客户端的 Rich Presence，由 Electron 主进程的 discordPresence.cjs 管理连接与状态更新。