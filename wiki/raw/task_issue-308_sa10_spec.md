# SA10 Spec 审查 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-6732a719-4459-419f-8290-45f37e8204b3`（mabf-sa10 / spec-review / iteration 0）
- 审查对象：**rebase 后最终交付** `154dd2cfe500a1908dce2e972d67f6f6ee40875d`（`feat(vfsl): merge member docs into read projection`），其父 = 权威 Parent PR #305 head `31da1f08dc168837523d5b314c9b12c5a89c1a91`（`git rev-parse 154dd2c^` 实测逐字节相同）
- 需求全集：Issue #308 正文（What to build + AC1–AC3）；REST comments `[]`（派发指令陈述，与 SA6 §2/SA8 iter5 实测一致）——**无 Owner 追加要求**
- 对照基准：SA6 验收契约 §12（可执行契约）、ADR 0019 §7（母决策）/决策 5、ADR 0016（含新增补节）、packages/vfsl AGENTS.md 可信域边界
- 裁决：**approve** —— 0 阻断 / 0 部分实现 / 0 错误实现 / 0 scope creep；2 项非阻断观察（§6）

---

## 1. Rebase 完整性（对象级核验，本轮实测）

| 检查 | 实测 | 结论 |
|---|---|---|
| 父提交 | `154dd2c^` = `31da1f0`（权威 head，逐字节） | ✅ rebase 落点正确 |
| 合并树 OID | `154dd2c^{tree}` = `37a0f621a87754aded4222b2c9b9b5fe7a77e607`，与 SA8 iter1–5 五次 `merge-tree` 干跑预测的干净树**逐字节相同** | ✅ 与五轮 clear 所裁决对象为同一 git 对象 |
| 被重放内容守恒 | `git diff 3fa05f4 154dd2c -- packages/vfsl docs/adr` = **0 行**（SA7 approve 的 38/38 动态断言对象面逐字节迁移） | ✅ 验证证据构造性迁移且为精确迁移（非近似） |
| 基线增量隔离 | `git diff 4d4208b 31da1f0 -- packages/vfsl docs/adr docs/vfsl CONTEXT.md` = **0 行**；增量（#322 codegen、root-lock）与 #308 面零交集；`packages/vfsl-codegen` 全包 grep `resolveSchemaAtPath` **0 命中**（无跨包行为耦合） | ✅ 无交互面 |
| 侧溢 | `git diff 31da1f0 154dd2c -- packages/namespace-runtime packages/vfsl-codegen apps` = **0 行** | ✅ 零越界 |
| 工作树 | tracked 文件对 HEAD 零 diff；未跟踪仅 Host 拥有的 wiki 工件 | ✅ 干净 |

## 2. AC 逐条判定

### AC1 — 读联合/枚举路径投影 docs 携带 `<member N>` 逐字成员 doc；marker 前、member 后 ✅ MET

- **实现**：`resolve-schema-at-path.ts` L485–489 第三遍扫描 `memberDocs`（去重并入）；L468–472 单点合并表达式 `merged(k) = [...fieldDocs[k] ?? [], ...markerDocs[k] ?? [], ...memberDocs[k] ?? []]`——合并序 field → marker → member 末位由构造保证（单点闭包，无分叉）；`want()`/spine/终点候选/闭包构造（L440–452）diff 零触碰（选键规则不变，ADR 0019 §7 原文要求）。
- **契约转写**：红契约 `resolve-schema-at-path-member-docs.test.ts` 16 tests = 前提 2 + M1–M9（13 it）+ D4 辅助 2。逐用例核对 SA6 §12.2：M1（`['u']` 闭包腿 + ref/闭包/aliasDocs 断言）、M2（枚举无成员结构、键只能由 memberDocs 表回填的对抗位）、M3/M4/M5b/M6（终点子树腿、闭包 `[]` 对抗位）、M5a（别名数组双路径）、M8a/M8b（23 键全量 + 闭包 8 名顺序）、M9a/M9b（机械不变量：三源逐字拼接 + 不发明键）——**全部在场且期望值逐字**；M7 以 `JSON.stringify(...) === '[" 载体甲 "," 成员甲 "]'` 逐字锁死 marker→member 次序，并断言 `Mixed.<member 1>` 空合并不成键。
- **fixture 对账**：`M4_TEXT` 36 行与 SA6 §12.1 逐字节相同；`EXPECTED_DOCS` 23 键与 §12.3 全等（含 `'Mixed.<member 0>': [' 载体甲 ', ' 成员甲 ']` 次序）。

