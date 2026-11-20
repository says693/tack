# 折页 FOLD

> **默认入口是引导式离线学习，并与完整阅读制卡工作台双向互通。** 连接自己的 AI（默认 DeepSeek）后，可选择 5 大内置专题或粘贴自己的学习笔记生成离线课程；也可随时切换至完整工作台，离线导入 Markdown/纯文本、划词建卡、分叉追问并执行间隔复习。

## 仓库与产品说明

- **演进关系**：本仓库沿用 `says693/tack` 的代码仓地址与提交历史，当前桌面应用产品名为 **折页 FOLD**（前端包名 `fold-study`，Tauri 标识 `com.fold.study`，Rust crate `fold`）。旧版 `tack` 代码保留在历史提交中，不与当前程序混装或自动迁移旧库。
- **平台范围**：当前主要针对 Windows 11（Tauri 2 + WebView2 + 中文 NSIS 安装包）设计与验证；macOS / Linux 尚未完成真机全流程验收。

---

## 核心产品流程：双模式互通

1. **引导式离线学习（Guided Study）**
   - **选科目与自定义资料**：支持关键词/子串检索 **5 个内置专题**（`物理 · 光的反射`、`数学 · 一元一次方程`、`Python · 控制流`、`网络 · HTTP 请求与响应`、`化学 · 氧化还原反应`），并支持切换**自定义资料**粘贴 40 字以上的笔记或课文片段直接生成课程。
   - **确认外发与生成**：明确展示资料出处、正文摘要与发送端点，用户确认后才发送请求；生成过程严格校验结构与逐句引用，失败不落半节课。
   - **离线学习与换课**：课程保存于本机 SQLite，断网或密钥失效仍可读讲解、作答、标记「想不起来」与自评排期；完成后可随时「学习新主题」或切换至完整工作台。
2. **完整阅读制卡工作台（Workbench）**
   - **阅读与逐字锚定**：导入 Markdown / 纯文本或外部片段，支持来源多版本（R1/R2…）；在阅读页划词可直接**「开分叉」**深入追问，或点击**「从选区建卡」**离线创建带 UTF-16 逐字锚定证据的草稿卡。
   - **主动回忆与严谨批改**：领题阶段隐藏参考答案；作答支持「想不起来」、草稿暂存与主动「改为自评」；AI 批改严格校验逐字证据引用；提出异议后将锁定直接确认，须重评或改用自评后才写入排期。
   - **概念级调度 `fold-sm2e-1`**：评级 `0–3`（忘记 / 困难 / 正确 / 轻松），默认每日 `10` 个新概念、`50` 个到期复习；遗忘重学（`relearning`）概念严格保留到期校验，不会混作新卡；跳过空白题自动避开原地死循环。

---

## 界面与凭据安全

- **界面形态**：支持胶囊、面板、全景三栏、独立复习、设置与引导模式；全应用统一采用「纸色 / 墨色」双主题，切页保留用户工作上下文。
- **凭据存储与备份脱敏**：
  - Guided 向导与工作台模型设置共享安全凭据存储（Windows 优先使用系统凭据管理器；受限会话或非 Windows 环境自动回退至独立加密隔离的本地保险库文件 `.fold-vault`，不写入 `fold.db`）。
  - 数据库备份（`.db`）在生成快照后会自动清空所有敏感配置键，并执行 `PRAGMA integrity_check`；TSV / JSON 导出亦不包含任何密钥。

---

## 技术栈

- **桌面端**：Tauri 2（Rust）+ React 19 + TypeScript + Vite 8 + Zustand
- **数据层**：`rusqlite` / SQLite（WAL）+ 自研简化 SM-2 调度器 `fold-sm2e-1`
- **模型接入**：引导模式默认连接 DeepSeek；工作台设置支持 DeepSeek、OpenAI、OpenRouter、Ollama 及任意 OpenAI 兼容 `/chat/completions` 端点
- **浏览器预览**：`src/mock/guided-study.ts` 与 `src/mock/backend.ts` 提供零外发的 `localStorage` 模拟后端（界面明确标注演示/模拟，仅用于前端开发与界面回归）

---

## 快速开始与测试

前置依赖：Node.js 24 LTS、Rust stable、Windows 下需 WebView2 Runtime 与 Visual Studio C++ Build Tools。

```powershell
npm install
npm run tauri:dev
```

浏览器开发预览（不连接真实模型）：

```powershell
npm run dev
# 默认打开引导式学习预览：http://127.0.0.1:1420/
# 如需直接打开工作台预览：http://127.0.0.1:1420/?legacy=1
```

生产构建与测试验证：

```powershell
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
npm run test:e2e

# 桌面端产物构建
npm run tauri:build      # 裸 EXE：src-tauri/target/release/fold.exe
npm run tauri:installer  # 中文 NSIS 安装包：src-tauri/target/release/bundle/nsis/
```

可选真实模型端到端验收（默认忽略，需显式提供环境变量）：

```powershell
$env:FOLD_REAL_BASE_URL = 'https://your-endpoint/v1'
$env:FOLD_REAL_MODEL = 'your-model'
$env:FOLD_REAL_API_KEY = '...'

cargo test --manifest-path src-tauri/Cargo.toml real_model_end_to_end -- --ignored --nocapture
```

---

## 数据目录与环境变量

默认数据目录由 Tauri `app_data_dir` 决定，可通过 `FOLD_DATA_DIR` 覆盖：

```powershell
$env:FOLD_DATA_DIR = 'H:\path\to\fold-data'
```

目录包含 `fold.db`（WAL/SHM）与受保护的凭据保险库（如触发回退存储）。删除来源采用软删除归档，相关卡片自动暂停并保留历史复习记录。
