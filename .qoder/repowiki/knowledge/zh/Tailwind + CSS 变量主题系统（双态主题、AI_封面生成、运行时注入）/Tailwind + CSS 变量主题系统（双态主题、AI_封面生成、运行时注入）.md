---
kind: frontend_style
name: Tailwind + CSS 变量主题系统（双态主题、AI/封面生成、运行时注入）
category: frontend_style
scope:
    - '**'
source_files:
    - src/index.css
    - tailwind.config.js
    - postcss.config.js
    - src/services/baseThemes.ts
    - src/types.ts
    - src/hooks/useThemeController.ts
    - src/hooks/themeControllerState.ts
    - src/services/themePreferences.ts
    - src/services/themeSanitizer.ts
    - src/utils/builtinTheme/generateBuiltinDualTheme.ts
    - src/components/app/AppShell.tsx
    - src/components/shared/ThemedDialog.tsx
---

## 1. 样式体系概览

Folia Player 的前端样式由 **Tailwind CSS v4**（通过 `@tailwindcss/postcss` 插件）驱动，入口为 `src/index.css`，使用 `@import "tailwindcss"` 引入框架。项目没有自定义 Tailwind 主题扩展（`tailwind.config.js` 中 `theme.extend` 为空），所有布局与原子类均直接使用 Tailwind 内置语义；全局样式集中在 `index.css`，组件级样式以内联 className 为主，极少单独写 `.css` 文件。

## 2. 设计令牌与主题模型

主题数据采用纯 JSON 对象模型，定义在 `src/types.ts`：
- `Theme`：包含 `backgroundColor / primaryColor / accentColor / secondaryColor / fontStyle / animationIntensity / wordColors / lyricsIcons / provider` 等字段。
- `DualTheme`：`light` 与 `dark` 两个 `Theme` 的配对。
- `ThemeMode`：`default | ai | custom` 三种来源模式。

内置默认主题在 `src/services/baseThemes.ts` 中以 `DEFAULT_THEME`（午夜墨染，zinc 系）、`DAYLIGHT_THEME`（日光素白，stone 系）和 `BASE_DUAL_THEME` 导出，供非 UI 消费者（如 OBS URL 构建器）直接引用。

## 3. 主题运行时架构

核心控制器是 `src/hooks/useThemeController.ts`，它维护 `theme / aiTheme / customTheme / legacyTheme / bgMode` 等状态，并通过 `bgMode` 在三者之间切换：
- `default`：回退到 `baseThemes.ts` 中的预设。
- `ai`：来自 AI 歌词分析或封面调色板生成的 `DualTheme`。
- `custom`：用户手动编辑保存的主题。

主题来源优先级由 `hooks/themeControllerState.ts` 中的 `buildThemeSourceModel` 与 `resolveBgModeTheme` 计算，最终输出一个当前生效的 `Theme` 对象。

主题持久化与偏好开关（动画强度、自动切换、自动生成、上次应用指针）集中在 `src/services/themePreferences.ts`，全部写入 `localStorage`，并提供类型安全的读写函数。

## 4. 主题生成管线

### 4.1 封面调色板生成（无 AI 路径）
`src/utils/builtinTheme/generateBuiltinDualTheme.ts` 从封面提取色板（`coverPaletteAnalysis`），按明暗模式分别生成背景、主色、强调色、次色，并调用 `adjustLightnessForContrast` 确保对比度达到 `PRIMARY_MIN_CONTRAST / ACCENT_MIN_CONTRAST / SECONDARY_MIN_CONTRAST` 阈值；名称与描述从 `themeNameTable.ts` / `themeDescriptionTable.ts` 随机选取。

### 4.2 AI 生成路径
`useThemeController.generateAITheme` 根据 `themeGenerationSource`（`ai` 或 `cover`）选择：若为 `cover`，走上述封面路径；若为 `ai`，调用 `services/gemini.ts` 的 `generateThemeFromLyrics` 传入歌词文本或纯音乐标题，返回 `DualTheme` 后经 `themeSanitizer.ts` 清洗。