### AC2 — 不使用 M4 的 schema 投影输出逐字节不变 ✅ MET

- **构造性**：`memberDocs` 为条件稀疏键（`derived.ts` L91 `memberDocs?`，本票零改动）；键缺席 → L485 三元整遍跳过 + `memberDocs?.[k] ?? []` 空贡献——两遍扫描内容/键集/键序与旧实现逐字节相同。
- **可执行锚定**：负控 C1（`FIXTURE_TEXT` 6 路径）/C2（`SPEC_FIXTURE` 4 + `FIXTURE_B` 3）/C3（剥离克隆 17 路径）以 `sha256(JSON.stringify(...))` 冻结摘要对账——fixture 内 41 个唯一摘要与 SA6 §12.4 表 1/2/3 **逐值核对一致**（本轮抽全量比对，含表 2 尾注 5 条）；C1/C2 附加 docs 无 `<member ` 子串断言。
- 摘要录制于实现前 HEAD `4d4208b`（SA6 §12.4），对账基准独立于世袭 fixture 常量（SA7 曾以文档转写值独立复算复核，探针笔误事件反证摘要具备判别力）。

### AC3 — packages/vfsl 相关测试（resolve-schema-at-path）与 typecheck 绿 ✅ MET（证据链完整）

- SA3（实现票）：聚焦 6 文件 **80 tests passed（--typecheck 无类型错误）**；`tsc -p packages/vfsl/tsconfig.json` exit 0；根 `pnpm typecheck`（14 tsconfig）exit 0；全包 36 files/644 tests；namespace-runtime 投影两文件 21 tests。
- SA7（动态验证，approve 38/38）：删除探针后复跑聚焦 6 文件与 runtime 两文件，结果逐项一致。
- **rebase 后迁移**：被测面（`packages/vfsl` 全目录 + `docs/adr`）rebase 前后**逐字节相同**（§1），基线增量不触该面 ⇒ 绿态结论精确迁移，无证据缺口；SA8 iter5 I3 已登记落地后例行 CI 确认（流程义务，非本审查阻断项）。
- 本角色不运行测试（章程）；上述为对既有 runner 记录的审查 + 对象同一性核验。

### Issue 括注 —「修订 ADR 0016 切片条款」（ADR 0019 决策 7）✅ MET

- ADR 0016 末尾追加 dated 增补节「ADR 0019 修订：docs 切片并入 memberDocs 第三来源（2026-09-11，issue #308）」：授权链 + 三条款（切片三来源 + 合并式；「文档三表」→「文档四表」；影响面）+ 保持句（「考虑的备选」为历史记录）。
- **append-only 机械核验**：`git diff 31da1f0 154dd2c --numstat -- docs/adr/0016-...md` = `20 0`（零删除行）；正文 L35–36/L42 旧文原样保留，增补节「旧文」引文与正文**逐字吻合**（本轮实测比对）；与全库修订惯例（`6155b51`/`2d9dce7` 先例）同构。

## 3. SA6 契约出口（§12.6）逐条

| 出口 | 状态 | 证据 |
|---|---|---|
| M1–M9 红（旧实现）→ 绿（目标实现） | ✅ | SA3 红灯基线 13 failed（红因逐条落 docs 合并处）→ 实现后 25 passed；SA7 S2/S3 探针 0 违例 |
| C1–C9 实现前后均绿 | ✅ | 负控 9 tests 逐条转写 §12.5 口径（C4 仅断言缺席、在场由 M1 锚定——与 §12.5 原文一致；C9 镜像 M4-free 不变量族 11 路径）；SA3/SA7 记录全绿 |
| 聚焦测试 + 包/根 typecheck 绿 | ✅ | §2-AC3 证据链 |
| 实现范围 = `sliceDocs` + 注释；不改 DerivedSchema/守卫清单/克隆器/既有测试 | ✅ | `derived.ts`/`evaluate.ts`/`index.ts`/6 份既有测试与 fixture 对基线**零 diff**（本轮实测）；函数头必填六键清单（L109–120）无 `memberDocs`（F3.1 红线保持） |

