# SA9 独立 Standards 终审报告 — issue #266（sc1- 内容寻址 schema ID）

**Date**: 2026-09-08
**Verdict**: **approve**（无 BLOCKER / 无 MAJOR；3 项 MINOR 登记，均不阻断）
**Reviewer dispatch**: sa-109f0579-026c-425a-b664-31de25f60351（iteration 0，phase standards-review）
**审查对象**: 已提交实现 `704398cc0fa352ff9aa8435987099d3fb6127435`（`feat(vfsl): derive content-addressed schema identity`），branch `mabf/issue-266`；基线 = Parent PR #158 权威 head `docs/rest-namespace-create@a1ca2d72303b6868b8bf78ac6bee716cdf89be59`（已核实 `origin/docs/rest-namespace-create` == `a1ca2d7` == HEAD~1，恰好 1 个提交）。Issue 评论 REST 读取为空、无 Owner 追加要求（派发注记 `task_266_dispatch.md` 一致）。

- 输入（全部读过）：任务简报 `task_issue-266.md`（AC1–AC4）；SA6 契约 `task_issue-266_sa6_contract.md` + 两份红跑日志；SA8 前置门禁 `task_issue-266_conflict_report.md`（`clear`，B1/B2/B3）；SA1 设计 `task_issue-266_design.md`（671 行）；SA8 设计后复审 `task_issue-266_design_conflict_recheck.md`（`clear`，N1/N2/N3）；SA2 攻击评审 `task_issue-266_sa2_review.md`（approve + C1/C2/C3 + F6 路由）；SA3 实现日志 `task_issue-266_sa3_impl.log`；SA4 验尸 `task_issue-266_sa4_review.md`（pass + D-1…D-5 登记）。仓库标准源：根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`docs/AGENTS.md`、根 `CONTEXT.md`、ADR 0005/0007/0008/0015 相关条款、`docs/agents/issue-tracker.md`。
- 独立性声明：未采信任何 SA 产物的断言为前提。全部判断基于对提交 diff 的逐文件实读（`git diff a1ca2d7..HEAD`，8 个业务/测试文件 + 8 个 wiki 档案文件）与针对标准敏感点的独立 grep/实读核验（证据见各节）。按角色章程不运行测试、不改代码——验证证据链采信 SA3 自报 + SA4 独立重跑的双层一致性（§6）。
- 职责边界：本报告只审 standards（仓库 AGENTS/ADR/模块责任/既有惯例/单一事实源/生命周期对称/文件范围/测试质量）；Issue 需求是否完整实现属 SA10，不在本报告裁决面。

---

## 1. 模块责任与边界（packages/vfsl/AGENTS.md）

| 包契约条款 | 核验方式与证据 | 结论 |
|---|---|---|
| 同步、确定性；公共畸形输入路径返回判别联合而非抛错 | `deriveSchemaIdentity`（index.ts L250-273）同步纯函数、全程 try/catch 收编为 E100 结构化 issue（`vfslCrashIssue` 单点镜像 parseVfsl 最终防线）；`compileSchemaEnvelope` 新增 ③b 步位于既有顶层 try 内，`sc1MismatchIssueOrNull` 的不变式 throw 由 ENV-100 收编（envelope.ts L236-256 + index.ts 编排实读） | ✅ |
| IR/派生产物环境中立、JSON 可序列化；`schemasource.ts` 是唯一环境绑定缝 | 新叶 `schema-id.ts` 零 import 纯 TS（L1-105 实读）；无 node:crypto/TextEncoder/fs 引入；`schemasource.ts` 零 diff | ✅ |
| 不引入 Yjs runtime 关注点 | diff 零 Yjs 触及（纯字符串/位运算） | ✅ |
| 公共 API 仅经 `src/index.ts` | `deriveSchemaIdentity` + `DeriveSchemaIdentityOk/Result` 仅经 index.ts 导出；`schema-id.ts` 五个内部件（SC1_ID_PREFIX/isInScIdFamily/isCanonicalSc1Id/digestHexFromCanonicalSc1Id/sc1IdFromDigestHex）只被 envelope.ts/index.ts 内部 import、**无 re-export**（grep `schema-id` 于 index.ts：L80 import、L267/L414 消费，无 export 行）；`sc1MismatchIssueOrNull` 同为内部消费；`package.json` 零 diff（exports 仍仅 `.`） | ✅ |
| 稳定码、issue 排序、路径报告、envelope 严格性、指纹输入 = 兼容行为 | 既有 ENV_1–5/100 与方言层 21 码零 diff（errors.ts 无改动）；`EnvelopeErrCode` append 式追加 ENV_6/ENV_7；门新步骤⑤插在方言断言**后**（envelope.ts L325-331），既有步骤序与 L270 顺序锚不受扰；指纹输入零改（fingerprint.ts 两构造函数体无 diff，仅追加 digest 提取件）；排序链由新文件 `sc1-failure-order-chain.test.ts` 7 用例钉死（SA2 C1） | ✅ |
| `makeEnvelopeIssue` 唯一构造点 + readOnly 不变量（仅 ENV-4 true） | ENV_6/ENV_7 均经 `makeEnvelopeIssue`（readOnly 默认 false，envelope.ts L56-66 实读）；单行 sanitizer 纪律保持 | ✅ |
| 模块图无环 | `schema-id.ts → ∅`；`fingerprint.ts → {sha256, types}`；`envelope.ts → {schema-id, fingerprint, schemasource, ir(types)}`；`index.ts → {envelope, fingerprint, schema-id, …}`（grep import 边核实）——无环 | ✅ |

