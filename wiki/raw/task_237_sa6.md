# SA6 红灯验收契约固化报告 — issue #237：路径级校验替代完整 ROOT 复制与全量校验

- **Issue**: #237（welltop-jim-wang/nomicore）| **阶段**: acceptance-contract（SA6，round 1, iteration 0）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-237` | **Branch**: `mabf/issue-237` | **HEAD**: `9e3f0bfe9e66ca71aecb33657f93907a4eafcf38`（=`9e3f0bf`，origin/main）
- **日期**: 2026-09-06（重跑 start 22:17:40 UTC；首次 dispatch `sa-c07c57ff-a690-487c-a287-a6a162d8a591` 因 Host observer schema failure 终止、未产生有效 acceptance-contract completion，本次完整重跑）
- **输入（全部读过）**: issue #237 正文 + Owner 3 条评论（2026-09-05T16:01Z 范围收敛 / 2026-09-05T16:08Z carrier follow-up / 2026-09-06T02:55Z 生产证据与 benchmark 场景）；SA5 `wiki/raw/20260906-bug-237.md`；SA8 门禁 `wiki/raw/task_237_conflict_report.md`（verdict `clear`，E1–E4）+ `wiki/raw/task_237_relevant_decisions.md`；既有契约规范 `wiki/raw/20260906-ac-issue-237.md`（已按重跑证据刷新）

## 交付物（可执行红灯验收契约，SA6 只锚行为、零生产改动）

| 文件 | 层 | 用例 | 角色 |
|---|---|---|---|
| `packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts` | doc-runtime `applyValidatedMutation` 内部管线（seam 计数 + 真实 Yjs/真实 vfsl） | 41（3 必红 + 38 绿锁定） | A-1 热路径零全量计数锚（必红）、A-2 无关分支语义反转（必红）、A-3 失败零写入/零事件、A-4 路径 carrier topology、A-5 批量数组整体判定+边界、A-6 行为等价 oracle 28 场景 |
| `packages/namespace-runtime/test/runtime-mutate-issue-237-hot-path-red.test.ts` | 唯一公共入口 `mutateData`（真实 Runtime seam + 真实 vfsl 编译） | 4（1 必红 + 3 绿锁定） | B-1 公共 interface/FIFO/最小 edit/单事务、B-2 失败零写入/零 dirty/零事件/槽不中毒、B-3 mutateData 级 R2 反转（必红）、B-4 大 ROOT 五笔 instrumentation |
| `wiki/raw/20260906-ac-issue-237.md` | 契约规范 | — | Owner 要求 → 测试锚点映射表（13 行）、E1–E4 文档义务登记、运行与证据 |

合计 **45 tests：4 failed（全部为预期「必红」锚）+ 41 passed（绿锁定）**。

## Owner 要求 → 锚点覆盖（全部显式入测试/契约文档）

1. **phase-1 前置假设**（mutation 前 committed ROOT 合法 = logical values + carrier topology）→ 每个用例前置 `expectValidBaseline`（extract 成功 + `validateLogicalSnapshot` 通过）——A-3/A-4/A-5/A-6、B-1/B-2；A-2/B-3 是唯一的显式例外（其语义即锚定 replication-unvalidated 形态）。
2. **删除热路径旧完整 ROOT 全量校验；不建 baseline 状态机；只提取/重建/校验 path + 最近必要语义边界** → A-1 计数锚（extract/validate/verify 三 seam 断言 = 0）。
3. **无关分支零访问/复制/校验；无关非法数据不再阻断路径外写（已声明语义）** → A-2（doc-runtime 级）+ B-3（mutateData 级）必红反转；B-1/B-4 identity/规模/内容零触碰绿锁定。
4. **路径导航检查局部 carrier topology；不实例化不匹配 carrier** → A-4×2（Y.Map↔Y.Array 冒充 → ok:false + 零写入，违规 carrier 原样保留）。
5. **校验失败在触碰 live Y.Doc 前决定；禁止写后 undo** → A-3×3 + B-2（stateBytes 不变、update 事件=0、notify=0、槽不中毒）。
6. **set/delete/批量 array-insert/批量 array-delete 均走局部路径**（最小 edit、单 guarded transaction、同槽 dirty、carrier identity 保留）→ A-1 第二用例计数锚 + A-5 + B-1（<128B/笔、notify=5、事件=5）。
7. **批量整体一次校验（不逐元素）** → A-5（任一元素非法 → 整批零写入拒绝；index/count 越界不 clamp）。
8. **union/Record/optional/数组边界/嵌套引用 ≡ 完整快照校验** → A-6 28 场景（oracle = 完整 proposed ROOT 全量校验，决策 + 结果 doc 全等 + 失败零写）。
9. **schema 要求更大上下文时安全退化至 ROOT（行为闭包）** → A-6 含空路径 set（整体替换 = 唯一合法全量形态）等价用例；create/replaceSchema 全量合法性建立点由既有绿测试族锚定，不改动。
10. **提交后 internal invariant 不无条件重提重验完整 ROOT；fatal 不削弱** → A-1 `verifySnapshotIntact` 计数 = 0（必红）；committed fatal 语义由既有 `apply-validated-mutation-fatal-contract.test.ts` 族守护（本套件未改）。
11. **大 ROOT + 连续五笔叶子 mutation（30s 周期压缩）保持 dirty notification 与 wire update count；不扩公共 API；不把 #238 归因本 issue** → B-4（8k 无关条目：ok×5、notify=5、update 事件=5、<256B/笔、尾部全局合法）；wire 级冻结引用 `ws-replication-issue230-incremental-mutation.test.ts`；描述与报告均不归因 #238。
12. **公共 interface / 结果联合 / 严格 FIFO / 最小 edit / 单 guarded transaction 保持** → B-1/B-2（逐笔 `toEqual({ok:true})` 精确联合；FIFO 引用既有 sequencer 测试族）。
13. **E1–E4（ADR-0007 修订节 / ADR-0008 同步 / ADR-0010 L107 后备句 + follow-up 登记 / CONTEXT.md 词条）+ follow-up 显式注册** → 已作为**随代码交付义务**登记于 AC 文档（SA6 不实现）；覆盖要求（AC 表 #10/#13 与义务节）保证 SA3/SA4 不静默丢项。

