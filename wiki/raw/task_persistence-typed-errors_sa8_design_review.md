# SA8 设计后复审报告 — issue #108（SA1 设计 ADR 一致性复审）

- 被审对象：`wiki/raw/task_persistence-typed-errors_design.md`（567 行，Phase 2 设计交付）
- 冲突基准：`docs/adr/` 全集 0001–0009（Phase 0 已全量盘点，本次聚焦 0009/0006/0008 交叉）+ `CONTEXT.md`
- 复审类型：设计后复审（SA2 全维度攻击评审另行，本报告只裁 ADR 一致性）
- 前置门禁：`wiki/raw/task_persistence-typed-errors_sa8_gate.md`（verdict clear，2 登记点均 no-conflict）

## Verdict

**`clear`** —— 设计与 ADR 冻结条款无冲突，可进入 SA2 攻击评审。

一句话理由：三类新错误 + 不变的 DocDuplicateError 恰好覆盖 ADR-0009 L76–L79 四类要求且无越界新增错误类别；commit-fact 裁决（§3 候选 a）保持 ADR-0006「temp→rename 提交点」零改动并以实证的 seam 对称性兑现「resolve ⟺ committed」；全部传播纪律（message 不拼接 cause / unknown 不伪装运营失败 / committed 原样传播 / 不虚假 rollback）逐条有设计落点与负锁锚定；裸传保留项与 ADR-0009 L56 的 Registry 消费契约相容。

## 核对项 1：三新类型 vs ADR-0009 L76–L79 四类要求

| ADR-0009 要求 | 设计落点 | 覆盖 | 越界检查 | 裁决 |
|---|---|---|---|---|
| L76 typed load operational error | §1.1 `DocLoadOperationalError` / `DOC_LOAD_OPERATIONAL`，cause exact identity（N2 `toBe`） | ✓ | 无 | no-conflict |
| L77 typed create operational error，明确 `committed:false` | §1.2 `DocCreateOperationalError`，`readonly committed: false = false` 字面类型；唯二构造点 R1/W2 均在提交点前（I-1） | ✓ | 无 | no-conflict |
| L78 committed-aware create fatal：稳定 phase + committed + 原始 cause | §1.3 `DocCreateFatalError` / `DOC_CREATE_FATAL` + `DocCreateFatalPhase` 四值 + 冻结 `DOC_CREATE_FATAL_PHASE_COMMITTED`（I-2：post-commit⇒true 唯一真值） | ✓ | phase 词汇表与冻结映射是 L78「稳定 phase」的**必要具体化**——ADR 只要求「稳定 phase」未规定词表，设计补全属授权范围内，不构成新错误类别 | no-conflict |
| L79 duplicate 继续使用稳定 duplicate 类型 | §1.0 既有 `DocDuplicateError` 逐字节保留；§1.4 无共享基类、四 code 字面量互斥（I-3）；C1 三判定（cache/存在性读/并发 claim）全部写路径之前不变 | ✓ | 无 | no-conflict（与 ADR-0006 #64「拒绝 DocDuplicateError（DOC_DUPLICATE）」逐字一致） |

**是否超出**：设计新增面 = ① phase 词汇表（L78 的具体化，见上）；② `wrapIo` 测试注入缝（§3.4，AC7「同一组测试跑两 Adapter」的机制，非错误通道变更，默认不传=现状逐字节）；③ `PersistenceIO` 类型导出（additive）。三者均不新增错误类别、不改 `DocPersistence` 接口签名（ADR-0006 #64 修订节接口代码块不动）。**无越界。**

## 核对项 2：Persistence fatal phase 四值 vs Registry fatal phase 三值（L89–L93）分层

- 词面：`'probe-read' | 'snapshot-encode' | 'store-write' | 'post-commit'` vs `runtime-construction | create-document-internal | lifecycle-slot-internal`——**零词面重叠成立**（无任何共享 token）。
- 语义：前者 = Persistence create 存储管线位置；后者 = Registry 侧构造期阶段（ADR-0009 L89–L93 明文限定为 `NamespaceRegistryFatalError` 的初始 phase）。两词表挂在两个互不继承的类型上（`DocCreateFatalError` vs `NamespaceRegistryFatalError`），Registry 未来以 cause 携带 Persistence fatal 时 phase 字段按类型可区分。ADR-0009 L66「非法 Clock 输出属于 `create-document-internal`、`committed:false` fatal」是 Registry 域判定，与 Persistence 词表无碰撞。
- 裁决：**no-conflict**，SA1 的零混淆声称成立。

## 核对项 3：四条传播纪律逐条落实

