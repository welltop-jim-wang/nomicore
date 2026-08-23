# AC 逐条确认门禁 — 验证后安全物化 logical ROOT 到 Yjs（issue #74）

- 任务类型：feature（功能开发）
- AC 来源：TASK.md / issue #74 Acceptance criteria（6 条）
- 行为锚点：`packages/doc-runtime/test/materialize-root.test.ts`（13 用例 / 6 组 describe）
- 验证基线：总控亲跑根目录 `vitest run --typecheck` → Test Files 57 passed (57) / Tests 773 passed (773) / Type Errors no errors / EXIT=0（2026-08-22 20:19，代码终态 = ac0f487 + d25beb6，此后 packages/ 零改动）
- 评审双清：SA4 verdict=pass（task_doc-runtime-materialize-root_sa4_review.md）+ SA7 verdict=pass（task_doc-runtime-materialize-root_sa7_report.md，29 项活链路探针 TOTAL=29 FAILED=0）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | logical 失败保留完整 issues；materialization 失败返回单 issue | ✅ | 用例 L171（issues 与 validateLogicalSnapshot 直调 toEqual 完全一致 ≥2 条）+ L197（ROOT 非空恰 1 条 issue）；SA4 21 组探针含多违规全收集核销；SA7 探针覆盖 unknown 位脏值单 issue | 测试锚定 + 双评审核销 |
| AC-2 | 目标 ROOT 非空响亮失败，不 overwrite、merge 或 fallback | ✅ | 用例 L214（既有内容不 overwrite + 新键不 merge + 0 写入）+ L232（异型 Y.Array 同款失败）+ L247（正向对照：ROOT 缺席/空 map 成功）；SA4 探针核销 | 测试锚定 + 双评审核销 |
| AC-3 | detached 构造正确区分 Y.Map、Y.Array、Y.XmlFragment 与 plain deep clone | ✅ | 用例 L267（全形态 fixture 载体逐类断言：map→Y.Map / array→Y.Array / xml-fragment→Y.XmlFragment / plain→非 Y.AbstractType 纯值）+ L290（突变输入快照 doc 不变，引用隔离）；SA7 探针含 `__proto__` Record 键往返无原型污染 | 测试锚定 + 双评审核销 |
| AC-4 | 全部构造成功后才执行单次 transaction；前置失败时 Y.Doc state/update 不变 | ✅ | 用例 L314（成功恰 1 次 update）+ L327（校验失败 0 事件 + state 逐字节不变）+ L341（ROOT 非空 0 事件 + state 不变）+ L353（SCHEMA/META 兄弟条目不变）；SA7 探针空事务 0 事件、嵌套事务归并单 update | 测试锚定 + 双评审核销 |
| AC-5 | XML string 物化后提取可再次通过逻辑校验，不要求字符串逐字相同 | ✅ | 用例 L368（物化→extractYjsSnapshot→normalizeXml 语义等价→revalidate ok:true）；SA7 五串 XML（`<br/>` 重排、单引号重排、实体/PI/注释逐字、空串）往返全过 | 测试锚定 + 双评审核销 |
| AC-6 | observer 抛错边界按 ADR 0007 处理，不虚假承诺事务回滚 | ✅ | 用例 L389（observer 抛错 toThrow loud 传播 + 写入已提交不虚假回滚）；SA7 双 observer 面（ROOT 级 + doc 级）loud 传播、多键部分提交不清理（`threw="observer-boom" updates=1 a="1" b="2"`） | 测试锚定 + 双评审核销 |

## 结论

AC-1 ~ AC-6 全部 ✅，无 ❌ 条目，无需追加 SA 修订轮。进入第四阶段收尾固化。

## 登记的不阻塞 MINOR（放行后跟进项，非 AC 缺陷）

- SA4-M1：design §10 DENY LIST 的 package.json 条目表述滞后于总控 bump 硬门禁（文档措辞，设计档案层面，不影响实现正确性）。
- SA4-M2：手造空成员联合的 E200 message 措辞可优化（INV-3 单 issue 纪律已守住，仅措辞）。
- SA7 登记：CI 侧 `gh run view --log` 触发证据因分支未 push 暂不可得（环境阻塞非缺陷）；本地静态触发链（SA4 §0.2：ci.yml `pnpm test` → 根 vitest.config `packages/*/test/**/*.test.ts` 覆盖 doc-runtime）+ 本地全量动态复现双证覆盖，push/PR 后由 runner 补录闭环。
