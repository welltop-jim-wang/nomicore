# SA9 Standards Review — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Reviewer：SA9（mabf-sa9 / standards-review / iteration 0，dispatch `sa-b2a9e5d4-9ef8-4a5c-8bf1-cdbfd1a50acf`）
- 被审对象：committed final diff，`7b92af0048ee58817aada54efdb581b24a760a93..HEAD`（HEAD `08569f2`，branch `mabf/issue-315`）——23 个仓内文件（15 src + 3 文档 + 7 测试）+ 8 个 wiki 产物
- 审查方式：静态独立核验（逐文件读 diff 与现行源码、规范/ADR/模块 AGENTS 逐条对照、只读命令复核钉值与卫生）；未修改代码/设计/测试，未运行测试/服务，未调度其他 SA，未 commit/push
- 职责边界：只判仓库与工程标准符合性；不判 Issue 需求是否完整实现（SA10 职责）

---

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| 任务简报 `wiki/raw/task_issue-315.md`（Issue body 5 AC；REST comments snapshot 空，无 Owner 追加要求） | 已读 |
| 设计 `wiki/raw/task_issue-315_design.md`（§7.2 B1-B6 冻结、§8 逐层设计、§11 ALLOW/DENY） | 已读 |
| SA2 `task_issue-315_sa2_review.md`（approve；N-1/N-2 + O-1..O-4） | 已读 |
| SA3 `task_issue-315_sa3_impl.md`（iteration 1：F-SA4-1 修复；Deviation #1 登记） | 已读 |
| SA4 `task_issue-315_sa4_review.md`（approve；F-SA4-1 闭合；N-1/N-3..N-6 非阻塞） | 已读 |
| SA8 `task_issue-315_conflict_report.md` / `_relevant_decisions.md` / `_implementation_conflict_report.md`（R2 verdict clear，`requiresConflictRecheck: false`） | 已读 |
| 规范面：根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`packages/namespace-runtime/AGENTS.md`、`docs/AGENTS.md`、ADR 0020（决策 1/2/4/5/6/7/8/10 原文）、ADR 0021、`docs/vfsl/v1-spec.md`、`CONTEXT.md`、`tests/acceptance/vfsl_spec_acceptance.py` 机制面 | 已读并逐条对照 |
| 全量 diff（`git diff 7b92af0..HEAD` 逐 hunk 读）+ 现行源码焦点区（parser.ts 分派流 / validate.ts 级联与消息 / 保留名两查询点） | 已核 |

## 2. Verdict

**approve**（无 BLOCKER、无 MAJOR；5 项 MINOR/观察均不阻断，见 §4）。`requiresConflictRecheck: false`——SA8 R2 已闭合消息面复查环，本审查未发现新的决策面。

## 3. 标准逐项核验

### 3.1 模块责任与架构惯例（根/模块 AGENTS）

| 标准 | 核验结果 | 证据 |
| --- | --- | --- |
| vfsl 拥有 parser/语义/求值/校验；codegen 只消费 evaluator 输出不重推导语义（ADR 0005）；投影克隆归 namespace-runtime | 符合。文本层闸门全部在 `parser.ts`；运行时判定在 `validate.ts`；codegen 仅 `projectValue → 'number'` + emitter 闸门放行；`cloneValueSchema` 补两 case | `parser.ts:506-633`、`validate.ts:206-255/591-598`、`valuetype.ts:35-40`、`emitter.ts:335-348`、`read-schema-projection.ts:170-184` |
| 镜像既有 Pattern 先例（架构惯例） | 符合。主层识别/AST pos = 左元记号/标量叶同层判定/同层投影/裸用 E100/字段名与别名查询点复用，全部与 `string & Pattern` 先例同构；18 保留名在 `parseIdentType` 逐一显式分类（keyword 完备边界 = 保留名集合，spec §4 不变量保持） | `parser.ts:454-536` 逐分支清点 18 名全覆盖 |
| vfsl：同步确定、公共畸形输入返回判别结果不抛 | 符合。新分支全部经 E100/E303 issues 通道；`VfslSyntaxError` 顶层收编机制未动 | parser/validate diff 全集 |
| vfsl：IR/derived 环境无关、JSON 可序列化纯数据 | 符合。条件键纪律（裸 Int 两键整键缺席、键序 kind→min→max）；JSON 往返哨兵测试锁定 | `ir.ts:66-76`、`semantic.ts:238-244`、`evaluate.ts:288-294`；`parse-vfsl-int-range.test.ts:101-111`、`validate-int-range.test.ts:122-127/153-155` |
| vfsl：公共 API 只经 `src/index.ts`；错误码/issue 顺序/路径上报/信封严格性/指纹输入 = 兼容性行为 | 符合。`index.ts` 零改动；`errors.ts` 零改动（21 码零新增，ADR 0020 决策 4）；issue 源序全收集不变；`fingerprint.ts` 零改动 | diff 文件清单（两者不在列）；`errors.ts:10-32` 现读 |
| vfsl-codegen：输出确定逐字节稳定、不支持形状响亮失败 | 符合。`domains/vfs3-assets/generated.ts` 未在 diff；desync 闸门保留仅收窄放行 int/range | sha256 实测 `342d8c1f…e6707` 与钉值一致（§3.6）；`emitter.ts:336-346` |
| namespace-runtime：公共 API 只暴露 detached projection | 符合。克隆经既有 memo 机制产全新副本、条件键逐键携带、共享节点保共享 | `read-schema-projection.ts:170-184` |
| 根 AGENTS typed namespace writes 强制纪律 | 不适用（本票零触碰 `domains/**` 写路径与 Namespace 数据变更）；源码面无 `as any`/`: any` 散布（grep 复核零命中） | diff 文件清单；grep |

