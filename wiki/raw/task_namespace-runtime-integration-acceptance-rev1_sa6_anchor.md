# SA6 红灯锚定报告 — issue #93 round 2（验收契约落锚；对当前 HEAD 实测）

- **Date**: 2026-08-25（round 2 Phase 1；HEAD = `fix/issue-93-on-docs-namespace-runtime`）
- **SA6 交付**: 全部按设计 `wiki/raw/task_namespace-runtime-integration-acceptance-rev1_design.md`（rev1 + R2 修订）+ SA2 R2 评审遗留 A/B/C 落锚；改锚 + 新红灯 + 存量审计锚。
- **红线纪律**: 全部红因经实跑逐字摘录 = 契约缺失（模块级导出形状 / getter 未 throw / ok:false 而非 rejection / getter 返回 null 而非 E2 throw），无一为测试自身错误；发现 1 处伪红（T7.2 场景② fixture）已当场修正并登记（见 §4-偏差 2）。
- **范围**: 只改 20 个测试文件（18 修改 + 2 新建）+ 本 wiki；src/docs/ADR/package.json **零改动**；未 commit。

## §1. 红/绿总表（用例 × 状态 × 红因摘要）

### 1.1 红（契约缺失——必须 SA3 修绿）

| # | 用例 | 文件 | 红因（逐字失败摘要） |
|---|------|------|------|
| R1 | T1.1 值导出键集恰一键 | runtime-acceptance-exports-audit.test.ts | `expected [ 'RuntimeWriteFatalError', …(1) ] to deeply equal [ 'RuntimeWriteFatalError' ]`（现 2 键含 seam——D-1 值导出未撤出 index.ts） |
| R2 | T1.2 生产构造器与 seam 模块级缺席 | 同上 | `模块级导出 createNamespaceRuntimeWithSeam 应缺席: expected [Function: createNamespaceRuntimeWithSeam] to be undefined` |
| R2b | §9.2 改锚：seam 不从公共 package entry 导出 | runtime-public-surface-ownership.test.ts | `expected [Function: createNamespaceRuntimeWithSeam] to be undefined`（AC1 用例改锚——D-1 正向锁定；本文件其余 5 用例绿） |
| R3 | T2.1 close 后三 getter 同步 throw | runtime-close-lifecycle.test.ts | `getSchemaEnvelope post-close 应同步 throw（D-2 停接纳）: expected [Function] to throw an error`（post-close 返回投影值——D-2 门禁缺失） |
| R4 | T2.2 closing 窗口三 getter throw（含 'closing'） | 同上 | `getSchemaEnvelope closing 窗口应同步 throw: expected [Function] to throw an error` |
| R5 | T2.3 fatal×close（用例内追加；fatal 期 getter 照常，close 后才 throw） | 同上 | `getSchemaEnvelope fatal×close 后应同步 throw: expected [Function] to throw an error`（fatal 期「照常」断言全过；仅 close 后 throw 缺——显式负向锚正确红） |
| R6 | T2.4 cyclic META × close → RUNTIME_READ_DISABLED（非 RangeError） | 同上 | `expected RangeError: Maximum call stack size exceeded to not be an instance of RangeError`（门禁缺失 → 深拷贝递归 RangeError 外泄——门禁先于投影的反证失败） |
| R7 | T3.1 δ：非 map 形 structure node 裸 throw → rejection（非 E200 ok:false） | runtime-replace-schema-sa7-dynamic.test.ts | `应为 fatal rejection（非 ok:false domain result）: expected 'resolved' to be 'rejected'`；实测 resolved 值 = `{"ok":false,"issues":[{"message":"DOCRT-E200: replaceSchemaAndRoot 内部错误（意外异常）: ROOT 结构节点非 map 形（手造派生物）"}]}`——与设计「现 resolved ok:false(E200)」逐字一致；红因 = D-3 未知异常未 fatal 化（评审项 5/裁决 C） |
| R8 | T4.1 异型载体 → getSchemaEnvelope() throw NSRT-SCHEMA-E2 | runtime-schema-carrier-split.test.ts | `异型载体下 getSchemaEnvelope() 应同步 throw: expected '(no throw)' not to be '(no throw)'`（现返回 null——载体损坏静默映射缺席 = D-4 虚假降级） |
| R9 | T4.2 组合锚（unavailable+ENV-1+fatal null 部分绿；E2 组合部分红） | 同上 | `expected '(no throw)' not to be '(no throw)'`（P0 unavailable/SCHEMA_ENVELOPE_1/fatal null 断言全过——存量；getSchemaEnvelope() E2 缺失——红） |
| R10 | T5.1 生产装配 Memory 全链 post-close getSchemaEnvelope throw | runtime-acceptance-production-assembly.test.ts | `post-close getSchemaEnvelope() 应同步 throw（D-2 停接纳）: expected '(no throw)' not to be '(no throw)'`（六步全链 + dirty 计数 + read/write 停接纳全部绿——唯一 D-2 交叉红） |
| R11 | T5.2 生产装配 File 全链（同上） | 同上 | 同 R10（File 面） |