## 2. ADR / CONTEXT / 架构惯例一致性

- **ADR 0015（governing，随 PR #158 在途）**：窄接口形状（text-only、四不暴露、非 REST endpoint、复用 pipeline 返回 fingerprint+ID 或 VFSL issues）与 L119-125 逐字对应；`sc1-` + 52 位小写 RFC 4648 Base32 无 padding、payload = 完整 256-bit digest 不截断、与 `sha256:v1:<64 hex>` 同 digest（schema-id.ts 编解码实读：MSB-first 5-bit 组、pad 位为零校验、52 字长度闸）；envelope 强校验 + 两稳定码 + 旧式兼容（L144）落在 `compileSchemaEnvelope` 义务面（D6）。**零 ADR 改动**（docs/ 零 diff）——B2 不重开条款成立；状态翻转属总控收官。
- **ADR 0007**：L15 分相位结果联合框架内加法（envelope 相位末步 ENV_6；ENV_7 在 parse 成功后 evaluate 前——ADR 0015「与 text semantic fingerprint 精确匹配」的必然最早判定点，SA8 复审 N2 已备案）；L17 指纹语义零改。
- **ADR 0005 D1 / B1（SA8 明文复核项）**：sc1- 校验只产生放行/拒绝，不参与任何编译产物；`getCompiled` 段零 diff（缓存键仍纯文本哈希，id 不参与）；无唯一性注册表引入；doc/复制身份零涉。「id 可校验」未外溢为引擎正确性依赖。✅
- **ADR 0008 L131**：下游 `SCHEMA_ENVELOPE_<n>` 动态族不透明透传——`packages/namespace-runtime` 等全部下游包**零 diff**（diff --stat 核实仅 `packages/vfsl` 8 文件）。✅
- **docs/AGENTS.md 文档纪律**：无任何规范文档陈述的契约变化需要同步——v1-spec §7「id 对 parser 不透明」条款不变、v1-spec 全文零 ENV 码记载（envelope 注册表 source-resident 既有模式，B3②）；CONTEXT.md「内容寻址 schema ID」词条已是目标态（SA8 复审实读 L73-75 核实），故 docs/CONTEXT.md 零 diff 为**正确**而非遗漏。N1 保留族词汇登记与 ADR 0005 交叉注记为既定收官卫生项（总控）。
- **集成 PR 纪律**（`docs/agents/issue-tracker.md` L16-18）：ticket 挂 Parent PR #158 分支同支累积，分支跟踪 `refs/heads/docs/rest-namespace-create` 正确，单提交叠加于权威 base。✅

## 3. 单一事实源

| 检查项 | 证据 | 结论 |
|---|---|---|
| 指纹格式知识单源 | digest 提取件 `digestHexFromSemanticFingerprint` 与 `FINGERPRINT_PREFIX` 同文件（fingerprint.ts L60-77）；无第二处硬编码前缀 | ✅ |
| issue 构造单点 | 两新码均经 `makeEnvelopeIssue`（唯一构造点），sanitizer 单点纪律保持 | ✅ |
| sc1- 编解码单源 | 全部 codec 知识在 `schema-id.ts` 单叶；测试侧 `sc1-base32-ref.ts` 为**独立**参考实现（零共享 import——两文件头注互斥 grep 守卫 + 生产侧刻意异名，SA2 F2/C2 落实），防循环论证纪律成立 | ✅ |
| 无规则多文档拷贝 | 新码不记入 docs/vfsl/（既有 source-resident 模式）；头注义务面免责句（SA2 F4）已落于 index.ts L33-44 | ✅ |

## 4. 生命周期对称性

纯函数切片：无资源获取/释放对、无定时器、无缓存读写（derive 与 ③b 均不触 `compiledCache`，实读核实）、无部分状态（失败即返、幂等重试）。无可适用不对称面。✅

## 5. 文件范围（设计 §12 ALLOW/DENY + SA2 授权增量）

