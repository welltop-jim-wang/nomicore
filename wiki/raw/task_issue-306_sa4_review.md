# SA4 实现静态审查 — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-40200b6b-be3-41f2-b89a-af40aa2f9c58（mabf-sa4 / implementation-review / iteration 0）
- **审查对象**: SA3 实现（worktree `/home/wangjian/nomicore-fix-issue-306`，branch `mabf/issue-306`，HEAD `91c4add`；`git status`：`M packages/vfsl/src/{parser,ir,semantic,derived,evaluate}.ts`，151 insertions / 14 deletions；SA6 三件契约测试 + wiki/scratch 产物为 untracked）
- **Verdict**: **approve**（无 BLOCKER、无 MAJOR；4 条 MINOR 观察见 §12，不阻断）

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-306.md`（Host 简报，issue 正文 + AC1~AC6） | 已读 |
| `wiki/raw/task_issue-306_design.md`（SA1 设计，417 行） | 已读 |
| `wiki/raw/task_issue-306_sa2_review.md`（SA2 评审，approve，O-1~O-5 MINOR） | 已读 |
| `wiki/raw/task_issue-306_sa6_contract.md`（SA6 契约，19 用例 12 红/7 绿，金样本冻结） | 已读 |
| `wiki/raw/task_issue-306_sa3_impl.md`（SA3 实现报告，iteration 1） | 已读 |
| `wiki/raw/task_issue-306_design_conflict_report.md`（SA8 设计后复查，clear，O-1/O-2 实现红线） | 已读 |
| `.scratch/sa8-conflict-report-issue-306.md`（SA8 前置门禁，clear，C-1~C-6/E-1~E-6） | 已读 |
| `wiki/raw/task_issue-306_relevant_decisions.md` / `task_issue-306_conflict_report.md` | 不存在（设计 §6 / SA8 报告已登记；等价产物为上述两份 SA8 报告） |
| `docs/adr/0019-vfsl-union-member-docs.md`（规范权威，已接受未被取代） | 已读（决策 1~10 逐条对照实现） |
| `packages/vfsl/src/{parser,tokenizer,semantic,ir,derived,evaluate,index}.ts` 全文 + 其余 src 锚点抽查；`packages/vfsl/AGENTS.md` | 已读 |
| 冻结契约三件：`packages/vfsl/test/{parse-vfsl-union-member-docs,evaluate-derived-member-docs}.test.ts`、`union-member-docs-fixture.ts` | 全文核读 |
| 存量断言面：`parse-vfsl-jsdoc.test.ts`、`parse-vfsl-root-convention.test.ts`、`evaluate-derived-docs-audit.test.ts`、`resolve-schema-at-path.test.ts` | 锚点核读 |
| 跨包消费面：`packages/vfsl-codegen/src/emitter.ts`、`packages/doc-runtime/**`、`packages/namespace-runtime/**`、`packages/vfsl/src/resolve-schema-at-path.ts`（grep `memberDocs` / `kind: 'union'` 全量） | 已核 |
| `.scratch/sa3-{red-baseline,contract-green,pkg-vfsl-run,root-typecheck}.log`（SA3 保留证据） | 已读（本审查未运行测试，仅复核证据日志） |
| `vitest.config.ts`、`packages/vfsl/tsconfig.json`、`.github/workflows/ci.yml` | 已读 |
| Owner 评论 | 无适用评论（Host dispatch「REST comment read returned an empty array」；SA6 §2 / SA8 两报告独立复核一致） |

## 2. Verdict

**approve**。实现是 SA1 设计 §7 D1~D7 与 ADR 0019 决策 1/2/3/4/5/8/9.3/10 的忠实落地；文件范围恰为 ALLOW LIST 五条；冻结契约零改动且红灯集合与 SA6 录制逐条一致（12 红 → 19/19 绿、包 619/619 绿、包/根 typecheck exit 0，均有 SA3 保留日志佐证）；静态攻击（记账窗口、引用同一性、嵌套/坍缩/夹缝/M3 竞争、手造 IR 守卫覆盖、盲读消费方）未发现可实现反例。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
| --- | --- | --- |
| Issue：doc 紧邻 `\|` 之前挂后继成员 | `parser.ts:334-336` 前导 `\|` 与 `parser.ts:341-343` 成员分隔 `\|` 后 `recordPipeAnchor()`（`parser.ts:178-181`：`start = dangling.length - depositedByLast`，`leads = dangling.slice(…)` DocLead 引用） | ✅ 落实（ADR 决策 1 第 1 子句） |
| Issue：首成员无前导 `\|` 挂成员起始记号 | `parser.ts:337-338` else 分支 `recordStartAnchor()`（`parser.ts:185-188`：消费前快照 `start = dangling.length`、`leads = peek().leadDocs ?? []`） | ✅ 落实（决策 1 第 2 子句；SA8 复查 #2 的等价记注） |
| Issue：连续多条 doc 按序同挂一成员 | tokenizer pending 累积挂同一记号（`tokenizer.ts:72-82`，零改动）＋ settle 整段核对（`parser.ts:202-218`） | ✅ 落实（契约用例 4 逐字 `toEqual` 绿） |
| Issue：坍缩维持 E305 | `parser.ts:346-348` `members.length === 1` 早退、不结算 → doc 留 dangling；`semantic.ts:71-83` 现行 E305 判定不变 | ✅ 落实（契约用例 8 两形态 @(2,10) 绿） |
| Issue：`\|` 夹缝 doc 非标记 E305 / 标记按 M3 不双挂 | 夹缝 doc 挂成员起始记号、不入 A/B 记录（`parser.ts` 记录点只在 `\|` next() 后与首成员 peek 处）；标记名成员由既有 M3 `claimDocs()`（`parser.ts:520`）整段取走 → settle 引用失配 → `memberDocs[i]=[]`（`parser.ts:206/214`） | ✅ 落实（契约用例 7/9/10 绿；`parser.ts:169` claimDocs 整取尾部、无部分取走） |
| Issue：E305 措辞补「联合成员」 | `semantic.ts:76` 正文枚举追加，前缀 `VFSL-E305: ` 由 `makeIssue` 构造不变 | ✅ 落实（契约用例 11 `/联合.{0,6}成员/` 绿） |
| Issue：纯文档不进校验与物化 | `validate.ts`/`validate-patch.ts`/`resolve.ts`/`shapes.ts` 零改动（git status）；契约用例 15 七路 `toEqual` 全等绿 | ✅ 落实 |
| AC4：存量 IR/指纹逐字节不变 | `semantic.ts:222-230` `some(d => d.length > 0)` 条件展开；金样本常量与 SA6 §12 逐字节一致（本审查逐值比对，无重录）；用例 18/19 绿 | ✅ 落实 |
| AC5：手造 IR 畸形 → E100 | `evaluate.ts:363-369` `guardMemberDocs`（在场非「等长数组的数组」→ TypeError）→ `evaluate.ts:77-80` 顶层 catch → 恰一条 E100、无 derived；用例 16/17 绿 | ✅ 落实 |
| SA2 O-1（文件计数口径） | SA3 以 runner 输出为准；本审查定谳：34 files = 33 个运行时 `.test.ts`（`find` 实数）+ 1 个 `.test-d.ts` 类型套件（`sa3-pkg-vfsl-run.log` 首行 `✓ TS packages/vfsl/test/resolve-schema-at-path.test-d.ts (3 tests)`） | ✅ 核销（非缺陷，数字口径澄清） |
| SA2 O-3（旗标不一致） | SA3 命令统一带 `--conditions=nomicore-source`，日志显示实际执行 | ✅ 核销 |
| SA2 O-4 / SA8 复查 O-1/O-2（实现红线注释化） | `parser.ts:101-113`（M4Pending 引用语义红线）、`parser.ts:176-188`（两锚点注释）、`parser.ts:190-199`（逆序 + 不得中段 splice 红线） | ✅ 落实（纯注释） |
| SA2 O-2/O-5 | 无实现动作（符合 SA2 建议） | ✅ 无义务 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
| --- | --- | --- | --- |
| D1 附着点 A/B + `settleM4` 逆序同一性结算 | `parser.ts:174-220`（`M4Pending`/`recordPipeAnchor`/`recordStartAnchor`/`settleMemberDocs`）＋ `parser.ts:330-355`（`parseUnionType`） | ✅ 与设计伪代码逐要素一致：仅 `members ≥ 2` 结算（`parser.ts:346`）、逆序（`parser.ts:202`）、逐位 `===`（`parser.ts:208-213`）、`splice + claimed += n`（`parser.ts:215-216`）、失配/越界 → 该成员 `[]` 且不动 dangling（`parser.ts:205-206/214`）。命名 `settleMemberDocs`（设计作 `settleM4`）为已声明的等价自由度 | 无 |
| D1 记账不变量保持 | `parser.ts:284-286` `docTotal` 核对零改动；每次 splice 同步 `claimed` | ✅ 丢失必以 loud E100 暴露 | 无 |
| D2 AST union 恒携带必填等长 `memberDocs` | `parser.ts:43`；唯一构造点 `parser.ts:349-354`；坍缩路径不构造 union 节点 | ✅ 全仓 grep `kind: 'union'`：src 内 AST 构造仅此一处（其余为 IR/derived/ValueSchema 层，可选键不破坏）；`shapes.ts:39` `Extract<AstType,…>` 只读 `members` | 无 |
| D3 IR 条件键 + 键序 + 指纹纪律注 | `ir.ts:45-54`（含「不得补空槽/二次规范化、键序 kind→members→memberDocs」注）；`semantic.ts:219-230` 条件展开（三元返回，`exactOptionalPropertyTypes` 纪律） | ✅ 与设计 D3 代码逐字同构 | 无 |
| D4 derived 条件稀疏 + `<member N>` + 第八键居末 | `derived.ts:84-91`（类型 + 差异常态化注）；`evaluate.ts:341-347`（DocsTables 第四表）；`evaluate.ts:401-410`（先守卫、`docs.length > 0` 才 `put`、照旧递归、停点不变）；`evaluate.ts:72-74`（返回字面量末位条件展开） | ✅ 键序 = 成员声明序（`forEach` 序）；`<member N>` 文法复用 `evaluate.ts:405-408` 既有合成；存量七键集合不变（用例 14 `BASE_DERIVED_KEYS` 绿） | 无 |
| D5 手造 IR loud 守卫 | `evaluate.ts:355-369`；四类畸形全覆盖（整体非数组 / 短 / 长 / 元素非数组）；缺席合法；`md.every((d) => Array.isArray(d))` 与设计 `md.every(Array.isArray)` 等价（SA3 已声明） | ✅ TypeError → `evaluate.ts:77-80` 顶层 catch → 恰一条 E100；与 `put/appendDocs` 守卫族（`evaluate.ts:349-353/371-375`）同族且「缺席=合法」不对称有 ADR 决策 5 明文依据 | 无 |
| D6 E305 消息 | `semantic.ts:76`，与设计推荐措辞逐字一致 | ✅ 前缀冻结；全仓消息断言仅前缀正则（`parse-vfsl-jsdoc.test.ts:127`、契约文件；`parse-vfsl-root-convention.test.ts:193-197` 仅断码+位置——本审查逐一核读） | 无 |
| D7 六条冻结不变式 | tokenizer/claimDocs/depositedByLast/docTotal/三锚位调用点（`parser.ts:273/520/608`）/StructureNode/ValueSchema/index/Discriminator/resolve/shapes/validate/resolve-schema-at-path/envelope/schemasource/fingerprint/index 全部零改动（git status + mtime 佐证：仅 5 个 ALLOW 文件 mtime 更新，其余 src 均为 checkout 时间） | ✅ 逐条保持 | 无 |

**M4 机制独立重推（本审查新增的对抗验证）**：

1. **`depositedByLast` 无陈旧窗口**：`next()` 每次无条件重置（`parser.ts:157` `?? 0`），`recordPipeAnchor` 紧跟 `\|` 的 next() 调用（`parser.ts:335/342`），读到的必是该 `\|` 的沉积条数。
2. **引用同一性链构造成立**：tokenizer `emit()` 把 pending 数组本身挂到恰一个记号（`tokenizer.ts:76-82`）；`next()` 以 spread 把同一批 DocLead 对象推入 dangling（`parser.ts:158-160`）——A 锚 `slice` 与 B 锚 `token.leadDocs` 持有的是与 dangling 逐位 `===` 的对象引用；每个 DocLead 恰入 dangling 一次 ⇒ 跨 pending 假匹配构造性不可能。SA8 O-1 红线（不得拷贝/重建）经代码核实未被违反。
3. **结算不污染 claimDocs 窗口**：`settleMemberDocs` 不重置 `depositedByLast`，但 `parseUnionType` 的全部出口（`;` / `>` / `,` / 字段分隔符 / `[`）在其后必先经一次 `next()` 才可能到达任何 claimDocs 调用点（M1 `parser.ts:273` / M2 `parser.ts:608` / M3 `parser.ts:520` 均紧跟各自锚记号 next()）——本审查沿 `parseTypeExpr` 的全部四个调用方（parseTypeAlias / parseRecordType / parseMarkerType / parseObjectType）逐一核对，无绕行路径。
4. **区间单调性**：成员解析内的 claimDocs 只整取「该成员内沉积的尾部批」⇒ dangling 长度跨成员边界单调不降 ⇒ 各 pending 区间按记录序递增且互不重叠；逆序 splice 只影响更高下标（`parser.ts:202` 循环方向），低 pending 的同一性核对不受先行结算影响——SA8 O-2 红线经核未被破坏（未改 `next()` 沉积次序、结算前无中段 splice）。
5. **对抗场景逐一重推均与 ADR 决策一致**：夹缝非标记（留 dangling → E305）、M3 竞争（B 锚失配 → `[]`，doc 在 marker 恰一次）、嵌套 union（内层先结算、区间更高；内层坍缩不结算 → 其 doc 留 dangling → E305）、`\|` 记号夹缝叠写（`/** 成员口径 */ \| /** 载体口径 */ YLeaf` 各归各锚）、EOF 悬空 doc（`parser.ts:261-267` 显式沉积发生在全部结算之后）、成员起始为 `Record<`/`{`/`[]` 后缀（B 锚记录、无内部锚位竞争 → 挂载成功，符合决策 1「成员起始记号」文义）。
6. **失败模式恒 loud**：实现算错的任何路径要么破坏 `claimed + dangling.length === docTotal`（→ E100，`parser.ts:284-286`）要么把 doc 留 dangling（→ E305）——无静默丢失/误挂通道。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
| --- | --- | --- | --- |
| doc 记账与第四类回收 | parser（dangling/claimed/docTotal 事实拥有者） | `parseUnionType` 内记录+结算，`claimDocs`/三锚位零触碰 | ✅ 未复制底层状态机 |
| AST→IR 条件附加 | semantic.ts | `semantic.ts:219-230` | ✅ |
| derived 收集 + 守卫 | evaluate.ts（DocsTables/守卫族宿主） | `evaluate.ts:341-347/355-369/401-410` | ✅ 复用 `put` 统一入口与顶层 catch |
| E305 消息 | semantic.ts:76（唯一生产点） | 原位改 | ✅ |
| 指纹 | fingerprint.ts 单一生产者 | 零改动（DENY） | ✅ |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| 挂载锚位回收 | M1/M2/M3 `claimDocs()` 同步回收 | M4 延迟回收（记录+终局核对） | 有依据的分歧 | ADR 0019 决策 4 明文（坍缩判定需扫到末尾）；并入同一记账系统 |
| docs 表收集 | `DocsTables` 三表 + `walkDocs` + `put` | 第四表同构 + 条件稀疏差异注 | 一致（差异明示） | ADR 决策 5 明文 |
| 条件键纪律 | `exactOptionalPropertyTypes` + 条件展开（derived.ts:13 注释先例） | D3/D4 同款构造（三元返回 / 末位条件展开） | 一致 | 存量逐字节稳定的构造保证 |
| `<member N>` 路径文法 | `evaluate.ts` 既有合成段 | 零改动复用 | 一致 | 无平行文法 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| doc 归属 | tokenizer leadDocs → parser dangling/claimed（docTotal 不变量守护） | AST/IR memberDocs → derived 表（逐层纯映射，值逐字引用同源数组） | 无第二记账系统 |
| 指纹 | fingerprint.ts 单一生产者 | 条件键构造性不入场（存量输入 IR 逐字节不变） | 无漂移（fingerprint.ts 零改动） |

### 生命周期对称性

纯函数链路（parse/evaluate 同步、无 IO/后台任务/缓存失效面）；`M4Pending` 随解析栈消亡；异常路径（error 记号即抛）无需清理，`docTotal` 核对只在成功路径运行（`parser.ts:284`）。无不对称引入。✅

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
| --- | --- | --- | --- |
| 第二套 doc 记账 | dangling/claimed/docTotal | M4 并入同一记账（splice + `claimed += n`） | 无平行 |
| 第二守卫入口 | put/appendDocs 族 | `guardMemberDocs` 同族延伸（call 同一顶层 catch） | 无平行 |
| 第二消息生产点 / 新测试入口 | semantic.ts:76 / vitest 既有 include | 原位改 / 契约落既有入口 | 无平行 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
| --- | --- | --- | --- |
| `packages/vfsl/src/parser.ts`（M） | §11 ALLOW：D1/D2 | M4 记录/结算/AST 必填键 | ✅ +100/-7，全部落在 ALLOW 描述内 |
| `packages/vfsl/src/ir.ts`（M） | §11 ALLOW：D3 | 条件键 + 指纹纪律注 | ✅ |
| `packages/vfsl/src/semantic.ts`（M） | §11 ALLOW：D3/D6 | 条件展开 + E305 措辞 | ✅ 恰两处 |
| `packages/vfsl/src/derived.ts`（M） | §11 ALLOW：D4 | 条件稀疏类型 + 差异注 | ✅ |
| `packages/vfsl/src/evaluate.ts`（M） | §11 ALLOW：D4/D5 | 第四表 + 守卫 + 收集 + 末位条件展开 | ✅（另含一处注释措辞「三表收集→表收集」的顺带更新，与第四表事实一致，不越范围） |

- untracked：SA6 契约三件（冻结验收输入，SA3 零改动——文件 mtime 停留在 SA6 时窗 12:20~12:23，且红灯基线日志的 12 红集合与 SA6 §13 录制逐条一致、金样本常量与 SA6 §12 逐值一致，无重录/软化证据）、wiki/raw 六件（Host/各 SA 产物）、`.scratch` 四份 SA3 证据日志 + 既有 SA8 报告。
- DENY 全部未触碰：`tokenizer.ts`/`fingerprint.ts`/`validate*.ts`/`resolve.ts`/`shapes.ts`/`resolve-schema-at-path.ts`/`index.ts`/`envelope.ts`/`schemasource.ts`/`packages/vfsl-codegen/**`/`docs/**`/`tests/**`/`domains/**`/其余 packages（git status + src mtime 全为 checkout 时间佐证）。
- `git diff --check` exit 0（本审查复核）。**范围结论：实际改动 = ALLOW LIST 五条，无越界。**

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
| --- | --- | --- | --- | --- |
| `VfslType` union 变体 +`memberDocs?` | codegen emitter、doc-runtime、namespace-runtime、resolve-schema-at-path、envelope 链 | grep `memberDocs` 全仓：命中仅 5 个 ALLOW 生产文件 + 冻结契约测试——全部消费方对可选键盲读 | 无（加性可选键；`packages/vfsl` 与根 typecheck exit 0 覆盖类型面） | 无 |
| `DerivedSchema` +`memberDocs?`（第八键居末） | emitter 显式挑槽（`emitter.ts` 不整对象展开）、doc-runtime 具名键访问、`resolveSchemaAtPath` docs 切片两来源（#308 面外） | 盲读；存量 schema 键集合构造性不变（条件稀疏） | 无 | 无 |
| `evaluate` 失败语义扩展（手造 IR 畸形 memberDocs：ok:true → ok:false E100） | 仓库内手造 IR 直调方 | grep：仅契约测试构造 `memberDocs`（即目标行为）；跨包手造测试构造的是 **derived**（doc-runtime 等）而非 IR union，不经该入口 | 无（ADR 决策 5 授权；生产链路 IR 恒为 parseVfsl 产物，构造性无畸形） | 无 |
| AST union +必填 `memberDocs`（内部类型） | `shapes.ts` 等 AST walk、测试 | 唯一构造点 `parseUnionType`；消费方只读 `kind`/`members`（`AstType` 不导出） | 无 | 无 |
| `StructureNode`/`ValueSchema`/index/判别式 | `resolve-schema-at-path.ts:172` 合成 union 等 | 形状零改动；`resolve-schema-at-path.test.ts:289` `Object.keys(node)).toEqual(['kind','members'])` 断言保持（在 619 绿内） | 无 | 无 |
| E305 消息文本消费方 | `parse-vfsl-jsdoc.test.ts:127`（前缀正则）、`parse-vfsl-root-convention.test.ts:193-197`（码+位置）、`tests/acceptance/vfsl_spec_acceptance.py`（断规格文本，本票未改规格） | 全部不锁定正文 | 无 | 无 |
| semantic 指纹输入（ADR 0017/0018 消费方） | META.schema 生命周期、peer re-arm | 存量文本 IR 逐字节不变（金样本 A/B 断言绿）；新文本此前 E305 无存量指纹 | 无 | 无 |

## 8. 错误、恢复与并发

- **错误面**：不新增错误码；E305 条件只缩小（坍缩/夹缝维持面由契约用例 8/9/10 冻结，绿）；E100 新增一类触发（手造 IR 畸形 → `guardMemberDocs` TypeError → `evaluate.ts:77-80` 顶层 catch，`makeIssue` 前缀构造同源）——与既有守卫族同构。求值顺序确定：`collectDocs`（`evaluate.ts:61`）位于 aliases/structure/values/index 之后，同 IR 既有更早 InternalError 先到者胜，单错误模型（v1-spec §4）不破。
- **无吞错/伪成功**：守卫禁止 `?? []` 静默规范化（契约用例 17 四类畸形逐类断言恰一条 E100、无 derived——`expectE100` 显式断 `'derived' in result === false`）；parser 侧 docTotal 失衡兜底（`parser.ts:284-286`）保持，结算算术缺陷必 loud。
- **恢复/幂等**：`parseVfsl`/`evaluate` 同步纯函数，无 Date/random/IO；重复调用逐字节同输出；无半完成状态、无缓存失效面（`compiledCache` 按文本内容键）。
- **并发**：Parser 实例私有状态（dangling/claimed/depositedByLast/pendings），无共享可变状态、无竞态面。
- **资源界**：`MAX_TYPE_NESTING` 计费零改动；pendings O(成员数) 随解析栈消亡；结算纯算术比较不可抛。
- **静态无法确认项**：无（本任务全链路同步纯函数，上述性质均可由代码构造性得出；仅全仓跨包运行面留 §11 动态项）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
| --- | --- | --- | --- | --- |
| `parse-vfsl-union-member-docs.test.ts`（13 用例） | M4 两锚位挂载（等长 `toEqual`、逐字载荷、JSON 往返）、逐节点条件键（`hasOwnProperty` 整键在场性 + JSON 不含串）、M3 不双挂（两方向：marker 序列化恰一次 + 成员表不含）、坍缩/夹缝 E305 维持（恰一条 + 前缀 + 精确锚点）、措辞正则、金样本 A/B（IR SHA-256 + `sha256:v1:` 指纹精确值 + IR 不含 memberDocs） | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 命中；CI typecheck 作业 + test 分片按磁盘枚举自动收编（ci.yml:44/78-80） | 无 skip/only/todo（grep 0 命中，本审查复核）；无源码字符串断言；断言全经 `parseVfsl` 运行时返回值 | 无 |
| `evaluate-derived-member-docs.test.ts`（6 用例） | 条件稀疏（键序精确 `toEqual`、member 2 不成键、嵌套 `X.k.<member 0>`/`V.<item>.<member 0>`）、纯文档性质（七路全等 + 派生物确有差异）、手造 IR 正控（无键/等长良性/全空不产表）与 4 类畸形（`expectE100`：恰一条 + 前缀 + 无 derived）、derived 金样本（键集合七键 + SHA-256） | 同上；`packages/vfsl/tsconfig.json` include `test/**` → tsc 覆盖 | 同上 | 无 |
| `union-member-docs-fixture.ts` | 纯数据（v1-spec §10 逐字节副本 + 联合密集 fixture，均无成员 doc） | 非 `.test.ts`，不被收集（include 面核实） | 无 | 无 |
| **红灯保持验证** | SA3 以 `git stash push -- packages/vfsl/src` 剥离实现复跑红灯：**12 failed \| 7 passed (19)**，失败集合逐条 = SA6 §13 红表（`sa3-red-baseline.log`，本审查逐条比对，含措辞用例的真实 E305 旧正文失败信息）——证明契约断言对「无实现」真红、非恒真 | 同上 | 无（恢复后 diff 逐字节比对 `PATCH_IDENTICAL`；5 文件 mtime 同步更新与 stash/pop 一致） | 无 |
| **存量回归** | `packages/vfsl/test` 全量 **34 files / 619 tests 全绿**（33 运行时 + 1 `.test-d.ts` 类型套件；`sa3-pkg-vfsl-run.log`）；含 SA6 §10 全部既有锚点（`resolve-schema-at-path.test.ts` 合成 union 两键断言、docs-audit 三表全键集、指纹/IR 形状锚） | 同上 | 无 | 无 |
| **门禁** | `npx tsc -p packages/vfsl/tsconfig.json` exit 0；根 `pnpm typecheck`（14 tsconfig 链）exit 0（`sa3-root-typecheck.log`） | CI typecheck 作业同命令 | 无 | 无 |
| 契约冻结 | SA6 三件 mtime 停留 SA6 时窗；金样本常量与 SA6 §12 六值逐字节一致（未重录）；红灯集合与 SA6 独立录制一致（若断言被软化，红灯复现不可能逐条吻合） | — | 无 | 无 |

**mutation 敏感性（SA6 §9 表 + SA2 复核）**：错误实现 → 必红用例映射完备（挂前成员/丢相邻/抢 M3/无 doc 附空表/坍缩误挂/乱序/嵌套键文法/空表入场/泄入物化/`?? []` 规范化），红灯基线日志实证「无实现即红」，断言非恒真。

## 10. Required revisions

无 BLOCKER、无 MAJOR finding。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
| --- | --- | --- | --- |
| 全仓跨包测试面（`pnpm test` 全量，含 doc-runtime / namespace-runtime / codegen 分片；SA3 按 SA6 E-5 以包面交付未跑全仓） | CI test 分片 / SA7 | 全绿（类型面已由 14 tsconfig typecheck 覆盖；行为面构造性限于「此前 E305 的文本」与「手造 IR 带 memberDocs」，跨包无该入口） | 任一跨包摘要/派生物断言出现 memberDocs 相关差异（静态分析判定不可能，若出现即为实现缺陷） |
| 信封编译与指纹端到端（`compileSchemaEnvelope`/`getCompiled` + `deepFreeze`）对使用 M4 的 schema | SA7 动态复核 | 新文本产出新指纹、缓存按内容键正常、冻结覆盖新表无异常 | 冻结/缓存路径抛错或指纹前缀异常（≠ `sha256:v1:`） |
| #307/#308/#309 中间态确认（C-5 出界项） | PR #305 收官核对 | codegen 对 M4 schema 盲读不崩、`resolveSchemaAtPath` 切片无 memberDocs、v1-spec §5 仍三锚位——均不判 #306 缺陷 | 收官清单遗漏三票（流程性，非本实现缺陷） |

## 12. Non-blocking observations

| ID | Observation | Evidence | Suggestion（不阻断） |
| --- | --- | --- | --- |
| N-1 | 根 `pnpm test` 全仓面未在 SA3 验证内（`packages/vfsl/AGENTS.md` 要求「public types 变化时跑根 typecheck 与 pnpm test」；typecheck 已跑、全仓 test 未跑）。风险构造性有界：新键只出现在此前 E305 的文本（存量 fixture 不可能产出）、evaluate 失败语义变化仅手造 IR 带 memberDocs 可达（全仓 grep 无跨包生产者）、类型面 14/14 绿 | `sa3-root-typecheck.log` vs 缺失的全仓 test 日志；SA3 §Deferred 1 | 由 SA7/CI test 分片补跑确认（§11 第 1 项）；无需实现改动 |
| N-2 | B 锚在非字面量成员起始（`Record<…>` / `{…}` / `[]` 后缀成员）上的新合法挂载无显式契约用例（契约覆盖字面量与标记成员） | `parser.ts:185-188`；契约用例集 | 行为经本审查静态判定符合 ADR 决策 1「成员起始记号」文义（M2 只回收字段名批、`{`/`Record` 批无竞争者 → 挂载成功）；如需显式锁定可在 #309 规格测试矩阵补充（出 #306 冻结面，不得现场扩测） |
| N-3 | 实现自由度偏差均为已声明等价形：`settleM4` → `settleMemberDocs`；`md.every(Array.isArray)` → 逐参形式；`evaluate.ts` 顺带更新一处注释（「三表收集」→「表收集」） | SA3 §File scope check；diff 逐行核读 | 无需动作（记录在案） |
| N-4 | SA2 O-1 的「33 vs 34」文件计数分歧本审查定谳：34 = 33 个运行时 `.test.ts` + 1 个 `resolve-schema-at-path.test-d.ts` 类型套件（vitest typecheck 集成计数） | `sa3-pkg-vfsl-run.log` 首行 + `find packages/vfsl/test -name "*.test.ts" \| wc -l` = 33 | 无需动作（口径澄清，后续引用 runner 数字时注明含 test-d） |

---

**审查方法与边界**：本审查未修改任何文件（除本产物）、未运行测试/服务/临时进程；结论基于 5 文件 diff 逐行核读、全仓 grep（memberDocs / kind:'union' / E305 断言面 / skip-only-todo）、ADR 0019 与设计/契约/评审/复查报告交叉比对、M4 机制的独立对抗重推、以及对 SA3 保留证据日志（红灯基线、绿灯、包全量、根 typecheck）的逐条复核。

— SA4（Red Team / Implementation Reviewer），唯一产物为本文件。
