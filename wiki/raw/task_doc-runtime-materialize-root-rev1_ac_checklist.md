# AC 逐条确认门禁 — 修订轮 rev1（PR #84 owner Review 闭环，issue #74）

- **日期**：2026-08-22
- **commit**：`638ad94`（fix/issue-74-on-docs-doc-runtime-validation，已 push origin）
- **基线 AC**：初轮 `task_doc-runtime-materialize-root_ac_checklist.md` AC-1~AC-6 全 ✅（本轮无回归，820/820 全绿含初轮锚）
- **本轮 AC**：简报 `task_doc-runtime-materialize-root-rev1.md` RAC-1~RAC-6

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| RAC-1 | P1：observer 重入不抛错（delete/overwrite/insert extra key）语义有明确契约并落实；回归测试断言返回结果与最终 ROOT 状态 | ✅ | SA1 设计 RD1 定谳出口 A（⑤ verifyInstall 顶层 size+逐键身份双断言，偏离 throw DOCRT-E201；JSDoc 契约 + ⚠️ 最外层事务前置条件 R-7）；SA6 R1 组 6 用例 + T-1/T-4/空快照（CI 60/60 内含）；SA7 探针 PRB-2/3/4/5 独立复证五向量（残留状态逐键断言：不回滚、不补偿）；SA2 R2 pass / SA4 pass（设计偏离逐字核对） | SA1（裁决+设计）→ SA2（两轮评审）→ SA6（锚定）→ SA3（实现 638ad94）→ SA4/SA7 双清 |
| RAC-2 | High：detached 构造失败（逻辑校验已通过）→ ok:false + 恰 1 issue + 0 update + state 字节不变；unknown 字段承载 Date/bigint/NaN/Infinity/Yjs 类型/数组内 undefined + XML parser 构造期拒绝分支 | ✅ | SA6 R2 it.each 10 行矩阵（C-1~C-8 含 ±Infinity、Y.Array 独立行 + C-8/X-F9 attr-`"`)，每行先证 `validateLogicalSnapshot ok:true` 再证四断言；SA7 探针 PRB-6 独立复证 Date 支路；CI 双腿 60/60 | SA6 锚定（现实现行为已达标，测试锚定为主锚——owner #5 方法论并入） |
| RAC-3 | High：xml-parse 表驱动覆盖 attributes/comment/CDATA/PI/多根/顶层文本/空 XML/self-closing/空元素/重复属性/whitespace/malformed；失败场景单 issue + 零 update + state 不变；接受域差异定谳并锁定 | ✅ | SA1 RD3 定谳 attr-`"` 为有意 materialization 约束（yjs 序列化器不转义属性值）；SA6 R3 it.each 25 行（17 成功语义等价经 expectXmlSemanticallyEqual 比较器——W2 合规 + 8 逻辑失败恰 1 issue 双断言）；SA7 探针 PRB-7 独立锁定 `<p title='a"b'>x</p>` 差异；SA4 核对 X-F9 并入 C-8 有设计规范依据 | SA1 定谳 → SA6 表驱动锚定 → SA4/SA7 双清 |
| RAC-4 | Medium：materialize 后 extractYjsSnapshot 提取与输入 snapshot 完整语义比较（union 各 variant、Record 全 key、Y.Array 元素与顺序、leaf 值、XML 内容）；嵌套 plain clone 隔离 | ✅ | SA6 R4 三用例（全量语义比较 A/B + 嵌套 clone 隔离 C，W3 语义归一化）；SA7 探针 PRB-1 独立 extract 全量语义比较 + revalidate；CI 双腿绿 | SA6/SA3 落实，SA4/SA7 双清 |
| RAC-5 | Low：observer 抛错测试 toThrow('observer-boom') 或 exact identity + observer 调用次数 | ✅ | SA6 U13 原地收紧（toThrow('observer-boom') + observeCalls===1，保留 updates===1 与值未回滚）；SA7 探针 PRB-8 用独有消息 'sa7-boom-7734' 原样传播复证 | SA6/SA3 落实 |
| RAC-6 | 建议：CI 增加 materialize-root 专项存在性门禁 | ✅ | ci.yml「Materialize root tests」步骤（`--typecheck --passWithNoTests=false`，紧随 Domain scaffolds check 后）；CI run 32579701331 双腿真实执行 60/60（SA7 Step 4 all-vitest-packages-triggered）；SA7 §2.6 破坏性验证：移走测试文件 → exit 1（门禁非摆设） | SA1 设计 §7 → SA3 落实 → SA7 动态+破坏性双证 |

**结论**：RAC-1~RAC-6 全部 ✅，无 ❌ 条目，无需追加派发。owner Review 的 P1 + 两项 High 全部闭环；Medium/Low/建议项全部采纳落实，无裁剪项。
