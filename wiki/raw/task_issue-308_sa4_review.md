# SA4 实现静态审查 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-a2b7e297-f317-431c-ad19-6b633f048615`（mabf-sa4 / implementation-review / iteration 0）
- 审查对象：SA3 实际交付 diff（worktree `/home/wangjian/nomicore-fix-issue-308`，分支 `mabf/issue-308`，HEAD `4d4208b` + 未提交工作树改动）与 `wiki/raw/task_issue-308_sa3_impl.md` 验证证据
- 裁决：**approve** —— 0 BLOCKER / 0 MAJOR / 0 MINOR 阻断项；3 项非阻断观察（§12）。实现逐字落实 SA1 设计 D1–D8 与 SA6 契约 M1–M9/C1–C9，文件面严格限于 ALLOW，无 DENY 触碰，无契约连锁遗漏。

---

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（Issue #308 body；REST comments `[]`） | `wiki/raw/task_issue-308.md` | 已读；无 Owner 评论（派发指令与 SA6 §2/SA2 §4 三重一致） |
| SA1 设计（iteration 1，SA2 approve） | `wiki/raw/task_issue-308_design.md` | 已读（§7-D1–D8、§10、§11、§14 逐项） |
| SA2 设计评审 | `wiki/raw/task_issue-308_sa2_review.md` | 已读（F-SA2-1 闭环基准 + N-1–N-4 + O-1/O-2） |
| SA6 验收契约 | `wiki/raw/task_issue-308_sa6_contract.md` | 已读（§5/§6/§9/§12.1–§12.6/§13/§15 逐项转写核对） |
| SA8 冲突门禁 | `wiki/raw/task_issue-308_sa8_conflict.md` | 已读（C1–C12 + F1/F2/F3.1–F3.3） |
| SA3 实现报告 | `wiki/raw/task_issue-308_sa3_impl.md` | 已读（含 4 项如实记录的实现期偏差） |
| 实际 diff | `git diff` / `git status`（只读命令） | 已全量核对：`resolve-schema-at-path.ts` `+41/-9`；ADR 0016 `+20/-0`；3 份新增测试文件未跟踪 |
| 源码/测试锚点 | `resolve-schema-at-path.ts`（全文 496 行）、`derived.ts`、`evaluate.ts`、`read-schema-projection.ts`、既有 `resolve-schema-at-path*.test.ts`、两份既有 fixture、`vitest.config.ts`、`packages/vfsl/tsconfig.json`、`.github/workflows/ci.yml`、`packages/vfsl/AGENTS.md` | 已读 |
| ADR | `0016`（118 行，含新增节）、`0019`（§5/§7 逐字） | 已读 |
| 机械对账 | fixture vs SA6 契约（脚本比对，只读） | M4_TEXT 逐字节相同（36 行）；EXPECTED_DOCS 与 §12.3 全等（23 键）；fixture 内 41 个唯一 sha256 摘要 == SA6 §12.4 全部摘要（无缺失、无多出） |

固定输入中 `task_issue-308_relevant_decisions.md` 不存在（SA8 冲突报告已内联相关决议，SA2 §1 同判），无事实缺口。

## 2. Verdict

**approve**。理由分四线：

