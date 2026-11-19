# 折页 FOLD · 首版验收记录

验收日期：2026-11-15  
平台：Windows 11 · Tauri 2 · WebView2  
应用版本：`0.1.0`  
调度器：`fold-sm2e-1`  
真实模型：`deepseek-v4.1-flash`，OpenAI 兼容自定义端点  
浏览器演示：`src/mock/backend.ts`，界面标注“演示模型 / 模拟批改”，不作为真实学习记录

状态只使用：**通过 / 失败 / 待执行 / 不适用**。  
真实模型证据与模拟证据分开记录；没有把浏览器演示当成真实模型结果。

## 执行方式

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
```

真实模型测试：

```powershell
$env:FOLD_REAL_BASE_URL = 'https://<endpoint>/v1'
$env:FOLD_REAL_MODEL = 'deepseek-v4.1-flash'
$env:FOLD_REAL_API_KEY = '...'
cargo test --manifest-path src-tauri/Cargo.toml real_model_end_to_end -- --ignored --nocapture
```

本次结果：Rust `31 passed / 1 ignored`，前端 `11 passed`，Playwright `1 passed`，真实模型 ignored 测试单独运行 `1 passed`。证据见 `docs/evidence/`。

## A00–A04 · 来源、回链与外部片段

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A00 | 通过 | 起始目录 `H:\自学软件` 为空，没有既有实现可映射。记录了新建模块、启动和测试命令；没有搬运竞品工程。 | `README.md`、`docs/evidence/cargo-test.log` | 这是新建工程，不是对旧仓库的增量改造。 |
| A01 | 通过 | 导入材料 A、B 和两个外部片段。数据库有 4 个来源、6 个修订；A/B 同名章节没有串书。 | `db-summary.txt`：source=4，source_revision=6；`library-paper-2026-11-15.png` | 无。 |
| A02 | 通过 | 打开证据属于 R1 的卡片，点“定位原文”；阅读器回到 R1，原文块标出，不是当前 R3。 | `reader-r1-locate.png`；`db-summary.txt` 中 R1/R3 修订 | 无。 |
| A03 | 通过 | 同一来源已有 R1、R2、R3。旧卡片证据仍指向 R1；打开当前来源看到 R3，但没有替换卡片证据。 | `reader-revision-r3.png`、`reader-r1-locate.png`、`db-summary.txt` | 无。 |
| A04 | 通过 | 从书架粘贴外部文字，创建“外部片段”，来源说明显示“外部片段 / 来源未提供”。没有自动取词入口，因此“剪贴板并发变化”子项不适用。 | `reader-external-fragment-paper.png`、`library-paper-2026-11-15.png` | 自动取词未实现；明确粘贴流程已验。 |

## A05–A07 · 临时分叉

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A05 | 通过 | 从 R1 选区开分叉；会话保留原文、片段、父会话与学习意图。返回后原文版本和阅读位置未变。 | `session-fork-paper.png`、`reader-r1-locate.png` | 无。 |
| A06 | 通过 | 关闭分叉后从书架“最近的线索”重新打开，消息与卡片草稿仍在；没有为关闭动作额外调用模型。 | `session-fork-paper.png`、`db-summary.txt`：session=2 | 无。 |
| A07 | 通过 | 单元测试模拟流式消息中断，恢复后助手消息标记为 `failed`，没有伪造结论；真实窗口重启后仍能读到已提交消息。 | `repo::sessions::tests::interrupted_stream_is_marked_without_inventing_a_conclusion` | 无。 |

## A08–A12 · 草稿、证据与来源变更

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A08 | 通过 | 真实模型生成草稿后，卡片显示“未入队”；草稿不计入今日新卡。收下后才变为 active。 | `card-draft-paper.png`、`db-summary.txt`：draft=1 | 无。 |
| A09 | 通过 | 编辑启用卡产生新修订；语义修改后卡片暂停并等待“保留原排期 / 重置该概念排期”。题目不会在作答中被后台替换。 | Rust 测试 `semantic_edit_of_active_card_requires_schedule_decision`；真实窗口手工暂停/保留 | 无。 |
| A10 | 通过 | 严格解析器拒绝不存在、越界或与输入证据不匹配的引用；证据不属于本次输入时不能产生评分。 | `llm::tests::generated_card_rejects_invented_quote`、`grade_rejects_out_of_scope_citation`、`grade_rejects_unmatched_excerpt` | 无。 |
| A11 | 通过 | 手写自评卡标为“自评”，不显示为教材或 AI 核实；模型生成卡标“AI 参考 / 新编”。 | `cards-all-paper.png`、`card-active-paper.png` | 无。 |
| A12 | 通过 | 删除来源后卡片暂停，原因显示“来源已删除，等待重新定位”；历史复习记录保留。 | `db-summary.txt`：paused=1；`cards-all-paper.png` | 无。 |

## A13–A17 · 作答、反馈与模式

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A13 | 通过 | 首次作答前答案隐藏；提交后真实模型给出“未答对”、实际错误点、遗漏与逐字证据；没有为严格而强行挑错。 | `review-feedback-real-model.png`、`real-model-e2e.log` | 无。 |
| A14 | 通过 | 有一次已确认尝试 `hint_used=1`，首次答案长度 5，提示记录保留；没有把提示后的练习当成无提示高分。 | `db-summary.txt`：hint=1、confirmed | 无。 |
| A15 | 通过 | 批改只比较答案与证据，不按耗时判定；耗时仅保存。数据库中有 8.9–19.3 秒的不同尝试，均按内容评级。 | `db-summary.txt`；`review.rs` 中 `latency_ms` 只落库 | 没有做严格的同答案双计时实验；代码路径已核对。 |
| A16 | 通过 | 提出异议后记录保留，未确认前不写 due；`insufficient_evidence` 在单元测试中不创建 review、不改 due。 | `db-summary.txt`：objection=1；`insufficient_evidence_does_not_move_due_or_create_review` | 无。 |
| A17 | 通过 | AI 失败时首次答案保留，状态为 `ai_failed`；只有用户明确点“改为自评”才切换，自评记录保留原失败。 | Rust 测试 `ai_failure_keeps_the_answer_and_requires_explicit_self_switch`；真实窗口手工流程 | 无。 |

## A18–A21 · 调度与今日队列

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A18 | 通过 | 评级 0–3 全部映射到 `fold-sm2e-1`；同概念多卡只产生一个当前到期任务；一次尝试只推进一次状态。 | Rust 调度器测试 5 个；`queue::next_task_reuses_the_open_attempt` | 无。 |
| A19 | 通过 | 默认预算 10 新 / 50 复习；测试中先服务 50 个复习再分配 10 个新卡；超出预算的 due 不被推迟。 | `default_budget_serves_fifty_reviews_then_ten_new_cards`；`db-summary.txt`：daily_new=10、daily_review=50 | 无。 |
| A20 | 通过 | 两连接同时取题只产生一个开放分配；同概念第二个尝试同日提交时拒绝重复排期，不覆盖第一条 review。 | `concurrent_next_task_returns_one_open_assignment`、`second_attempt_for_the_same_concept_does_not_double_schedule` | 无。 |
| A21 | 通过 | 切到 `America/New_York` 后本地日期变为 2026-11-14，切回 `Asia/Shanghai` 恢复 2026-11-15；重启后设置和 due 正常。 | `db-summary.txt`：study.timezone=Asia/Shanghai；真实窗口手工切换记录 | 未做睡眠唤醒的自动化计时测试。 |

## A22–A26 · 导出、隐私与不可信内容

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A22 | 通过 | 导出 7 行、每行 6 列；兼容 CSV 解析器读取列数一致，制表符、引号、换行没有串列；卡片含中文。 | `export-cards.tsv`、`docs/evidence/README.md` | 没有在真实 Anki 客户端执行导入；字段映射需在导入时确认。 |
| A23 | 通过 | JSON 使用 `fold-export/1`；导出时计数与数据库一致（5 次尝试、5 次复习、7 张卡等）；不含 `sk-` 或 `api_key`；注明不含附件、不是完整材料备份。 | `export-snapshot.json`、`db-summary.txt`、`docs/evidence/README.md` | 无。 |
| A24 | 通过 | 首次发送前显示目标端点、模型、会发送/不会发送范围；密钥不回显、不在导出与日志中。 | `cloud-consent-real-model.png`、`real-model-e2e.log`、`export-snapshot.json` | 密钥以明文存在本机 SQLite，未接系统钥匙串。 |
| A25 | 待执行 | XSS 子项：Markdown 关闭 HTML 并使用 DOMPurify；没有 iframe，iframe 子项不适用。提示注入子项只做了提示词隔离与批改器约束，没有专门红队用例。 | `src/lib/markdown.ts`、`src-tauri/src/llm.rs` | 需要补一个恶意文档/恶意答案的端到端红队测试。 |
| A26 | 通过 | 断网、超时、错误 JSON、越界引用时保存明确错误；不换模型、不伪造反馈、不改卡片状态或排期。 | `ai_failure_keeps_the_answer_and_requires_explicit_self_switch`、`grade_rejects_out_of_scope_citation`、真实窗口失败重试记录 | 无。 |

## A27–A31 · 数据正确性与恢复

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A27 | 通过 | 当前 schema v1，没有需要迁移的旧结构；打开数据库时建表并保留既有数据。 | `db.rs` schema、`db-summary.txt` | 真正升级到 v2 时仍需先做备份/迁移/恢复演练。 |
| A28 | 通过 | 同一尝试重复确认只返回一条 review 和同一个 due；同键不同负载拒绝；真实模型测试也验证了重复确认。 | `concurrent_confirmations_for_one_attempt_return_one_review`、`real-model-e2e.log` 的 `[idempotent]` | 无。 |
| A29 | 通过 | 已提交但响应丢失时，按同一幂等键取回既有结果，不重新计分；同键不同答案/评级被拒绝。 | 同上；`idempotency` 表持久化响应 | 没有模拟进程崩溃瞬间的中断注入；由事务和幂等表覆盖。 |
| A30 | 通过 | 同概念两个不同尝试同日提交，第二条明确返回 `concept_already_reviewed_today`，只保留一条 review。 | `second_attempt_for_the_same_concept_does_not_double_schedule` | 无。 |
| A31 | 通过 | 胶囊/面板/全景/复习/设置尺寸、`Ctrl+Shift+Space`、托盘重新打开、纸色/墨色主题、退出与重启均正常。 | `capsule-paper.png`、`panorama-paper.png`、`settings-*-paper.png`、真实窗口手工记录 | 只在 Windows 11 验证；未测 macOS/Linux。 |

## A32–A36 · 真实试用与 Good Learning 参考

| ID | 状态 | 执行方式与结果 | 证据 | 剩余问题 |
| --- | --- | --- | --- | --- |
| A32a | 通过 | 真实模型端到端：连接 → 流式对话 → 严格出卡 → 收下 → 入队 → 作答 → 批改 → 确认 → 重复确认幂等 → 历史 → TSV 导出。 | `real-model-e2e.log` | 无。 |
| A32b | 待执行 | 尚未用用户允许的非敏感真实材料完成至少 5 个概念、20 次跨日尝试。不能用演示数据或同一天的重复练习冒充。 | 当前 `db-summary.txt` 有 7 个概念、5 次真实尝试 | 需要连续使用数天，记录误判与卡住步骤。 |
| A33 | 通过 | 会话有“初学 / 复习 / 未指定”意图；初学不强制先诊断，复习仍先独立作答；正常分叉返回不变。 | `session-fork-paper.png`、`Session.tsx` 意图逻辑、真实窗口手工切换 | 无。 |
| A34 | 通过 | 卡片分别显示“新编 / 自评 / 待核”等题源；模型由说明性原文生成的问题默认新编，不随教材升级成原题。 | `card-draft-paper.png`、`cards-all-paper.png`、`export.rs` | 未建立原题题库；原题/改编的完整流程只覆盖标签与导出。 |
| A35 | 通过 | 反馈只指出可观察到的错误句；证据不足不猜原因；异议保留。真实反馈指出“核对编号之后”与原文“登记完成后”不符，没有编造“第三步算错”。 | `review-feedback-real-model.png`、`insufficient_evidence...`、`db-summary.txt`：objection=1 | 原因标签未做成独立错因系统，符合首版边界。 |
| A36 | 通过 | 演示数据、模型讲解和打开材料不写 attempt/review；只有宿主收到真实作答并确认才推进状态。数据库所有真实 attempt 的 `is_demo=0`，浏览器演示单独标注。 | `db-summary.txt`、`src/mock/backend.ts`、`review::confirm_review` | 无。 |

## 结论

已完成：

- F01–F10 主流程在真实 Windows 应用中可用。
- 真实模型调用、严格证据校验、首次答案、反馈、用户确认与幂等排期已通过。
- 默认 10 新 / 50 复习、概念级调度、同一概念同日不重复排期已通过。
- TSV / JSON 导出、密钥排除、重启恢复、并发取题与重复确认已通过。
- 前端单元、Rust 单元、Playwright 演示闭环全部通过。

尚未完成 / 不应宣称：

- **A25 的提示注入红队测试**未做完整端到端验证。
- **A32b 的 5 概念 / 20 次跨日真实试用**尚未执行。
- 真实 Anki 客户端导入未验证；只验证了兼容解析器和字段完整性。
- macOS / Linux 未验证。
- 密钥明文存储于本机 SQLite，未接系统钥匙串。
- 这些未完成项不会用模拟数据、演示作答或“看起来通过”的代码替代。
