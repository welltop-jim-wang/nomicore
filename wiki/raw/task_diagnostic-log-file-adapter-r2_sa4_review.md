# SA4 静态验尸报告 — File diagnostic-log adapter R2（issue #152 round=2）

**Date**: 2026-08-28
**Verdict**: pass
**审查对象**: commit `fde8034` → `f52eccb`（10 文件 +1498/−134，未 push）
**权威契约**: r2_design.md（SA1 R3）+ dispatch 第 12 行 G18 吸收裁决 + 第 14 行 R2-G19/G20/G21 勘误裁决（与设计同等约束力）+ r2_sa6_red.md 红灯契约
**独立复验**: 包测试 19 文件 / 305 测试全绿、0 type errors、EXIT=0（本 SA4 独立进程复跑，与 SA3 证据逐字一致）；`pnpm typecheck` 全仓 EXIT=0（独立复跑）；`git diff --check fde8034 f52eccb` 干净

---

## 审核结论

1. 设计一致性：✅ 一致（六码/双向阈值/连续性状态机/双阶段提交点/definitive-ambiguous 二分/ADR amendment 逐条对照全落实；两处微小备注见 §3.9/§3.10，均不阻塞）
2. 读写路径一致性：✅ 一致（`projectCarrier` 的 `≤ inlineUpdateMaxBytes → inline / > → sidecar` 与 reader §2.4 双向阈值**恰互补**，同一 `inlineUpdateMaxBytes` config 值同时喂 `buildManifest` 与物理投影，writer 自产记录不可能违反自身 manifest；writer capture=false 三守卫 → update-omitted 与 reader §2.2 一致；genesis 与 capture 正交两侧一致）
3. 静默失败：✅ 无（ambiguous → storage-write-failed 事件 + fallbackLog「may not be persisted」行；definitive → storage-write-failed；gate drop → record-dropped/storage-validation-failed。密封后 emit 静默返回系 round-1 既有 mode-gate 语义且 emission 词表冻结无 drop 码可发——契约上正确，见 §4 观察 O-1）
4. 降级方案：✅ 安全（无新增降级路径；§2.3 digest+degraded marker 是 #148 冻结降级面的执行而非新降级）
5. 极端攻击：✅ 安全（攻击清单与结论见 §5；两项残余风险均为设计明文容忍且方向保守）
6. 错误处理：✅ 完整（readStreamStrict 全函数 try/catch 兜底不抛；emit 保持 void/non-throwing，appendSemantic/appendFinal 顶层 catch → pipeline-crashed 包络不变）
7. 架构评估：✅ 可行（无死胡同信号：无 FIXME、无绕行补丁、无跨 3 模块蔓延）
8. 过度设计：✅ 精简（reader +233/file +252 行 vs 设计预估 ~120/~110——同为一位数量级；splitRawLines 字节扫描、policy 提取、CommitHooks 均为设计 §2.1/§3.2 明文要求，非投机抽象）

---

## 1. Scope Creep Guard（§1.1）与 DENY LIST

实际 diff 10 文件 vs 设计 §8 ALLOW LIST（7 文件）set 比对：

| 文件 | 判定 |
|---|---|
| `src/reader.ts`、`src/adapters/file.ts`、`test/file-adapter-strict-reader.test.ts`、`test/file-adapter-r2-policy-continuity.test.ts`、`docs/adr/0012-*.md`、`README.md`、`AGENTS.md` | ALLOW LIST 内 ✅ |
| `package.json`（仅 version 0.1.1→0.1.2 单行） | 不在 ALLOW LIST，但系**总控硬门禁 9 明令**（dispatch 第 15 行「版本 bump 0.1.1→0.1.2（硬门禁 9）」）——总控指令优先级高于设计文件清单，备案放行 |
| `test/helpers/file.ts` | SA6 域文件；dispatch 第 13 行明文授权（「helpers validManifest 默认 capture:true」）。diff 核验：仅 `committedUpdateCapture: false→true` 单值 + 注释，无其他改动 ✅ |
| `test/file-adapter-r2-supplemental.test.ts` | SA6 域文件；dispatch 第 13 行授权的 2 处预置接缝断言回改（exhausted → corrupt+gap 存在性）✅ + SA3 备案 ② 的 R-1a 夹具政策一致化（处置判定见 §3.2——语义保持，同批先例，总控已接受留 SA4 复核，**本 SA4 判定放行**） |

