# AC 逐条确认门禁 — doc-runtime：复用 detached builder 并原子替换 ROOT 内容（issue #88）

- 阶段：Phase 3.5（写 .mabf-done 前）
- 依据：issue #88 Acceptance criteria（与 TASK.md 一致，gh issue view 88 核对）
- 评审双清状态：红灯 13/13 转绿（总控亲跑）+ SA4 verdict: pass + SA7 verdict: pass
- 实现 commit：bbf4e5a（branch fix/issue-88-on-docs-namespace-runtime）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | materializeRoot 与新替换能力复用同一个 detached builder，不复制 Y.Map/Y.Array/XML/plain 构造规则 | ✅ | 单一构造源 `packages/doc-runtime/src/detached-build.ts`（`buildTopEntries`），materialize.ts 与 replace.ts 双入口均 import 它（replace.ts 头注「AC-1 单源，仓内不存在第二份构造规则」）；SA4 §纯移动验证：基线 materialize.ts 28 函数机械 diff——15 逐字全等，其余仅授权差异（export/类型名/api 实参），零未授权行为偏差；行为锚 G5（与 materializeRoot 构造等价：读回全等 + 失败面一致）13 用例全绿 | 无需处理 |
| AC-2 | detached builder 保持包内能力，不作为业务公共 API 或可跨时间执行的 prepared mutation 暴露 | ✅ | `src/index.ts:36-43` 公共面恰 4 值导出（extractYjsSnapshot / readLogicalValueAtPath / materializeRoot / replaceRootContent），detached-build 不在公共面；G6 黑盒模块级断言 `Object.keys` 精确匹配；detached-build 导出面 = buildTopEntries + @internal 四辅助 + 三类型（包内 seam，无 prepared mutation 句柄）；SA4 Scope 检查：改动恰 8 文件 = ALLOW LIST 全集 | 无需处理 |
| AC-3 | 完整验证和 detached 构造成功后，才允许 transaction 内清空并安装 ROOT 内容 | ✅ | replace.ts 六阶段编排（⓪ guard → ① validateLogicalSnapshot → ② buildTopEntries detached 构造 → ③ 探针+载体判定 → ④ 单 transaction clear+安装 → ⑤⑥ 写后校验），④ 严格在 ①②③ 成功之后；G3 双用例（逻辑失败/构造失败）断言 transaction 未发生 | 无需处理 |
| AC-4 | 顶层 doc.getMap('ROOT') identity 保持，旧子类型 identity 可失效 | ✅ | G1 断言：替换前后 `doc.getMap('ROOT')` `toBe` 同一实例、旧子类型 `not.toBe`（stale 失效）、恰 1 次 update、读回与新快照等价；SA4 RA-1 机制复跑（clear+set 单事务 identity 保持/旧子 stale）通过；SA7 双 Node 复证 | 无需处理 |
| AC-5 | 前置验证/构造失败时 Y.Doc state/update 零变化 | ✅ | G3：逻辑校验失败 → ok:false + issues 与 validateLogicalSnapshot 直调逐条一致 + 0 update + state 字节不变 + 旧内容原封不动；构造失败（NaN 过 ① 拒 ②）→ ok:false 恰 1 issue + 0 update + 字节不变；G7 未闭合外层事务 → throw DOCRT-E202 零写入 | 无需处理 |
| AC-6 | transaction observer/fatal 服从 committed-aware no-rollback 契约 | ✅ | G4：observer 抛错原样 loud 传播（不吞不包）、不虚假声称回滚、值已提交；写后偏离 throw DOCRT-E201 家族（绝不 ok:true）；SA1 §9 RA-2/RA-3 实测（observer 冒泡+update 照发；重入 delete 开独立新事务）经 SA2/SA4/SA7 三方复证 | 无需处理 |
| AC-7 | 行为测试覆盖空/非空 ROOT、全部载体种类、构造失败和 observer 边界 | ✅ | `test/replace-root-content.test.ts` 13 用例 / 7 组：G1 非空 ROOT（全载体 fixture：Record/union/ref/XML/plain/array）、G2 空+缺席 ROOT、G3 构造失败、G4 observer 边界、G5 构造等价锚、G6 封装边界、G7 事务纪律；13/13 绿（总控亲跑 + SA7 独立复跑） | 无需处理 |
| AC-8 | 全量 typecheck/test 和 Node 20/24 CI 通过 | ✅（本地门槛）| 总控亲跑：Node 24 `pnpm test` 66 文件 940 用例全绿 exit 0 + `pnpm typecheck` 六包 exit 0；SA7 独立复跑：Node 20.20.2 同命令 940/940 绿 + typecheck exit 0（双 Node 日志 /tmp/sa7/full-n24.log、full-n20.log）；SA4 §vitest 触发性：ci.yml Node 20/24 matrix 的 Test step 跑 `pnpm test` 覆盖本包。**GitHub CI run 在 push 后由 runner 跟踪核验（职责边界，本地完成事务不含 CI 绿）** | CI 面 deferred 至 runner（O-S7-1，与 rev2 先例一致） |

## 结论

8/8 AC 全部 ✅（AC-8 以本地双 Node 全量证据满足本地完成门槛；GitHub Checks 由 runner 在发布后核验）。无 ❌ 条目，无需追加 SA 派发。进入 Phase 4 收尾固化。
