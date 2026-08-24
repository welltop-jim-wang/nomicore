# SA4 静态验尸报告

**Date**: 2026-08-24
**Verdict**: pass
**被审对象**: SA3 实现 commit `6cb6f17`（`fix/issue-90-on-docs-namespace-runtime`，base `docs/namespace-runtime` = `df22660`）
**审前上下文**: 任务简报 + SA1 设计 R2（847 行）+ SA2 R2 pass 评审（5 攻击点全落实 + 红线 #1–#4 必查）+ SA6 冻结锚 3 文件 19 用例

---

## 审核结论

1. **设计一致性：✅ 一致**（逐决策 D1–D9/D8' 与实现 diff 对账，见下表）。三处化妆级偏差均无语义影响：
   - `writeFatalMessage` 用 `${String(committed)}` 而非模板直插（输出恒等）；
   - S2/S4 槽内 fatal 以 `return rejectWithWriteFatal(...)` 达成（设计 D2 伪代码写 `throw fatalOf(...)`）——async 函数内 `return Promise<never>` 与 `throw` 结算语义恒等；
   - index.ts 导出排列顺序与 D8' 列举顺序不同（导出集合逐名核对一致）。
   - **SA2 R2 红线逐条兑现**：红线 #1（D9 `issues: unknown[]` + tsc 全绿门）✅；红线 #2a/b/c（数组分支 ①②③④ 查序 + descriptor 先于值读取，write.ts:262–301 与 D3 ①–⑤ 逐行对应）✅；红线 #4（phase 类型与 error 类同源 errors.ts 声明并导出）✅。

   | 设计决策 | 实现落点 | 判定 |
   |---|---|---|
   | D1 第八键 mutateRoot 同步接纳（enqueue 同步拼尾、thunk 纯调用零输入读取） | runtime.ts:129–132 | ✅ |
   | D2 写槽七步 S1–S7（序不可重排） | write.ts:69–157 逐位对应 | ✅ |
   | D3 snapshotter（对象四查 + 数组 ①–⑤ + 后序冻结 + 祖先集环检 + defineProperty 纪律） | write.ts:249–339 | ✅ |
   | D4 执行时 active schema（unavailable → 零写入；preparing∧无 fatal → loud internal） | write.ts:105–124 | ✅ |
   | D5 fatal 分类表 / D5.3 执行序（markWriteFatal 先行 → best-effort 恰一次 → throw；notifier 预算 ≤ 1） | write.ts:133–154、172–207 | ✅ |
   | D6 seam `notifyDirty?` 可选字段 + V1 三行式校验 + WriteEnv 显式 undefined 联合 + D6.4 loud gate + D6.3 工厂加参 | runtime.ts:49–53、204–210、110、142–148；write.ts:92–98 | ✅ |
   | D7 enqueue 泛化 `Promise<T>` + tail `Promise<unknown>`（P0 用法零变化） | sequencer.ts:35–42（唯一既有调用点 runtime.ts:117 `void` 丢弃原样） | ✅ |
   | D8 doc-runtime 恢复导出（仅 index.ts +2 行 + 头注释；mutation.ts 零改动） | doc-runtime/src/index.ts:21–22 | ✅ |
   | D9 结果联合 `{ok:true} \| {ok:false; issues: unknown[]}` + 四稳定码（RUNTIME_WRITE_DISABLED / MUTATION_INPUT_NOT_PLAIN_DATA / SCHEMA_UNAVAILABLE / NSRT-FATAL-WRITE-INTERNAL） | write.ts:56–62、161–169；errors.ts:22–34 | ✅ |

2. **读写路径一致性：✅ 一致**。写路径唯一 Y.Doc 入口 = `applyValidatedMutation(tools.derived, env.doc, snap.value)`（write.ts:129），`env.doc` 即构造栈 V3a 捕获、read/projection 闭包共用的同一 live Y.Doc 实例——无数据源分叉。dirty 登记经 seam 注入的 `persistence.saveDoc(handle)`（MemoryPersistence `handle.doc` 同实例已由 persistence testing.ts:242 锚证）。冻结快照值经 placeSet → copyJsonDomain 重建全新可变容器后入库（detached-build.ts 实读核实：数组/对象分支均 `out = [] / {}` + defineProperty）——冻结不外泄进 doc/读取面/持久化编码。

3. **静默失败：✅ 无**。`runRootWriteSlot` 全部分支三态结算完备（ok:true / ok:false+issues / RuntimeWriteFatalError rejection）；gate 拒绝、快照拒绝、领域失败、fatal、degraded、notifier 未绑定全部有稳定码可判别。唯一吞没点（fatal 路径 best-effort notifier 失败，write.ts:197–199）由原始 fatal rejection 承载信号 + `status.fatal` 稳定摘要兜底——设计明文（D5.3「原始 fatal 优先传播」），非静默。