| 纪律 | ADR 出处 | 设计落实 | 裁决 |
|---|---|---|---|
| 稳定 message 不拼接 cause | 0009 L81 | §1.4：三新类型 message 为编译期常量默认参数，lifecycle 调用点永不传自定义 message；N4 字面量全等断言 + N3 四面负锁（message/name/stack/JSON.stringify 不含哨兵串、rootDir 实值） | no-conflict |
| unknown exception 不伪装为运营失败 | 0009 L81、L56 | §2 分类表：operational 唯三构造点（L1/R1/W2）全部是 store 级 I/O 拒绝且 epoch current；encode 失败→fatal（W1）、restore/validate→裸传（L3）、integrity→裸传（L4）、dispose 竞态→fatal 或裸传（R2/R3/W3/L2/L0/C0）；N6 裸传负锁 | no-conflict（边界注记 O-1，见结论） |
| fatal 的 committed 事实原样传播所需信息 | 0009 L81、L78 | committed 由冻结 phase 表唯一派生（I-2），字段只读携带；W4 即核心动机场景（write resolved ⇒ committed:true ⇒ Registry 禁止重试 create、允许 open，与 0009 L70 Registry 行为条款精确对接） | no-conflict |
| 不虚假声称 rollback | 0009 L70/L120、0006 #64「不销毁传入 doc」 | N5：message 负锁 `/rollback\|compensat\|undo/i` + 行为证伪（store 内容留存断言、重试得 `DOC_DUPLICATE`）；EC3/EC5/EC9 断言 `doc.isDestroyed === false`（所有权仍归调用方，0006 #64 失败条款逐字兑现） | no-conflict |

## 核对项 4：commit-fact 裁决（§3 候选 a）vs ADR-0006 提交点条款 + flush/degraded/retry 零回归

**与 ADR-0006 的一致性**：
- #64 修订「FilePersistence 以 temp→rename 完成为提交点；不新增 fsync 保证」——设计 File **零代码改动**（§3.1/§4.4），已实证：`file.ts` `writeCommittedSnapshot` 的 `throwIfAborted`×3 全部在 `fsp.rename` 之前、rename 不接收 signal——现状已精确满足「reject ⇒ 未提交；resolve ⇒ 已提交」，提交点本体与语义不变。**no-conflict。**
- 「失败时不返回 handle、不缓存、不销毁传入 doc」——C2 claim 清理行为不变 + EC 断言 doc 存活。**no-conflict。**
- #79 修订（saveDoc dirty notification / degraded 拒绝面 / DocHandleStatus）——I-4 + §6.3 声明零改动，DENY LIST 不含任何 #79 面。**no-conflict。**
- 候选 (b)/(c)/(a′) 的否决理由不推翻任何 ADR 条款（(a′) 否决恰是**保护** dsh probe 观察通道现状）。

**seam 收紧本身的 ADR 地位**：`PersistenceIO.write` 的 aborted 行为（早退 resolve → reject）是包内 seam，不被任何 ADR 条款冻结（ADR-0006 冻结的是 `DocPersistence` 三方法接口与存储语义）；收紧使「write resolved ⇒ committed」在两 Adapter 成立，正是 ADR-0009 L78「committed-aware」的前提。属 ADR-0009 已授权演进的实施细节。**no-conflict。**

**零回归论证的事实核验**（本复审亲证，只读）：
| 设计声称 | 核验结果 |
|---|---|
| memory.ts `write`：hook → abort 门（早退 return）→ mirror set（提交段） | ✓ 代码逐行吻合（§3.1 所述结构在案） |
| file.ts：reject 点全在 rename 前、rename unsignaled | ✓ 案 |
| dispose 同步先 `closed = true; epoch += 1` 再 `abort()` ⇒ aborted ⇒ epoch stale | ✓ 案（lifecycle.ts dispose 体） |
| flush 的 resolve 早退（try 段 `!isCurrent` return）与 reject 早退（catch 段同守卫）可观察等价；`startFlush` 有顶层 `.catch(() => {})` 吸收 | ✓ 案（lifecycle.ts flush 双守卫 + startFlush 吸收器在案） |
| memory 测试 L437（aborted flush rejection）/ L461（never-settling writer resolve 路径）今天已分别覆盖两分支 | ✓ 两用例在案 |
| routeOwnedRead：disposed-first 裸 / ReadError 裸 rethrow（→ 设计改 L1 包装）/ restore 裸传 | ✓ 案，设计 §2.1 与现状逐点对应 |
| testing.ts「io down」断言（§5.4.1 修订对象）与 dispose-race hook resolve-on-abort（§5.4.2 修订对象） | ✓ 两处现状在案；旧 hook 在新契约下确属「resolve-而-未提交」违规实现，修订必要且四条原断言保持成立（`DocCreateFatalError` instanceof `Error`） |

## 核对项 5：裸传保留项 vs ADR-0009 L56（Registry 消费契约）

ADR-0009 L56：Registry 用窄 `OpenNamespaceIssue` 映射 invalid identity / not found / **typed load operational failure** / not accepting；**unknown load exception 不得被降级为运营失败**。

