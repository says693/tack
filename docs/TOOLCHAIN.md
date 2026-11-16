# 构建工具链

开发机需安装 Node 24、Rust 1.98 MSVC、uv 0.12.17。Windows 还需 Visual Studio C++ Build Tools 与 WebView2。

Python 固定为 3.12 系列，由 uv 管理。不要依赖 Windows Store 的 `python.exe` 占位别名；使用 `uv run --project core --frozen python` 或项目虚拟环境。

推荐过程：

1. 检查 `node --version`、`cargo --version`、`uv --version` 均能运行。
2. 执行 `scripts/setup.ps1`，安装锁定依赖并运行测试。
3. `npm run dev` 自动构建 Python sidecar，随后运行桌面程序。
4. `scripts/build-installer.ps1` 生成当前用户 NSIS 安装器。

Node 锁文件、Cargo 锁文件和 uv 锁文件都必须随依赖更新提交。不要把失败的安装/编译步骤当成可跳过项。没有完整工具链时，源码检查不等于桌面验收。

`check-env.ps1` 与 `setup-toolchain.ps1` 是旧版辅助脚本，不是 CI 或验收依据；它们不负责锁定依赖。实际安装版本以本页和工作流为准。