红灯纪律：断言全部锚定可观测行为（结果联合 / Yjs 状态字节 / update 事件计数 / dirty 计数 / 模块 seam 调用计数）；「必红」在交付时即红；**零墙钟计时断言**（计数锚大小无关、确定性、零 flake；B-4 把 30s 扫描周期压缩为紧邻调用——写路径无墙钟依赖）。

## 运行证据（重跑，2026-09-06）

```bash
# 红灯契约（同一命令两次运行结论一致；exit 1 = 契约现状即红，符合「必红」设计）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts \
  packages/namespace-runtime/test/runtime-mutate-issue-237-hot-path-red.test.ts --typecheck=false
# 结果：45 tests | 4 failed | 41 passed（vitest exit 1）
#   必红×4 = A-1 set（extract×3+validate×2+verify×1 ≠ 0）/
#            A-1 delete+array-insert+array-delete（同上 ≠ 0）/
#            A-2（无关非法 qty ⇒ 仍 ok:false，契约 ok:true）/
#            B-3（mutateData 级同上反转）
#   绿锁定×41 全绿 = A-3×3 / A-4×2 / A-5×5 / A-6×28 / B-1 / B-2 / B-4
# 日志：.mabf-bg/sa6-237/acceptance-red-rerun.log（start 22:17:40，Duration 9.38s）
#       首次 attempt 日志 .mabf-bg/sa6-237/acceptance-red.log（结果一致）

pnpm exec tsc -p packages/doc-runtime/tsconfig.json --noEmit       # exit 0（含本测试文件，类型洁净）
pnpm exec tsc -p packages/namespace-runtime/tsconfig.json --noEmit # exit 0
# 日志：.mabf-bg/sa6-237/tsc-doc-runtime-rerun.log / tsc-ns-runtime-rerun.log（均为空输出 + exit 0）
```

工作树洁净性（`git status -sb`）：仅 6 个未跟踪文件——上述两个 test 文件 + `wiki/raw/20260906-bug-237.md`（SA5）、`wiki/raw/task_237_conflict_report.md` + `task_237_relevant_decisions.md`（SA8）、`wiki/raw/20260906-ac-issue-237.md` + 本报告（SA6）；**零 src/ 改动、零既有测试改动、零公共 API 变化**。`.mabf-bg/` 由 .gitignore 排除，仅留盘证据。

## 结论与交接

- **SA6 判定：契约已固化且验证通过**——当前 HEAD 上 4 个「必红」锚全部真实红（红因与 SA5 缺陷点一一对应：prepare/verify 全提取 ×3、旧+proposed 两次全量逻辑校验、提交后整树 verify、无关分支全量校验拒绝），41 个「绿锁定」锚全绿（含 ADR-0007 明文前置的 28 场景行为等价）；两包 typecheck 双绿；无生产/公共面改动。
- **SA3 修绿目标**：4 个必红锚转绿且 41 个绿锁定保持全绿；随代码交付 E1–E4（ADR-0007 显式修订节、ADR-0008 §ROOT write 同步、ADR-0010 L107 修订 + replication/损坏存量/carrier 审计 follow-up 显式登记、CONTEXT.md 词条修订）。
- **边界遵守**：未扩公共 API/事件面；未把 #238 replication latency 归因本 issue；未建 committed-generation/baseline 状态机；失败判定先于 live 写（无 write 后 undo 契约锚）。
