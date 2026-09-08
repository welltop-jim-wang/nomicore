# SA4 静态验尸报告 — File diagnostic-log adapter（issue #152）

**Date**: 2026-08-28（R1）· 2026-08-28（R2 复审，追加于文末）
**Verdict**: R1 轮 **reject**（§二/§三）→ **R2 复审轮 pass**（commit `cb44bcd`，见文末「SA4 R2 复审轮」；**当前生效 verdict = pass**）
**R1 摘要**：1 × REJECT 级实现缺口 R-1（P_DECIMAL 镜像漏 frameOffset 消费面 → strict reader 假 ok，PoC 实证）+ R-2（writer 注入门未镜像，sequence '01' 落盘零事件）+ R-3（carrier.ts P_BASE64 字面量脱离单源）——R2 轮全部消除并经独立重跑实证（PoC A/B/C 对照 + R-3 等价性 20 探针 + 4 条新锚定测试逐名触发）

**被审对象**：基线 `7ceede1` → HEAD（`56ed694` + `0ec62e9`）；设计 R2（含总控 §11 六项裁决 + J9 裁决）；SA2 R2 pass（附 R2-1 强制项）。
**审查方法**：全新视角静态审读全部新增/修改源码 + 运行时实证（VFSL 引擎行为探针、4 个 PoC 直打 `readStreamStrict`/`injectFinalRecordFile`、全量测试复跑）。全部结论附可复现命令与实测输出，非纸面推断。

---

## 一、门禁快照（skill 立法项逐条）

