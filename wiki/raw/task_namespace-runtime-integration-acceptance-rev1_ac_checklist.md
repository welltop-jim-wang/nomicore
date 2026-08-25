# AC 逐条确认清单（round 2 / rev1）— issue #93 PR #114 双轴评审修订轮

> 来源：issue #93 Acceptance criteria（TASK.md 同步）+ PR #114 双轴人工评审 5 项 merge-blocking + 2 项建议（round 2 任务简报逐字收录）。核对时间：2026-08-25（本地 17:50–18:05）。
> 证据等级：runtime=可执行测试；static=静态审计/文档核对；ci=CI/流程证据。
> 基线：round 1 终态 151d09c（PR #114 CI 全绿）→ round 2 交付 526edc2 → 56d38c5 → 0e31b8e。

## 一、评审 7 项逐条核验（round 2 核心门禁）

| # | 评审项（级别） | 状态 | 核验证据 | 契约 |
|---|---|---|---|---|
| 1 | 公共 testing seam 泄漏（High/阻断） | ✅ | runtime：`runtime-acceptance-exports-audit.test.ts` T1.1 值导出键集恰 `['RuntimeWriteFatalError']`、T1.2 seam 模块级缺席、T1.4 package.json exports 恰 `['.']`（无 ./testing 子路径）；`runtime-public-surface-ownership.test.ts` seam toBeUndefined。SA7 探针 c：干净环境 tsx 真实 import 独立互证键集恰一键（双 Node 一致）。static：SA4 核验 index.ts 值导出恰一键 + 11 类型、seam 值与 `NamespaceRuntimeSeamInput` 类型撤出、runtime.ts 模块级逐字节不动、19 个测试文件 import 切 `'../src/runtime.js'` 零漏网 | D-1/裁决 A+G |
| 2 | 生产装配路径真实端到端（High/阻断） | ✅ | runtime（新增 `runtime-acceptance-production-assembly.test.ts` T5.1/T5.2）：包内生产工厂 `createNamespaceRuntime(handle, () => persistence.saveDoc(handle))`（ADR-0008 L45 逐字调用形）+ 真实 compile + Memory/File 双 Adapter 六步全链（P0→读→ROOT write→SCHEMA replacement→跨实例/crash-restart→close）+ dirty 计数每成功写恰 +1；文件内 grep 无 WithSeam（构造哲学隔离）。SA7 探针 a 双 Node 2/2 | D-5/裁决 E① |
| 3 | fatal 全链覆盖补齐（Medium/阻断） | ✅ | runtime（fullchain AC5 块 U-1..U-4）：U-1 Memory × pre-commit（schema-compile-throw committed:false，notifier 恰 0、零 update/字节不变、fatal 摘要 NSRT-FATAL-SCHEMA-WRITE-INTERNAL、读照常+写 DISABLED、close release 恰一次）；U-2 File × pre-commit + restart durable 零写入；U-3 File × committed（observer 逃逸经生产工厂，best-effort saveDoc 恰一次、restart 见提交值）；U-4 Memory × P0 fatal（NSRT-FATAL-P0-INTERNAL、schema.state 保持 preparing、读立即可用）。SA7 探针 a 双 Node 7/7 | D-6/裁决 E② |
| 4 | close 后停止全部公共数据读取（High/阻断） | ✅ | runtime：close-lifecycle T2.1（post-close 三 getter 同步 throw code RUNTIME_READ_DISABLED、message 含 'closed' 与 getter 名）、T2.2（closing 窗口含 'closing' + getStatus 全窗口可用）、T2.3（fatal 期照常→close 后才 throw，增补 H 负向锚）、T2.4（cyclic META + close → RUNTIME_READ_DISABLED 而非 RangeError——门禁先于深拷贝）；production-assembly post-close getter throw 交叉确认。SA7 探针 d：生产工厂构造 → close → 三 getter throw + getStatus/read 保留（双 Node 互证）。static：SA4 核验门禁方法体首行、key 仅 lifecycle、先于投影零触碰 Y.Doc；CONTEXT.md 停接纳词条同步修订（三 getter 入停接纳、getStatus 保留） | D-2/裁决 B+H |
| 5 | 未知 schema preparation 异常进 fatal（Medium/阻断） | ✅ | runtime：sa7-dynamic T3.1/T3.2（δ 注入 structure.node=42 → rejection RuntimeWriteFatalError phase=pre-commit-internal committed=false、cause 含 DOCRT-E206、notifier 恰 0、零 update/字节不变、fatal 摘要、后续写 DISABLED）；T3.3 γ（DerivedInvariantError → E204 A4 红线零回归）；T3.4（深 doc × keep-root → E 层吸收领域 ok:false + 零写入 + fatal 零置位 + 修复通道行为锚定——6_000 深度两相）。static：SA4 核验 E204 逐字节保留、E206 模板逐字节符合设计 §3.3、E200 活分支删除、replace/materialize/mutation 零触碰 | D-3/裁决 C |
| 6 | 非法 SCHEMA 载体不静默映射 null（建议） | ✅ | runtime（新建 `runtime-schema-carrier-split.test.ts` T4.1–T4.4）：T4.1 异型载体 public getSchemaEnvelope throw NSRT-SCHEMA-E2（message 含载体观测）；T4.2 P0 unavailable + SCHEMA_ENVELOPE_1 + fatal null + 组合锚（同 doc getter throw E2——数据级收编与 loud 诊断并存）；T4.3 缺席对照 null + ENV-1 宽容零回归；T4.4 异型 doc 上 replaceSchema ok:false 单 issue（写路径开放诚实）。static：SA4 核验 p0 分支 return null 永不 throw（runP0 catch 结构性不可达）、缺席→null 保留 | D-4/裁决 D |
| 7 | walker 重复漂移提取共享基础设施（建议） | ✅ | static：新建 `src/plain-data.ts`（OwnDataFact 五分事实 + ownDataFact/isPlainRecord/putPlainKey/yjsFamilyWord/describePlainValue；index.ts 不导出、零 yjs 依赖防环）；projection/write 各自消费、不统一遍历器；SA4 攻防点核验 accessor 先于 non-enumerable 判序保现行消息。runtime：零行为回归硬验收——snapshotter 四查锚、F-3 RangeError 锚、metadata-proto-key 全量 + T7.2 双场景（non-enumerable 下标可读 + undefined 子情形 violation 消息锁定）全绿 | D-7/裁决 F |

