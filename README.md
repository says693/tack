# tack

常驻桌面的知识钉板。导入资料、生成卡片、作答、记录复习时间。Tauri 2 外壳 + Python 内核 + SQLite，一科一库。

## v0.1.1：真实学习闭环

- 导入 UTF-8 TXT / Markdown / 文本型 PDF，可搜索、生成学习卡。
- 科目独立；钉卡、评分、暂停、恢复、今晚/明天复习均写入数据库，重启后保留。
- 标准答案与用户作答分开保存；按 UTC 秒判断到期，按本地日历安排明天。
- 导入相同内容不会重复生成卡；文档更新后旧卡仍能追溯其原文版本。
- 明确离线模式使用关键词近似评分；明确在线模式调用 OpenAI 兼容 HTTPS 端点。
- 在线调用失败或响应不合法会报错并回滚，不转为离线“成功”。
- Windows 安装包携带 Python 内核，不要求最终用户安装 Python、Node 或 Rust。
- HUD 使用原生弹出菜单；主窗/锚点支持显式拖动区域。

## 开发（Windows）

构建环境：Node 24、Rust 1.98 / MSVC、uv 0.12.17、WebView2。Python 3.12 由 uv 管理。

```powershell
.\scripts\setup.ps1
npm run dev
```

安装包：

```powershell
.\scripts\build-installer.ps1
```

或者 `npm run build -- --bundles nsis -- --locked`。准备内核会使用 PyInstaller 打包并按本机 Rust target 命名 sidecar。**不能将本机 Python 二进制直接交叉编译为其他平台。**

## 界面

1. 点击左上角科目名可创建/切换科目、恢复暂停卡。
2. 点击“导入材料”或拖入文件；只有事务提交后才显示成功。
3. 作答后“交卷”显示评分与下次复习时间；点击“下一张”继续。
4. “记住了”是明确的自评，会记录 3 分；“明天再看”只延期，不伪造答题记录。
5. 原文区长按或按 P 开锚点，确认名字后保存。
6. 关闭主窗只是隐藏；HUD 或托盘菜单可退出。

独立浏览器页面是**静态预览**，会明确提示不能执行学习操作，不提供模拟成功结果。

## 数据与配置

默认目录：

- Windows：`%APPDATA%\app.tack.desktop`
- macOS：`~/Library/Application Support/app.tack.desktop`
- Linux：`~/.local/share/app.tack.desktop`

桌面内核由外壳指定同一目录；CLI 使用相同默认约定。`TACK_DATA_DIR` 可显式指定隔离的验收目录。科目库位于 `subjects/`；配置为 `config.json`。界面科目管理中会显示实际完整路径。

默认没有配置文件时是明确的 `offline` 模式，不联网。在线模式配置示例：

```json
{
  "llm": {
    "mode": "online",
    "base_url": "https://YOUR-ENDPOINT/v1",
    "model": "YOUR-MODEL",
    "fast_model": "YOUR-MODEL",
    "timeout_s": 60
  }
}
```

Key 只读取项目专用 `TACK_API_KEY`，或系统钥匙串中的 service=`tack` / username=`llm`。不会借用 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY`。环境变量 `TACK_MODE`、`TACK_BASE_URL`、`TACK_MODEL` 可显式覆盖配置。配置损坏直接报错。

在线模式会把原文/作答发送给你配置的服务。请先确认材料可发送，详见 [安全说明](docs/SECURITY.md)。

## 旧版数据迁移

旧版仓库的 `data/subjects/` 不再是默认运行目录。迁移前关闭应用并完整备份旧库，然后将其中的数据库复制到新目录的 `subjects/`，**不要覆盖同名的新库**。旧 `core/tack.local.json` 需人工转换为上述显式模式配置；不要直接复制含未知字段的旧配置。

首次打开 v1 库会事务迁移日期到 epoch 秒，保留原文和卡片。旧版曾在复习时覆盖标准答案，因此**旧库中已经复习过的卡会标为待核对**，不自动继续评分。在科目管理里可见，需从原文重新制卡；程序不能凭空恢复已经丢失的标准答案。

## 目前的明确边界

- 不做扫描 PDF 的隐式 OCR；无文本时明确拒绝导入。
- 单文件上限 50 MB、2000 文本块；在线制卡每次上限 10 块，超限回滚并要求拆分。
- 离线关键词评分不具备完整语义理解，界面明确标注，不应当作权威判断。
- 未提供跨设备同步、自动启动、代码签名和自动更新。
- Windows 本机验收与跨平台 CI 的实际结果见验收文档，不能从“编译通过”推断所有平台 GUI 已通过。

## 测试

```powershell
cd core
uv run --frozen python -m unittest discover -s tests -v
cd ..
npm test
npm run build:core
uv run --project core --frozen python scripts/test-bundled-core.py
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

依赖锁：`package-lock.json`、`src-tauri/Cargo.lock`、`core/uv.lock`。CI 在 push/PR 运行回归、冻结内核验证和 Rust 检查；发布工作流必须先通过这些检查。

MIT。依赖的许可分别以其上游声明为准。