4. **降级方案：✅ 安全**。notifier 未绑定 = loud gate（RUNTIME_WRITE_DISABLED + 构造方义务 message，write.ts:92–97），非静默 no-op——D6.4 立法兑现；degraded 检查后降级不撤销已提交事务、S6 照常登记（persistence lifecycle.ts「degraded is NOT a rejection reason」注释实读核实，issue #79 语义）；无补偿、无 fallback、无伪回滚。

5. **极端攻击：✅ 安全**（13 项独立运行时探针全过，scratch 测试经公共 seam 驱动真实实现，验后已删）：
   - 快照器逃逸面：稀疏数组空洞 / 非规范下标键 `'01'` / boxed Number / 数组子类 / 循环数组 / 对象 accessor（**getter 调用数 === 0**，descriptor 先于值读取兑现）→ 全部拒绝 + `MUTATION_INPUT_NOT_PLAIN_DATA`；
   - 正例不误伤：`Object.create(null)` 空原型 plain 对象、深冻输入（Object.freeze 嵌套）→ 快照通过；
   - **栈溢出攻击**（200,000 层嵌套数组）→ `RangeError` 被 snapshotMutation try/catch 收编为 ok:false（类 B 分级），进程不崩、Runtime 不关写——防「深嵌套 → 永久关写」DoS 成立；
   - **超大稀疏数组**（1e6 空洞）→ ③ own-descriptor 判定快速拒绝（< 1s），无 O(n) 放大；
   - **原型污染攻击**（JSON 自带 `__proto__` 自有键）→ defineProperty 写入纪律保真，全局原型零污染；
   - handle 边界：released → disabled 零写入；`getStatus()` adapter 违约 throw → 统一 fatal（committed:false、phase `write-slot-internal`）+ 写永久关 + 读取保留 + 后续写 disabled——与 D5.2 表第 6 行逐字段一致。

6. **错误处理：✅ 完整**。每个 if/else/try/catch/提前 return 均有可观察结算；fatal 路径执行序（markWriteFatal 同步先行 → notifier → throw）使 `status.fatal` 在 notifier 挂住窗口内即可观测（D5.3 ① 先于 ② 静态核实：write.ts:193 markWriteFatal 在 :196 await 之前）。

7. **架构评估：✅ 可行**。零 FIXME/临时补丁/绕行；未触发任何退回 SA1 信号；#89 冻结五测试零触碰全绿（targeted run 27 文件 334 用例含全部 #89 文件）。

8. **过度设计：✅ 精简**。write.ts 339 行（含大量契约注释）对设计预算 ~270 行——槽体/快照器/fatal 分类无多余抽象层；变更半径 = ALLOW LIST 8 文件，未外溢。

---

## 门禁清单（技能 §1 立法逐项）

| 门禁 | 结果 | 证据 |
|---|---|---|
| §1.1 Scope Creep Guard | ✅ PASS | `git diff --name-status df22660 6cb6f17` = 8 文件，全部 ∈ §11 ALLOW LIST（write.ts 新建 / runtime.ts / sequencer.ts / errors.ts / index.ts / 两 package.json / doc-runtime index.ts）；DENY LIST（p0.ts、status.ts、projection.ts、tsconfig.json、doc-runtime mutation.ts、vfsl/persistence 全部、#89 冻结五测试、根配置、.github/workflows）零触碰；BLACKLIST（package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store）零命中 |
| §1.2 设计偏离 | ✅ PASS | 见结论 1（三处化妆级偏差无语义影响） |
| §1.3/1.4 测试触发性 | ✅ PASS | vitest.config.ts include `packages/*/test/**/*.test.ts` 收集全部 5 个 SA6 测试文件（实跑 78 文件 1046 用例收集证明）；CI（.github/workflows/ci.yml）`pnpm typecheck`（七包串联）+ `pnpm test`（vitest run --typecheck）全触发；无 per-package filter 黑洞 |
| §1.5 协议假设 | ✅ PASS | §12 表 11 条全部有具体依据；本 SA4 独立重验源码引用：#2 transactGuarded→E203 committed:true（fatal.ts 实读）、#3 DerivedInvariantError→E204 committed:false（mutation.ts catch 实读）、#4 saveDoc degraded 非 rejection（lifecycle.ts 注释+代码实读）、#5 handle.doc 同实例（testing.ts:242）、#6 copyJsonDomain 全新容器（detached-build.ts 实读）、#7/#8 双通道 include（tsconfig.typecheck.json 实读 + tsc exit 0）、#10 enqueue 泛化 P0 零变化（runtime.ts:117 唯一调用点 `void` 原样） |
| §1.6 契约改动连锁 | ✅ PASS | 设计 §13 自审「无 return→throw / catch→rethrow / 同步变异步」经 diff 复核属实。caller 全 grep：`enqueue` 2 处（P0 `void` 丢弃——INV-N12 P0 永不 reject；mutateRoot 槽——结果返回调用方，fatal 契约要求消费方处理）；`createNamespaceRuntime` 全仓零调用（仅定义+注释+ownership 测试缺席断言）；`applyValidatedMutation` 唯一生产 caller = write.ts:129（唯一 try/catch：DocRuntimeFatalError 分级 + 未知异常保守 committed:true）；`mutateRoot` 无模块级导出（index.ts 核实 + SA6 断言 mutateRootOfEntry undefined） |
| §1.7 测试质量 | ✅ PASS | 5 个测试文件零 `readFileSync` 源码 grep 断言；`toMatchObject`/`toContain` 全部作用于运行时结果对象（如 `JSON.stringify(blocked)).toContain('RUNTIME_WRITE_DISABLED')`——结果联合上的稳定码断言，非源码文本形状）；断言面 = 结果联合 / update 事件计数 / state 字节 / notifier 计数 / getter 调用计数 / 提交值深等——全部公共接缝可观测行为 |