## 二、Issue #93 AC 全量复核（round 2 证据更新）

| AC# | 描述 | 状态 | round 2 证据更新 |
|---|---|---|---|
| 1 | 真实 VFSL compiler + doc-runtime + Memory/File Persistence 端到端覆盖 Runtime 全能力 | ✅ | **更新**：新增生产装配路径（项 2，T5.1/T5.2——生产工厂真实绑定 + 双 Adapter 六步全链），与既有 seam fullchain（注入链）并存互补（设计 §5.3 分工表）；round 1 的 fullchain/degraded/persistence 锚全量保持绿 |
| 2 | 冷启动 P0 pending 读立即成功，早期写严格排在 P0 后 | ✅ | 保持：sync-read-face AC8、mutate-root-sequencer AC4、p0-sequencer AC5/AC7 原样绿（仅 import 行切换，零断言变化） |
| 3 | ROOT/SCHEMA 写、active schema 切换、dirty notification 顺序符合单 sequencer 契约 | ✅ | 保持：两 sequencer 测试 + sa7-dynamic AC9 时序原样绿；D-2 门禁住公共方法层不改槽序（SA4 核验 sequencer/槽文件零触碰） |
| 4 | persistence degraded/recovery、检查后降级竞态、最新 live Y.Doc 最终持久化（两 Adapter） | ✅ | 保持：degraded-two-adapter 全量绿（仅 import 行切换） |
| 5 | committed/pre-commit fatal、best-effort dirty notification、fatal 后只读、close 全链 | ✅ | **更新**：U-1..U-4 补齐 pre-commit fatal × 真实持久化（Memory+File）与 committed fatal × File + P0 fatal 变体（项 3）；D-3 使未知 preparation 异常经 E206 进入同一 fatal 通道（项 5）；T3.4 锚定深 doc keep-root 的 E 层吸收与修复通道行为 |
| 6 | 公共 exports 审计：不暴露生产构造器、DocHandle/Y.Doc/writable Yjs reference、包内 detached/testing seam | ✅ | **更新**：seam 值与类型撤出公共入口（项 1）——审计锚从「seam 为预期导出」反转为「值导出恰一键 + seam 模块级缺席」；T1.4 配置审计锁 exports 键集 |
| 7 | ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致 | ✅ | 保持 + 修订：ADR 0008 正文零改动（新码 NSRT-SCHEMA-E2 落 errors.ts 注册、DOCRT-E206 落 doc-runtime 侧——均走 L125 注册表归属机制，SA8 双门禁裁决成立）；CONTEXT.md 停接纳词条按裁决 B 修订（三 getter 入停接纳、getStatus 保留、_Avoid_ 收窄）；errors.ts 头注公共面表述收口（0e31b8e） |
| 8 | 全仓 typecheck/test、Node 20/24 CI 全绿、无待处理 blocker | ✅（本地 + 干净克隆双 Node 全绿；PR 真实 CI 观察期属 Host） | runtime：总控亲跑 `pnpm test` 92 文件 1118 用例 exit 0 + `pnpm typecheck` 七包 exit 0 + `tsc -p tsconfig.typecheck.json --noEmit` exit 0（.mabf-bg/verify-rev1b.log，T=0 C=0 X=0）；SA7 干净克隆全新 install 双 Node（v24.13.0/v20.20.2）同绿 + ci.yml 七步本地对等复现双口径全 exit 0 + T3.4 负载稳健复测（9× 超时余量）。ci：round 2 推送后 PR #114 复审与真实 CI run 移交 Host 观察期 |

## 三、硬门禁终检（round 2）

- HG12：SA4 review wiki verdict=pass 与其 dispatch verdict 真实一致 ✓；SA7 report verdict=pass 一致 ✓
- HG13：N/A（无 .spec.ts 新增——全部 .test.ts/.test-d.ts 经 vitest 真实执行）
- HG14：SA4 §1.4 all-vitest-packages-triggered ✓ + SA7 HG#14 四目标文件执行摘录 ✓（SA6 锚定/SA3 转绿/总控 verify/SA4 复跑/SA7 双 Node 五重执行链）
- HG15：未触发（设计 §11 协议假设表 6 行全部源码/测试引用依据，D-3 撤销后零引擎依赖；关键词计数 ≤3）
- HG16：无 git push / gh pr create 痕迹（总控纪律）；REPORT.md 与 .mabf-done 不入 commit（SA3 三次 commit 均精确 add 证实）；mabf.base-branch 配置面属 Host/Runner

## 结论

评审 7 项（5 阻断 + 2 建议）逐条 ✅；issue #93 AC 8/8 ✅（AC8 真实 CI run 按职责边界移交 Host）；硬门禁终检全过。遗留 LOW 观察（SA4 ×3 / SA2 R2 B·C 已处置或登记）均不阻塞。
