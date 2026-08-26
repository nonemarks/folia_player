<p align="center">
  <img src="/img/head2.png" alt="Folia" width="100%" />
</p>

<div align="center">

# Folia (修改版)

> **本仓库是 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的 Fork。**
> 以下「本 Fork 的更改」章节描述了相对于上游的独有修改，其余内容均来自原仓库。

Lyrics Reimagined // 辞曲新境

[![GitHub release](https://img.shields.io/github/v/release/nomarks114/folia_player?label=release)](https://github.com/nomarks114/folia_player/releases)
[![License](https://img.shields.io/github/license/nomarks114/folia_player)](https://github.com/nomarks114/folia_player/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/chthollyphile/folia-major)
[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)
<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-35-orange.svg?style=flat-square)](CONTRIBUTORS.md)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

[上游原仓库](https://github.com/chthollyphile/folia-major)
·
[获取方式](#获取方式)
·
[使用指南](https://folia-site.cielaniska.top/guide/)
·
[技术说明](docs/technical.md)

</div>

---

## 本 Fork 的更改

相对于上游 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)，本 Fork 包含以下独有修改：

### Sonnet 可视化增强

- **镜头过渡方向联动**：镜头退出方向跟随相机平移方向，使过渡更自然
- **Fragment-collage 概览提升**：在镜头最后 30% 加入平滑缩放效果
- **入场延迟支持**：新增 `entryDelay` 属性，支持逐字延迟入场
- **新增 shot 类型与布局**：扩展 `sonnetShotFlowLayouts`、新增 `sonnetShotMg` 模块
- **增强过渡动画**：扩展 `sonnetTransitions`，支持更多过渡效果
- **排版角色与布局增强**：扩展 `sonnetTypographyRoles` 和 `sonnetTypographyLayout`

### Windows 构建配置

- 新增 **Portable** 构建目标（x64），与 NSIS 安装包并存
- 图标格式从 `icon.png` 改为 `icon.ico`
- 新增 `build-electron.cjs`：绕过 SSL 证书验证的构建脚本（适用于企业代理环境）

### 其他

- **歌词代理白名单**：移除 `kgimg.com` 域名
- **开发快捷键**：调试叠加层快捷键从 `Alt+Shift+D` 改为 `Ctrl+Shift+D`
- **Fork 版本号**：`v0.6.21a`

---

以下内容来自原仓库 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)。

---

## 项目简介

Folia是一个以全屏沉浸式歌词播放为核心的在线音乐播放器，支持网易云、酷狗、Navidrome 和本地音乐库，通过智能歌词匹配，AI生成配色主题，以及多种全屏歌词动画为用户提供独特的听歌体验。

提供基于Electron的 windows/ macOS/ Linux 桌面端版本与基于 Node.js 的 Web 版本，支持多平台部署。

如果希望能够在移动设备上使用，或在浏览器上体验，可以选择[一键部署到 Vercel](https://folia-site.cielaniska.top/guide/deploy-vercel) 的 Web 版本，或自行部署到其他支持 Node.js 的平台。

## 展示

![visualizer](./img/visualizer.png)

### 演示视频

https://github.com/user-attachments/assets/af806cf1-f67f-4b88-b2e7-57db507e9e81

https://github.com/user-attachments/assets/fd27f4f0-64b9-4c57-8c3b-10df767f934b

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

### 部分主题预览

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Lumi 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>浮名</strong></td>
    <td align="center"><strong>流光</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Cad 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Pat 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>心象</strong></td>
    <td align="center"><strong>云阶</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="群唱 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>群唱</strong></td>
    <td align="center"><strong>倾诉</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-diorama.png" alt="镜台 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-pendolo.png" alt="时计 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>镜台</strong></td>
    <td align="center"><strong>时计</strong></td>
  </tr>
</table>

不同的歌词动画具有不同的排版氛围和可调参数，让全屏歌词拥有如同文字PV般的丰富视觉效果，同时又能兼顾响应式布局，自动适配不同窗口尺寸。

## 核心能力

| 模块 | 说明 |
| --- | --- |
| 在线搜索与播放 | 搜索歌曲、歌手或专辑后即可播放，并自动加载相关封面与歌词。 |
| 本地音乐支持 | 可导入本地音频文件，在本地安全保存索引信息，不上传文件内容。详细用法见 [本地音乐库管理](docs/local-library-management.md)。 |
| 智能歌词匹配 | 本地歌曲可自动匹配在线歌词与封面，也支持手动修正匹配结果。 |
| 本地歌词文件识别 | 自动加载同目录同名 `.lrc`、`.vtt`、`.ttml`、`.qrc`、`.yrc`、`.krc` 歌词文件，或歌词文件内嵌 LRC 歌词。适配 LDDC 生成的增强型逐字歌词格式。 |
| Now Playing 接入 | 支持通过本机 [Now Playing](https://github.com/Widdit/now-playing-service/) 服务接入外部播放器的歌曲、时间轴与歌词信息，并驱动 Folia 的舞台视图与全屏歌词渲染。 |
| AI 主题生成 | 基于歌曲情绪与歌词内容生成沉浸式背景与视觉参数。 |
| 多端体验 | 提供 Web 部署方式，同时支持桌面端打包分发。 |

## 获取方式

桌面版内置前后端运行环境，适合希望即装即用的用户。

### 一键部署

如果你希望快速上线 Web 版本，请阅读 [Vercel 一键部署指南](https://folia-site.cielaniska.top/guide/deploy-vercel) 来创建项目

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major) 

项目也支持一键部署到 Cloudflare，请参考 Vercel 的部署教程进行相应调整。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major)

Vercel 与 Cloudflare 上的 QQ 音乐不再需要额外部署一个常驻 API 实例：把 `VITE_QQ_API_BASE` 填成 `/api/qq`，再配一个 `QQ_SESSION_SECRET`（服务端密钥，**不加 `VITE_` 前缀**）即可。这种形态默认只支持微信扫码登录，且播放前必须先登录；Cloudflare 上可以再绑定一个 Durable Object，增加 QQ 扫码登录方式。完整步骤、平台差异和排错方法见 [QQ 音乐部署指南](docs/qq-music-deployment.md)。

自托管用户可以使用 [Docker Compose 全栈部署](deploy/docker/README.md)。本地音乐目录访问依赖可信 HTTPS 安全上下文，部署文档包含 NAS 反向代理和证书要求。

关于移动端：

目前推荐移动端用户部署 Web 版本/自托管版本之后，通过chrome for android / iOS Safari 创建 PWA应用（也就是将网页应用添加到桌面，Folia web版本支持安装为PWA应用）来使用。

有一定技术的用户可以使用 capacitor 将本项目的web版本打包成为可安装的安卓apk，具体方法可参考示范仓库：[chthollyphile/folia-sonnet](https://github.com/chthollyphile/folia-sonnet)

### 直接下载

- **Windows / macOS / Linux**: 最新版本的安装包请前往 [Releases 页面](https://github.com/chthollyphile/folia-major/releases/latest) 下载。
- **Arch Linux**: 可通过 AUR 获取 [folia-major-bin](https://aur.archlinux.org/packages/folia-major-bin)。
- **Flatpak**: 社区提供的第三方 flatpak，详情见 [Flatpark](https://flatpark.org/apps/top.izuna.foliamajor/)。



Linux 包、Wayland / Hyprland 遥控窗和桌面端细节见 [技术与开发说明](docs/technical.md)。

## 文档与开发

更完整的使用说明请访问 [Folia Guide](https://folia-site.cielaniska.top/guide/)。

部署、环境变量、本地开发、Stage API、常用脚本和技术栈见 [技术与开发说明](docs/technical.md)。

## Sync Server

Folia 提供了可选的官方同步服务端 `sync-server`，用于在多个设备之间同步外观设置与 AI 主题库。服务端由用户自行托管，适合希望跨设备同步配色主题的用户。

支持以下部署方式：

- **Cloudflare Workers / D1**：免服务器运维的 Serverless 部署，推荐使用。
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**：镜像与 Compose 入口见 [Docker 部署目录](deploy/docker/README.md)。
- **Node.js 自托管**：使用 SQLite，适合本地或不方便使用 Docker 的环境。

详细的环境变量、Token 配置与部署步骤请参阅 [Sync-Server 部署指南](https://folia-site.cielaniska.top/guide/deploy-sync)。部署完成后，在 Folia 的"存储设置"中填写服务端地址和 `SYNC_TOKEN` 即可启用同步。

## 本地音乐与匹配说明

Folia 会读取音频文件元数据、同目录歌词和封面，并可通过网易云、QQ 音乐或酷狗音乐补全歌曲信息。自动匹配按网易云、QQ、酷狗依次回退；匹配不准确时，可以手动选择候选、恢复首次导入的本地信息，或进一步合并、拆分艺术家与专辑实体。

完整的导入、重扫、匹配、实体编辑、歌单、缓存和故障排查说明见 [本地音乐库管理](docs/local-library-management.md)。

## Community

加入discord社群，共同交流，获得帮助

[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)

## 贡献者

感谢所有为本项目进行 Issue 提交、Bug 报告、想法建议、测试与代码编写的贡献者，均依据 all-contributors 规范进行统计

由于列表过长，贡献记录请见 [贡献者名单](CONTRIBUTORS.md)。

## 法律与免责声明

本项目在 AI 的广泛协助下开发，因此仍可能存在细微或不易察觉的问题。若给你带来不便，敬请理解。

本项目主要用于展示播放动效、界面设计与相关工程实现。应用中涉及的在线音乐流媒体、歌词、专辑封面及其他内容，其版权均归对应权利人所有。

本仓库及其源代码仅供个人学习、技术交流与非营利测试使用。请勿将其用于商业盈利用途。若因对在线资源的传播、加工或再分发而引发版权纠纷或其他责任，均由使用者自行承担，项目开发者不承担相关责任。

请始终尊重数字版权，并在条件允许时通过官方平台支持正版音乐。

## 致谢

特别感谢以下项目和资源：

- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [chenglou/pretext](https://github.com/chenglou/pretext)
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)
- [paper-design/shaders](https://github.com/paper-design/shaders)
- [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api)

本项目接入了 [Apple Music-like Lyrics TTML 逐词歌词库](https://github.com/amll-dev/amll-ttml-db) 以提供高质量的歌词文件，感谢此歌词库的作者和贡献者们。

## 许可证

本项目基于 `AGPL-3.0` 许可证开源。