# SA4 对抗式实现复审 — Issue #227（implementation-review 轮，2026-09-06）

- 角色/阶段：SA4 adversarial implementation review（流水线 SA5 → SA6 → SA1 → SA2 → SA3 → **SA4**）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，基线 HEAD `ac91a6b` + 本 change 工作树未提交改动）
- 被审对象：SA3 实现报告 `wiki/raw/task_issue-227_sa3_impl.md` 所列全部改动（src 8 文件 + 文档 2 + 测试 5）
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
