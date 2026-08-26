# SA2 设计对抗评审：Issue #110 namespace-registry `open`

**Round 2 复审**
**审查对象**：`wiki/raw/task_namespace-registry-open_design.md`（448 行全文，SA1 修订版）
**权威基准**：`TASK.md`、ADR-0009、tracking issue #104 Implementation/Testing Decisions、当前 `namespace-runtime` / `persistence` 契约。
**日期**：2026-08-26
**结论：APPROVED-WITH-CHANGES**
**残余阻断数：0**

> 本结论仅放行设计进入实现；不替代 SA4/SA7 对实现、真实 module-boundary gate、全量 typecheck/test 与 Node 20/24 CI 的验证。

## Round 2 核验结论

| 原项 | 复核结果 | 证据与结论 |
|---|---|---|
| B1：carrier 清理、ABA、确定性测试 | **已闭环** | §5 L230–236 把 `entries` 与 `carriers` 分离，并对每个 operation 规定三条件删除：无 entry、captured carrier identity 相等、tail 仍是本 operation 的 green tail。identity + 不复用 bigint generation + tail 条件防止旧 cleanup 删除新 carrier；§9 L356–357 有 null/typed/unknown failure 批量成对 diagnostics、cleanup-microtask 前二次接纳、old-carrier ABA 三类无 sleep 红灯锚。diagnostics 只给不可逆 token 与 generation、不返 map，符合受控 testing seam 边界。 |
| B2：hostile identity、兼容性 | **已闭环** | §4 L179–205 撤回 ASCII/128/首字符限制，且把“零访问”精准缩至 Registry map/Persistence/Runtime；`namespaceId` 先 `typeof` 短路，owner 只接受 object/null-prototype plain data descriptor，所有 prototype/descriptor traps 包在 try/catch 并稳定映射 invalid。Unicode、长字符串、空格仍可通行；§9 L353 要求 persistence create/load round-trip 兼容测试。当前 Persistence contract 的 `User.userId`/`docId` 均为无约束 string（`contract.ts` L4–41），该最小规则不再无故缩窄常规现存身份域。 |
| B3：module-boundary 活链路 | **已闭环（实施硬门）** | §2.1 L56 明确当前 helper 缺失并把 REPO_ROOT-relative scan、真实 `registry.ts` import 被收集和 `violators=[]` 作为硬验收；§9 L352/L362 明确非 fixture-only gate 与反演探针；§13 L438–440 允许修改 helper 与 rev1 test。此项实际是否绿必须由后续实现/SA4 运行现有测试确认。 |
| 裁决 1：create/shutdown 占位 | **已落实且可接受** | §3 L116–137 将未实现操作固定为 resolve 的 `NAMESPACE_OPERATION_UNAVAILABLE` 窄 issue，不再伪装成 internal fatal、不读 input/Persistence、也不改变 running。它明确是本切片占位，§11 要求 #111/#112 替换时做兼容性审查，符合 ADR/#104 中“内部 fault 才用 fatal”的错误分类精神。 |
| 裁决 2：released getter | **已落实** | §3.2 L155 / §7：投影 getter 用既有同步 throw 通道，且主入口导出 `NamespaceLeaseReleasedError`，可通过 `instanceof` 或 stable code 分辨；read/写走其原有结果联合/Promise 通道，status 唯一成功，满足 TASK AC8/AC9 和 ADR L42–44。 |
| 裁决 3：identity grammar | **已落实** | §4 明确没有共享 canonical grammar 时不得自行加 ASCII/长度白名单；保留的 non-empty、控制字符、`/`、`\\`、`.`、`..` 防御为最小安全边界，并定义 Unicode/长/空格兼容锚。未来共享 validator 必须走独立 ADR/迁移。 |
| 裁决 4：factory cleanup | **已落实** | §6 L282 固定 factory throw 后 `handle.release()` 恰一次，release reject 与 observer throw 均不得替换 `runtime-construction` 主 fatal；§8/§9 有 exact-cause observer 与 resolve/reject 断言。 |
| 裁决 5：`create(input: unknown)` | **已落实** | §3 L132–133 保留 unknown 的纯扩展位，未偷渡 #111 schema/root 输入类型；与本票只做 open 的范围一致。 |

## 残余非阻断修订要求

### N1 — `NAMESPACE_OPERATION_UNAVAILABLE` 的公开替换策略须在实现 PR 描述中再次确认

`create()` / `shutdown()` 的占位结果是新的公开稳定行为；#111/#112 后续把其返回 type 换成真正 result 的 source compatibility 是否可接受，仍须在对应 ticket/PR 明确记录版本与迁移判断。当前 §11 L386 已要求此审查，因此**不阻断 #110**。