**DENY LIST 零触碰 ✅**：`record.ts` / `schema.ts` / `vocabulary.ts` / `pipeline.ts` / `adapters/memory.ts` / `docs/adr/0011-*.md` / `packages/namespace-runtime/**` / `packages/vfsl/**` 均不在 diff（逐项 grep 核验）；BLACKLIST（npm lockfile/TASK.md/.bak/.DS_Store）零命中。

## 2. 触发性与协议假设硬门禁

- **§1.3 E2E spec 触发**：本票无 `*.spec.ts` 改动 —— N/A。
- **§1.4 vitest 触发性 ✅**：改动测试均在 `packages/namespace-diagnostic-log/test/**`；根 `pnpm test` = `vitest run --typecheck`，`vitest.config.ts` include `packages/*/test/**/*.test.ts` 全覆盖该包；`.github/workflows/ci.yml` `Test` step（L39）执行之；`Typecheck` step 含 `packages/namespace-diagnostic-log/tsconfig.json`。无 CI 黑洞。
- **§1.5 协议假设 ✅**：设计 §9「协议假设依据」章节存在且全部为源码引用（无「应该/通常」无据推断）。本 SA4 于基线 `fde8034` 抽验 3 条：`reader.ts:402-408`（仅 `<=` 递增、注释明载「gap 合法」）✅、`file.ts:235-240`（`allocate()` 即写 `lastSequence`）✅、`file.ts:385-397`（line 超限降级 digest+唯一 marker）✅——引用行号与内容逐字相符。两条「高」风险假设（同步 append 阻塞、catch 无字节回执）已分别由 ADR amendment 与 §3.2.1 保守分类正面处置，并有真实失败注入测试（/dev/full）实证。
- **§1.6 契约改动连锁 ✅**：`readStreamStrict` 仍同步不抛、返回形状不变（`StrictReadIssue.code: string` 开放类型，六新码无需改类型）；`emit` 仍 void/non-throwing。生产 caller 清单 `git grep`：`readStreamStrict` 仅经 `index.ts` 导出、仓内无生产消费方（replay/Host 接线属 #155 DENY 域）；`emit` caller（emitter 管线）不在本票 diff。无 caller ripple 面。
- **§1.7 源码 GREP 断言禁令 ✅**：3 个改动测试文件 `readFileSync` 仅用于读 `.bin` fixture 字节（`file.ts` helpers / 测试局部 `readBin`），42 处 `toContain` 全部作用于 `issueCodes(read.*)` 行为结果断言。零源码字符串断言。

## 3. 本轮特别复核点逐项判定

### 3.1 SA3 备案 ①（§3.4 伪代码 `continue` vs 正文「不拼接精确缺口」）——**判定：实现取舍成立，正文+锚为准**

- 伪代码字面：不可锚定行 `continue`（expected 不变）→ 其后首条可信记录 `actual > expected` → 报 gap——**这正是正文所禁止的**「把可见的下一条与其前一条拼接出精确缺口」：坏行的真实 sequence 不可知（可能恰为 2），报精确 gap 即伪造知识。
- 正文（§3.4 末条）+ SA6 已绿护栏锚（坏 JSON/VFSL/streamId 三变体均断言**无** `sequence-gap`，strict-reader L1097-1126）+ SA8 hard-violation #1 回归锚（#9/#10）三方一致指向「不可锚定 = 基线未知」。
- 实现置 `expectedSequence = null`，其后首条可信记录以 `actual+1n` 重建基线、不推断缺口——满足正文与全部锚。**不可伪造 false-ok**：任何不可锚定行必携自身 corrupt issue（invalid-json/vfsl-invalid/stream-mismatch），stream 永不 ok。
- 结论：伪代码 `continue` 行为与规范正文自相矛盾时的从属关系已由锚定契约（G18：语义冲突以族 B 定稿为准）解决；无需 SA1 返工。建议（非阻塞）：SA1 后续设计文档触碰时给该伪代码行加注，避免未来轮次误读。