### 4.3 安全清洗
`src/services/themeSanitizer.ts` 用正则 `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$` 校验 HEX 颜色，将非法值回退到 fallback 主题；同时规范化 `fontStyle`、`animationIntensity`、`wordColors`、`lyricsIcons`，保证任意来源主题都能安全渲染。

## 5. 样式注入方式

主题不通过 CSS 变量名（如 `--bg-color`）暴露给 Tailwind，而是由 `useThemeController` 把 `Theme` 对象转为 React `style` 属性，再透传到根容器（例如 `AppShell.tsx` 的 `appStyle` prop）。因此组件通过 `style={{ backgroundColor, color }}` 等方式直接消费主题，而不是依赖 CSS 变量。

`index.css` 中定义的 CSS 变量（`--scrollbar-track / --scrollbar-thumb / --scrollbar-thumb-hover`）仅用于滚动条样式；`theme-polaroid-card`、`theme-glass-panel` 等 class 使用了 `var(--bg-color)` / `var(--text-primary)` 这类变量，但它们在项目中未被广泛使用，属于预留的通用样式类。

## 6. 全局样式约定

- 字体：`Inter` 作为正文，`Folia Noto Serif SC` 通过 `@font-face` 从 CDN 加载，支持 400/500 两档字重。
- 滚动条：统一 8px 宽，轨道 `#18181b`，滑块 `#3f3f46`，hover `#52525b`；提供 `hide-scrollbar`、`mobile-hide-scrollbar`、`visualizer-overlay-scrollbar` 三类覆盖。
- 点击穿透：`html[data-click-through='active']` 下除 `.click-through-interactive` 外全部 `pointer-events: none`。
- 无障碍：`prefers-reduced-motion: reduce` 下关闭进度条呼吸动画与网格面板提示动画。
- 窗口圆角：Electron 模式下通过 `AppShell` 动态设置 `borderRadius` 与 `boxShadow`，最大化时取消。

## 7. 组件库与第三方依赖

- 样式：Tailwind CSS v4 + PostCSS + Autoprefixer。
- 动效：`framer-motion` 用于弹窗、标题栏遮罩等过渡。
- 图标：`lucide-react`。
- 未使用 CSS-in-JS 方案（如 styled-components/emotion），也未使用 CSS Modules；组件样式以 Tailwind className + 少量内联 `style` 为主。

## 8. 关键约束与约定

- 主题对象必须经 `sanitizeTheme` / `sanitizeDualTheme` 后才能进入状态，防止脏数据污染 UI。
- `animationIntensity` 只能为 `calm | normal | chaotic`，超出值会被回退。
- 主题持久化键名集中管理于 `themePreferences.ts`，新增偏好需在此注册读写函数。
- 默认主题不可变，用户修改会创建独立的 `Custom` 来源主题。
- 所有 HEX 颜色必须为 3 或 6 位十六进制字符串，否则被丢弃。
- 主题生成失败时自动降级到封面调色板路径，保证始终有可用主题。

## 9. 相关文件清单

- `src/index.css` — 全局样式、字体、滚动条、动画、点击穿透
- `tailwind.config.js` — Tailwind 扫描范围配置
- `postcss.config.js` — PostCSS 插件链
- `src/services/baseThemes.ts` — 内置默认双态主题
- `src/types.ts` — `Theme` / `DualTheme` / `ThemeMode` 类型定义
- `src/hooks/useThemeController.ts` — 主题状态机与 AI/封面生成流程
- `src/hooks/themeControllerState.ts` — 主题来源模型与模式解析
- `src/services/themePreferences.ts` — 本地存储的偏好与开关
- `src/services/themeSanitizer.ts` — 主题数据清洗与回退
- `src/utils/builtinTheme/generateBuiltinDualTheme.ts` — 封面调色板→主题算法
- `src/components/app/AppShell.tsx` — 根容器样式注入点
- `src/components/shared/ThemedDialog.tsx` — 基于 isDaylight 的轻量主题化示例