## 4. 规范一致性（适用 normative 面）

| 规范 | 要求 | 实现 | 判定 |
|---|---|---|---|
| ADR 0019 §7（母决策） | 三来源、`docs[k]=[...field,...marker,...member]`、选键不变、空过滤不变、四件套不变、克隆零改动 | 逐字对应（§2）；`packages/namespace-runtime/**` 零 diff | ✅ |
| ADR 0019 决策 5 | memberDocs 条件稀疏（缺席合法） | 缺席短路 + C3/C6 剥离克隆 ok:true | ✅ |
| ADR 0016（经增补节修订） | 键规约、投影四件套、两码结果联合 | 类型面零改动（`ReadDataSchemaProjection` 仅注释更新）；C7 恰 5 键 | ✅ |
| packages/vfsl AGENTS.md | 可信域畸形 → `InternalError`，不进结果联合；不泄漏裸 TypeError | D4 窄守卫（在场且 null/非对象/数组 → `InternalError`，L458–465）；D4 辅助断言含「畸形 + 解析失败 → 两码联合不额外 throw」（N-4 偏好锚定） | ✅ |

## 5. Scope 审查

- **ALLOW 符合**：交付触碰 = 设计 §11 ALLOW 全部 5 行（源码 1 + ADR 1 + 新测试 3）+ 6 份 wiki 证据文件（集成本分支惯例，#307/#322 同款）。DENY 全量核对零触碰（§3 末行 + namespace-runtime/codegen/v1-spec/CONTEXT.md/ADR 0019/0003 零 diff）。
- **无 scope creep**：深读路径（`['u','x']`）保持 `{}`——SA6 §15.1 明确不冻结、设计 D6 显式非目标，非遗漏；D4 守卫是设计明文决策（堵新增访问路径的裸 TypeError 泄漏），有契约外辅助断言但不替代任何 M/C 用例（SA6 §12/设计 §10 允许）。
- **PR 必须披露的未达成项**：无未达成 AC。已在 SA3 报告如实登记的移交项（非本票范围，不构成 partial）：① ADR 0003 回写指针 → #309/#306 收尾；② v1-spec §5 措辞滞后 → #309 收官（SA8 F2 明示中间态）；③ 深读携带途经成员 doc 需另立票；④ fieldDocs/markerDocs 存量 mistype 加固属独立小票。建议 PR 描述保留上述移交清单。

## 6. 非阻断观察（不阻断 approve）

1. **提交信息缺 issue 引用（MINOR，卫生项）**：`154dd2c` 仅有单行 subject「feat(vfsl): merge member docs into read projection」，未带 `(#308)` 后缀与验证摘要（SA3 建议稿含）；本支惯例（`31da1f0` `fix(#307)…`、`4d4208b` `fix(#306)…`）均在 subject 携带票号。可由 PR 标题/描述补齐，不影响任何 AC。
2. **rebase 后例行 CI 首跑待发生（记录性）**：绿态经对象同一性精确迁移（§1），无证据缺口；SA8 iter5 I3 已登记落地后例行 CI 确认为流程义务。

## 7. 结论

- **verdict：approve**。AC1/AC2/AC3 全部 MET 且证据链闭合（SA6 契约 approve → SA2 approve → SA3 实现 → SA4 approve 0-0-0 → SA7 approve 38/38 → SA8 六轮 clear 含最终授权确认）；rebase 后交付与五轮门禁所裁决对象为同一 git 树（OID 逐字节复现）；规范面（ADR 0019 §7/决策 5、ADR 0016 增补节、包边界）逐项一致；无遗漏、无部分实现、无错误实现、无 scope creep；无必须披露的未达成项（移交项已在 SA3 如实登记）。
- `requiresConflictRecheck: false`——本审查不新增/修订任何决策；SA8 iter5 终局确认的三项失效条件（Y1 head 再移动 / Y2 新 Owner 评论 / Y3 决策集新提交）本轮无触发迹象（head/树 OID 实测吻合）。