### 3.2 SA3 备案 ②（R-1a 夹具政策一致化）——**判定：原断言语义保持，放行**

- R-1a（frameOffset "0125" 前导零镜像锚）原断言集：`status corrupt` / `records[0].ok===true`（首帧照常）/ `records[1].ok===false` / `issues 含 vfsl-invalid`。100B sidecar 在默认阈值 4096 下会叠加 `manifest-sidecar-threshold-violation` 击穿 `records[0].ok===true` 正例断言。
- 处置：夹具 manifest 覆盖 `inlineUpdateMaxBytes: 64`（同文件既有 64 阈值先例；100 > 64 → sidecar 政策正例）。核验：断言集逐字未动；rec1 经阈值/存储/CRC 全检 ok（复跑绿）；rec2 的 frameOffset 非规范在 §2.4 本体校验先行规则下不产生阈值噪音。**与 SA6 获授权的「4097B ×2」属同一冲突类、同一处置模式**；总控已接受留 SA4 复核——本判定维持。R-1b 未改动（其断言为 ok=false 方向，阈值 issue 叠加无害，复验通过）。

### 3.3 SA3 备案 ③（definitive errno 封闭集 {EISDIR,EACCES,ENOENT}）——**判定：严格成立，方向保守**

- 设计 §3.2.1 definitive 定义 = 「打开目标路径即失败的 EISDIR、EACCES、ENOENT（+ seam 声明 wroteBytes:0）」——实现封闭集恰为设计列举三类；`errnoOf` 无 code → 'EUNKNOWN' → ambiguous（设计「未知 wrapper/interceptor throw 默认归 ambiguous」）。
- POSIX 层论证：`appendFileSync` = open(O_WRONLY|O_APPEND)+write+close；EISDIR/EACCES/ENOENT 均为 open(2) 期错误，write(2) 错误集（ENOSPC/EIO/EFBIG/EDQUOT/EPIPE/…）与之不相交——errno 分类忠实还原「open 期」语义，且 write 期 ENOSPC 归 ambiguous 有 /dev/full 实测锚（SA6 锚 7：open 成功、write 恒 ENOSPC → 密封而非复用）——「不得以 errno 猜零写入」边界成立。
- 残余（SA3 已备案）：exotic 文件系统 write 期 EACCES 理论误归 definitive → candidate 复用。后果有界：最坏产生部分行/重复 sequence，由 reader 以 invalid-json/sequence-out-of-order 响亮判 corrupt（非静默错乱）；POSIX 本地文件系统上该错误形态实际不可达。误分类安全方向核验：definitive→ambiguous 误判仅多密封一代 generation（安全），本轮唯一危险方向（ambiguous→definitive）被封闭集排除。**接受，记 SA7 动态面**。

### 3.4 R2-G19（{capture:'none'} 恒合法）——✅ 落实

`inputPolicyViolation`（reader.ts:250-272）：非 digest 分支 `capture==='none'` 在全部四 policy 下返回不违规；`policy==='none'` 时 not-accessed/unavailable/unsafe-input 仍违规（capture!=='none' → true）；digest 分支在 none policy 恒违规（含带/不带 marker 双路）。与裁决逐句吻合；测试正例（L685「none manifest + {capture:none} → ok」）+ 违规阶梯（L742）双向锚定。

### 3.5 R2-G20（gap 归因=发现记录）——✅ 落实

