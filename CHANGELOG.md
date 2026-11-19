# Changelog

## 折页 FOLD - 开发中，未发布

- 沿用 `says693/tack` 仓库和旧提交历史，当前实现改为 Tauri / Rust / React，不再使用 Python sidecar。
- 默认进入连接自己的 AI、输入科目、核对可信资料、生成本地课程的引导式学习流程。
- 保留原有工作台数据与入口；不将旧版真实模型验收视作新向导验收。
- CI 改为 Windows 前端构建、单元测试、浏览器回归与 Rust 测试；移除自动发布工作流。
- 本次仅同步源码、文档与测试，不创建 Release、版本标签或上传安装包。

## 旧版 tack 历史

以下条目描述旧版实现，不代表折页当前功能或验收状态。

## 0.1.1 — 2026-11-16

- Replaced demo business state with a bundled transactional Python sidecar.
- Separated answer keys and review history; normalized due timestamps and interval caps.
- Explicit online/offline modes; strict model results; no silent error fallback.
- Versioned document chunks and idempotent mutations preserve data and sources.
- Fixed draft loss, save retry, final-card completion, modal shortcuts and HUD menus.
- Added dependency locks, regression tests, frozen-executable tests and CI gates.

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [Unreleased]

### 已就位（G0，待实机验证）

- 三窗形态：HUD 胶囊 180×40、主窗 440×712、锚点窗 272×440（440 ÷ 1.618）。
- 长按 450ms 选中 → 命名 → 锚点窗只读钉子；钉住/丢弃。
- 主窗每日下行流：作答、启发式批改、进度、科目切换。
- Python 内核：SQLite 一科一库、FTS5 trigram 中文检索、pypdf 导入、说话式调度（封顶 60 天）。
- 离线优先：无 API Key 时出题/批改/调度全走本地启发式，单测与 CLI 端到端已通过。
- 模型层：任何 OpenAI 兼容端点（openai / litellm 双路径），Key 只读环境变量或系统凭据管理器。
- 右键菜单：卡片 / 科目 / 空白 / HUD / 锚点，键盘导航。
- 快捷键：过卡全键盘、锚点全键盘、全局 Ctrl+Shift+T。
- 安装包：NSIS 当前用户安装、中文界面、定制头图与侧边图；GitHub Actions 三平台构建。

## [0.1.0] - 2026-11-16

首个骨架版本（开发中）。