### 3.2 ADR 与规范文档符合性

| 决策条款 | 实现核对 | 结论 |
| --- | --- | --- |
| ADR 0020 决策 1/2（保留名 16→18、白名单四例、E100 文案更新、判定顺序/`[]` 结合镜像 Pattern） | `RESERVED_NAMES` +`Int`/`Range`；`CROSS_WHITELIST_MSG` 提为模块常量两生产点共用；`number &` 主层识别镜像 string 块；`parsePostfixType` 零改动 | 符合（`parser.ts:89-98/506-524`） |
| ADR 0020 决策 4（arity 锚构造起点记号；Int 端点锚该小数记号；空区间解析期 E100；零新增码） | `parseConstraintArgs` 三阶段序（形状→源序值闸门→空区间）与 B3/B4 冻结一致；arity/空区间锚 `nameTok`，端点违规锚该记号；错误码注册表零改动 | 符合（`parser.ts:643-700`；测试 A1-A12/B1-B14 锚逐例钉死） |
| ADR 0020 决策 5 + ADR 0021 决策 6（IR/derived 条件键叶子；既有指纹全不变） | 新叶子只在 `number &` 新分支触达；既有路径逐字节不变；指纹钉值哨兵在仓 | 符合（§3.6 静态复核） |
| ADR 0020 决策 6 + ADR 0021 决策 1/3（validate 标量叶判定、四值统一基线、-0 `Object.is`、消息不冻结、两写路径同口径） | 级联 typeof→四值→整数性→区间（四值步先于区间步——`Range<-40,85>` 否则放行 -0 的对偶论证在注释中显式给出）；复用 `isJsonFaithfulNumber`/`renderNumberValue`；`validate-patch.ts` 零改动共享 `validateSubtree` | 符合（`validate.ts:227-233/424-431/591-598`） |
| ADR 0020 决策 7（codegen 发射 number 原样、字节稳定） | `projectValue` +2 case → `'number'`；注释声明品牌类型不做 | 符合 |
| ADR 0020 决策 8 + ADR 0016（投影标量叶、零新增拒绝路径与失败码） | `resolve-schema-at-path.ts` 仅注释更新零行为；`SCHEMA_PATH_NOT_FOUND` 既有码 | 符合（`resolve-schema-at-path.ts:289/413`；`resolve-schema-at-path-int-range.test.ts:78-91`） |
| ADR 0020 决策 10 + docs/AGENTS.md（行为变化同步全部规范文档、同一变更集；CONTEXT.md 词条同步） | spec §2（白名单句/EBNF `IntType`/`RangeType`/注记 1/微示例）、§3（形状归类三处 + 新「Int / Range」节 + 家族基线现在时 + ROOT 约定）、§4（判定顺序第 7 条/E100 码表行/保留名 18 名）与 guide §6/护栏、CONTEXT.md「值 schema」词条同 diff 落地；**§5/§8 零编辑**（14 个 hunk 全部 ≤ 行 450，§5 起于 460、§8 起于 573——逐 hunk 核对） | 符合 |
| docs/AGENTS.md「ADR 不得静默矛盾」 | ADR 0020/0021 零编辑；spec §8 两类例外条款逐字节保持 | 符合（diff 文件清单无 ADR） |
| 规范机检面（acceptance py G4/G5/G6） | `REQUIRED_LHS` 为子集检查、`Y[A-Z` 坏名规则不匹配 `IntType`/`RangeType`、`CANONICAL_MARKERS` 未变——新增产生式不触红；机检脚本本身不在 diff | 符合（静态机制复核；SA3 报告 22/22 GREEN 与此一致） |

