# 发布与打包

本地 Windows 构建：

```powershell
npm ci
npm test
uv sync --project core --frozen --group build
npm run build -- --bundles nsis -- --locked
```

`beforeBuildCommand` 使用 PyInstaller 把 Python 内核和依赖打成 sidecar。安装用户不需要单独安装 Python。`--locked` 是传给 Cargo 的尾部参数，不是 Tauri CLI 选项。

GitHub 只有推送 `v*` tag 才触发发布。release 先调用三平台验证工作流，全部通过后才生成草稿 Release。普通 main 推送只验证，不发布。macOS 产物与其 runner 架构一致，不使用无法同时满足 Python sidecar 的 universal 交叉编译。

发布前必须确认：版本一致、锁文件同步、回归通过、冻结内核运行通过、安装后运行与重启持久化通过。未签名安装包必须如实标识；不得宣称已完成未执行的平台 GUI 验收。
