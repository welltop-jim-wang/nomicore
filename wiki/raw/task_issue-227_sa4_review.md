# SA4 对抗式实现复审 — Issue #227（implementation-review；R1 工作树态 + R2 已提交态）

- 角色/阶段：SA4 adversarial implementation review（流水线 SA5 → SA6 → SA1 → SA2 → SA3 → **SA4**）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，基线 HEAD `ac91a6b` + 本 change 工作树未提交改动）
- 被审对象：SA3 实现报告 `wiki/raw/task_issue-227_sa3_impl.md` 所列全部改动（src 8 文件 + 文档 2 + 测试 5）
- **R2（2026-09-06 21:30，当前轮）**：被审对象升级为**已提交 commit `31ff694`**（`fix(diagnostics):
  lease strict replay and fail closed`，基线 `ac91a6b`，全部证据随提交入库）；实施轮冲突门禁重开
  （`wiki/raw/task_issue-227_impl_conflict_recheck.md`，verdict=clear）后的已提交态独立静态复审——
  **R2 记录见文末 §R2（本轮 verdict：approve，延续 R1 并在提交粒度复核测试触发范围 / 版本 bump /
  ADR·DENY 约束）**；以下 §1–§8 为 R1 存档（结论经 R2 复核全部维持）
- 权威契约：设计 `wiki/raw/task_issue-227_design.md`（R1.1，INV-227-1..10）；SA2 复审
  `wiki/raw/task_issue-227_sa2_review.md`（approve + **K-1..K-4 binding**）；SA6 红灯
  `wiki/raw/task_issue-227_sa6_red.md`（§3.3 红基线 19 条 / §3.4 绿灯 pin）；SA8 冲突复审
  `wiki/raw/task_issue-227_design_conflict_report.md`（clear + N-A/N-B/N-C）
- 复审方式：**全部独立重验**——不沿用 SA1/SA2/SA3/SA6 任何声明；本轮亲读全部改动 diff 与
  改后全文（reader.ts 405–1003 / read-session.ts 全文 / file.ts 1060–1411 / retention.ts /
  index.ts ×2 / diagnostic-replay.ts 全文 321 行 / 四个新测试文件全文 1331 行 / sa7 pin 改写），
  并亲跑定向 + 包级 + 文件级验证命令（§2）
- 边界：零生产代码改动、零测试改动、零 git 操作；唯一写入 = 本文件

## Verdict

**approve**（`requiresConflictRecheck: false`）

- AC1–AC5 与 K-1..K-4 逐项独立核验**全部兑现**（§3/§4）；INV-227-1..10 静态核验**全部成立**（§5）。
- DENY 面（§0.3）**零触碰**（git status/diff 亲证：schema.ts / record.ts / emission.ts /
  pipeline.ts / sink.ts / adapters/memory.ts / deleteGroup S1–S3 步序 / analyzeStreamForResume /
  删除协议文法 全部原样）；无测试抑制掩盖失败（§6）；本轮亲跑 5 组验证全绿（§2）。
- 零阻断发现；4 条非阻断观察项（§7，均附处置建议，不需返工）。

---

## 1. 改动面清单（本轮独立盘点，与 SA3 §1 声明一致性核验）

`git status` 亲证改动 = 10 个修改 + 4 个新增测试 + wiki 证据：

| 路径 | 类型 | 与设计 §0.2 ALLOW 对照 |
|---|---|---|
| `packages/namespace-diagnostic-log/src/read-session.ts` | 修改 | ✅ 列名 |
| `packages/namespace-diagnostic-log/src/reader.ts` | 修改 | ✅ 列名 |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | 修改 | ✅ 列名 |
| `packages/namespace-diagnostic-log/src/retention.ts` | 修改（仅 JSDoc） | ✅ 列名 |
| `packages/namespace-diagnostic-log/src/index.ts` | 修改（增量 re-export 两常量） | ✅ 列名 |
| `apps/yjs-server/src/diagnostic-replay.ts` | 修改 | ✅ 列名 |
| `apps/yjs-server/src/index.ts` | 修改（+1 行类型 re-export） | ⚠️ ALLOW 未逐字列名——见观察 O-1（接受） |
| `packages/namespace-diagnostic-log/AGENTS.md` / `README.md` | 修改 | ✅ 列名（文档义务） |
| `apps/.../diagnostic-replay-host-lifecycle-sa7.test.ts` | 修改（K-1 pin 改写） | ✅ 列名（§8.5） |
| 4 个新测试文件（A/B/C/D 红文件） | 新增 | ✅ 列名（§8） |

DENY 面逐项 `git diff` 亲证零改动；`CONTEXT.md` 未改（SA3 已附理由，见观察 O-2）。

## 2. 本轮亲跑验证（全部独立执行，2026-09-06）