## 验证证据（命令 + 结果，独立进程后台运行）

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | **exit 0 零错**（SA2 红线 #1 显式门；现状基线曾 4 错） |
| `pnpm exec vitest run packages/namespace-runtime packages/doc-runtime --typecheck` | 27 文件 / **334 用例全绿**，Type Errors 无 |
| `pnpm test`（全量） | 78 文件 / **1046 用例全绿**，Type Errors 无，**exit 0**（与总控 Phase 3 复验记录一致） |
| SA4 scratch 边界探针（公共 seam 驱动，13 用例，验后已删） | **13/13 通过**（结论 5 全项） |

---

## 非阻塞观察（供总控/SA7 知悉，无需返工）

| # | 观察 | 定性 |
|---|---|---|
| O1 | 写槽 `getStatus()` adapter 违约 fatal 后，若 adapter 持续抛错，公共 `runtime.getStatus()` 读面同样原样传播（fatal 摘要经该面暂不可观测；`runtime.read()` 保留）。这是 #89 既有 loud-throw 读面契约（status.ts 头注释明文，DENY LIST 零改动项），非本任务缺陷 | 既有契约，交 SA7 动态确认即可 |
| O2 | fatal 路径 best-effort notifier **永久挂住** → rejection 永不送达 + 队列停滞（设计 §6.2 #8 明文哲学：停滞而非静默 timeout；`status.fatal` 挂住窗口内可观测）。SA6 冻结锚只覆盖 S6 成功路径挂住屏障（sequencer:322–352），fatal 路径永久挂住无冻结用例 | 设计内行为，交 SA7 动态验证 |
| O3 | 版本 bump 已落实（namespace-runtime 0.1.1 / doc-runtime 0.1.8），零新依赖、lockfile 零改动（§7.3 兑现） | 已核 |
| O4 | **工程收尾提醒**：SA6 三个测试文件与 wiki 档案当前仍为 worktree 未跟踪/未提交状态（SA3 commit 仅含 src+package.json）。若最终 PR 不携带测试文件，冻结锚将不进 CI——正是「spec 存在但永不触发」失败模式的镜像 | 总控收尾时确保测试文件随 PR 提交 |
| O5 | 真实 Persistence 集成锚使用 MemoryPersistence；FilePersistence/dsh-persistence 路径的写链未在本任务测试面（设计 §8 声明消费方边界） | 未来 Registry 接线面，非本任务 |

## 动态审核重点（交 SA7）

1. **notifier 挂住双窗口**（§6.2 #8）：注入永不 resolve 的 notifier—— S6 成功路径：槽停滞、后续写永排队、read 照常；fatal committed:true 路径：`status.fatal` 先于 rejection 可观测、pA 永 pending、新调用因队列停滞（非 gate）不结算。锁定「停滞而非静默跳过/降级」。
2. **O1 场景**：adapter 持续抛错下 getStatus 读面 throw 与 runtime.read 保留的并存行为。
3. **Node 20/24 CI 矩阵**：本 SA4 环境单 Node 验证；CI 双矩阵绿属 AC10 动态面（`gh run view --log` 摘录 vitest/tsc 触发证据）。
4. **深嵌套栈溢出收编**（200k 层）：本 SA4 已探针过一次（ok:false 收编），建议 SA7 在 CI Node 上复跑确认 V8/JSC 行为一致。
5. **跨实例持久化 round-trip**（AC10）：MemoryPersistence 全新实例 loadDoc 读到写入值（冻结锚已覆盖）——SA7 摘录实际运行证据即可。

---

## 结论

**pass。** SA3 实现是 SA1 R2 设计的忠实直译：槽序/fatal 分类/快照器四查纪律/结果联合/公共面演进逐位对应，SA2 R2 全部红线兑现，全部门禁（scope/触发性/协议假设/契约连锁/测试质量）通过，1046 用例 + tsc 双通道全绿，13 项独立边界攻击零失守。SA7 可进入动态验证。