`sequence-gap` issue 携带**发现缺口的物理 record** 的 segment/offset/sequence（reader.ts:553-556，与兄弟码 `sequence-out-of-order`（L552，本轮顺带补齐归因字段）同构）。测试 `[1,3] → offset 1`（L1017）、起始 `[2] → offset 0`（L1028）、跨 segment `seg2 offset 0`（L1038）三向钉死；r2-supplemental 归因不绑值（存在性断言）与两种归因取值兼容——无冲突。

### 3.6 R2-G21（fallbackLog 通道、冻结事件字段不动）——✅ 落实

`commitAmbiguous`（file.ts:264-283）：事件仅发既有冻结形状 `{type:'storage-write-failed', stage, code, operation?}`（零新字段）；「sequence N may not be persisted: … old generation sealed, no in-place retry」经 `fallbackLog` 行通道；不断言缺失。SA6 `assertMayNotBePersistedEvidence` 双通道（events 序列化文本 ∪ logLines）锚定 ×3 用例 + max 变体全绿。

### 3.7 版本 bump 与 G18 码表

- `package.json` 0.1.1→0.1.2 ✅（硬门禁 9）。
- G18 六码逐字落实（reader.ts:512-537、555）：五 record 级 `manifest-update-capture-violation` / `manifest-input-policy-violation` / `manifest-inline-threshold-violation` / `manifest-sidecar-threshold-violation` / `manifest-line-limit-exceeded` + stream 级 `sequence-gap`；无族 A `policy-*`、无 `sequence-start-invalid`；`[2]`/`[1,3]` 统一 `sequence-gap`；六码均不入 `INCOMPATIBLE_SET`（corrupt + records 逐条保留，未知格式行为不变）✅。提交点分配（§3.2 双阶段）、definitive/ambiguous 二分、genesis/capture 正交（#9 锚）、EISDIR 恢复锚语义中立（mismatch-interference 11 测试复跑绿）均按 G18 (b)(c)(d) 落实。

### 3.8 ADR 0012 amendment vs 设计 §4.1/§4.2/§4.3 逐条对照——✅

| 设计要求 | ADR 落点 | 判定 |
|---|---|---|
| §4.1 取代关系（非并列） | 「在首切片 File adapter 的当前实现范围内**被以下条款取代**」 | ✅ |
| 每 emit ≤1 条 JSONL 有界同步 append + sidecar BIN-first ≤1 帧；无 queue/batch/fsync 开关/常驻 fd；不构成 fsync/掉电承诺 | amendment 首段 | ✅ |
| 「有界」定义（数据量/操作数，非磁盘延迟上界、非任意调用点不阻塞） | amendment 第二段 | ✅ |
| write-slot 外 MUST + void/non-throwing/no-durability-promise + #149–#151/#155 修复后方可启用 | amendment（加粗 MUST 规范性接线条件） | ✅ |
| 演进路径（公共 seam/schema/policy/slot 隔离不变前提下可替换 queue/batch；须另行定义 close/shutdown/flush/队列满/fsync） | amendment 末段「目标演进形态而非并列当前要求」 | ✅ |
| §4.3 被否方案四条 | 被否方案段新增 4 条逐条对应（同步称实现细节 / slot 内执行 / 有界=延迟承诺 / 现在实现异步 queue/batch） | ✅ |
| 后果/权衡（EISDIR 恢复简化、消除内存-磁盘孪生态 vs 调用方可被阻塞；仅 slot 外接线保 ADR-0011 隔离） | 后果段「首切片取舍（2026-08-28 amendment）」 | ✅ |
| ADR 状态保留 accepted；ADR-0011 正文不动 | 状态头未改（已接受）；0011 不在 diff | ✅ |

两处非阻塞备注：① amendment 增补一句设计草稿没有的澄清（「retention、queue 容量、batch/flush 策略、fd cache 与 metrics sampling 可动态调整的既有条款对首切片继续成立」）——保护既有可调条款不被取代条款误伤，与设计精神一致，无害；② 设计 §4.1 草稿把 write-slot MUST 独立成段，ADR 合并入同段——语义等价。

### 3.9 红锚转绿证据独立性