### 3.3 单一事实源

| 事实 | 唯一来源 | 核验 |
| --- | --- | --- |
| 交叉白名单文案 | `CROSS_WHITELIST_MSG` 模块常量（消除 `:392`/`:480` 双文案漂移） | 符合（`parser.ts:96-98`，两处 throw 均引用常量） |
| 数值约束判定级联 | `intRangeReject`（`validateValue` 判定与 `intRangeRejectMessage` 共用同一级联；thunk 门控维持计数/截断态零消息开销） | 符合（`validate.ts:227-254/591-598`） |
| number 家族四值基线 | 复用 `isJsonFaithfulNumber`/`renderNumberValue`（-0 经 `Object.is` 渲染 `-0`），未造第二套数值语义 | 符合（`validate.ts:229/246/251/254`） |
| 写路径值校验 | `validate-patch.ts` 零改动共享 `validateSubtree` 单源（旁路实现不存在；C4f 锁定同口径） | 符合 |
| 指纹 | `fingerprint.ts` 单一生产者零改动；钉值测试哨兵 | 符合 |

### 3.4 生命周期对称性

全链同步纯函数、调用局部中间态、无模块级缓存/订阅/后台任务/持久化新增——生命周期面 N/A，与模块 AGENTS「同步确定」一致。无新增 register/dispose 不对称风险。

### 3.5 文件范围（ALLOW/DENY）

- **ALLOW**：23 个仓内改动文件中 22 个逐条命中设计 §11 ALLOW 条目（15 src + 3 文档 + 4 测试修改/5 新测试——containers-markers 标注「可选」，在册）。
- **DENY 零触碰**（`git diff --name-only` 逐条核对）：`tokenizer.ts`/`fingerprint.ts`/`pattern.ts`/`validate-patch.ts`/`index.ts`/`vfsl-protocol/**`/`domains/vfs3-assets/**`/`doc-runtime/**`/ADR/spec §5§8/`tests/acceptance/vfsl_spec_acceptance.py`/CI 配置全部不在改动集；无探针/临时文件残留（`git status` 非 wiki 未跟踪项恰为任务简报本身）。
- **1 处 ALLOW 外改动（MINOR M-1）**：`packages/vfsl/test/evaluate-derived-schema.test.ts` +5 行文件内自持镜像类型 additive 同步（纯类型、零断言变化）——`pnpm typecheck` 机械强制（生产联合变宽则镜像失配 TS2322），SA3 Deviation #1 已登记、SA4 N-1 建议总控追认为 ALLOW 修订、SA8 R1/R2 均核证非决策面。形式越界但无行为与断言影响，不阻断。
- wiki 产物 8 件随 commit 入仓（证据面，`docs/AGENTS.md` 定位非规范）；任务简报 `wiki/raw/task_issue-315.md` 仍为未跟踪（观察 M-5，前例 issue-314 简报在仓）。

### 3.6 测试质量标准

| 维度 | 核验 |
| --- | --- |
| 断言纪律 | 全部新测试只观察公共接缝运行时输出（`parseVfsl`/`evaluate`/`validateLogicalSnapshot`/`validatePatch`/`resolveSchemaAtPath`/`compileSchemaEnvelope`/`generateProjection` + 生成物文件字节）；不 grep 源码；文件头显式声明纪律 |
| 负例强度 | C2 负例逐例钉错误码 + 行列锚（A1-A12/B1-B14/复合 B3/非数字实参 B4/EOF 截断/夹缝 doc E305），杀死「只断 ok:false」的过宽实现 |
| 负控组 | 小写 `int`/`range`（E301 + 新增锚断言，较原断言**加强**）、近似名 `Integer`/`Range2` 合法、既有白名单 `string & Pattern` 两形态保持——保留面精确性（SA8 Required action 5）锁定 |
| 翻转义务 | `validate-number-domain-narrowing.test.ts` AC7 拆分翻转（SA8 Required action 2）：`Int`/`Range` → E100 @ (1,18)（按本文件实际脚手架，SA2 N-1 落实）；小写保持 E301；AC1-AC6 零弱化、describe 未删除规避 |
| 判别性用例 | C4g `{v:5}`=1 条 / `{v:true}`=2 条（杀死漏 `contradictsInner` case）；别名链结构叶断言（杀死漏改 `isNoChildTerminal` 非 switch 盲区）；emitter 闸门经 C6a desync 断言判别——两处 typecheck 盲区均有判别覆盖 |
| 消息不变量 | C4d 只钉语义承载（R1 普通 issue/R2 -0≠0/R3 区间与互异），F-SA4-1 回归断言为内容不变量级（含「整数」/不含 `undefined`）——未把措辞升格为冻结面，与 ADR 0021 决策 3 / SA6 §12.0 纪律一致 |
| skip/only/todo | 全测试面 grep 零命中 |
| codegen 证明方式 | 生成文本经真实 tsc `preEmitDiagnostics` 0 诊断（不用正则冒充「合法 TS」）；前置判别 derived 值叶确为 int/range（非空转断言） |
| 指纹/漂移哨兵 | 既有 fixture 双指纹 + `generated.ts` sha256 逐字节钉死（本审查独立复算 `342d8c1f…e6707` 一致）；新 fixture 稳定不钉值、前缀 `sha256:v1:` 锁定 |
| 卫生 | `git diff --check` 只读复跑 exit 0（stdout 空） |

