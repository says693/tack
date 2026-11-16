# 交接：第一次在你机器上跑起来

沙盒不可用，所以本轮的 Rust 编译、Python 单测、Tauri 三窗都是**按规格写好、未实跑**。按下面顺序走，每一步出问题只要把报错原文贴回来。

## 1. 先看界面（零依赖，2 分钟）

浏览器双击打开 `ui/preview.html`。三窗并排，能点、能长按、能作答。这一步只验审美，不验 Tauri。

## 2. 跑内核（只需 Python）

```powershell
cd core
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m unittest discover -s tests -v
.\.venv\Scripts\python -m tack_core.cli seed demo
.\.venv\Scripts\python -m tack_core.cli quiz demo
```

`seed demo` 会建一个示例科目；`quiz demo` 出一道题，你作答，它批改、给下次复习时间。没有 API Key 也全程可用。

## 3. 跑外壳（需要 Rust + MSVC）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

首次编译 3–8 分钟。预期：右下角出现胶囊；单击开主窗；按住主窗文字 450ms 出锚点窗；关闭主窗自动隐藏。

## 4. 已知风险（编译阶段最可能报错的地方）

| 位置 | 风险 | 处理 |
|---|---|---|
| `build_tray` | Tauri 2 各小版本 `MenuItem` 签名微调 | 报错贴回来，按你的 Cargo.lock 版本改 |
| `pin_icon` | `Image::new_owned` 在某些版本签名不同 | 同上；也可直接删掉回落，强制用生成的图标 |
| 图标 | `setup.ps1` 首次会调 `make-icons.ps1` 生成 PNG/ICO | 若 System.Drawing 报错，改用 `npx tauri icon ui/icons/pin.svg` |
| 锚点窗透明/置顶 | Windows 下 `focus:false` + `alwaysOnTop` 组合需实机确认 | 不行就改成 `focus:true` 但 `skipTaskbar:true` |

## 5. 接模型（可选）

在 `core/` 下新建 `tack.local.json`：

```json
{ "llm": { "base_url": "https://api.tianxuncloud.xyz/v1", "model": "deepseek-chat" } }
```

再设环境变量 `TACK_API_KEY`（新 Key，旧的请吊销）。不配就是纯本地模式。

## 6. 下一步（G1）

主窗底栏接导入进度；`main.rs` 增加 `import_file` 命令调 Python 内核；扫描版 PDF 加视觉兜底。