SA3 声称 29 红锚全转绿 + 276 存量零回退。本 SA4 独立进程复跑 `vitest run packages/namespace-diagnostic-log/test` → **19 文件 / 305 测试全绿 / 0 type errors / EXIT=0**，与 SA3 `.mabf-bg/sa3-full-run.log` 一致；SA3 基线红日志 `.mabf-bg/sa3-baseline-red.log` 尾部 `29 failed | 276 passed, EXIT=1` 与 SA6 报告逐字一致；`pnpm test` 全仓（SA3 日志 EXIT=0）与 `pnpm typecheck`（SA3 日志 + 本 SA4 复跑均 EXIT=0）在案。测试质量：注入手段全部真实运行时行为（目录占位 EISDIR、segments 删除 ENOENT、/dev/full 符号链接 write 期 ENOSPC、Proxy getter trap），零 mock 桩、零源码 grep 断言、零同义反复断言（#10 锚 `toEqual(['manifest-update-capture-violation'])` 恰一码 + 无假 gap 双向钉死）。

### 3.10 其余设计条款抽验

- §2.1 行字节定义：`splitRawLines` 按 0x0A 字节扫描、行 byteLength 排除单个 `\n`、逐行 `TextDecoder` 子串解码（避免 whole-buffer 字节索引切串错位）✅；行长检查先于 JSON.parse（超限+坏 JSON → 双码）✅；中间空行 invalid-json 语义保持 ✅。
- §2.2 genesis 豁免（`kind !== 'genesis-baseline'`）+ capture=true 不反向强迫 ✅；fatal committed:true/effect:update 计入 carrier（SA6 锚 1 第二例）✅。
- §2.4 阈值仅在 carrier 本体校验通过后运行（storageIssue!==null 时短路）；inline N 取 `payloadLength`（`validateInlineCarrier` 已验 `decoded.length === payloadLength` + CRC，可信）；边界 `≤`/`>` 两侧互补 ✅。
- §3.2 双阶段：`candidateSequence()` 无副作用；preview（assembleAttempt/runGenesis 构造时）与提交点 candidate 之间无状态写入路径（prepareRecord 纯 notify）→ 恒一致；`{...prepared.record, sequence: candidate}` 物化 + `encodeFrame(record.sequence,…)` 同源 ✅。encode/decode 自检失败按提交前 gate 处理（零写入、不消耗）✅。
- §3.3：exhausted 仅 `commitConfirmed` 且 `=== UINT64_MAX` 恰一次；ambiguous max 不触 latch 只密封（SA6 锚 11 三变体绿）✅；`presetLastSequence` 语义收紧为 lastCommittedSequence ✅；`injectFinalRecordFile` 不分配不推进、ambiguous 保守密封（备案方向与 emission 一致，设计未细述面——保守正确）✅。
- 构造期 genesis ambiguous 密封经 `sealed` 标记防 `mode='ready'` 覆盖（file.ts:775-776）✅。
- BIN-ok + JSONL-definitive 交错（orphan + candidate 复用）：按设计伪代码实现（复用）；核验 `validateSidecarFrame` 首个被引用帧 `expectedOffset===null` 不做 boundary 检查——恢复后引用新帧可判 ok（orphan 留作诚实残态，两种终态均诚实）；SA3 已备案为已知容忍，与设计 §6 风险表一致，无测试锚（记 SA7 动态面）。

## 4. 极端条件攻击清单（§5）