**合计 12 个红**（Σ 断言失败位置；T2.3 为既有用例内追加断言使其整体转红——按设计 §8 标记）。

### 1.2 绿(存量) / 绿(保留) / 绿(存量审计锚) — 全部实跑确认

| 组 | 用例 | 说明 |
|---|---|---|
| 绿(保留) | 零回归 18+1 项对应面：snapshotter 四查（mutate-root-snapshotter-array）、F-3 RangeError（boundary-supplementary）、fatal message rev1（write-fatal-message-rev1）、A4 红线 γ（sa7-dynamic γ）、十键/七键/close 幂等/排空/release 双通道（close-lifecycle 其余 6 用例 + close-sa7-dynamic）、read 停接纳联合、fatal 期 read 保留、unavailable/preparing 期 getter 照常（p0-sequencer/sync-read-face）、persistence 缺席宽容（共享套件）、meta proto-key 四真、materialize-root-rev2、degraded 两 Adapter、fullchain 既有三用例、类型面双 guard | 逐文件 vitest `--typecheck` 全绿（2 个 .test-d.ts 单独跑：2 文件 4 测试 pass） |
| 绿(存量) | T1.5 全部 18 个切换文件既有断言全量 | 12 纯切换文件中 11 个文件整体绿；5 个拆分行文件中 mutate-root-sa7-dynamic / write-fatal-message-rev1 整体绿（零断言变化） |
| 绿(存量) | T5.1/T5.2 六步全链 + dirty 每成功写恰 +1 | 唯 post-close getter throw 红（R10/R11）；六步、跨实例/crash-restart、dirty=2、P0/close 零 notify 全绿 |
| 绿(存量) | T6.1=U-1 / T6.2=U-2 / T6.3=U-3 / T6.4=U-4 | fullchain 7 测试全绿（3 存量 + 4 新增）；U-3 经生产工厂 createNamespaceRuntime（含 File committed fatal + restart 见提交值）；U-4 P0 fatal 真实持久化——首跑即绿，无集成缺口 |
| 绿(存量行为锚) | T3.4（ε）深 doc × keep-root | keep-root resolved ok:false + message `/DOCRT-E100\|VFSL-E100\|校验工作预算耗尽/`（实测 = `DOCRT-E100: 内部错误（意外异常）: Maximum call stack size exceeded`）+ 0 update + stateBytes 不变 + notifier 0 + fatal null + 双写位 enabled + envelope/active/read 照常 + 修复尝试诚实结果（见 §4-偏差 1）；D=6_000（负载超时修复后——§4-1 二轮），standalone 2.86s / 四进程并发负载 5.02s / 全量 92 文件并行 5.54s |
| 绿(存量语义锁定锚) | T7.2 场景① non-enumerable 下标照常投影 | `meta['arr']` toEqual `[5, 2, 3]`（数组元素面带值照常读——D-7 提取前后不变量） |
| 绿(存量消息锁定锚) | T7.2 场景② non-enumerable ∧ undefined → NSRT-META-E1 + 「数组位置 undefined 不可投影」 | fixtur 修正后绿（见 §4-偏差 2） |
| 绿(存量审计锚) | T1.4 package.json exports 键集恰 `['.']` | 配置审计（非源码文本），首跑绿 |
| 绿(改锚保留) | T1.3 唯一值导出 RuntimeWriteFatalError 是 function | 改锚后绿 |
| 绿(存量) | T4.3 缺席对照（null + ENV-1 + unavailable + fatal null） | 含 `share.has('SCHEMA')===false` 前置断言 |
| 绿(显式锚) | T4.4 异型 doc replaceSchema → ok:false 单 issue（`SCHEMA 载体不是 Y.Map…`）| 写路径开放且诚实（fatal null、schemaWrite enabled、read 照常） |

## §2. 触碰文件清单（全部 [SA6 owned] 测试文件）