1. **设计落实零漂移**：`sliceDocs` 第三遍扫描 + 单点 `merged(k)`（field → marker → member 末位）+ D4 窄守卫（在场畸形 → `InternalError`，不入必填键清单）与设计 §7-D1/D4 伪代码逐句对应（源码 L454–489）；`want()`/spine/终点候选/闭包构造零改动（diff 佐证）；L54 接口注释与 docstring 按 D7 同步；ADR 0016 为末尾追加 dated 增补节（`+20/-0`），正文 L35–36/L42/L84 原文保留，增补节内「旧文 → 新文」引文与正文逐字一致（本轮实测比对）。
2. **验收契约完整转写且未被弱化**：红契约 M1–M9（含前提断言 2 条 + D4 辅助 2 条 = 16 tests）与负控 C1–C9（9 tests）逐用例对得上 SA6 §12.2/§12.5；46 条冻结摘要（13+4+3+17+16−重复）与 41 个唯一 sha256 值经机械比对与 SA6 §12.4 表 1/2/3 完全一致；M4_TEXT 与 §12.1 逐字节相同；无 skip/only/todo、无源码字符串断言、全部经公共入口 `parseVfsl → evaluate → resolveSchemaAtPath`。SA3 红灯基线（13 failed / 3 passed）与实现后（25 passed）内部自洽（13 红 = M1–M9 + D4-loud；3 绿 = 前提 2 + D4 路径失败联合 1——与旧实现行为逐条推演一致）。
3. **文件面严格合规**：2 M + 3 新增测试全部落在设计 §11 ALLOW 五行内；DENY 全量核对零触碰（见 §6）。
4. **契约连锁无遗漏**：`resolveSchemaAtPath` 生产消费面全库 grep 仅 `projectReadDataSchema` 一处（L33/L56，零改动）；`InternalError` 走其已文档化的唯一逃逸通道（零 catch 结构不动）；`cloneDocsRecord` 泛化深拷贝承接新条目；namespace-registry/runtime src `memberDocs` 0 命中。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1：联合/枚举路径投影 docs 携带 `<member N>` 逐字成员 doc | `sliceDocs` 第三遍扫描（L485–489）+ `merged(k)`（L468–472）；红契约 M1–M8b 逐字期望（含 M2 枚举无成员结构、键只能由 memberDocs 回填的对抗位） | ✅ 落实 |
| AC1：marker 前、member 后 | `merged(k)` 单点拼接序构造性成立；M7 `JSON.stringify(r.docs['Mixed.<member 0>']) === '[" 载体甲 "," 成员甲 "]'` 逐字次序断言；`Mixed.<member 1>` 空合并不成键 | ✅ 落实 |
| AC2：不使用 M4 的投影输出逐字节不变 | 条件键缺席 → 第三遍整体跳过；`merged` 在 memberDocs 缺席/键缺失时与旧表达式 `[...(fieldDocs[k] ?? []), ...(markerDocs[k] ?? [])]` 逐值等价（构造性 + C1/C2/C3 冻结摘要 13+7+17 条）；C1/C2 附加 docs 无 `<member ` 子串断言 | ✅ 落实 |
| AC3：packages/vfsl 相关测试与 typecheck 绿 | SA3 Verification 表：聚焦 6 files/80 tests（--typecheck 无类型错误）、`tsc -p packages/vfsl` exit 0、根 `pnpm typecheck` exit 0、全包 36 files/644 tests、namespace-runtime 投影两文件 21 tests | ✅ 证据完整（命令、退出码、数量齐备） |
| Issue 括注「修订 ADR 0016 切片条款」 | ADR 0016 末尾 dated 增补节（三条款 + 授权链 + 保持句），`git diff --numstat` = `20 0`、`git diff --check` 干净（本轮复验 exit 0） | ✅ 落实（append-only，正文零改动） |
| SA6 §5–§13 全部红/绿判定出口（§12.6） | §12.6 三出口逐条满足：M1–M9 绿、C1–C9 绿、聚焦测试 + 包/根 typecheck 绿、实现范围 = `sliceDocs` + 注释（未触 DerivedSchema/守卫清单/克隆器/既有测试） | ✅ 满足 |
| SA8 C1–C12 / F1 / F3.1–F3.3 | SA3 报告 SA8 约束表逐行核对属实：必填键清单六键不动（源码 L109–120 实测无 `memberDocs`）；C6 剥离克隆与含表派生物均 `ok:true`（C6 用例）；合并局限 docs 表层（C8 非 docs 摘要 16 路径冻结） | ✅ 全部落实 |
| SA2 Required revisions（iter 1 已闭环，无新增阻断项） | F-SA2-1 选项 (a) 落实：增补节纯新增、正文不动；N-1（L84 随全文保留 + 保持句声明）/N-2/N-3（设计文档项）/N-4（守卫位置 = sliceDocs 内，红契约 D4 辅助第二用例锚定「畸形表 + 不可解析路径 → 两码联合不额外 throw」） | ✅ 无遗留 |
| Owner 评论 | Issue REST `comments: []`（简报/SA6/SA2/派发指令四重一致）；无评论级要求可遗漏 | ✅ 不适用 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1：三源合并单点（第三遍扫描 + `merged(k)` 闭包；三处扫描共用；去重并入；空过滤 `content.length > 0`） | `resolve-schema-at-path.ts` L467–489（三遍循环体逐句与伪代码同构；`merged` 为局部闭包，零新增公共符号） | ✅ 逐句一致 | — |
| D2：选键规则零改动（`want()`/spine/终点候选 V/闭包构造不动） | diff 未触及 L440–452（`want` 原样）；值侧游走 L282–288（union 展开 `<member N>`）原样 | ✅ | — |
| D3：M4-free 逐字节不变（构造性） | 条件键缺席短路（L485 三元）+ `memberDocs?.[k] ?? []` 空贡献；evaluate 侧 M4-free 派生物真无该键（`evaluate.ts` L74 `Object.keys(docs.memberDocs).length > 0` 条件展开，本轮源码复核）→ 守卫与扫描均不触碰 | ✅ 双侧（实现 + 上游产物形状）成立 | — |
| D4：在场畸形窄 loud 守卫（null/非对象/数组 → `InternalError`；不加必填清单；守卫位于 `sliceDocs` 内） | L454–465：`rawMemberDocs: unknown` 收窄 + 三形谓词（`null` 显式分支在场——`typeof null === 'object'` 陷阱正确处理）→ throw `InternalError`（复用 `./resolve.js` 既有导入）；函数头必填六键清单（L109–120）零改动 | ✅ 谓词、通道、位置、红线四项全对（SA3 偏差 3 的 TS 收窄写法与伪代码语义逐条等价，经 `tsc` 双级验证） | — |
| D5：docs 键插入序（fieldDocs 声明序 → marker-only → member-only） | 三遍扫描顺序即插入序；逐调用确定（零 memo，派生物不可变） | ✅（未被 ADR 冻结，M8b/C 系用 `toEqual`/M4-free 摘要，口径相容） | — |
| D6：穿过联合的深读不扩展 | spine/选键零改动；`['u','x']` 仅作为 C3 剥离克隆冻结路径（旧/新同判），未设成员 doc 断言 | ✅ 显式保持现状 | — |
| D7：源码内注释同步 | L54–57（接口注释三来源 + 合并序）；L421–433 docstring（合并式、扫描序、条件键缺席语义、前缀匹配安全性注记保留） | ✅ | — |
| D8：ADR 0016 append-only dated 增补节 | 末尾 20 行纯新增；节题/授权链/三条款/保持句与设计 §7-D8 规格逐字一致（条款 3 行断差异 = SA3 偏差 2 登记的设计稿换行残句修正，语义逐字相同）；条款 1/2 的「旧文」引文与正文 L35/L42 逐字吻合（本轮实测） | ✅ | — |
| §8 接口/数据流/§9 错误并发 | 公共 API 零变化（`index.ts` L125–126 原样；`ReadDataSchemaProjection` 仅注释变化，类型形状不动）；纯函数、零 memo、无状态机——与源码事实一致 | ✅ | — |

