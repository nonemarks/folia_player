---
kind: external_dependency
name: Docker Compose 全栈部署
slug: docker-compose-stack
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - deploy/docker/README.md
    - deploy/docker/compose.yaml
---

仓库提供完整的 Docker Compose 堆栈，包含 gateway（Nginx 反向代理）、backend（Folia Web API）、netease-api、kugou-api、qq-api 和独立的 sync-server。对外仅暴露 gateway 的 18080 端口与 sync-server 的 13000 端口，其余服务通过 Docker 网络互访。默认镜像命名空间为 papersman，通过 FOLIA_IMAGE_NAMESPACE 与 FOLIA_STACK_VERSION 控制。HTTPS 安全上下文是本地音乐目录导入、Service Worker/PWA、OPFS、音频设备枚举等能力的必要条件。