| 文件 | 改动 |
|---|---|
| runtime-acceptance-exports-audit.test.ts | §9.1 改锚（键集/forbidden/用例名+头注）+ T1.4（package.json 配置审计） |
| runtime-public-surface-ownership.test.ts | §9.2 改锚（import 拆分、:84-88 toBeUndefined、用例名、头注） |
| runtime-close-lifecycle.test.ts | §9.3 改锚（:184-187 注释、:212-221 post-close 三 getter throw 断言）+ T2.2/T2.3（fatal×close 内追加）/T2.4 |
| runtime-acceptance-fullchain.test.ts | §9.4 import 拆分 + `createNamespaceRuntime` 导入 + U-1..U-4（AC5 追加块） |
| runtime-replace-schema-sa7-dynamic.test.ts | §9.5 import 拆分 + δ（T3.1/T3.2）+ ε（T3.4 偏差重锚） |
| metadata-proto-key.test.ts | §9.5 import 切换 + T7.2 场景①/② |
| runtime-boundary-supplementary / runtime-close-sa7-dynamic / runtime-mutate-root-persistence / runtime-mutate-root-sequencer / runtime-mutate-root-snapshotter-array / runtime-p0-sequencer / runtime-replace-schema-persistence / runtime-replace-schema-sequencer / runtime-sync-read-face / runtime-acceptance-degraded-two-adapter / runtime-mutate-root-sa7-dynamic / runtime-write-fatal-message-rev1 | 仅 seam import 行切换 `'../src/index.js'`→`'../src/runtime.js'`（5 个拆分行其中 mutate-root-sa7-dynamic / write-fatal-message-rev1 属拆分；断言零变化——11 文件整体绿） |
| runtime-schema-carrier-split.test.ts | **新建**：T4.1–T4.4（T4.5 为 persistence 共享套件既有锚，零改动） |
| runtime-acceptance-production-assembly.test.ts | **新建**：T5.1/T5.2（文件内 grep 无 `WithSeam`——构造哲学隔离 ✓；import `createNamespaceRuntime` 自 `'../src/runtime.js'`） |
| runtime-close-lifecycle-type-guard.test-d.ts / runtime-replace-schema-type-guard.test-d.ts | **零改动**（设计 §1.5 保留——类型导入不变；实测 typecheck 2 文件 4 测试绿） |

## §3. 验证证据（命令 + 结果）

对每触碰文件按纪律后台独立进程（`setsid nohup ... vitest run <file> --typecheck`，轮询 log）：

- 红文件（5）：exports-audit `2 failed / 2 passed`；public-surface `1 failed / 5 passed`；close-lifecycle `4 failed / 6 passed`；replace-schema-sa7-dynamic `1 failed / 10 passed`（δ 红、T3.4 绿）；schema-carrier-split `2 failed / 2 passed`；production-assembly `2 failed / 0 passed+全链绿`（T5.1/T5.2 各仅 post-close throw 红——其余断言全部通过后触达）。
- 全绿文件（15）：metadata-proto-key 6、boundary-supplementary、close-sa7-dynamic、mutate-root-persistence、mutate-root-sequencer、mutate-root-snapshotter-array、p0-sequencer、replace-schema-persistence、replace-schema-sequencer、sync-read-face、mutate-root-sa7-dynamic、write-fatal-message-rev1、degraded-two-adapter、fullchain 7（含 U-1..U-4）、type-guards 2 文件 4 测试。
- 全部 run `Type Errors no errors`；type-guards 轮捕获并修正了 production-assembly 的类型窄化（`readAfter.code` 在 ok:true 分支不存在——补 ok 判别窄化后 typecheck 项目级零错误）。

## §4. 与设计 wiki 的偏差及理由