**测试锚**：#110 断言两成员不访问 input/Persistence 且返回固定 issue；#111/#112 的设计审查中增加 TS consumer compile fixture，确认替换不会悄然破坏支持范围内的 callers，或明确标为版本化变更。

### N2 — 最小 identity rule 的 Persistence 适配器兼容性应以真实 Memory/File 证据补强

设计的 Unicode/长/空格 round-trip 测试目前由 §9 锚定，且 #110 范围明确不建 Memory/File 共用 contract suite。实现时至少应针对当前可用 persistence adapter 执行这些测试；完整双 adapter contract 仍归 #113。**不阻断**，因为它是现有无约束 string contract 上的兼容性测试深化，而非本票需要修改 Persistence。

## AC / ADR / #104 / 接口复核

- **12 条 AC**：§10 对每项提供实现节与测试锚。尤其 AC2/AC3（carrier green tail + same-key FIFO / different-key parallel）、AC5（细分 issue 与 unknown fatal）、AC8/AC9（lease synchronous invalidation 与既有通道）、AC10（entry/carrier 双代际保护）、AC11（zero-echo + observer）、AC12（deferred/microtask、Node 20/24、真实 boundary gate）均有可执行设计锚。
- **ADR/#104 一致性**：open 在 load + Runtime construction 后发布，不等 P0；unknown load 不降级；typed load 单独窄 issue；lease release 的 promise identity、既接纳写不被取消、released status 为 null runtime、observer exact cause 都对齐。非目标的 idle/Clock/plugin/真实 shutdown 聚合没有被提前实现，只有适当的状态机/接口预留。
- **现有接口兼容性**：设计调用 `createNamespaceRuntimeForRegistry(handle, () => persistence.saveDoc(handle))`，与 `internal.ts` L27–31 的二参签名精确匹配；`loadDoc(owner, docId): Promise<DocHandle | null>` 与 `DocLoadOperationalError` 分类匹配 `persistence/contract.ts` L38–72；Runtime 三个 getter 均为同步返回/throw（`runtime.ts` L90–105），支持 released 的 coded-throw 方案。
- **公开面纪律**：主入口只列 Registry/Lease/fatal/released-error 和 public types；§2.2 要求 runtime export-key + declaration emit 双审计，防止 `NamespaceRuntime`、`DocHandle`、Y.Doc 或 internal subpath 泄漏。testing subpath 可有受控 factory/observer/diagnostics，但不暴露 entry/carrier map。
- **确定性并发性**：所有指定竞争均可由 deferred gate + explicit microtask settle 重现，无 real sleep；B1 的 cleanup-before-next-admission 场景与 old/new carrier ABA 都已有明确锚。

## 协议假设依据审查

通过。§14 正确声明本切片无 HTTP/WS、端口、跨进程、服务启动时序或第三方工具行为假设；没有缺失可复验的网络协议证据。

## 错误处理链路审查

本任务没有 UI/exStatus。设计已保持：invalid/typed operational 走窄结果，unknown load/factory internal failure 走 stable fatal，公开 message 零回显；observer 仅保存受控 identity/exact cause 且 observer throw 被隔离。未见把正常路径前提伪装成降级的设计。

## 红线实施验证清单（后续 SA4/SA7）

1. 对大量不同合法 key 的 `null`、typed load failure、unknown fatal，确认 diagnostics create/delete 成对并验证同 key cleanup 不能删后来 tail/carrier。
2. 注入 hostile owner getter/Proxy traps、namespaceId String object；确认只得到 invalid 且 map/persistence/factory 计数为零。再用 Unicode、长、含空格 identity 对真实 persistence round-trip open。
3. 将真实 `packages/namespace-registry/src/registry.ts` internal import 置入 production graph：REPO_ROOT gate 必须收集它且 `violators=[]`；testing/test/其他 package 的反演 importer 必须失败。
4. 释放 lease 后：三个 getter 同步抛公开 `NamespaceLeaseReleasedError`，read/两写返回 `NAMESPACE_LEASE_RELEASED`，唯 getStatus 成功；重复 release/asyncDispose 必须 exact same Promise。
5. factory throw + handle release reject + observer throw：release 恰一次，主结果仍为原 `runtime-construction` fatal，且公开文本不泄漏 identity/cause。

## 总结

**APPROVED-WITH-CHANGES，残余阻断 0。** 原 B1/B2/B3 已被设计级修订闭环；N1/N2 为后续实现/后续 ticket 必须保留的非阻断审计点。