| 攻击 | 结果 |
|---|---|
| `[1,3]` / `[2]` / 跨 segment gap / 重复 / 倒序 / 多重 gap `[1,3,5]` | 全部响亮 corrupt；gap 归因发现记录；倒序不改 expected（后续连续不产生二次噪音）✅ |
| 不可锚定行（坏 JSON/VFSL/streamId）后接高 sequence | 不拼接精确缺口（null 基线）；stream 因自身 issue 恒 corrupt，无 false-ok 路径 ✅ |
| policy 违规记录夹在连续流中间（#10） | 恰一 policy 码，后续 record 无假 gap ✅ |
| 阈值边界 4096/4097 四象限 + 阈值 0 推论（仅 0 字节可 inline） | `≤`/`>` 严格双向；测试覆盖四象限 ✅ |
| 多字节 UTF-8 行超限（JS 字符数未超） | 字节计量捕获（`'界'` 类 fixture）✅ |
| manifest 负阈值/0 阈值 | reader 忠实执行冻结 policy（诊断面语义，非正确性洞）✅ |
| sequence 超出 uint64 值域十进制串 | 设计 §3.4「VFSL 应先拒」假设**机械上不成立**（P_DECIMAL 正则不封长度，仅文档语义 uint64）；实际后果仍诚实：作为 gap/out-of-order 判 corrupt，永不 false-ok；false-ok 需物理构造 2^64 条连续记录——不可达。观察 O-2，不阻塞 |
| sealed 后续 emit / 注入 | mode-gate 静默拦截（round-1 语义，设计「no later append」）✅ |
| 构造期 genesis ambiguous | sealed 防覆盖 + failed 模式 ✅ |
| inject 失败 ambiguous → lastCommittedSequence 被写 | 后续 emit 被 sealed mode-gate 拦截，该写入不可观察（inert）✅ |

## 5. 动态审核重点（交 SA7）

1. **write 期 EACCES 误分类残余**（§3.3）：实际自托管 runner 文件系统上无 write-期 EACCES 样本即可关闭；如遇 exotic fs（NFS/FUSE）需关注。
2. **BIN-ok + JSONL-definitive 交错终态**（§3.10 末条）：真实恢复路径产出的 orphan + 复用 candidate 流，strict reader 实测判 ok 还是 frame-boundary-invalid（静态推演为 ok：首引用帧无 boundary 检查）；无测试锚，建议动态补证。
3. **并发半行**（README 既有声明）：R2 行长检查以文件当前字节为准——活跃 writer 并发读仍按既有「静态 stream」契约声明，SA7 无需新证，仅需确认 README 声明未回退。
4. **CI 触发证据**：PR CI `Test` step 日志摘录 namespace-diagnostic-log 19 文件收集行（§1.4 静态结论的动态确认）。

## 6. 观察备案（非阻塞，无需回流）

- **O-1** 密封/耗尽后的 emit 静默丢弃无 per-drop 事件——emission 词表冻结（DENY），现状为契约正确行为；未来词表演进可考虑 drop 计数。
- **O-2** P_DECIMAL 正则不机械封 uint64 值域（设计 §3.4「VFSL 应先拒」为语义层假设）；reader 行为仍诚实。若未来需封闭，归 schema 演进票（#148 冻结，本票禁改）。
- **O-3** SA3 于 SA6 域文件（r2-supplemental R-1a）的一处夹具改动：属 SA6 获授权同批冲突类、经备案+总控接受+本 SA4 判定语义保持（§3.2）——流程闭环，无需回退；后续轮次同类改动建议仍由 SA6 落笔以保持域纪律。

## 7. 验证证据回放

| 命令 | 结果 |
|---|---|
| `git diff --name-only fde8034 f52eccb` | 10 文件（§1 清单）；DENY/BLACKLIST 零命中 |
| `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（SA4 独立后台进程） | Test Files 19 passed (19)；Tests 305 passed (305)；Type Errors no errors；EXIT=0 |
| `pnpm typecheck`（SA4 独立后台进程） | EXIT=0（10 包） |
| `git diff --check fde8034 f52eccb` | 干净 |
| `.mabf-bg/sa3-baseline-red.log` 尾部 | 29 failed \| 276 passed (305)，EXIT=1（与 SA6 报告一致） |
| `git show fde8034:…reader.ts` L402-408 / `file.ts` L235-240 / L385-397 | 设计 §9 协议假设引用逐字相符 |

**Verdict: pass** — SA7 可进入动态验证（重点见 §5）。
