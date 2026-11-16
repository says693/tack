# 发布到 GitHub

## 第一次上传

```powershell
cd H:\CC小姐\tack
git init
git add .
git commit -m "G0 skeleton"
git branch -M main
git remote add origin https://github.com/<你的用户名>/tack.git
git push -u origin main
```

仓库设置里把 Description 写上，Topics 建议：`tauri` `spaced-repetition` `active-recall` `study` `desktop` `chinese`。

## 本地出安装包

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

产物在 `src-tauri\target\release\bundle\nsis\`，文件名形如 `tack_0.1.0_x64-setup.exe`。当前用户安装，不需要管理员权限。

## 用 CI 出三平台安装包

1. 改 `package.json` 和 `src-tauri/tauri.conf.json` 里的版本号，两边要一致；
2. 提交并推 tag：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions 会比你在本机构建更省事：Windows `-setup.exe`、macOS 通用 `.dmg`、Linux `.AppImage` 会自动挂到一个**草稿 Release** 下。到 Release 页检查一遍再点 Publish。

## 安装器外观

`scripts/make-icons.ps1` 生成：

- `icons/icon.ico`：安装器与程序图标（朱红钉头，纸面底）；
- `icons/nsis-header.bmp`（150×57）：欢迎页顶部横幅，左侧 `tack` 拉丁文斜体、右侧小钉头；
- `icons/nsis-sidebar.bmp`（164×314）：安装器左侧竖版画面，钉头 + 「钉住 / 每天回来一次」。

## 注意事项

- 仓库里不提交 `src-tauri/icons/*.png|ico|bmp` 也可以：CI 会先跑生成脚本。但本地构建前需先跑一次 `make-icons.ps1`（`setup.ps1` 会自动做）。
- macOS 未签名时首次打开会被 Gatekeeper 拦一次，右键「打开」即可。正式分发需 Apple Developer 签名与公证，G5 再处理。
- 不要提交 `data/`、`core/.venv`、`core/tack.local.json`、任何 `.env`。`.gitignore` 已覆盖。
