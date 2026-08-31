# SA4 静态验尸报告 — Issue #151 trusted replication / 复制管理写接入诊断变更日志

**Date**: 2026-08-31（Phase 3 static review）
**Reviewer**: SA4（Red Team——静态绿光验尸）
**被审对象**: SA3 实现 commit `218a74e` + SA6 后续最小 fixture 修订（worktree 未提交 diff：红灯 bump 用例 prior 链修正）
**输入链**: 任务简报、SA1 设计 `_design.md`（659 行 R1 终稿）、SA2 `_sa2_review.md`（R1 reject → **R2 pass**）、SA8 `_conflict_report.md`（clear + 七条钉死）、SA6 `_sa6_red.md`（15 用例契约 + 两轮勘误）、SA3 `_sa3_impl.md`、主线 `b66615c` 形状锚、基线 `722bddf`。
**任务类型**: feature。

**Verdict: reject**（两处实现缺陷可一轮修复——F1 P0 业务隔离违例 + F2 P1 冻结映射表违例；另 3 项 ALLOW/DENY 文档缺口需 SA1 补录。架构、词表、稳定码、端口保真、emit 纪律、CI 触发全部通过独立核验，无需 redesign）

---

## 0. 审查方法与独立证据基线

| # | 验证项 | SA4 独立证据（命令/位点） | 结论 |
|---|---|---|---|
| E-1 | Scope Creep Guard（§1.1） | `git diff --name-only 722bddf HEAD`（+worktree）= 33 文件 vs 设计 §18 ALLOW LIST 逐 token 比对 | 8 文件超 ALLOW（见 F3——全部有登记、无黑名单命中） |
| E-2 | b66615c 端口保真（SA2 R2 附随义务点名 SA4 执行） | 15 个稳定码/文案常量逐字比对（脚本循环 `grep -A1` 双侧值提取）→ **15/15 MATCH**；两物化文件去注释语义 diff（见 §1.4） | 差异面恰落在 R-3.1/R-3.3/L1/L3 + diag 接线 + 捕获窗口 + SessionRegistry 适配 + refusalOf 内联（零语义差）——**无登记外漂移** |
| E-3 | 红灯契约复跑 | `pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts` → **15/15 PASS，Type Errors no errors，exit 0**（含 SA6 prior 链修正后） | SA3/SA6 转绿声明属实 |
| E-4 | 两包全量回归 | `pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` → **359/359 passed（42 文件），exit 0** | 存量冻结行为零回归 |
| E-5 | 类型检查 | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` → **exit 0**（含 SA4 探针文件后） | CI 等价通过 |
| E-6 | CI 触发性（§1.3/§1.4） | `.github/workflows/ci.yml` `Test: pnpm test` → 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖红灯/探针/全部改面测试；`Typecheck: pnpm typecheck` 含 namespace-runtime/namespace-registry 两 tsconfig | **全部测试接通 CI，无孤儿 spec** |
| E-7 | 源码 grep 断言禁令（§1.7） | 9 个改面测试文件扫描：`readFileSync` 仅 `runtime-registry-internal-seam.test.ts:107` 读 `../package.json`（exports 审计，非源码）；全部 `toMatch/toContain` 锚运行时值（record 字段/结果联合） | **无伪测试** |
| E-8 | 缺陷复现探针（SA4 owned，新增） | `packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts`（2 用例）→ **2 failed**，失败根因即 F1/F2（见 §1.1/§1.2） | 两缺陷可执行复现 |

---

## 1. Reject 清单（同一轮一次性列出，可共同修复集合）

### F1【P0 · reject · 回流 SA3（修实现）+ SA1（补设计注记）】apply 槽 R6 的 notifyDirty 门控依赖 diag 条件捕获窗口——无诊断基线（生产默认）一切成功 apply 静默跳过持久化

**位点**：`packages/namespace-runtime/src/replication-session.ts:548` 与 `:585`

```ts
if (diag !== undefined) host.doc.on('update', updateHandler);   // :548 窗口挂接以 diag 为条件
...
if (capturedUpdate !== undefined) {                              // :585 R6 门控读捕获值
  try { await notifyDirty(); } catch ...
```

**机理**：R-3.1 仲裁把「捕获窗口有字节 ⟺ 有集成 ⟺ 须 notifyDirty」定为**业务判据**（设计 §2 流程图 R6 行、§9.3 A-j/A-k），但窗口挂接被写成 `if (diag !== undefined)`（照抄 enable/bump 的 E5 窗口形态）。当 `diagEnv.emitter === undefined`——**生产默认**（`createNamespaceRuntime(handle, notifyDirty)` 无 seam 注入，`runtime.ts` `createNamespaceRuntime` 纯两参委托）——update handler 永不挂接 ⇒ `capturedUpdate` 恒 `undefined` ⇒ R6 恒跳过 ⇒ **复制 apply 的一切集成永不经 saveDoc 落盘**。enable/bump 的 E6 无条件 await（对照组健康），唯独 apply 把持久化挂在了诊断装配上。

**违反的冻结契约**（四处独立违反，任一即阻断）：
1. 设计 §3 补充隔离：「诊断装配不改变无日志基线」+ §13.5「diagEnv.emitter === undefined ⇒ …无日志基线行为等价（唯一差异是返回 promise 结算多一跳微任务）」——实现使无日志基线的 apply **零持久化**，与有日志基线行为分叉；
2. AC4 / SA8 钉死 #5（ADR-0011 §能力态隔离）：日志装配状态不得改变业务结果——此处「日志缺席」改变持久化行为，同一隔离轴的镜像违例；
3. ADR-0006：saveDoc dirty notification 是唯一持久化触发器——跳过即静默数据丢失（apply 返回 `ok:true`，写只在内存，进程重启即失）；
4. 主线保真：主线 R6 是无条件 `await notifyDirty()`（SA2 E-5 实核）；R-3.1 只允许「零集成 ⇒ 跳过」，不允许「零诊断 ⇒ 跳过」。

**可执行证据**（探针 A，`runtime-replication-sa4-probe.test.ts` 用例 1）：
```
× 探针 A：emitter 未装配时，有真实集成的 apply 仍必须触发 notifyDirty
  → expected 1 to be 2            ← enable 后 saveCalls=1（E6 无条件通知，对照通过）；
                                      apply 集成后 ROOT.n=42 已断言生效，saveCalls 停在 1
```
（对照：同一用例内 `expect(saveCalls).toBe(1)` 对照组通过——证明缺陷为 apply 独有，非 fixture 伪影。）

**修复方向（SA3，最小）**：apply 槽 R5 的 update 订阅窗口改为**无条件挂接**（业务事实源——与 beforeTransaction 探针同待遇：探针本就无条件，因其承载 committed 二分这一业务事实）；`diag.updateBytes = capturedUpdate` 赋值保持 diag 条件。修复后无 emitter 基线与有日志基线行为等价（R-3.1 判据在两基线同构成立）。
**SA1 同步**：§13.5/§3 的「零 update 订阅」措辞需收窄为 enable/bump 槽（其 E6 无条件）；apply 的窗口是 R-3.1 业务判据载体，必须无条件——设计文档补一句注记防后续轮次回退。

### F2【P1 · reject · 回流 SA3】enable 槽 E3 成功后未写 `diag.input = {snapshot}`——§9.1 冻结映射表 E-f…E-k 六行全部谎报 `not-accessed`

**位点**：`packages/namespace-runtime/src/replication-write.ts:281-314`（E3 两个**失败**分支各自赋值 `diag.input`；成功分支 `replicationId = captured` 后无任何赋值）+ `runtime.ts` `createSlotDiag('replication-enable')` 缺省初值 `{status:'not-accessed'}`。

**机理**：E3 单读捕获成功后，E4/E5/E6 的一切结局点（E-f corrupt fatal / E-g 幂等 noop / E-h META_ABSENT / **E-i committed update** / E-j 事务 throw / E-k dirty fatal）的 emission 携带 `input: {status:'not-accessed'}` → record 面 `{capture:'not-accessed'}`。而输入已被读取且合法——这谎称「拒绝先于任何输入访问」（ADR-0011 §E 的 not-accessed 专属语义）。设计自身在 §9.3 表头注把该类谎报定为**明文契约违规**（「committed 记录携带 not-accessed 即『谎称拒绝先于输入访问』的契约违规」——SA2 #1 攻击点的同源禁则，适用于一切 operation）；§9.1 冻结表 E-f…E-k 六行 input 列均为 **snapshot**；#149 ROOT 槽先例 S3 成功即 `diagInputReady(diag, snap.value)`（`write.ts:148`，helper `diagnostic.ts:264` 就在旁边未被调用）。讽刺的是 SA3 自己在 E3 注释里写了「D-8：E3 成功捕获 → input {snapshot:{replicationId: 捕获串}}」——注释声明了，代码没做。

**影响**：调查者无法从 `replication-enable` 的 committed/rejected/fatal 记录区分「输入被读且为 {replicationId: X}」与「拒绝先于输入访问」——AC1「受控 source/context」之外 input 捕获面失真，六结局点系统性错标。

**可执行证据**（探针 B，同文件用例 2）：
```
× 探针 B：enable committed 记录的 input 必须是已捕获快照
  → expected { capture: 'not-accessed' } to match object { capture: 'full' }
```
（inputPolicy 'full' 下设计期望 record 面 `{capture:'full', value:{replicationId}, digest}`——`projection/input.ts` 既有投影。）

**测试缺口**（同轮指出）：SA6 红灯 15 用例对 enable 记录的 `rec.input` **零断言**（全文仅 :686 session-closed 一处）——故 15/15 绿灯未能拦截。SA6 按设计 §9.1/SA2 §4.1 既有建议补锚：enable committed 用例追加 `expect(rec.input).toMatchObject({capture:'full', value:{replicationId: REPLICATION_ID}})`（红灯文件为 SA6 owned）。

**修复方向（SA3，一行）**：E3 成功分支后 `if (diag !== undefined) diag.input = { snapshot: Object.freeze({ replicationId }) };`（镜像 `diagInputReady`；与 E-e 失败分支的 freeze 形态一致）。

### F3【P2 · 设计文档缺口 · 回流 SA1（补 ALLOW LIST；代码不回滚）】8 个实际改动文件落在 §18 ALLOW LIST 之外，其中 5 个测试文件字面命中 DENY LIST

| 文件 | 性质 | SA3 登记 | 处置 |
|---|---|---|---|
| `registry-idle/shutdown/sa7-hostile/sa7-rev1/sa7-concurrency.test.ts`（5 文件） | `implements NamespaceRuntime` 替身补 loud stub（`REPLICATION_NOT_STUBBED` 显式失败，零断言改动——逐 diff 核实） | 偏差 2 | **字面命中 DENY**「非上述三文件…零改动」；但系公共面扩张的类型面强制收容（不补即 CI typecheck 断），语义上不属「改冻结行为」。→ SA1 修订 §15.2/§18 把六处替身收容补进 ALLOW LIST；**不接受回滚**（回滚即断 typecheck） |
| `namespace-registry/src/index.ts` | +7 个 **type-only** re-export（逐 diff 核实零运行时值；registry-surface「恰九个 value」断言绿） | 偏差 3 | ALLOW 缺列。主线 b66615c registry index 同款 re-export 面。→ SA1 ALLOW LIST 补录 |
| `namespace-runtime/package.json` / `namespace-registry/package.json` | 仅 version 字段：0.1.8→0.1.9 / 0.1.3→0.1.4（逐 diff 核实无其他字段；pnpm-lock 零 diff——workspace 版本不入 lockfile，实测） | §1「版本 bump」 | 仓库既定纪律（#167 `722bddf` 同款只 bump 触及包）。→ SA1 ALLOW LIST 补录 |

判定说明：DENY 命中按 §1.1 属 REJECT 触发，但本案 DENY 条目立基于 §15.2 的错误完备性声明（SA2 E-8 只审了 `Object.keys` 断言面）；改动本身是接口扩张的最小诚实收容且全部公开登记。故并入本轮 reject 的**共同修复集合**（SA1 补文档即可闭合），不单独要求代码动作、不升级为 needs-redesign。

---

## 2. 通过项（独立核验，不再要求动作）

### 2.1 设计一致性 / 端口保真（E-2）

- **`errors.ts`**：15 个复制稳定码/文案与 `b66615c` **逐字节一致**（含 R-3.2 裁决的常量名含 WRITE、值不含 WRITE：`FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE = 'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`）。CODE 常量族（EPOCH_OVERFLOW 等）为主线 MESSAGE 内嵌码前缀的加法提取，值零新造——SA3 已登记。
- **`replication-write.ts`（511 行 vs 主线 440）**：去注释语义 diff 全量走查——E1–E7 槽序、E3 单读捕获 + 全探测收编（逐字）、E4 live META 读 + META_ABSENT 二次纯读分野（逐字）、E5 事务、E5.5 整替、E5.5' fence（`fanout`→`sessions` 适配，调用点/语义不变；enable 不 fence 保留）、E6/E7；差异 = 登记的 diag 行 + 捕获窗口 + `sessions` 替代 + `refusalOf` 内联为 `disabled(...)`（零语义差：同一 `disabled()`、逐字 message）。INV-R1/R2/R4/R9 保留。
- **`replication-session.ts`（793 行 vs 主线 889）**：A 层四门（closedBy 精化/A2 双分支陷阱安全拷贝/A3/A4）逐字；R1–R7 逐位（R2 被动 fence、R3 O-1 五条件 bypass、R4 scratch 预演全套含白名单容器判据、R5 探针 + 受控 origin、R5.5 标记、R7）；剥离面恰为 L1（扇出全套）/L3（wrapCore/计数）；R-3.1 零字节跳过（判据实现见 F1 缺陷）；R2 事实源 = `state.replication` 投影链单点（不读 live META）——与设计 §5.3 一致。
- **`lease.ts`/`registry.ts`/`types.ts`**：`parseOpenSessionOptions` + `INSTANCE_ID_PATTERN` + `REPLICATION_SESSION_INPUT_INVALID_MESSAGE` 主线逐字；R-3.3 方向无关薄通道（无角色门/drawReplicationId/计数/wrapCore）；`createLeaseController` 第 4 参形状 = 主线同款（`onReleased` 位置参数化亦同主线）；registry 注入点 + 跨包 `Equal` 双锁（core≡公共面、status≡公共面）。
- **`runtime.ts`**：十二键、V2.5 预投影（corrupt → 构造 throw）、V3c'''''/V3d''/V3f 顺序、close 同步段 `terminateAll`（lifecycle 置位后、barrier 前——close.ts 零改动）、WeakMap 零键污染（键集测试 12 键绿）。
- **DENY 面零触碰**：`namespace-diagnostic-log/**`、runtime `index.ts`、`sequencer.ts`、`close.ts`、`status.ts`、`projection.ts`、`plain-data.ts`、`schema-write.ts`、`testing.ts` 均不在 diff。

### 2.2 slot 外/槽后 emit（SA8 钉死 #2 / ADR-0012 amendment C）

三条 operation 的槽后挂点全部 `void settled.then((r)=>emitSlot(...), (e)=>emitSlot(...))`——与 #149 mutateRoot 同款（emit 在 slot 释放后的微任务、不被 await、不延长槽）；enable/bump 的 acceptance 拒绝与 apply 的 A 层拒绝在**公共方法同步段**（入队之前，slot 之外）emit——amendment 允许的两个合法位置各归其位。排序机构唯一（INV-S1 同一 WriteSequencer），红灯用例 13（hostile emitter `calls()===2` + FIFO epoch=2）/14（capacity:1 → accepted=1/dropped=1 + 业务序不变）行为级验证通过。

### 2.3 owned Yjs update（SA8 钉死 #1）

三处捕获窗口（enable/bump E5、apply R5）单赋值 handler + try/finally 退订；红灯用例 1/4/5/6/11 的链式重放（`applyCarrier` + prior 链）与反向鉴别（`expectNoMaterializeWithoutBase` 空 doc 不物化）实测通过——事务增量非全文档编码冒充。update-omitted 零 producer 产出 = 设计 §10 裁决（存储面承载，SA7 (b) 消费）。捕获 bytes 所有权：emit 时窗口已关（finally 先行），零再触碰。

### 2.4 input 三态词表（SA2 #1 / 设计 §7 第 4 点）——除 F2 外全部正确

apply 槽 diag `input: undefined` 构造 → record `{capture:'none'}`（红灯用例未直接断言但探针/静态链路核证：`emitSlot` 条件展开 + `projection/input.ts:58`）；bump 全行省略（B-a acceptance 亦省略——SA2 R2 明示「bump 无调用方输入，none 诚实」）；A 层 A-a/A-b/A-c `not-accessed`、A-d `unavailable`；enable E-a `not-accessed`、E-e snapshot/unsafe-input。**唯一违例 = F2（enable E3 后六行）**。

### 2.5 版本 bump

两触及包各 +0.0.1，diff 仅 version 字段，lockfile 零 diff——与 #167 先例一致（见 F3 补录项）。

### 2.6 其余专项

- **读写路径一致性**：`state.replication` 投影链单点（构造 V2.5 / 槽 E5.5 两写点；open 门/R2/getStatus 三读点）——无分叉；enable/bump E4 读 live META 属主线镜像（槽序内串行，E5.5 同槽回写投影）。
- **静默失败**：唯一静默失败路径即 F1（apply ok:true + 零持久化 + 零可观察信号）；其余全分支有结果联合/rejection/记录三者之一以上。
- **降级**：host 缺席 → `REPLICATION_SESSION_UNSUPPORTED` 显式能力缺席（非静默猜缺省）；V2.5 corrupt → 构造 throw 零副作用（loud）；无伪降级路径。
- **极端条件**：E3 敌意 Proxy/ownKeys 收编（主线逐字）、A2 `new Uint8Array(update)` 陷阱安全拷贝（非 slice）、空 diff → noop 零 dirty（用例 7）、epoch MAX 判据先于 +1（B-f context {id, MAX}）、窗口互斥（唯一 sequencer 结构保证）、fence 竞争经串行化收敛（finalize 幂等 + 终态不降级）。
- **契约改动连锁（§1.6）**：无 return→throw/swallow→rethrow 改动；`markWriteFatal`/`writeFatalMessage` 加分支且 'root'/'schema' 渲染逐字节不变（fatal-message-rev1 绿）；`emitAttempt`/`emitSlot` 可选参缺省 = 既有字节面（ROOT/SCHEMA 14/14 回归绿）；`createLeaseController` 签名扩展唯一生产 caller `registry.ts:586` 同步更新（grep 实证无其他 caller）。
- **协议假设（§1.5）**：设计 §16 P1–P8 章节完备、依据全为实测/源码/测试引用；本次探针 A 间接复证「真实集成必发 update 事件」（有日志路径捕获到 bytes）与「enable E6 无条件通知」。
- **过度设计/架构死胡同**：物化体量（≈1,300 行）为设计 R-2 最小闭包所定量（SA2 R2 复核无冗余无缺失）；无绕过式补丁、无 FIXME 残留；F1/F2 均为局部接线修复，无架构制约信号。

---

## 3. 审核结论（技能清单九项）

1. **设计一致性**：⚠️ 偏离——F1（apply 窗口 diag 条件化违反 §3/§13.5 行为等价 + R-3.1 判据业务性）、F2（§9.1 六行 input 列违例）；其余（端口/词表/仲裁/局限登记）一致。
2. **读写路径一致性**：✅ 一致（state.replication 投影链单点；无数据源分叉）。
3. **静默失败**：❌ 发现——F1 即典型静默失败（apply ok:true、零 HTTP/零状态/零 UI 信号、持久化丢失）。
4. **降级方案**：❌ 风险——F1 的「无日志 ⇒ 跳过 dirty」是把 R-3.1 判据错误降级到诊断装配上；处置：REJECT（SA3 修复）。
5. **极端攻击**：✅ 安全（敌意输入/陷阱拷贝/空 diff/溢出/窗口互斥全部按主线机械保留）；F1/F2 已单列。
6. **错误处理**：✅ 完整（§9 三表结局点全覆盖——F2 属记录面失真非缺分支）。
7. **架构评估**：✅ 可行（无退回 SA1 信号；F1/F2 局部修复）。
8. **过度设计**：✅ 精简（设计定量物化；无多余抽象）。
9. **范围**：⚠️ F3 八文件超 ALLOW（含 5 文件字面 DENY）——语义必要 + 全部登记，SA1 补文档闭合。

## 复验范围（本轮 reject 修复后的固定复审面）

1. F1 修复行（replication-session.ts R5 窗口无条件化）+ 探针 A 转绿 + 红灯 15/15 不回归；
2. F2 修复行（replication-write.ts E3 成功 snapshot 赋值）+ 探针 B 转绿 +（若 SA6 补锚）enable 用例 input 断言；
3. SA1 设计补录（§15.2/§18 ALLOW LIST 四项 + §13.5 窗口注记）落地；
4. 两包全量回归 + tsc 复跑（含探针文件入树后 `pnpm test` 整绿）。

## 动态审核重点（交 SA7）

1. **设计 §15.7(a) 物化面对账**：`git diff b66615c -- packages/namespace-runtime/src/replication-write.ts packages/namespace-runtime/src/replication-session.ts` 逐差异点对账 R-3.1/2/3 + L1–L6 + 接线豁免——SA4 已做静态侧（E-2），SA7 在活链路复核（尤其 F1 修复后的 diff 形态）。
2. **设计 §15.7(b)**：`makeLog({ updateCapture: false })` 跑 hub-to-peer committed apply → 断言 `committed + update-omitted` + reason ∈ 冻结三词表（预期 `update-capture-disabled`）、业务 `ok:true` 不变。
3. **A-c 未覆盖路径**：Runtime close 终止 session（`closedBy:'runtime-close'`）后的 apply → acceptance/RUNTIME_WRITE_DISABLED——红灯 15 用例未覆盖该分支（只测了显式 close）；连同 close-while-apply-in-flight 的 FIFO 排空观测。
4. **无诊断基线行为等价 sweep**（F1 修复后）：无 emitter 装配上跑 enable/bump/apply 三面，断言 saveCalls/结果联合/槽序与有日志装配一致。
5. `pnpm test` 全量（含 SA4 探针与 SA6 补锚后）在 CI `Test` step 的实际执行证据（`gh run view --log`）。

## 附：SA4 产出物

- 本报告：`wiki/raw/task_trusted-replication-management-diagnostic-change-log_sa4_review.md`
- 复现探针（SA4 owned，修复后转绿）：`packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts`（2 用例，当前 2 failed = F1/F2 的可执行证据；断言全为运行时行为，无源码 grep；tsc 0 errors）
