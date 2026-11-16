# 环境配置：先把工具链装齐

沙盒没有 PowerShell 也没有 Windows 包管理器，所以这一层只能在你机器上执行。但我已经用 Linux 版 PowerShell 7.4 把每个脚本**真跑过**，修掉了运行时崩溃（`${env:ProgramFiles(x86)}` 在非 Windows 下为空导致 `Join-Path` 报错），并确认它们在你机器上会走 Windows 分支。

## 顺序（只有四步）

```powershell
cd H:\CC小姐

# 1. 体检：找出已装/便携版/缺失的六样东西
powershell -ExecutionPolicy Bypass -File .\check-env.ps1

# 2. 补齐缺的（用 winget，用户级安装，不污染系统）
powershell -ExecutionPolicy Bypass -File .\tack\scripts\setup-toolchain.ps1 -InstallMissing

# 3. 装项目依赖 + 跑内核单测
powershell -ExecutionPolicy Bypass -File .\tack\scripts\setup.ps1

# 4. 启动
powershell -ExecutionPolicy Bypass -File .\tack\scripts\dev.ps1
```

## 六样东西分别是什么、为什么

| 工具 | 用途 | 安装方式 |
|---|---|---|
| Node.js 20+ | 跑 `@tauri-apps/cli` | winget 用户级 |
| npm | 随 Node | 同上 |
| Rust stable | 编译 `src-tauri` | `Rustlang.Rustup`，默认 MSVC host |
| **MSVC Build Tools** | Rust 链接器（唯一可能需要 UAC 的一项） | VS 2022 Build Tools + C++ 工作负载 |
| Python 3.11+ | 内核、单测、图标生成 | winget 用户级 3.12 |
| WebView2 | Tauri 运行时 | Win11 自带；Win10 装 Evergreen |
| Git | 版本管理、发布 | winget 用户级 |

## 如果 winget 失败

`setup-toolchain.ps1` 会逐项打印失败原因，不会中途停。最常见的两种情况：

- **MSVC 需要管理员**：它会提示你开一个管理员 PowerShell，再跑一次它给的那条 `winget install ...`。
- **刚装完某些工具仍显示 MISSING**：那是当前会话的 PATH 没刷新。关掉窗口重开，再跑 `check-env.ps1`。脚本末尾也会自动从注册表重载一次 PATH。

## 你已有便携版的情况

`check-env.ps1` 会扫 `C:\tools`、`C:\dev`、`D:\tools`、`scoop`、`%LOCALAPPDATA%\Programs`、`%USERPROFILE%\.cargo\bin` 等位置，深度 4 层找 `node.exe` / `cargo.exe` / `python.exe` / `git.exe`。找到的会直接复用，并在报告中打印完整路径。你的那个"配好过其他软件"的文件夹如果不在上面清单里，把它加进脚本顶部的 `$roots` 数组即可。

## 验证点

跑完第 2 步再跑一次 `check-env.ps1`，六行全 OK 就对了。第 3 步会打印内核 6 项单测结果（应全 OK）。第 4 步右下角出现胶囊，单击开主窗。