设计保留的裸传集（corruption/META 不匹配 L3 与 C0、disposed L0/L2/C0、integrity L4、`foreign or released`、identity 校验）在 Registry 边界全部落入「unknown exception」保守通道——**正是 L56 要求的行为**：不映射公开 issue、不降级。L3 的三方理由（损坏是完整性事实非运营失败；`DocLoadFatalError` 无消费方——load 无提交点概念；probe `isMetaMismatch` 与既有测试零回归）成立。ADR-0006 v1 布局节「META.docId 不一致视为持久化损坏并响亮失败」的 loud 语义保留（裸传即 loud）。

脱敏边界：ADR-0009 L95「公开 issue/error message 不含 owner/namespace 原值…」是 **Registry 公共面**条款；Persistence 内部错误携带 docId 属既有事实（R-2 已声明 cause 属内部观察面，公开脱敏归 Registry）。相容。**no-conflict。**

## 冲突点

**无。** hard-violation 0、override-declared 0、需 Jim 裁决的未授权演进 0。

非阻塞注记（登记供 SA2/后续参考，均非 ADR 冲突）：

| # | 注记 | 定性 |
|---|---|---|
| O-1 | W2 边界解释：epoch current 下任意 `io.write` 拒绝（含假设性的 write 内部非 I/O throw）都归 operational。Persistence 边界上 io seam 拒绝**就是** store 失败信号，与 ADR「typed create operational error」意图一致；替代方案（裸传）会复活文本猜测问题。属边界解释选择，非条款违反 | 边界注记，转 SA2 |
| O-2 | `wrapIo` 位于生产构造 options 而非 testing subpath：ADR-0009 L114「测试 seam 只位于受控 testing subpath」是 **Registry v1 公共接口**条款，不约束 Persistence 包；且 Memory 既有 `readSnapshot/writeSnapshot` flat hook 即本包同类先例，fault seam 本体（`createPersistenceIoFaultSeam`）位于 testing.ts subpath。设计已自标 R-4 供 SA2 攻击 | 边界注记，转 SA2 |
| O-3 | L2（load 读拒绝 + epoch stale）保持裸传 vs R2/R3（create 同构场景）typed fatal 的不对称：零回归优先的选择，ADR 未要求为 load dispose 竞态提供类型；Registry 侧两者都落保守通道，行为一致 | 边界注记，无需动作 |
| O-4 | R-5 将 ADR-0006 交叉引用卫生项（Phase 0 报告冲突点 #1 残留）推迟至独立 docs PR，DENY LIST 明令本 issue 不动 `docs/adr/**`——与 Phase 0 建议一致 | 处置正确 |

## 结论

**`clear`。** 设计是 ADR-0009 §Persistence 错误演进（L74–L81）的忠实实施：四类错误一一对应且无越界；phase 词表与 Registry 词表真分层；四条传播纪律全部有机制 + 负锁双锚；commit-fact 裁决不动 ADR-0006 提交点条款且零回归论证的关键事实全部实证成立；裸传保留集与 L56 Registry 消费契约相容。放行进入 SA2 攻击评审（O-1/O-2 两注记建议 SA2 重点攻击，但均非 ADR 一致性问题）。

## 附录：设计引入的新决策点登记（供全链 SA 复用，Phase 0 相关决议的追加）

> 设计后复审按技能要求追加登记设计引入的决策点（嵌入本文件，因单文件约束）。

1. **PersistenceIO seam 契约收紧**（设计 §3.1）：`write` resolve ⟺ 提交段已执行；reject ⟹ store 不变；abort ⇒ reject（Memory 早退 resolve 改 `throwIfAborted`）；`read` 同理不制造假裁决。未走 ADR 修订，属 ADR-0009 L78 授权范围内的实施契约。
2. **`DocCreateFatalPhase` 四值词表 + 冻结 phase→committed 映射**（设计 §1.3）：`'probe-read'/'snapshot-encode'/'store-write'` ⇒ false，`'post-commit'` ⇒ true；映射冻结于 contract.ts，committed 为派生只读事实，调用方不得再推导。
3. **cause 保留模式**（设计 §1.4）：自有可枚举类字段（同 `DocDuplicateError.code` 模式），不用 ES2022 Error-options cause（非可枚举，测试面不可见）；负锁含 `JSON.stringify`。
4. **错误谱系**：四类型互相独立的 Error 直接子类，无共享基类，code 字面量互斥（I-3）。
5. **裸传保留集冻结**（设计 §2/§6.2）：disposed 字面、META 不匹配、integrity、foreign/released、身份校验——均不 typed 化，Registry 按 unknown 保守处理。
6. **wrapIo 注入缝**（设计 §3.4）：around-seam、additive、默认不传=现状；返回的 io 必须自身满足 seam 契约。
