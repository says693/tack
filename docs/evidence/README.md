# 验收证据索引

这些文件来自 2026-11-15 的 Windows 11 实机运行，不是设计稿。

## 截图

| 文件 | 场景 |
| --- | --- |
| `onboarding-ink.png` | 首次进入，墨色主题 |
| `cloud-consent-real-model.png` | 首次云端发送前的范围确认；目标端点与模型可见，密钥不可见 |
| `today-paper-2026-11-15.png` | 纸色主题今日页 |
| `library-paper-2026-11-15.png` | 书架：材料 A/B、外部片段、最近线索 |
| `reader-r1-locate.png` | 从 R1 卡片的“定位原文”返回版本 1，原文块被标出 |
| `reader-revision-r3.png` | 同一来源的版本 3；旧卡片仍绑定 R1 |
| `reader-external-fragment-paper.png` | 外部片段，来源显示“外部片段”，不是教材 |
| `session-fork-paper.png` | 临时分叉，父会话/原文/意图保留 |
| `card-draft-generated-ink.png` | 模型生成的卡片草稿，未入队 |
| `card-draft-paper.png` | 草稿详情：题源“新编”、证据偏移、排期未入队 |
| `card-active-paper.png` | 启用卡片：复习历史、下次到期、修订记录 |
| `review-feedback-real-model.png` | 真实模型反馈：错误点、遗漏、逐字证据 |
| `review-confirmed-real-model.png` | 用户确认后的排期结果 |
| `review-empty-paper.png` | 今日队列清空状态 |
| `panorama-paper.png` | 三栏全景：上游、分叉会话、原文证据 |
| `settings-real-model.png` | 真实模型配置（密钥不回显） |
| `settings-custom-endpoint-paper.png` | 自定义端点不会被标成 DeepSeek |
| `capsule-paper.png` | 胶囊模式 |
| `cards-all-paper.png` | 卡片列表：草稿、启用、自评、暂停 |

部分截图拍摄于墨色主题，是早先真实流程的证据；后来统一用纸色主题复核了主要界面。

## 测试日志

| 文件 | 命令 | 结果 |
| --- | --- | --- |
| `cargo-test.log` | `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features` | 31 passed · 1 ignored |
| `vitest.log` | `npm test` | 11 passed |
| `playwright-e2e.log` | `npm run test:e2e` | 1 passed |
| `real-model-e2e.log` | 带 `FOLD_REAL_*` 环境变量的 ignored 测试 | 1 passed |

真实模型测试输出摘要：

```text
[connect] ... · deepseek-v4.1-flash · "OK"
[chat] 17 deltas · ...
[card] Q "在青石镇档案室的规定中，条目何时从蓝色盒移到绿色盒？"
[grade] verdict=correct suggested=Some(2)
[review] grade=2 interval=1d due=2026-11-16
[idempotent] same review=...
[export] 1 rows · 418 bytes
```

## 导出

- `export-cards.tsv`：7 行、6 列；兼容解析器读取列数一致，制表符与换行未串列。
- `export-snapshot.json`：`fold-export/1`；计数与导出时数据库一致：

```text
attempts=5 cardRevisions=8 cards=7 chunks=11 concepts=7
dailyAssignments=5 messages=2 reviews=5 sessions=2 sourceRevisions=6 sources=4
```

- 两个导出文件都不含 `sk-` 或 `api_key` 字段。
- JSON 不包含原始 PDF/图片附件，不是完整材料备份。

## 没有放入仓库的

- `.fold-test/fold.db`：测试数据库，含本机模型配置和密钥，刻意不复制。
- 任何真实用户材料或学习记录。

## 复现

```powershell
npm test
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
```

真实模型测试需要自己提供三个环境变量，命令见根目录 `README.md`。