| 门禁 | 结果 | 证据 |
|---|---|---|
| §1.1 Scope Creep Guard | ✅ 干净 | actual 18 文件全部落在 ALLOW LIST / SA6 测试域 / wiki 白名单；DENY LIST（schema.ts、memory.ts、pipeline.ts、emission.ts、record.ts、schema-patterns.ts、crc32c.ts、digest.ts、package.json、pnpm-lock.yaml、packages/vfsl/**）逐一 diff 为空；BLACKLIST（package-lock.json/yarn.lock/TASK.md/*.bak/.DS_Store）零命中。SA6 owned 文件仅两处改动：`file-adapter-genesis-results.test.ts:90` 与总控勘误裁决逐字一致（`expect(result.kind).toBe(idx === 1 ? 'fatal' : 'committed')`，commit 0ec62e9）；`test/helpers/file.ts` 为红灯日志自锚定的两处 TypeCheckError 基础设施修复（值导入 + Partial 装配 seam），非断言逻辑 |
| §1.3 E2E spec 触发性 | N/A | 本票无 `*.spec.ts` |
| §1.4 vitest 触发性 | ✅ 接通 | 根 `pnpm test` = `vitest run --typecheck`，`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖本包全部 7 个 file-adapter 测试文件；CI（`.github/workflows/ci.yml`）node 20/24 矩阵执行；`pnpm typecheck` 含本包 tsconfig。**1.4 vitest 触发性自检：all-vitest-packages-triggered（根 pnpm test include 覆盖本包全部 file-adapter 测试文件；CI node 20/24 矩阵执行）** |
| §1.5 协议假设复核 | ✅ 属实 | §13 全部假设复验：`statSync(目录).size=4096/isFile=false/不抛`、`statSync(缺失,{throwIfNoEntry:false})=undefined`（本 worktree node -e 实测）；appendFileSync 创建语义 / `'wx'` EEXIST / EISDIR / rename 均被绿测试锚定。**但 §13 漏登一条被设计实际依赖的引擎行为假设——见 R-1（VFSL Pattern alternation 语义）** |
| §1.6 契约改动连锁 | ✅ 零改动 | index.ts/testing.ts/health.ts/carrier.ts 全部只增不改；无既有 export 的 throw/return 契约变化；包外零消费者（设计 §14 审计复核属实） |
| §1.7 源码 GREP 断言禁令 | ✅ 干净 | 4 个测试文件的 `readFileSync` 全部读**数据产物**（manifest/bin/jsonl/fixture），`toMatch/toContain` 全部断言运行时值（streamId 形状、base64 输出、issue code），无「读 .ts 源码做字符串断言」反模式 |

**测试复跑（独立进程）**：`npx vitest run --typecheck packages/namespace-diagnostic-log` → **252 passed (252)，Type Errors: no errors，exit 0**；`npx vitest run`（全仓）→ **136 文件 1657 passed，exit 0**。SA3 报告的绿灯声明属实（1657 = 1656 + 勘误后转绿的 1 条）。

---

## 二、总控指定审查项：SA3 裁决 2（P_DECIMAL 补齐）三问

### 2.1 补齐是否正确 → sequence 面**正确** ✅

`src/reader.ts:81` `RE_P_DECIMAL = new RegExp(P_DECIMAL)` + `:375 sequenceShaped = sequence !== '' && RE_P_DECIMAL.test(sequence)`：

- JS 正则对冻结常量的语义忠实（探针实测：`''`/`'01'`/`'0123'`/`'0999999'` 均拒；`'0'` 与全部规范十进制均过；无假阳性）；
- `sequence !== ''` 守卫额外封掉引擎的**空串放行**面（探针：引擎对 `''` 返回 true——alternation 两臂全可跳过）；
- 无 `/g` 标志，无 lastIndex 状态污染；
- 与 SA6 前导零红灯（strict-reader.test.ts:510，断言 status corrupt + record not ok）精确对合。

### 2.2 单源纪律是否保持 → **基本保持，一处例外（MINOR R-3）** ⚠️

- `reader.ts` / `testing.ts`（`createFileDiagnosticLogPresetSequence` 的 R2-1 loud 校验）/ `paths.ts`（P_STREAM_ID/P_SEGMENT）三处镜像全部 `import` 冻结常量构造 RegExp——J12 单源纪律保持 ✅；
- **例外**：`src/carrier.ts` `decodeBase64Strict` 把 P_BASE64 以**字面量重打**（`/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|...)$/`）而非 import `P_BASE64` 常量。当前逐字符相同（实测比对），但这是包内唯一一处 Pattern 脱离 schema-patterns.ts 单源的 TS 校验点——冻结常量若被引用漂移，此处静默失联。一行 import 修复。

### 2.3 是否还有其它 alternation Pattern 受同 quirks 影响而未补 → **有，这就是本报告的唯一 REJECT 项（R-1）** ❌

冻结 Pattern 中含 alternation 的共两枚：`P_DECIMAL`（`^(0|[1-9][0-9]*)$`）与 `P_BASE64`（三臂尾组）。其余七枚（P_STREAM_ID/P_BOUNDED_STR/P_ISO_MS/P_STABLE_CODE/P_CRC32C_HEX/P_SHA256_HEX/P_SEGMENT）探针实测与 JS 正则零分歧，不受影响。

**引擎缺陷根因（实证定位，非推断）**：`packages/vfsl/src/pattern.ts` Codegen `alt` 分支的臂退出跳转 `jmp` 目标为 `this.prog.length + 1`（下一臂的 split 槽）而非 alternation 续点。最小复现与指令转储：

```text
$ tsx -e（脚本 /tmp/sa4-rootcause.ts，import pattern.js compile/match）
pattern '^(a|b)$'  prog: 0:assertStart 1:split(2,4) 2:char'a' 3:jmp(4) 4:split(5,6) 5:char'b' 6:assertEnd 7:match
engine test "ab" = true   | JS = false      ← 3 号 jmp 本应指向 6（assertEnd），实际指向 4（b 臂 split）
engine test ""   = true   | JS = false      ← 两臂经 split-y 全跳过 → 空匹配
```

即引擎把 `A|B` 的接受语言放大为「按臂序的可选串接」`A?B?`。由此：

| Pattern | 引擎放行而规范应拒（探针实测） | 消费面 | 是否有第二层防线 | 结论 |
|---|---|---|---|---|
| P_DECIMAL → **Sequence**（schema.ts:40） | `''`、`'01'`、`'0123'`、`'0999999'` | reader :375 已镜像 | — | ✅ 已补（正确） |
| **P_DECIMAL → FrameOffset（schema.ts:63）** | 同上四值 | **reader 无镜像；writer 注入门无镜像** | 无 | ❌ **R-1 漏洞** |
| P_BASE64 → Base64（schema.ts:57） | `''`、`'AB==ABCD'`、`'ABC=ABCD'`、`'AB==ABC='`（内部 padding） | carrier decodeBase64Strict | ✅ decode→re-encode 恒等判定（PoC D：`'AB==ABCD'` → corrupt + `base64-invalid`；`''` → length 0 → null） | ✅ 已被 storage 门全覆盖 |

---

## 三、REJECT 项

### R-1（REJECT）strict reader 对非规范 `frameOffset` 字面判 ok——同一冻结 Pattern 的第二消费面未补齐

**位置**：`src/reader.ts:321-343`（checkSidecar）——`BigInt(carrier.frameOffset)` 前无任何 P_DECIMAL 镜像复核；`src/adapters/file.ts:359-381`（checkInjectedSidecarFrame）同款。

**可复现证据**（PoC 脚本完整见附录 A；运行于本 worktree，node v24.13.0）：

```text
[PoC A] frameOffset:"0125"（帧真实在 125，前帧 offset '0' 规范引用）
  status = ok | issues = [] | records ok = [ true, true ]
  >>> 非规范前导零 frameOffset 被 strict reader 判 ok

[PoC B] frameOffset:""（空串）
  status = ok | issues = [] | records ok = [ true ]
  >>> 空串 frameOffset 被 strict reader 判 ok（BigInt('') === 0n → 偏移 0 → 帧校验全过）
```

前置事实链（全部实测）：

1. `validateLogicalSnapshot` 对 `frameOffset: ''` 的完整 attempt record 返回 `{ok:true}`（引擎空匹配放行）；
2. reader 的 P_DECIMAL 镜像只复核 `sequence`（:375），`carrierFromParsed` 提取的 sidecar carrier 直达 `BigInt(frameOffset)`；
3. Node 24（本仓 engines/CI 矩阵之一）`BigInt('') === 0n` → 首帧偏移 0 → 边界/魔数/CRC 全过 → **整条 stream 判 ok**。Node 20（CI 矩阵另一半，V8 11.x）`BigInt('')` 预计 throw → 同一输入落 reader 兜底 ⑧（records:[] 全灭 + 误导性 `manifest-invalid`）——两种运行时两种缺陷形态，均非正确判定。

**影响**：

- 直接击穿 **AC4**（"The strict reader validates … references, offsets, **formats** …"）与 SA6 简报 §2 JSONL 纪律（"sequence 十进制无前导零字符串；frameOffset 为十进制字符串"——schema.ts:62 冻结注释明示「十进制**无前导零**字符串」）；
- strict reader 的存在意义是对损坏/篡改 stream 的诚实判定：本票花大力气保证 `sequence` 前导零被拒（SA6 红灯锚定、SA3 补齐、总控裁决 2 认可），而同一冻结 Pattern 的孪生字段 `frameOffset` 对同类违规**静默判 ok**——「约一半的格式纪律被无声放弃」；
- SA6 红灯未锚定 frameOffset 前导零（strict-reader.test.ts 全部用例用 `'0'`/`'10'`/`'131'`/`'99999'` 规范字面），故绿灯掩盖该缺口——这正是静态验尸要抓的「测试未锚定的真缺口」。

**回流目标**：**SA3**（实现级补齐， sanctioned 方式的自然延伸，无需 SA1 新设计轮；请总控对「镜像复核扩展到 frameOffset」做一句裁决背书即可）：

- reader：`checkSidecar` 入口对 `carrier.frameOffset` 做同款复核（`frameOffset !== '' && RE_P_DECIMAL.test(frameOffset)` 不过 → record 级 `vfsl-invalid`，与 sequence 补齐同层同码）；
- writer 注入门 `checkInjectedSidecarFrame` 同步镜像（与 R-2 同一改点）；
- 建议把镜像复核提为一个局部小函数（`isCanonicalDecimal(s)`）供 sequence/frameOffset/preset seam 三处共用，消除第三份重复。

**根因登记（上游，另立票）**：`packages/vfsl/src/pattern.ts` alternation codegen 缺陷影响**全部域 schema 的全部含 alternation Pattern**（`'a|b'` 接受 `'ab'`），非本包独有。`packages/vfsl/**` 在本票 DENY LIST，SA4/SA3 均不得修；建议总控向 vfsl owner 立 issue（engine 修复后本包镜像可整体退役）。#148 的 memory adapter `records()` 门同受影响（sequence '01' 放行）——#148 冻结面，同归上游票。

### R-2（MINOR，随 R-1 同改）writer 注入门放行 `sequence:'01'`——写出自身 reader 必拒的 record

**可复现证据**（PoC C）：

```text
injectFinalRecordFile(log, { ...attempt, sequence: '01', inline carrier })
  writer 落盘 = "{\"recordKind\":\"attempt\",\"streamId\":\"log-0ef4480d…\",\"sequence\":\"01\",…  ← 已写入 JSONL
  writer 事件 = []                                    ← 无任何事件（VFSL 门放行）
  reader status = corrupt | codes = ["vfsl-invalid"]   ← 自家 reader 判损坏
```

**影响**：AC3「Final physical records pass the built-in VFSL schema … before append」在引擎按字面执行下不成立——writer 门写入了违反冻结 schema 语义（schema.ts:38 注释「无前导零」）的物理 record。可达面仅 testing 接缝（emission 路径 sequence 恒规范）；reader 已补故无终态假 ok——降为 MINOR。**回流**：SA3 在 `writeRecord` 的 VFSL 门旁挂同一镜像（sequence + frameOffset 一并），恢复 writer/reader 门对称。

### R-3（MINOR）carrier.ts 脱离单源的字面量正则

见 §2.2。`decodeBase64Strict` 内 P_BASE64 字面量改 import 冻结常量（现字符串逐字符相同，行为无差；纯纪律修复）。**回流**：SA3，一行。

---

## 四、审核结论（skill 八项）

1. **设计一致性**：⚠️ 偏离 1 处（R-1/R-2：设计 §7.1 B「P_DECIMAL 拒 '01'」的前提——引擎会拒——不成立，总控裁决 2 批准的镜像补齐只落了 sequence 一半；其余 §3 状态机/§4 管线/§6 门/§7 reader/§8 事件逐条对合：manifest 恰 14 键+类型核对+身份互核+G4-G9 码映射、BIN-first、fresh-stat offset（`statSync{throwIfNoEntry:false}`+`isFile()`）、exhausted 门闩恰一次、构造级 crash 包络（`streamId ??= 'log-'+0×32`）、genesis 守卫顺序与 G2/G10、R2-1 loud 校验、§7.4 十五步短路链与边界语义（含「首帧先验 magic、非首帧 boundary 先于 magic」「校验失败不推进 expectedOffset」）全部与设计一致）。
2. **读写路径一致性**：✅ 一致——writer/reader 共享 `paths.ts` 布局派生、`frame.ts` 编解码、`storage-gate.ts` 校验原语、`schema.ts` 冻结常量；无数据源分叉（R-1 属同源 Pattern 的门缺口，非分叉）。
3. **静默失败**：✅ 无未授权静默——全部丢弃路径有事件（§4.4 表逐行核对实现：三守卫/line 预算/降级/VFSL/storage/offset 规划/bin/jsonl/构造面/append 面顶层）；授权静默面（mode≠ready、exhausted 后、genesis 守卫跳过 G10、resume 匹配 G1）均按裁决落地。**R-1 的 frameOffset 假 ok 是唯一「违规静默」，已立案**。
4. **降级方案**：✅ 安全——binLength 缓存已按 R2 废除（grep 无存活用法），fresh-stat 自愈由 R2 补充测试实证（EISDIR 恢复后 `frameOffset:"125"` + reader 全绿；truncate 变体绿）；current.json 失败不禁用 + best-effort tmp 清理按 §2.3。
5. **极端攻击**：❌ 发现 R-1（前导零/空 frameOffset 判 ok）、R-2（注入 sequence '01' 落盘）；另探明并确认已覆盖面：P_BASE64 内部 padding（storage 门拒）、重复/乱序 sequence、重叠帧引用（boundary 拒）、BOM/无换行尾块（invalid-json）、jsonl ENOENT 零行无 issue、bin 目录占位（frame-missing）、manifest 第 15 键/类型篡改/身份篡改、双门互不干扰。
6. **错误处理**：✅ 完整（构造面/append 面/注入面三层 try/catch + reader 全函数兜底实测不抛；R2-1 入参 loud 校验实测拒 `'18446744073709551615'`/`'01'`/`'abc'`）——唯一缺口即 R-1（`BigInt('')` 依赖运行时 coerce 行为，未分类）。
7. **架构评估**：✅ 可行——无死胡同信号；镜像补齐方式是引擎修复落地前的正确消费者侧防线，只需补全第二个消费面。
8. **过度设计**：✅ 精简——无设计外抽象；`StrictReadRequest` 命名类型为 SA6 内联类型的无害提取。

---

## 五、动态审核重点（交 SA7）

| # | 风险点 | 验证方式 | 判定锚 |
|---|---|---|---|
| D1 | **Node 20 CI 矩阵上 `BigInt('')` 行为**：预计 throw（V8 11.x，StringToBigInt 未对齐 ToNumber 前的语义）→ R-1 空串变体在 node-20 job 表现为 reader 兜底 wipe（records:[] + manifest-invalid）。修复后两矩阵均应为 record 级 `vfsl-invalid` | node 20 单元跑附录 A PoC B；并摘录 CI 两 job 的 spec 触发证据（file-adapter-* 在 vitest run 中被执行） | 修复前：两形态均非 ok 判定缺陷；修复后：corrupt + vfsl-invalid |
| D2 | SA6 五文件 + R2 补充 15 条在 PR CI（node 20/24 矩阵）全绿且确被执行 | `gh run view --log` 摘录 `file-adapter-strict-reader` / `file-adapter-r2-supplemental` 触发行 | 252 passed 复现于 CI |
| D3 | EISDIR/append-创建/'wx'-EEXIST/rename 原子在 CI runner 文件系统上的行为（§13 假设的运行时面） | 既有 mismatch/r2-supplemental 用例即锚定，无需新增 | 全绿 |
| D4 | R-1 修复后回归：PoC A/B 输入 → corrupt + record 级 vfsl-invalid；既有 252 绿不退化 | 复跑附录 A 脚本 + 包套件 | 252+新增断言全绿 |

---

## 附录 A：PoC 脚本与实测输出（2026-08-28 于本 worktree）

- **A-0 引擎探针**（`/tmp/sa4-vfsl-quirk.ts`，逐常量 import `packages/vfsl/src/pattern.js` 的 compile/match，与 `new RegExp(常量)` 对比）：9 模式 × 探针集，**8 处分歧全部集中于 P_DECIMAL（`''`/`'01'`/`'0123'`/`'0999999'`）与 P_BASE64（`''`/`'AB==ABCD'`/`'ABC=ABCD'`/`'AB==ABC='`），引擎放行/JS 拒**；其余模式零分歧（节选）：

```text
P_DECIMAL ""          engine=true  js=false  <<< DIVERGENCE
P_DECIMAL "01"        engine=true  js=false  <<< DIVERGENCE
P_DECIMAL "0123"      engine=true  js=false  <<< DIVERGENCE
P_DECIMAL "00"        engine=false js=false     （'00' 被拒——第二臂须 [1-9] 起头）
P_BASE64 "AB==ABCD"   engine=true  js=false  <<< DIVERGENCE
P_BASE64 "AB CD"      engine=false js=false     （空白不受影响）
DIVERGENCES: 8
```

- **A-1 根因转储**（`/tmp/sa4-rootcause.ts`）：见 §2.3——`jmp` 指向下一臂 split。
- **A-2 reader/writer PoC**（`/tmp/sa4-poc-frameoffset.ts`）：PoC A/B/C/D 全文要点已内嵌 §三；构造方式 = 复用与 SA6 相同的 fake stream 手工夹具形态（`writeStreamFixture` 同构：manifest 14 键规范值 + JSONL 手写 + `encodeFrame` 造 bin），reader 直打 `readStreamStrict`，writer 直打 `injectFinalRecordFile`。
- **A-3 测试复跑**：`/tmp/sa4-pkg.log`（252 passed, exit 0）、`/tmp/sa4-full.log`（136 files 1657 passed, exit 0）、`/tmp/sa4-pkg.exit` = `/tmp/sa4-full.exit` = 0。
- **A-4 statSync 假设**：`node -e` 实测 dir→`size=4096,isFile=false`；missing+throwIfNoEntry→`undefined`（与设计 §13 登记一致）。

## 附录 B：SA3 实现报告三裁决的复核

| 裁决 | 复核 |
|---|---|
| 1. genesis-results.test.ts:90 自相矛盾断言 | ✅ 证据链成立（冻结 record.ts AttemptResult 判别联合 + #148 record-vocabulary.test 同语义）；0ec62e9 修改与总控勘误逐字一致，其余断言未动（diff 仅 +3/-1 行） |
| 2. P_DECIMAL 镜像补齐 | ⚠️ 方向正确、sequence 面正确、单源保持；**但同 Pattern 的 FrameOffset 消费面未补（本报告 R-1），writer 注入门未补（R-2）**——「同层复核」只落了一半 |
| 3. helpers/file.ts 基础设施修复 | ✅ 与红灯日志锚定的两处 TypeCheckError 对应；helper 为夹具层（断言仅 `checkInlineCarrier` 的数据语义校验），无断言逻辑改动迹象 |

---

**结论（R1 轮）**：架构、门序、事件纪律、降级设计、测试绿灯与 CI 接线全部成立；唯一实质缺口是总控指定审查项第三问的答案——**有未补面（FrameOffset），且已实证造成 strict reader 假 ok**。按最小变更原则，SA3 以 ≤10 行完成 R-1/R-2/R-3（+ 建议的 `isCanonicalDecimal` 收口）后本票即可转 pass；vfsl 引擎 alternation 缺陷请总控另立上游票。

---

# SA4 R2 复审轮（fix commit `cb44bcd`，2026-08-28）

**Verdict**: **pass**（R1 三项回流全部消除并经独立实证；无新问题引入；附 2 条非阻塞 backlog 备注）

**复审范围**：仅 R1 修订点（cb44bcd 对 `0ec62e9` 的 diff：src 5 文件 + supplemental 测试 +74 行 + wiki）；关键行为全部独立重跑实证，不采信 SA3/总控自述（总控亲验 256 绿为背景，本报告自带证据链）。

## 1. 修复与 R1 建议的对合（修法是否符合建议 → **完全符合**）

| R1 要求 | cb44bcd 落地 | 判定 |
|---|---|---|
| R-1：reader 对 `carrier.frameOffset` 做同款 P_DECIMAL 镜像（同层同码 vfsl-invalid） | `reader.ts:320` `checkSidecar` 入口 `if (!isCanonicalDecimal(carrier.frameOffset)) return 'vfsl-invalid'`——**先镜像后解析**，非规范字面在 `BigInt()` 之前被拒 → R1 动态项 D1（Node 20/24 `BigInt('')` 行为分歧）**由构造消除**（字符串不再到达解析层） | ✅ |
| R-2：writer 注入门同镜像（sequence + frameOffset） | `file.ts:435/:442`（VFSL 门后、storage 门前）：违规 → `storage-validation-failed{code:'vfsl-invalid'}` + return 零落盘 | ✅ |
| R-3：carrier.ts 改 import 冻结常量 | `RE_P_BASE64 = new RegExp(P_BASE64)` 单源；删除两枚字面量 | ✅ |
| R1 附带建议「提为局部小函数 `isCanonicalDecimal` 三处共用，消除第三份重复」 | `storage-gate.ts:26` 导出 `isCanonicalDecimal`（`value !== '' && RE_P_DECIMAL.test(value)`，冻结常量 import）；**四个消费面全部收口**——reader sequence（:372）、reader frameOffset（:320）、writer 注入门（:435/:442）、preset seam（testing.ts:112） | ✅ 建议被采纳 |

**修法增量裁决复核**（cb44bcd 自行引入、R1 未逐字规定的两点）：

- `storage-validation-failed.code` 增第 6 值 `'vfsl-invalid'`：类型为开放 `string`、按 G3「复用 reader 词表既有稳定码」同原则、且总控在修复轮指令中已明确该形状（"违规 → storage-validation-failed{code:'vfsl-invalid'} + 零落盘"）——**合规**。语义归属也正确（P_DECIMAL 字面违规在 reader 词表中即 vfsl-invalid）。遗留一行 cosmetics：`health.ts:63` 注释仍写 5 值集（见 backlog N-1）。
- reader 侧镜像置于 `reference-invalid` 之前：字面形状先于物理交叉，与 §7.3「逻辑形状先于物理交叉」的层序一致；既有 252 条测试零回归（suite 全绿）。

## 2. PoC 消除实证（同一脚本对照，2026-08-28 于本 worktree）

R1 的 `/tmp/sa4-poc-frameoffset.ts` **原样重跑**（未改一行），前后对照：

| PoC | R1（修复前） | R2（修复后，实测输出） | 判定 |
|---|---|---|---|
| A：`frameOffset:"0125"`（前帧 '0' 规范） | `status ok`，零 issue，records ok=[true,true] | `status = corrupt \| issues = ["vfsl-invalid"] \| records ok = [ true, false ]`（规范首帧不受连带） | ✅ 消除 |
| B：`frameOffset:""` | `status ok`（Node 24；Node 20 预期兜底 wipe） | `status = corrupt \| issues = ["vfsl-invalid"] \| records = 1, manifest 展示`（record 级归因，非兜底全灭） | ✅ 消除 |
| C：inject `sequence:"01"` | 违规 record 落盘、零事件；reader corrupt | `jsonl 存在 = false`（零落盘）`+ 事件 = ["storage-validation-failed/vfsl-invalid"] + reader ok/0 records` | ✅ 消除 |
| C′（新增变体）：inject sidecar `frameOffset:"01"` | —（R1 未单测；修复前预期 frame-missing 码落拒绝） | `jsonl 存在 = false + 事件 = ["storage-validation-failed/vfsl-invalid"]`（字面门先于帧存在性交叉） | ✅ 行为正确 |
| D：inline base64 `"AB==ABCD"` | corrupt + `base64-invalid` | 未变（本轮未触碰该路径） | ✅ 持续正确 |
| 回归：规范注入（sequence '1'/inline） | 落盘 + reader ok | `jsonl 存在 = true + 事件 = [] + reader ok + 首行 sequence = 1` | ✅ 无假阳性 |

**R-3 等价性实证**：旧实现（双字面量正则）与新实现（P_BASE64 镜像）对 20 输入探针集（`''`/`'AB=='`/内部 padding×3/`'AB='`/`'A'`/`'AAA='`/`'AAAA'`/`'AAAA='`/`'=AAA'`/空白/`'ABCD==='`/合法组）**逐输入一致，DIFF = 0**——删除的快速前置正则本就是 P_BASE64 的弱化子集，语义零漂移。

## 3. 新锚定测试真实触发性（非 vacuous）

```text
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts -t "R 修复轮" --reporter=verbose
 ✓ … > R-1a：frameOffset "0125"（前导零）→ corrupt + record 级 vfsl-invalid（不再判 ok）
 ✓ … > R-1b：frameOffset ""（空串）→ corrupt + record 级 vfsl-invalid（不依赖 BigInt("") 行为分歧）
 ✓ … > R-2a：注入 sequence "01" → storage-validation-failed/vfsl-invalid + 零落盘
 ✓ … > R-2b：注入 sidecar frameOffset "01"（前导零）→ storage-validation-failed/vfsl-invalid + 零落盘
      Tests  4 passed | 15 skipped (19)
```

四条测试**逐名执行且通过**；且其 fixture 形状与 R1 PoC 完全同构——R1 已实测同输入在修复前产出相反结局（A/B：status ok；C：落盘+零事件）→ 全部为**差分锚定**，不可能在未修复代码上通过（R-2b 的码值断言 `vfsl-invalid` 对修复前的 `frame-missing` 拒绝同样差分）。断言均为运行时行为（status/issue code/事件形状/文件存在性），无源码 grep 断言。

## 4. 修复有无引入新问题 → **未发现**

- **Scope**：cb44bcd 触及 src 5 文件全在 ALLOW LIST；supplemental 测试为本就由 SA3 落地维护的 R2 补充文件（设计 §9 R2 映射授权），追加而非改既有断言；wiki 白名单；DENY LIST 零触碰——**vfsl 引擎保持原样**（复跑 `/tmp/sa4-rootcause.ts`：`engine(/^(a|b)$/,"ab")=true` 仍在——正确的消费者侧定位，根因归上游票）。
- **依赖方向**：新增边 `storage-gate → schema-patterns`、`carrier → schema-patterns` 均指向零依赖叶子，DAG 无环（§1.1 纪律保持）。
- **emission 路径零扰动**：镜像门对 emission 不可达（sequence 恒 `allocate()`/`nextDecimal` 规范、frameOffset 恒 `String(offset)` 规范）——由既有 252 条测试全绿背书。
- **reader 层序**：frameOffset 镜像先于 `reference-invalid`/`frame-missing`——同违规双因时取字面码，与 §7.3 层序一致；expectedOffset 状态机不受影响（失败不推进，原有语义）。
- **测试复跑（独立进程，本轮）**：包 `vitest run --typecheck packages/namespace-diagnostic-log` → **18 文件 256 passed，Type Errors 0，exit 0**；全仓 `vitest run` → **136 文件 1661 passed，exit 0**——与总控亲验一致，R1 的 252/1657 基线 +4 条新锚定全绿零回归。

## 5. 非阻塞 backlog 备注（交 SA3/总控裁量，不影响 verdict）

| # | 备注 | 建议 |
|---|---|---|
| N-1 | `health.ts` `storage-validation-failed` 成员的 code 注释仍写 5 值集（`base64-invalid \| … \| frame-missing`），实际已含总控修复轮批准的第 6 值 `vfsl-invalid` | 一行注释同步（cosmetics；类型为开放 string，无行为影响） |
| N-2 | frameOffset 规范性检查位于两个 `validateSidecarFrame` **调用点**（reader/writer）而非原语内部——#153「打开与尾部恢复」新增调用点时须记得携带镜像 | #153 开工时把字符串形 frameOffset 与镜像复核折入 `validateSidecarFrame` 第 0 步（签名收字符串），使不可遗忘 |

## 6. R2 轮结论

R1 的 REJECT 项 R-1（strict reader 假 ok）与 MINOR 项 R-2/R-3 全部按建议消除，且修复方式在两处**优于**建议的字面（先镜像后解析根除 Node 版本分歧；四处消费面收口单函数）；4 条新锚定真实差分触发；包/全仓/类型三面独立复跑全绿；DENY 面与 vfsl 引擎零触碰（根因正确归位上游票）。

**Verdict: pass**（SA7 可进入动态验证；R1 动态项 D1 已由「先镜像后解析」构造性关闭，D2/D3 及修复后 CI 侧回归证据仍按 R1 §五交 SA7）。