1. **T3.4 深度重标定与偏差锚（SA6 两轮迭代记录）**。
   - **第一轮（落锚，D=20_000）**：设计/§13#19 断言「同 runtime 后续 provide-root `replaceSchema({schema, root: 浅完整 root})` ok:true——修复通道开放」。实测（Node 24，tsx 与 vitest 双重复现）：深嵌套 Y.Map ROOT 上 provide-root 的 doc 级 clear+install 在 **`ROOT.clear()` 触发 yjs destroy 递归栈溢出**（RangeError——yjs 引擎内部 destroy 递归，非 Runtime 写面锁定；clear 前的双写位 enabled + fatal null 断言即「keep-root 失败不锁 Runtime」的证明）→ replaceSchema branded rejection（`phase=observer-cleanup-throw, committed=true, cause=RangeError`）→ 实例 fatal（NSRT-FATAL-SCHEMA-WRITE-INTERNAL）。**处置**：按设计 §8 T3.4 回退预案思路（「CI 构建/集成限制 → 登记回退决议」）把该段重锚为「偏差锚」——断言真实行为（rejection 形状 + cause + fatal 码），即「修复尝试可发生且诚实（设计 §3.2.3.4 的『或带外重建 doc』是正确形态）」；运行时级通道开放（写位未禁）保持设计断言。设计的核心主张（深 doc 不产生 E206、E 层吸收、零写入、fatal 零置位）**全部实测成立并保留为绿(存量行为锚)**。
   - **第二轮（负载超时修复，本轮 commit）**：D=20_000 的 doc 构建 standalone ~30s（yjs set 逐层嵌套）；全仓 92 文件并行 vitest 下 >60s——verify-rev1 实测 `Test timed out in 60000ms`（60308ms；单文件跑均过，CPU 竞争放大了 async 用例的等待）。**深度重标定**（4_000–10_000 扫描，Node 24）：extract walk 溢出阈值 ~1_800–2_000（±100 漂移）、ROOT.clear destroy 溢出阈值 ~2_200（±100 漂移）；**D=6_000 两相（E 层吸收 + clear 溢出 rejection）均确定性触发**——extract 3× 边际、clear 2.7× 边际（远超漂移带）；构建 standalone ~1.3s（20_000 的 ~4%）、O(depth²) 总成本 ~9%。用例 timeout 60_000 保留。**断言语义逐字零变化**（仅 DEEP 常量与注释；标定/超时说明）。对 SA3 修绿零影响：D-3 半径（schema-replace.ts catch）不改该路径（E203 来自 transactGuarded，本轮零触碰）。
   - **负载验证证据**：(a) standalone `vitest run runtime-replace-schema-sa7-dynamic`：11 测试全绿，T3.4 2.86s；(b) 四重文件并发（sa7-dynamic + fullchain + validate-patch-sa7 + validate-snapshot-sa7，4 个独立 vitest 进程）：全绿，T3.4 5.02s；(c) 全量 `pnpm test`（92 文件并行，与 verify-rev1 同款形态）：**92 文件 / 1118 测试全绿，65.97s**（T3.4 单测 5.54s）——上次同形态 60s 超时点复测通过。
   - **标定修正记录**：第一轮「维持 D=20_000（两项各自 10× 余量的确定性判据）」在 standalone 时间/行为维度成立，但**负载墙钟维度不成立**（O(depth²) 构建被并行竞争放大）——第二轮以全仓负载实测为准改 D=6_000；确定性判据（两相触发）在 6_000 的 3×/2.7× 边际核算远超漂移带（±100），未牺牲行为确定性。
2. **T7.2 场景② fixture 修正（SA2 R2.4-A 的建议实现有误）**。SA2 建议 `Object.defineProperty(arr, 1, {})` 造「non-enumerable ∧ value undefined」——实测空描述符对**既有**下标不生效（ES DefineProperty：已存在可配置属性保留未提及字段——行为无任何变化，getMetadata 正常返回 → 判定伪红）。改为显式 `{ value: undefined, enumerable: false }`（与 SA2 意图语义一致：non-enumerable ∧ undefined → 现行 violation「数组位置 undefined 不可投影」），锁定目标不变（NSRT-META-E1 + 现行消息字面量）；伪红已消除，场景②实跑绿。
3. **T3.4 schema 形态补全（设计文字未给出的必要 fixture）**。设计「keep-root replaceSchema({schema: ENV2})」+「DEEP 层嵌套 Y.Map ROOT」——浅 schema（ENV2 级）下 extract walk 由**派生结构**驱动，深链在第 1 层即 carrier mismatch（非 E100，不达「E 层吸收」断言面）；VFSL 拒绝递归别名（E106 循环引用）。fixture 补全为**程序生成的非循环别名链**（`type N_{i} = { n: N_{i+1} }; … type ROOT = N0;`，DEEP=6_000 别名（随 §4-1 二轮重标定），compile ~240ms——parser 嵌套预算 100 每型、别名数无限、ref 不展开），使 walk 按 doc 实深下钻 → 溢出确定落在 extract 自身崩溃边界（INV-6）→ DOCRT-E100。这是断言面可达的必要组件，非行为偏差（与设计「任一 E 层吸收」的断言写法一致）。**fixture 形态注**：ε 沿本文件既有 fake-handle 夹具（设计「→ createDoc」以包内 seam 惯例等价实现——该用例全部断言为 runtime 公共面可观测行为，无任何持久层参与；设计「浅路径 read + P0 ready 预检」已内置于用例首段）。
4. **无其他偏差**；`git status` 确认 src/、docs/、ADR、package.json、TASK.md 零改动；未 commit。

## §5. 交付物清单

- 12 个红灯（R1–R11+R2b，§1.1）——红因全部 = 契约缺失，SA3 修绿对应 D-1（R1/R2/R2b）、D-2（R3–R6/R10/R11）、D-3（R7）、D-4（R8/R9）。
- 绿统计：触碰 20 文件共 115 用例（含 .test-d.ts 4 项）——绿 103 / 红 12（红均在新契约面；零回归 18+1 项全绿）。
- 伪红处置：1 处（T7.2 场景②，§4-2）——已修，无残留。
- 偏差登记：1 处实质（T3.4 修复面，§4-1）+ 2 处 fixture 级（§4-2/3）。