### 3.7 不属本审查范围的事项（声明）

- Issue 5 条 AC 的需求完成度判定 → SA10 职责；本审查仅核验实现与已批准设计/契约/ADR/模块标准的一致性。
- CI 分片/真实环境验收、`pnpm test`/`typecheck` 实跑 → SA3 已报告（353 files / 3863 tests / typecheck 0），本审查按纪律未复跑，静态证据与其一致。

## 4. Findings（全部 MINOR / 观察，不阻断 approve）

| ID | 级别 | 内容 | 处置建议 |
| --- | --- | --- | --- |
| M-1 | MINOR（文件范围） | `evaluate-derived-schema.test.ts` 为 ALLOW 外改动（+5 行纯类型镜像同步，typecheck 机械强制、零断言变化）。SA3 Deviation #1 已登记，SA4 N-1 建议总控追认 | 总控追认为 ALLOW 修订即闭合；无需返工 |
| M-2 | MINOR（注释精度） | `parser.ts` `parseConstraintArgs` JSDoc「EOF 锚经 err() 既有回退 (1,1)」与实际（锚 eof 记号真实坐标）不符；行为正确且测试按实际锚 (1,36) 断言并注明来源（SA4 N-3 / SA8 F-2） | 顺手修正注释，非本票阻断项 |
| M-3 | MINOR（文案引用） | `-0` 端点 E100 消息引「ADR 0020 决策 3」（#314 既有文案沿用），精确归属为经 ADR 0021 决策 2 修订；消息正文不进冻结面（SA4 N-4 / SA8 F-4） | 文案清理项 |
| M-4 | 观察（非规范面） | `tests/acceptance/exemplar/spec-exemplar-v1.md`（自述非交付物 fixture）与 `.scratch/` 存「唯一允许的交叉类型」旧句；规范面（spec/guide）已四例化，机检不含该句（SA4 N-5 / SA8 F-3） | 备查，无动作要求 |
| M-5 | 观察（housekeeping） | `wiki/raw/task_issue-315.md` 任务简报未跟踪入仓，其余 8 件产物已入仓；前例（issue-314）简报在仓。wiki 产物属证据非规范 | 交由 Host/总控收尾时决定是否补入 |

## 5. 独立核验方法记录

- `git diff 7b92af0..HEAD` 全 23 文件逐 hunk 读；焦点源码（parser 分派流 18 保留名完备性、`parseConstraintArgs` 三阶段序、`intRangeReject` 级联与消息分支次序、`cloneValueSchema` 条件键携带）逐行对照设计 §8 与 ADR 0020 决策 4/5/6 原文；
- 保留名两查询点（`parser.ts:311` 别名 E303 / `:756` 字段名 E100）源码核实——扩集合自动覆盖新名，零特判；
- spec diff 14 hunk 行号核对确认 §5（L460 起）/§8（L573 起）零编辑；acceptance py 机制（REQUIRED_LHS 子集语义、Y[A-Z 坏名、CANONICAL_MARKERS、exemplar 非规范自述）静态复核；
- `domains/vfs3-assets/generated.ts` sha256 独立复算 = 钉值 `342d8c1f…e6707`；`git diff --check` exit 0；skip/only/todo 与 `as any` 全测试/源码面 grep 零命中；
- SA8 R2 报告（verdict clear、`requiresConflictRecheck: false`）通读——消息面变更已经规范三处明文（v1-spec §3 两条 + ADR 0021 决策 3）裁定为非冻结面，本审查无新增决策面，不重开冲突复查。

SA9 未修改任何代码、设计、测试或上游产物；未运行测试/服务；唯一写产物为本文件。