```bash
# 1) SA6 §2 命令 1（定向 6 文件契约 + 零回退既有面并跑）
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts \
  apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts
# → Test Files 6 passed (6) / Tests 68 passed (68) / Type Errors no errors / exit 0
#    （含 E1–E5 真实进程 E2E 37.5s 全绿——#155 complete 门未回退）

# 2) K-1（SA7 重点 4 改写 pin）
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts -t "重点 4"
# → 1 passed | 5 skipped / exit 0；stdout 实测：status=partial issues=[update-unknown] lastSeq=2

# 2b) sa7 文件全量（-t 未选中的 5 个重点 + pin 改写的姊妹用例零扰动复核——SA4 加测）
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts
# → 6 passed (6) / exit 0（重点 5 真实进程 NDJSON 全生命周期 6.0s 绿）

# 3) 包级零回退全量（含 schema-freeze 指纹钉死 = 设计 §9「schema 冻结自证」的实际承载面）
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run packages/namespace-diagnostic-log
# → Test Files 30 passed (30) / Tests 448 passed (448) / Type Errors no errors / exit 0

# 4) 根 typecheck（14 个 tsconfig 顺序）
pnpm typecheck   # → exit 0
```

红灯基线可信性：SA6 在 HEAD `ac91a6b` 两次独立实测 19 条红（本 change 前），SA5 复现脚本
16/16（四腿）；本轮逻辑逐条重推（如 D1 步进钟 7 次取时推演 = 第 6 取触发拒续、A2 12s 步进
四段推演 = 段 4 检查点拒续），与断言一致——红→绿翻转非空洞。

## 3. AC1–AC5 逐项独立核验（代码锚点 + 亲跑证据）

### AC1 — 全程持约、续租或诚实失败 ✅

- **reader 侧**：`readStreamStrict`（reader.ts:405）④′（:546–604）取得会话——传入则快照即枚举
  （`segments := [...session.segments]` :605，INV-227-2 亲证：readStreamStrict 内**零**
  `enumerateSegmentGroups` 直呼，全函数唯一枚举源 = open() 内 :210）；缺省自开自关
  （`ownedSession` 函数作用域 :409；④′/⑦ :838/⑧ :868 三出口 close——本轮逐行核验 ④′ 与 ⑦
  之间**无任何 return 逃逸路径**，仅 continue/break）。①′ 防御门（:411–440）：身份不符 →
  `corrupt + locator-invalid` 零 fs；已 close → `corrupt + lease-expired`（A4a/A4b 绿证）。