设计明确但实现缺失项：无。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| docs 三源切片 | vfsl resolver（`sliceDocs`，ADR 0019 §7 明列改动点） | `sliceDocs` 内（同函数同构扩展） | ✅ 事实 Owner |
| memberDocs 表收集 | evaluate（#306 面） | 未触碰 | ✅ |
| detached 深拷贝 | namespace-runtime 组合边界 | 未触碰（`cloneDocsRecord` 泛化遍历 `Object.keys(rec)`，L216–220 实测） | ✅ |
| ADR 0016 条款回写 | append-only dated 增补节（全库条款级修订惯例） | 末尾追加，纯新增 | ✅ 与 `6155b51`/`2d9dce7` 先例同构 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| docs 表切片合并 | 两遍扫描 + 去重并入 + 空过滤 | 同构第三遍 + `merged()` 单点 | 一致 | 同函数内最小扩展；单点闭包消除三份复制表达式漂移面（R1 缓解） |
| 可信域 loud 守卫 | 函数头六键在场检查 + evaluate `guardMemberDocs`（条件键在场才校验） | D4：在场且非 record 才 throw | 一致 | 与 evaluate 侧「缺席合法、在场才校验」口径同族；通道复用 `InternalError` |
| 条件稀疏键消费 | evaluate L74 条件展开派生物 | resolver 侧同款条件消费 | 一致 | 两端对「第八键」的缺席语义对称 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 成员 doc | `derived.memberDocs`（evaluate 产物，条件稀疏） | 每次读现算 docs 切片（新鲜数组） | 无（零缓存） |
| 选键/合并规则 | `sliceDocs` 单点（`want()`/`merged()`） | — | 无（单点闭包） |
| ADR 0016 条款效力 | 正文 + dated 修订节条款清单 | — | 无（未引入第二种判定方式） |