- **tracked 业务改动恰为**：ALLOW LIST 的 4 个 src 文件（`schema-id.ts` 新建 + envelope/fingerprint/index）+ 契约文件 1 的一处锚更名（`'sc1-fixture-anchor'` → `'fixture-anchor'` + 5 行 documenting 注释，与 SA1 §14.1/SA2 F6/SA8 N3 处方逐字一致）。
- **ALLOW 外测试侧 2 项**均有明文上游授权：`sc1-failure-order-chain.test.ts`（SA2 C1 约束性交付条件 + C3 钉位）、`sc1-base32-ref.ts` 头注守卫（SA2 C2「SA3 执行」）——SA4 §3 D-2/D-3 已登记为授权内偏离。
- **DENY LIST 零触碰**（`git diff --stat` 实证）：errors.ts、sha256.ts、parser/tokenizer/semantic/ir/evaluate/validate*/pattern/xml/resolve/shapes/derived、schemasource.ts、schema-check-cli.ts、package.json（零新运行时依赖）、其余 packages、docs/、CONTEXT.md、domains/、根配置——全部无 diff。
- 生产代码零越界；wiki/raw 档案属流水线白名单。

## 6. 测试质量与验证证据

**测试质量（独立核验）**：
- 行为级断言：三测试文件零 `readFileSync`/源码 grep 断言（grep 实证）；零 `sleep`/`setTimeout`/`Date.now`/`Math.random`（确定性）。
- 红绿对照链路完整：SA6 红跑日志（16 红 + 9 绿 / 8 红）的用例标题与提交文件逐字一致（SA4 §2.2 核对 + 本轮抽验 L145-353 标题与红日志 ×16/✓9 计数一致）；锚更名为单字符串、零断言语义变化（指纹排除 id 有 #72 冻结保证）。
- 顺序链测试判别力充分（T1.1 长度/kind 双闸、T1.2 `not.toHaveBeenCalled`、T1.5 正交透传），evaluate mock 手法与 compile-schema-envelope/docscope-getcompiled 既有先例同款且带 drain 收尾卫生。
- 测试入口真实：三文件均命中 vitest include `packages/*/test/**/*.test.ts`；CI 磁盘枚举分片自动接通（SA4 §2.4）。

**验证证据链（SA9 不跑测试，采信双层一致证据）**：SA3 自报包级 tsc exit 0、三契约文件 40/40、vfsl 目录 588/588、根 `pnpm typecheck`（15 tsconfig）exit 0、根 `pnpm test` 295 文件/3163 全绿；SA4 全部独立重跑逐位一致 + 189 条独立对抗探针（自有 Base32 编码器 + node:crypto，双侧循环论证均不成立）PASS 189/FAIL 0。满足包 AGENTS「公共类型/envelope 编译变更须跑根门禁」的验证闸。

## 7. MINOR 登记（均不阻断 approve）

| # | 级别 | 事项 | 处置路由 |
|---|---|---|---|
| M1 | MINOR | **三份流水线产物未提交**：`wiki/raw/task_issue-266.md`（简报）、`task_issue-266_sa6_red.log`、`task_issue-266_sa6_narrow_red.log` 仍为 untracked，而其余 SA 档案已随 704398c 入库；issue-254 先例中简报与红日志均 tracked。SA6 §1 将两日志列为交付物、SA2/SA4 均引用——档案完整性缺口（证据在 worktree 内仍在，不影响业务代码） | 总控收官时补提交 |
| M2 | MINOR | 提交信息 `feat(vfsl): derive content-addressed schema identity` 无 issue 引用（#266）；仓内惯例混合（`feat(#256):`/`(#262)` 后缀/无引用均有先例，如无引用之 `a1ca2d7`），且无文档化提交信息规范 | 记录在案，无需动作 |
| M3 | MINOR | 过程偏离（SA4 §3 已登记，本轮复核确认内容正确）：D-1 锚更名由 SA3 执行而非独立 SA6 修订轮（声称总控路由；内容与处方逐字一致，SA4 已用独立探针补偿验收独立性）；D-2/D-3 SA2 授权的测试侧改动超出设计 §12 ALLOW 字面；D-4/D-5 命名/重构均有 SA2 F2 与设计 §8.1 注 (b) 明文授权。设计文档 §12/§13 的 ALLOW 回填属收官卫生 | 总控收官注记（SA4 §6 清单沿用） |

## 8. 裁决

**approve**。已提交 diff 在模块责任、ADR/CONTEXT 一致性、单一事实源、生命周期、文件范围、测试质量与验证证据七个 standards 维度全部合格：公共面纪律（仅经 index.ts、窄面四不暴露）、兼容行为面（既有码/排序/严格性/指纹输入零回归且有负控与 557 既有绿守护）、义务面保守边界（D6 结构性成立）、防循环论证纪律（独立参考件 + 异名守卫）均经受住独立核验。无 BLOCKER、无 MAJOR；三项 MINOR 均为档案/卫生类，路由总控收官，不阻断合并链路下游（SA10/SA7）继续。
