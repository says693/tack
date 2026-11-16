# tack

常驻桌面的知识钉板。随手选中一段文字 → 钉成一张卡 → 每天被温和地提醒复习 → 答错时被告知错在哪。

> 工作名。中文名候选：图钉 / 钉板 / 知钉。

## 形态

- **HUD 胶囊**（180×40）常驻屏幕边缘，不抢焦点。
- **主窗**（440×712）每日下行流：今天要复习的卡，一张一张过。
- **锚点窗**（272×440，440÷1.618 黄金比例）长按选中文字后弹出，只读钉子：一句话提炼 + 原文对照，`[X 丢弃]` / `[PIN 钉住]`。

## 目录

```
tack/
  src-tauri/        Tauri 2 外壳（Rust，多窗、置顶、托盘、HUD 定位）
  ui/               三窗前端（原生 HTML/CSS/JS，无构建步骤）
  core/             Python 内核（SQLite FTS5、切分、出题、批改、调度）
  data/             一科一库（git 忽略，零密钥）
  docs/             决策记录、信源清单、安全披露
  scripts/          Windows 一键脚本
```

## 快速开始（Windows）

```powershell
# 1. 环境体检（缺什么它会告诉你）
powershell -ExecutionPolicy Bypass -File .\check-env.ps1

# 2. 一键安装（npm 依赖、Cargo 依赖、Python 虚拟环境）
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1

# 3. 开发运行
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1

# 4. 出安装包（当前用户安装，免管理员）
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

推一个 `v0.1.0` 的 tag，GitHub Actions 会出三平台安装包并挂到草稿 Release。步骤见 [docs/RELEASE.md](docs/RELEASE.md)。

## 状态

G0 骨架完成。内核单测与 CLI 端到端已在 Linux 通过（Python 3.10 / SQLite 3.37）；Tauri 外壳与安装器待 Windows 真机编译验证。路线与验收标准见 [docs/G0-CHECKLIST.md](docs/G0-CHECKLIST.md)。

只想先看界面：直接用浏览器打开 `ui/preview.html`，三窗并排预览，无需 Tauri。

## 右键与快捷键

三窗都有自己的右键菜单：卡片（钉住 / 今晚再看 / 跳过 / 放下）、科目标签（带勾选态）、HUD（置顶 / 回右下角 / 退出）、锚点（复制 / 改名 / 钉住 / 丢弃）。菜单每行标着键位。

主窗过卡不碰鼠标：`Space` 提示、`Enter` 交卷、`N` 下一张、`S` 跳过、`P` 钉住、`L` 排今晚、`C` 复制、`Ctrl+Tab` 切科目、`?` 键位表。全局 `Ctrl+Shift+T` 任何程序前都能唤出主窗。完整说明见 [docs/MENUS-KEYS.md](docs/MENUS-KEYS.md)。

## 内核（可单独使用）

```powershell
cd core
python -m tack_core.cli init demo          # 建 demo 库
python -m tack_core.cli ingest demo .\某本书.pdf
python -m tack_core.cli search demo "光合作用"
python -m tack_core.cli quiz demo           # 出题并作答（无 API Key 时走启发式，也能跑通）
python -m tack_core.cli due demo            # 今天该复习的卡
```

## 模型接入

任何 OpenAI 兼容端点都可以：在 `core/tack.local.json` 里写 `base_url` 和 `model`，Key 只进系统钥匙串或环境变量：

```json
{
  "llm": {
    "base_url": "https://api.tianxuncloud.xyz/v1",
    "model": "deepseek-chat"
  }
}
```

Key 的获取顺序：环境变量 `TACK_API_KEY`（或 `DEEPSEEK_API_KEY`）→ Windows 凭据管理器 `tack/llm`。**Key 永远不会写进 `data/`，也不会进 git。**

## 安全

- 学习笔记与文件按公开数据处理；**唯一要保护的是 API Key**。
- 前端 CSP 只允许本地资源与 IPC，不允许任何外联。
- 本地模式开关：不配 `base_url` 时全部走下线的启发式路径，完全不联网。
- README 与 [SECURITY.md](docs/SECURITY.md) 明确：界面上出现的正则脱敏只是辅助，不要把未脱敏的隐私内容喂给外部模型。

## 许可

MIT，见 [LICENSE](LICENSE)。本仓库不含任何 AGPL 依赖。