### 生命周期对称性

不适用（纯同步函数；无 register/dispose/后台任务/订阅）。回滚 = 单文件 revert + 三测试文件删除 + 增补节 revert（纯新增，删除即还原）——SA3/设计 §9 叙事与 diff 形态一致。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套合并/过滤逻辑 | `sliceDocs` 两遍 | 并入同一 `merged()` 单点 | 无平行机制 ✅ |
| 新公共符号/导出 | `index.ts` 现有面 | 零新增 | ✅ |
| 新测试通道 | vitest include `packages/*/test/**/*.test.ts` | 三份新文件落 `packages/vfsl/test/`（fixture 非 `.test.ts` 不收集、由包 tsconfig `test/**/*.ts` 覆盖——实测 tsconfig include） | ✅ 复用真实 runner |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（M，`+41/-9`） | §11 ALLOW 行 1 | D1/D4/D7（第三来源 + 单点合并 + 窄守卫 + 注释同步） | ✅ 改动内容全部在 ALLOW 描述内 |
| `docs/adr/0016-readdata-semantic-schema-projection.md`（M，`+20/-0`） | §11 ALLOW 行 2（末尾追加、正文零改动、diff 纯新增） | D8 dated 增补节 | ✅ `numstat 20 0` + `git diff --check` 干净（双重复验）；正文 98 行原样（总 118 行） |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-fixture.ts`（新增） | §11 ALLOW 行 3 | 契约 fixture（数据） | ✅ 非 `.test.ts`；M4_TEXT/EXPECTED_DOCS/摘要常量与 SA6 机械对账全等 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts`（新增） | §11 ALLOW 行 4 | 红契约 M1–M9 + 前提 + D4 辅助（16 tests） | ✅ |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts`（新增） | §11 ALLOW 行 5 | 负控 C1–C9（9 tests） | ✅ |
| `wiki/raw/task_issue-308_sa3_impl.md`（未跟踪） | 非 ALLOW/DENY；SA 过程工件（wiki/raw 为 Host 拥有工件区） | SA3 实现报告 | ✅ 惯例归属 |

DENY 核对（`git status --short` 全量 + 源码实测）：`derived.ts`、`parser/ir/semantic/evaluate.ts`、可信域必填键清单（L109–120 六键，无 `memberDocs`）、`packages/namespace-runtime/**`、既有测试/夹具（`resolve-schema-at-path*.ts` 三测试 + test-d + fixture、`evaluate-derived-member-docs.test.ts`、`union-member-docs-fixture.ts`——git status 零修改）、`index.ts`、`packages/vfsl-codegen/**`、v1-spec、schema-authoring-guide、`CONTEXT.md`、ADR 0019、ADR 0003、ADR 0016 正文——**全部零触碰**。工作树无越界文件、无临时 marker（`.scratch/vfsl-v1-parser/spec.md` 为 14:53 既有文件，先于本任务改动，非 SA3 遗留）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `resolveSchemaAtPath` ok 分支 `docs` 内容增量（新增 `<member N>` 键，仅 M4 输入） | `projectReadDataSchema`（`read-schema-projection.ts` L33/L56，唯一直接生产调用方——全库 grep 复核） | 整体深拷贝透传（`detachReadSchemaProjection` → `cloneDocsRecord` 泛化按键遍历，新条目随表流过）；零改动 | 无 | — |
| 新增 `InternalError` throw 路径（memberDocs 在场畸形） | 同上 | 既有已文档化唯一逃逸通道（「不加 catch、不收敛 null、不降级码」，L54–56 注释与结构实测不动）；类别未漂移；生产不可达（evaluate 恒产合法 record——`collectDocs` 以 `{}` 初始化 + `put` 填充，L378/L407） | 无 | — |
| `NamespaceRuntime.readData` 成功分支 | runtime 组合点 | `schema: projection \| null` 透传，docs 内容加法兼容 | 无 | — |
| `@nomicore/namespace-registry` / typed-access / 外部 adapter | 键控读取投影 | 无 M4 输入（`grep memberDocs` 于两包 src 0 命中，本轮复核）；四件套形状不变 | 无 | — |
| `validate.ts` / `validate-patch.ts` | — | 不读 docs 表（ADR 0019 §8）；本 diff 未触 | 无 | — |
| vfsl-codegen emitter | — | 直接消费 derived 表；发射位属 #307；未触 | 无 | — |
| 既有 55 tests（含 L449–485 M4-free 不变量族） | vitest/CI | 文件零修改；SA3 聚焦运行 4 旧文件全绿 + 全包 644 绿（C9 runner 面）；既有 resolve 测试文件 `memberDocs` 0 命中（本轮 grep）→ D4 守卫不可能击穿存量用例 | 无 | — |
| ADR 0016 文档契约面 | 规范读者 | 纯新增登记节；「旧文 → 新文」引文与正文逐字吻合；判定方式与全库惯例一致 | 无 | — |

## 8. 错误、恢复与并发

| 检查项 | 结论 | 证据 |
|---|---|---|
| 错误吞掉/伪装成功 | 无。条件键缺席是合法形状（规格行为），非降级；D4 守卫 loud（`InternalError`，不进结果联合） | L454–465；packages/vfsl AGENTS.md 可信域例外句（本包指令确认） |
| 裸 TypeError 泄漏 | 已堵：新增访问路径（`Object.keys(memberDocs)`）先过表级形状守卫；条目级信任与 fieldDocs/markerDocs 同级（既有姿势，设计 D4 要点 4 + follow-up 4 如实登记） | L458–465 |
| 部分完成诚实报告 | 纯函数，无部分态；三遍扫描产单点合并值 | L468–489 |
| 重试/回滚/幂等 | 无重试语义；同输入逐字节确定（C7 两次调用全等 + JSON 往返断言）；回滚 = revert 纯新增面 | C7；diff 形态 |
| 并发 | 零共享状态、零 memo（正则缓存调用局部，原样）；多读并发安全性与现状相同 | 源码 L129 |
| TOCTOU/双写/stale generation | 不适用（读面纯函数，无缓存/版本面） | — |
| 守卫顺序与失败语义 | path 敌意守卫 → derived 六键守卫 → 路径解析 →（ok 才）`sliceDocs` 内 memberDocs 守卫：解析失败 + 畸形表 → 两码联合不额外 throw（N-4 偏好，红契约 D4 第二用例锚定） | L96–126、L181；红契约 L273–280 |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `resolve-schema-at-path-member-docs.test.ts`（16 tests） | 前提 2（memberDocs 23 键非空、fieldDocs 恒无 `<member N>` 条目、marker+member 同键双非空唯一位）；M1/M2/M8a（闭包腿逐字 + ref/闭包/aliasDocs）；M3/M4/M5b/M6（终点腿逐字 + 闭包 `[]` 对抗位）；M5a（别名数组元素）；M7（marker 前 member 后的 JSON 逐字次序 + 空合并不成键）；M8b（23 键全量 + 闭包 8 名顺序 + aliasDocs）；M9a（闭包腿机械三源拼接）；M9b（不发明键 + 三源拼接 + aliasDocs ⊆ 表）；D4 辅助 2（畸形 → InternalError；畸形 + 解析失败 → 两码联合） | vitest include `packages/*/test/**/*.test.ts`；CI typecheck 作业 + test 分片（shard 脚本枚举全部 `*.test.ts`）必然收集 | 无。期望全为运行时行为断言（`toEqual`/`toThrow`/JSON 序列化），经公共入口；无 skip/only/todo（grep 实测）；M4_TEXT 与 SA6 §12.1 逐字节相同（机械比对）；M9a 对闭包空路径天然空转，由 M3/M4 直测补偿（SA6 §12.2 原设计即如此） | — |
| `resolve-schema-at-path-member-docs-control.test.ts`（9 tests） | C1（FIXTURE_TEXT 6 摘要 + 无 `<member ` 键）；C2（SPEC_FIXTURE 4 + FIXTURE_B 3）；C3（剥离克隆 17 摘要）；C4（空数组合并 → 键缺席，仅缺席断言——SA6 §12.5 原文口径，在场由 M1 锚定，SA3 偏差 1 如实记录且正确）；C5（整表替换不泄漏 + `['m']` marker-only）；C6（两形状均 ok）；C7（恰 5 键/两次全等/JSON 往返）；C8（非 docs 摘要 16 路径）；C9 镜像（M4-free 不变量族，路径集与既有 L449–485 同 11 条） | 同上；复用既有 fixture（`FIXTURE_TEXT`/`SPEC_FIXTURE`/`FIXTURE_B` 导入实测在场） | 无弱化。41 个唯一 sha256 与 SA6 §12.4 机械全等；`sha256` 用 `node:crypto`（运行入口真实）；C9 的「既有文件零改动原样绿」由 git status + SA3 runner 记录锚定，新 C9 镜像为补充面 | — |
| fixture 文件 | 纯数据导出（不被收集，包 tsconfig `test/**/*.ts` 覆盖类型检查） | `npx tsc -p packages/vfsl/tsconfig.json`（SA3 exit 0） | 无 | — |
| SA6 红灯断言保持 | SA3 实现前运行证据：13 failed（M1–M9 + D4-loud）/ 控制 9 passed——与 SA6 §13「旧实现红/绿」矩阵逐条一致；实现后 25 passed | SA3 Verification 表 | 无伪绿路径（无 fallback/env override/源码断言）；红灯失败点全部落在 `docs` 断言处（`valueSchema`/`aliases`/`aliasDocs` 前置即绿） | — |
| 既有测试（C9） | 4 旧文件 55 tests + 全包 36 files/644 tests + namespace-runtime 投影两文件 21 tests | 同 runner | 文件零修改（git status） | — |

CI 触发性：`ci.yml` typecheck 作业跑 `pnpm typecheck`（含 packages/vfsl tsconfig 的 test glob → fixture 类型检查）+ `vitest run --typecheck.only`（test-d 面）；test 作业 shard 枚举全部 `*.test.ts` → 新两文件必然入片。新测试未被入口遗漏。

## 10. Required revisions

无（0 BLOCKER / 0 MAJOR / 0 MINOR 阻断项）。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 全仓 `pnpm test`（跨包集成面，SA3 已跑 vfsl 全包 + namespace-runtime 投影两文件，未跑全仓） | CI test 分片（真实环境首跑） | 全部分片绿（公共类型未变，理论零影响） | 任一分片红且归因于 docs 新键或 D4 守卫 |
| 三份新文件在 CI shard 脚本下的收集与耗时 | CI 首跑 | 新两文件入片、25 用例绿；耗时不显著改变分片均衡 | shard 枚举遗漏（`passWithNoTests=false` 会响亮失败）或超时 |
| 大规模 schema 下第三遍扫描的实测量级（SA6 §7 近线性曲线为旧实现基线） | 后续性能敏感场景的例行观测 | O(memberDocs 键数) 增量，无可观测回归 | 非线性增长或毫秒级以上单读增量 |
| `memberDocs` 条目级畸形（如条目为字符串）的存量信任姿势 | 独立小票（设计 §13 残余 4 已登记） | — | —（非本票面；与 fieldDocs/markerDocs 同信任级，不因本票恶化） |

## 12. Non-blocking observations

1. **D4 守卫的条目级信任边界（记录性）**：守卫只校验表级形状（null/非对象/数组），条目值仍照旧信任（如手造条目为字符串时 spread 会按字符展开而非 throw）——与 fieldDocs/markerDocs 既有姿势同信任级，设计 D4 要点 4 明示且 follow-up 4 已登记独立小票；生产不可达（evaluate 恒产合法表）。无需本票动作。
2. **C9 的可执行面形态**：负控文件中的 C9 是既有 L449–485 不变量族的**镜像**（同 11 条路径、同判据），而「既有测试文件零改动原样运行仍绿」这一 SA6 C9 本体由 git status（零修改）+ SA3 runner 记录（4 旧文件/55、全包 644 绿）锚定。镜像与本体互补，不构成弱化；提示后续读者以「文件零改动 + 既有 runner 记录」为 C9 本体证据链。
3. **深读路径（如 `['u','x']`）语义留白**：设计 D6/SA6 §15.1 显式不冻结；实现朴素保持 `{}`。若未来消费方要求深读携带途经成员 doc，须另立票 + SA6 扩契约（本审查不作为缺口）。
