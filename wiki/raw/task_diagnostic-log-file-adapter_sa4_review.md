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
| §1.4 vitest 触发性 | ✅ 接通 | 根 `pnpm test` = `vitest run --typecheck`，`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖本包全部 7 个 file-adapter 测试文件；CI（`.github/workflows/ci.yml`）node 20/24 矩阵均执行；`pnpm typecheck` 含本包 tsconfig |
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

**结论**：架构、门序、事件纪律、降级设计、测试绿灯与 CI 接线全部成立；唯一实质缺口是总控指定审查项第三问的答案——**有未补面（FrameOffset），且已实证造成 strict reader 假 ok**。按最小变更原则，SA3 以 ≤10 行完成 R-1/R-2/R-3（+ 建议的 `isCanonicalDecimal` 收口）后本票即可转 pass；vfsl 引擎 alternation 缺陷请总控另立上游票。