- **逐段续租检查点**（:659–662）：每段读 jsonl 前 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`，
  拒续 → `lease-expired` + break 保留已读 records（A2 红转绿：corrupt + lease-expired(00000004)
  + seqs[1,2,3]；A2 对照 unbounded 同钟 ok 全量）。sidecar bin 校验读（checkSidecar :631）发生在
  检查点后同迭代内——受约覆盖。
- **replay 侧**（diagnostic-replay.ts:129–136）：locator 成功后自开 session（缺省
  ttl=DEFAULT_READ_SESSION_TTL_MS/maxLifetimeMs=null/真实钟），内层 try/finally（:304–308）
  恒 close；`readStreamStrict({...strictRequest, session})`（:139）全程持约；④ 每条 attempt
  物化前续租检查点（:226–229）、genesis 物化前同（:191–194）——materialize 的 sidecar `.bin`
  重读（reader.ts:998）落在 replay session 注册期内，受 S0′ 租约门保护。
- D1 红转绿亲证：bounded 45s/步进 10s 假钟 → `partial + lease-expired + lastSeq='3'`（前缀快照
  count=9）；D2 亲证恒释放（replay 返回后 0/0 sweep 立删 3 闭组、leaseBlockedGroups=0）。

### AC2 — sweep 只删无有效 lease 的组、无 TOCTOU 窗口 ✅

- **S0′ 提交点复查**：`deleteGroupIfUnleased`（file.ts:1093–1103）在 S1 rename 前以 sweep 入参
  `now` 复核 `segmentLeased`（惰性过期语义——过期租约永不阻塞，INV-4）；P1（:1258 初查 +
  :1266 复查）与 P2（:1325 初查 + :1334 复查）双门结构成立；`'lease-blocked'` →
  `leaseBlockedGroups += 1` + **break**（前缀纪律不跳洞）；P2 while 循环 `progressed` 守卫
  （:1356）防租约全阻塞下的活锁。`deleteGroup` 本体（:1067–1086）逐字未动——S1/S2/S3 步序
  与 `.deleting` 文法冻结保持。
- **P0 卫生租约门**（:1171–1176）：orphan-BIN unlink 前查 `segmentLeased`，blocked 计入
  `leaseBlockedGroups` 后 `continue`（卫生遍历无前缀纪律——逐组跳过，与设计 §3.3.2 一致）；
  `.deleting` 续走循环（:1139–1159）正确**不加**门（marker 组对一切会话枚举不可见）。
- **可证伪兜底**：`segment-vanished`（reader.ts:674–700）——jsonl ENOENT 时 stat bin 与
  marker：bin 在 ∧ marker 缺 → BIN-first 合法窗口零行零 issue（**逐字保留**，A3b 对照绿）；
  marker 在 ∨ bin 缺 → `segment-vanished`（A3a/A3c 绿，segment 归因正确）；bin stat 失败 →
  fail-closed 按消失（:689）。三腿论证（open 原子 + S0′ + marker 不可见）在代码面闭合。
- B2/B3 亲跑绿：活跃 session 下 orphan bin 幸存、`leaseBlockedGroups≥1`、close 后次轮清理；
  `retention-swept` 事件计数与报告一致（N-3 频率语义，事件形状零变更——`emitRetentionSweptIfAction`
  仅注释变动，字段白名单未动）。

### AC3 — fatal/committed:true/effect:'unknown' 不再推进至 complete ✅

- materialize 谓词（reader.ts:946–972）亲验穷举（对 schema 八成员联合逐一求值）：
  `effect==='update-omitted'` → omitted（无条件）；`effect==='update' ∧ (committed ∨
  fatal-committed:true)` → carrier（畸形 → invalid）；`fatal ∧ committed:true`（其余一切 effect，
  **含字段缺席**）→ `{kind:'unknown'}`；余 → none。**不存在任何 `committed:true` 形状落入
  `none`**——INV-227-5 字面成立，F-1 闭合。
- replay switch（diagnostic-replay.ts:254–259）：`'unknown'` → issue `update-unknown` +
  `break entryLoop`——不推进 lastSeq/expectedNext（INV-227-6）；标签循环修复了 switch 裸
  break 只出 switch 的缺陷（SA3 自报首版 D3 红，本轮核验 :169 `entryLoop:` + :242/:252/:258/:270
  四处终止分支全部带标签——含 `update-undecodable` catch 臂）。
- D3/D8/sa7-重点4 三腿亲跑绿：`partial + [update-unknown] + lastSeq 停在 fatal 记录前 + 前缀快照`。

### AC4 — 缺失/omitted/unknown/不可解码 → 稳定 partial/failed + issue；complete 仅全证可达 ✅

- 分类单源化：app 侧 `committed`/`hasUpdateCarrier` 推导整体删除（diff 亲证 -66 行），
  replay 只消费 materialize 投影（包边界纪律强化，C11）。连续性复核先于物化/omitted
  （:221–224，N-1 翻转——D4d 亲证 update-omitted 从 issue 集合消失、sequence-gap 存续）。
- complete 门（:288–293）与 #155 逐字节相同（diff 亲证表达式未动——INV-227-7）；
  `readStatusOk`/`historyTrimmed` 透传、⑤ genesis-missing、⑥ identity 各分支零改动。
- 通道矩阵亲跑：omitted 双形状 + K-2 手拼残差（D4a/b/c）→ partial + update-omitted 不推进；
  undecodable（D5）→ partial + update-undecodable；断链（D6a）→ sequence-gap；畸形 carrier
  （D6b）→ vfsl-invalid 非 complete（VFSL 先拒，G5 防御面维持 fail-closed）；pre-genesis 损坏
  载体（D9）→ failed + frame-missing×4 + genesis-missing 并存（SA5 实测形状钉死）。

### AC5 — 测试覆盖矩阵 ✅

A1–A5（11 用例）/ B2–B3（4）/ C1–C4（4）/ D1–D9+K-3+夹具自证（18）/ sa7 重点 4 改写（K-1）
全部落地且亲跑绿；「并发」按 §8.0 三等价类构造（注入钟生命周期 / 公共 API 步进交错 /
S0′+vanished 结构可观测）；合法 complete 保真回归 D7（混合健康链 complete/issues=[]/lastSeq='6'/
快照终态）与 E1–E5 真实进程 E2E 全绿——收紧未误伤保真面。

## 4. K-1..K-4 binding 逐项核验

| # | 约束（SA2 §4） | 本轮独立核验 | 结论 |
|---|---|---|---|
| **K-1** | SA7 重点 4 pin 废止改写为 D3 语义，与红文件同 change | sa7.test.ts:443–479 改写 diff 亲读：旧断言（complete/issues:[]/lastSeq'4'/count=9）逐字移除，新断言（partial/[update-unknown]/lastSeq'2'/count=5）+ 头注 4 号条目同步改写；同一工作树改动（`git status` 同批）。CMD2 亲跑 1 passed；全文件 6/6 无姊妹扰动 | ✅ |
| **K-2** | N-A 备案 + D4 增手拼变体 pin（fatal/committed:false/omitted → partial + update-omitted、不推进） | SA2 复审文件本身即 annex（K-5 授权）；materialize omitted 分支无条件（reader.ts:947–951，注释明示 K-2）；D4c 亲跑绿（partial + update-omitted + lastSeq='3'） | ✅ |
| **K-3** | replay session open 的 throw 收敛为 `failed` + `replay-internal-error`（零新码）；红灯增非法供参 pin | open 位于内层 try/finally **之外**、顶层 catch **之内**（diagnostic-replay.ts:129–136 vs :309–320）——`ttlMs:0`/`maxLifetimeMs:0` 的 throw 面被收敛；K-3a/b 亲跑绿：不抛断言 + `failed + [replay-internal-error]` + lastSeq null + 无 snapshot；码复用既有（grep 亲证 `replay-internal-error` 仅顶层 catch 一处 push） | ✅ |
| **K-4** | diagnostic-replay.ts 头注五条件措辞同 change 同步 | 头注 :12–15 新增「（#227 K-4 措辞同步）必要条件收紧」段 + :22–27 租约生命周期段；文档义务与行为同批落地 | ✅ |

## 5. INV-227-1..10 静态核验（逐条）

| INV | 核验事实（本轮亲读锚点） | 结论 |
|---|---|---|
| 1 持约读取 | ④′ 后一切 fs 读（jsonl/bin/stat）均在未闭会话内；自开路径三出口 close（④′枚举失败 :591、⑦ :838、⑧ :868）；④′–⑦ 间无 return 逃逸（逐行核验 :604–834） | ✅ |
| 2 快照即枚举 | 传入 session 时 segments 恒 = `session.segments`（:605）；readStreamStrict 内零 `enumerateSegmentGroups`（grep 亲证仅 read-session.ts:210 / analyzeStreamForResume :1181 / file.ts sweep 六处——后两者非本函数面） | ✅ |
| 3 提交点复查 | P1/P2 每次 deleteGroupIfUnleased 前置 `segmentLeased` 复查（:1101），`now` 与初查同源（sweepRetention 入参）；lease-blocked 恒 break | ✅ |
| 4 卫生守约 | P0 orphan unlink 前租约检查（:1173）；blocked 计入 leaseBlockedGroups（:1174） | ✅ |
| 5 fail-closed 必要性 | materialize 判定只依赖 kind/committed/effect（:946–972）；穷举求值无 committed:true 落 none；`committed ∧ effect:'update'` 恒 carrier/invalid | ✅ |
| 6 unknown 不推进 | switch 'unknown' → issue + break entryLoop，lastSeq/expectedNext 不动（:254–259）；D3/D8/sa7-4 三腿实测 | ✅ |
| 7 complete 门冻结 | 表达式与旧版逐字节同（diff 尾部亲证——仅缩进随 try 块移动） | ✅ |
| 8 恒释放 | replay 内层 finally close（:304–308）覆盖 incompatible 早退/④ 各 break/⑦ 正常返回；异常逃逸面由顶层 catch 前的 finally 先行 | ✅ |
| 9 零静默空读 | ENOENT 豁免仅 bin 在 ∧ marker 缺（:697 谓词 `markerIsFile ∨ !binIsFile` 取反）；stat 失败按消失 fail-closed | ✅ |
| 10 词表封闭 | 新码恰四：reader 域 `lease-expired`/`segment-vanished`（头注 29→31）、replay 域 `update-unknown`/`lease-expired`；grep 全 src 无第五新码；零 health 事件成员变更（retention.ts 仅 JSDoc；emitRetentionSweptIfAction 仅注释） | ✅ |

## 6. 测试完整性审计（无抑制掩盖）

- 四个新文件 + sa7 改写：grep `.skip|.only|.todo|passWithNoTests|continue-on-error|xit(` **零命中**。
- 全仓既有 `it.skipIf(isRoot)`（8 处）均为 pre-existing 环境（uid=0 EACCES 注入失效）守卫，
  本 change 零触碰（`git status` 亲证改动文件集不含它们）。
- CMD2 的 5 skipped 是 `-t "重点 4"` 名称过滤（SA6 自定命令原样复跑）——非抑制；本轮 2b 以
  全文件无过滤复跑 6/6 全绿证伪。
- 断言纪律：全部针对运行时产物（报告/issue 码/磁盘文件/sweep 报告/事件/Y.Doc 解码），
  零源码文本断言；外部 session 用例 afterEach close（A/B 文件 `openSessions.splice` 亲证）；
  步进假钟为态对象（每次 now() 前进）。
- 既有面零回退亲跑：T-C1..C8/T-B6（file-adapter-read-session 9/9）、R1–R11（host-lifecycle-red
  22/22 含真实进程 E2E）、包级 30 文件 448/448（含 schema-freeze 指纹钉死）。

## 7. 非阻断观察项（不构成返工；移交 SA7/总控知悉）

- **O-1** `apps/yjs-server/src/index.ts` +1 行类型 re-export 不在 §0.2 ALLOW 逐字清单内。裁断：
  纯加性类型导出（`DiagnosticReplayReadSessionOptions`），与该文件既有 replay 类型 re-export
  块同构，消费方类型化新请求字段所必需；SA3 已在变更清单申报。**接受**（DENY 面零涉）。
- **O-2** `CONTEXT.md` 未更新（设计 §0.2 列为 ALLOW）。SA3 理由：零 update-omitted reason、
  零 health 事件成员（INV-227-10），四新码均为包/工具局部词表，已在包 AGENTS.md #227 增量段
  成文——与 #154/#155 先例一致。核验：CONTEXT.md 确未变、AGENTS.md 增量段内容与实现逐点相符。
  **接受**（ALLOW ≠ MUST，词表演进备案义务经 AGENTS.md 满足）。
- **O-3** `segment-vanished` 的 marker 判定用 `st.isFile()`——若盘面出现**目录**形态的
  `{seg}.deleting` 且 bin 在，会落入 BIN-first 豁免臂（无 issue）。该形态违反 INV-13 文法
  （marker 恒为 renameSync 产物文件）、生产不可达，且 bin 缺失臂仍 fail-closed；属理论边界
  非缺陷。建议未来清理票如收紧可改 `st !== undefined`。**备案不阻断**。
- **O-4** 设计 §9 的 `pnpm schema:check` 裸命令实际要求 `<schema.vfsl>` 参数（exit 2 用法错）；
  record schema 冻结自证的真实承载面是 `test/schema-freeze.test.ts`（包级 448 内绿）。
  设计文档命令笔误，非实现缺陷。**备案**。

另注（流程记录，非实现面）：`wiki/raw/task_issue-227_dispatch.md` 仅记 SA1 一行，后续派发未
追加——不影响本复审证据链（各 SA 证据文件齐全），移交总控酌情补记。

## 8. 结论

实现对设计 R1.1 全部决策（D1–D7）、SA2 K-1..K-4 binding、INV-227-1..10 的兑现**无偏差**；
SA3 自报的 D3 标签缺陷已正确修复且同 class 四处全覆盖；19 条红灯契约全部按 SA6 预期翻转、
既有 259+ 文件零回退（本轮包级 + 应用定向 + E2E 亲证）；DENY 面零触碰、零测试抑制。
SA4 裁定 **approve**，可进入 SA7 动态最终验证（§9 全量 `pnpm typecheck && pnpm test` 复跑）。

Verdict: **approve**（`requiresConflictRecheck: false`）

---

# R2 — 已提交态独立静态复审（2026-09-06 21:30，当前轮）

## R2.0 轮次定位、输入与方式

- **触发与对象**：实现已提交为 `31ff694`（「fix(diagnostics): lease strict replay and fail closed」，
  基线 `ac91a6b`；提交含 src 7 + 包 AGENTS.md/README 2 + 测试 5 + wiki/raw 证据 12）；实施轮冲突
  门禁已重开并裁 clear（`wiki/raw/task_issue-227_impl_conflict_recheck.md`，工作树新增未跟踪文件）。
  本轮 SA4 对**已提交 diff** 做独立静态复审——R1 审的是工作树未提交态，本轮在提交粒度重验并补
  三项专项核对（测试触发范围 / 版本 bump / ADR·DENY 约束）。
- **核对输入**：任务简报 `task_issue-227.md`（AC1–AC5）、设计 R1.1 `task_issue-227_design.md`
  （INV-227-1..10）、SA2 `task_issue-227_sa2_review.md`（approve + K-1..K-5）、SA3
  `task_issue-227_sa3_impl.md`、SA6 `task_issue-227_sa6_red.md`（19 红基线 + 绿 pin）、
  冲突门禁 `task_issue-227_impl_conflict_recheck.md`（clear）、实际 diff。
- **方式**：全部独立重验，不沿用任何前轮声明——`git diff ac91a6b..31ff694` 逐 hunk 亲读
  （read-session/reader/file/retention/index×2/diagnostic-replay/sa7 pin 改写 全文 diff）；
  ADR-0014-LOG L280–318 与 ADR-0011 L90–105 原文回读；vitest.config.ts / 根 package.json
  scripts / ci.yml 亲读；定向契约套件后台 Job 独立重跑（§R2.3）。
- **边界**：零生产代码/测试改动、零 git 写操作（不 commit/push）；唯一写入 = 本文件本节。

## R2.1 提交范围与 ALLOW/DENY 核对（本轮亲证）

`git diff --name-status ac91a6b..31ff694`：生产 src 恰 7 文件（read-session/reader/file/
retention/index + apps diagnostic-replay/index）+ 包 AGENTS.md/README + 测试 5（4 新增 + sa7
改写）+ wiki/raw 证据 12——与设计 §0.2 ALLOW 白名单逐项对照：

| 路径 | ALLOW 对照 | 备注 |
|---|---|---|
| `packages/.../src/read-session.ts` / `reader.ts` / `adapters/file.ts` / `retention.ts` / `index.ts` | ✅ 列名 | retention 仅 JSDoc；index +3 行增量 re-export |
| `apps/yjs-server/src/diagnostic-replay.ts` | ✅ 列名 | session 生命周期 + ④ 单源化 + K-3/K-4 |
| `apps/yjs-server/src/index.ts` | ⚠️ 未逐字列名（+1 行类型 re-export） | O-1 维持接受：纯加性类型导出，DENY 零涉 |
| 包 AGENTS.md（+20 行）/ README.md | ✅ 列名（文档义务） | 本轮亲读内容与实现逐点相符（§R2.5） |
| 4 新测试文件 + sa7.test.ts 改写 | ✅ 列名（§8 / §8.5 K-1） | — |

**DENY 面 zero-diff 亲证**：`git diff ac91a6b..31ff694 -- src/schema.ts src/record.ts
src/emission.ts src/pipeline.ts src/sink.ts src/adapters/memory.ts CONTEXT.md docs/**`
→ **0 行**；`deleteGroup` S1–S3 本体与 `analyzeStreamForResume` 零 hunk（diff 亲证仅外围
包装/无触碰）。提交后工作树干净（`git status` 仅余未跟踪的冲突门禁文件）。

## R2.2 五份关键 diff 独立重读（INV-227-1..10 在提交态的锚点复核）

- **read-session.ts**：`DEFAULT_READ_SESSION_TTL_MS=15_000`/`READ_SESSION_RENEW_MARGIN_MS=1_000`
  单源导出；`renewIfDue`（margin 内到期才续、closed/拒续→false、非法 margin 视同 0 不
  throw——G-227-1 兑现）；`enumerationFailed` 事实承载（枚举失败收敛空快照+标志，不 throw）；
  open 的三个 throw 面（id/ttlMs/maxLifetimeMs）原样保留——K-3 收敛所依赖的面未被削除。
- **reader.ts**：①′ 防御门（:411–440：身份不符→`corrupt+locator-invalid`、已 close→
  `corrupt+lease-expired`，均零 fs）；④′ 会话取得（:546–604：提供→`segments := [...session.segments]`
  快照即枚举 / 缺省→自开 `ownedSession`）；逐段续租检查点（:659–662，拒续→`lease-expired`
  +break 保留已读）；`segment-vanished`（:675–699：jsonl ENOENT 时 bin 在∧无 marker →
  BIN-first 豁免臂**逐字保留**；marker 在∨bin 缺 → `segment-vanished`；stat 失败 fail-closed）；
  ⑦ :838 / ⑧ :868 恒释放；materialize 谓词（:946–972）`fatal∧committed:true∧effect∉
  {'update','update-omitted'}` → `{kind:'unknown'}`（effect 缺席与字面 'unknown' 同归）。
  **INV-227-2 grep 亲证**：`enumerateSegmentGroups` src 全部调用点 = 定义（reader.ts:371）+
  analyzeStreamForResume（:1181，DENY 面）+ read-session.ts:210（open 内，唯一枚举源）+
  file.ts 六处（sweep）——`readStreamStrict` 函数体（:404–880）**零**直呼。
- **file.ts**：`deleteGroupIfUnleased`（S0′：S1 rename 前以 sweep 入参 `now` 复核
  `segmentLeased`）；P1/P2 双门（初查保留 + S0′ 复查），`'lease-blocked'` → 计数 + **break**
  （前缀纪律），P2 `progressed` 守卫防活锁；P0 卫生 orphan-BIN unlink 前租约门（跳过计入
  `leaseBlockedGroups` 后 continue）；`.deleting` 续走循环正确**不加**门（marker 组对一切
  会话枚举不可见）；`deleteGroup` S1–S3 本体零 hunk；`hygieneStream` 增 `now` 参；
  `emitRetentionSweptIfAction` 仅注释（N-3 频率语义备案，事件形状/白名单零变更）。
- **diagnostic-replay.ts**：**K-3**——session open 位于内层 try/finally **之外**、顶层
  catch **之内**（非法供参 throw → `failed` + 既有 `replay-internal-error`，零新码）；
  **INV-227-8**——内层 `finally { session.close() }` 覆盖 incompatible 早退/④ 各 break/正常
  返回；④ 重写为 materialize switch 唯一分类源（app 侧 `committed`/`hasUpdateCarrier` 推导
  整体删除）；`entryLoop:` 标签 + 四处终止分支 `break entryLoop`（omitted/unknown/
  invalid/undecodable-catch——SA3 自报 D3 首版缺陷的修复面，本轮 diff 亲证四处全覆盖）；
  连续性复核先于物化/omitted（N-1 翻转）；complete 门表达式 `issues===[] ∧ applied>0 ∧
  readStatusOk ∧ !historyTrimmed` **逐字保留**（INV-227-7）；头注 K-4 措辞段在场。
- **sa7.test.ts（K-1）**：旧断言（complete/issues:[]/lastSeq'4'/count=9）逐字移除，新断言
  （partial/`[{code:'update-unknown'}]`/lastSeq'2'/count=5）+ 头注 4 号条目改写并标注
  「K-1，SA6 同 change 废止旧 pin」——收紧方向改写，经设计 R-5/SA2 binding 预授权。

## R2.3 测试触发范围（本轮专项核对）

- **全量触发面**：根 `pnpm test` = `NODE_OPTIONS=--conditions=nomicore-source vitest run
  --typecheck`；`vitest.config.ts` `test.include` = `packages/*/test/**/*.test.ts` +
  `domains/*/test/**/*.test.ts` + `apps/*/test/**/*.test.ts`（`maxWorkers: 1`，typecheck
  enabled）。⇒ 本 change 的 **5 个测试文件全部落在全量触发面内**（无路径排除；`passWithNoTests:
  true` 只在 include 为空时放行，本 include 非空不构成掩蔽）；`pnpm typecheck` 顺序覆盖
  namespace-diagnostic-log 与 apps/yjs-server 两个 tsconfig。
- **改动文件 → 触达测试映射**：`reader.ts`/`read-session.ts`/`file.ts`/`retention.ts`/
  `index.ts` → `packages/namespace-diagnostic-log/test/**`（30 文件 448 用例，含本批
  A/B/C 三新文件 + read-session/retention/strict-reader/deletion 既有面）；`diagnostic-replay.ts`
  → `apps/yjs-server/test/diagnostic-replay*`（本批 D 新文件 + host-lifecycle-red/sa7）；
  `apps/src/index.ts` re-export → yjs-server 测试导入面 + typecheck；AGENTS.md/README →
  无测试触达（纯文档）。
- **新用例计数亲证**：strict-reader-lease **11** + file-adapter-retention-lease-gate **4** +
  strict-reader-materialize-unknown **4** + diagnostic-replay-lease-completeness-red **18**
  = **37** 新用例（与 R1/SA7 记账一致）。
- **零抑制亲证**：5 个新增/改写测试文件 grep `.skip|.only|.todo|xit(|passWithNoTests|
  continue-on-error` → 零命中（exit 1）。
- **本轮亲跑（后台 Job，2026-09-06 21:30，提交态 HEAD `31ff694`）**：6 文件定向契约 +
  sa7 全文件并跑 → **Test Files 7 passed (7) / Tests 74 passed (74) / Type Errors no
  errors / exit 0**（45.73s；含 E1–E5 真实进程 E2E；stdout 实测重点 4：
  `status=partial issues=[{"code":"update-unknown"}] lastSeq=2`）——与 R1 CMD1（68/68）+
  CMD2b（6/6）、冲突门禁独立重跑（68/68）、SA7 全量（2906/2906）互证一致。

## R2.4 版本 bump 核对（V-1 复核）

- **事实（本轮亲证）**：`31ff694` 对 `**/package.json` 与 `pnpm-lock.yaml` 的 diff = **0 行**；
  `namespace-diagnostic-log` 维持 **0.1.6**、`apps/yjs-server` 维持 **0.1.3**。
- **先例（打破面）**：`ac91a6b`（#248）bump 了 apps/yjs-server + namespace-registry；
  `45a22f0`/`d948ea5` 亦随 src 变更 bump——本 change 未延续该惯例。
- **repo CI 立法亲读**（`.github/workflows/ci.yml`「Build and verify publishable tarballs」
  步骤注释，L68–73 区）：明文「不要把『与 registry 同版本 integrity 相等』……当作源码 PR
  门禁——**版本提升与 npm publish dry-run 属于 release 流程**」，且该步骤以
  `NOMICORE_VERIFY_REGISTRY_INTEGRITY=0` 显式关闭同版本比对——版本 bump **不构成 CI/PR
  门禁**。
- **范围裁定**：设计 §0.2 ALLOW 白名单未列 package.json（SA2 批准的改动范围本不含 bump 面）。
- **结论**：维持 SA7 V-1 与冲突门禁 §5 的一致裁定——**非阻断**；建议总控在 finalize 或
  release 流程补 bump（namespace-diagnostic-log 0.1.6→0.1.7、yjs-server 0.1.3→0.1.4；
  lockfile 依赖全 `workspace:*`（32 处亲证），无版本解析需变更）。备注：SA7 另引
  `skills/orchestrate-bugfix/SKILL.md` 硬门禁 9 的 bump 要求——该文件不在本 worktree
  （总控侧环境），本轮无法直接核验其文本；本裁定以 repo CI 立法 + 设计 ALLOW 范围为
  独立依据，两者均指向非阻断。

## R2.5 ADR / DENY 约束核对（本轮原文回读 + diff 亲证）

- **ADR-0014-LOG §Retention 与删除（L289–297 亲读）**：「retention 只删除已关闭且没有
  reader lease 的 segment group」——P1/P2 双门 + P0 卫生租约门为**兑现型实施**（原 P0
  orphan-BIN 不看租约属实施偏差，本票纠偏）；「reader 通过 openReadSession() 获得短期
  segment lease……长期 reader 必须有最大 lease 时长**或显式续租**」——缺省
  `maxLifetimeMs=null` 显式续租臂为 ADR 明文两臂之一；删除协议 S1–S3/`.deleting` 文法/
  orphan 清理步骤文法零触碰。
- **ADR-0014-LOG §Strict reader 与诊断性 replay（L301–318 亲读）**：报告形状
  `{status,lastAppliedSequence,issues,snapshot?}` 冻结面零变更；「只有存在有效 genesis、
  records 连续、**所有必要 updates 可解码且校验通过**……才能返回 complete」——收紧只做
  必要条件方向的加严（分类/issue 通道），无任何新形状 complete 可达。
- **ADR-0011（L97–105 亲读）条件 3**：「每个非-noop committed record 都携带可解码的 Yjs
  update」才可声明诊断性重放成功——`fatal∧committed:true` 而 effect 不可证（字面 'unknown'
  /字段缺席）不允许 complete；旧实现推进至 complete 属实施偏差，本票纠偏与 ADR 对齐。
- **DENY 面**：§R2.1 zero-diff 亲证（schema 冻结指纹/result 联合/写路径 emission·pipeline·
  sink·memory/删除协议/analyzeStreamForResume/CONTEXT.md/docs 全部原样）。
- **词表封闭（INV-227-10）**：新码恰四（reader 域 `lease-expired`/`segment-vanished`
  ——头注 29→31 成文；replay 域 `update-unknown`/`lease-expired`）；零 health 事件成员
  变更、零新 update-omitted reason（CONTEXT.md 词表零触碰——O-2 维持）。
- **与冲突门禁交叉核对**：`task_issue-227_impl_conflict_recheck.md`（clear）§1–§3 的
  事实断言（改动面盘点/DENY zero-diff/谓词穷举无 committed:true 落 none/N-A·N-B·N-C 经
  K-2/K-3/K-4 闭环）与本轮独立重验**逐项一致**，无相互矛盾发现；其对 `31ff694` 的
  兑现型定性（五缺口 G1–G5 修复 = ADR 已决条款实施）成立。

## R2.6 观察项状态（继承复核，均维持、无新增）

| # | 项 | 本轮复核 |
|---|---|---|
| O-1 | apps/yjs-server/src/index.ts +1 行类型 re-export 不在 ALLOW 逐字清单 | 维持**接受**（纯加性、DENY 零涉；冲突门禁同裁） |
| O-2 | CONTEXT.md 未改（设计 ALLOW 列有该路径） | 维持**接受**（零新 reason/零 health 事件成员；AGENTS.md #227 增量段 +20 行亲读相符，承载词表备案义务） |
| O-3 | `segment-vanished` marker 判定 `st.isFile()` 目录形态理论边界 | 维持**备案**（INV-13 文法下生产不可达；bin 缺失臂仍 fail-closed） |
| O-4 | 设计 §9 `pnpm schema:check` 裸命令笔误（实参缺 `<schema.vfsl>`） | 维持**备案**（冻结自证真实承载面 = schema-freeze.test.ts，包级 448 内绿） |
| V-1 | 两改动包未 bump patch 版本 | 见 §R2.4——**非阻断**，移交总控/release 流程裁量 |

## R2.7 R2 结论

已提交变更集 `31ff694` 在提交粒度经本轮全部独立重验：改动面与设计 §0.2/§0.3 及 SA2
binding 零偏差；INV-227-1..10 在提交态锚点全部成立；K-1 pin 改写合法且绿；测试触发范围
完整（5 测试文件全在全量 include 面内、37 新用例零抑制、本轮 7 文件 74/74 亲跑绿）；
版本 bump 缺位经 repo CI 立法 + 设计范围双依据裁定非阻断（V-1 移交）；ADR-0011/0014-LOG
全部被引条款兑现型合规、DENY 面 zero-diff；与冲突门禁 clear 结论互证一致。**R2 裁定
approve（requiresConflictRecheck: false）**——R1 结论在已提交态维持成立，无返工项。

Verdict: **approve**（`requiresConflictRecheck: false`）
