# 冲突门禁报告（设计后复审，Round 2 修订轮 R0）

- 被审对象：`wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md`（SA1 R0 初版，395 行，§1–§8 全文通读）
- 冲突基准：`docs/adr/` 全集 9 篇 + 根 `CONTEXT.md`（本会话前置门禁已全量逐篇重读；本次复审前 `git status --porcelain docs/adr/ CONTEXT.md` 复核仍为零变更，HEAD=0a4d460）
- 复审焦点（总控指定）：ADR 0009 第 18 行模块边界语义 + §公共 Interface testing subpath 条款
- 复审性质：轻量复审（全量 ADR 盘点见本轮前置门禁报告 `…_rev1_conflict_report.md`，verdict: clear）；本报告只裁设计 vs ADR 一致性，设计优劣归 SA2
- 实证核验：设计引用的 SA6 冻结资产已在盘核对——fixture 树 `find` 实测 19 文件（`repo/` 根内含 `packages/` 层级：`repo/packages/namespace-registry/src/…`）；rev1 测试真实门禁 describe 实测仅两断言（`prodFiles>0` + `violators=[]`，无路径常量）
- 配套产出：相关决议文档已追加「设计后复审追加（SA8，rev1 R0）」RN1–RN8

## Verdict

`clear`

## ADR 复审盘点（轻量）

| 编号 | 相关 | 对照结论 |
|---|---|---|
| 0009 | 是（裁决核心） | **L18 全句逐段对照**：①「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime」——设计的 DENY list 冻结 `src/**` 零改动，Round 1 已落地的该通道原样保持；②「主 entry 不公开生产 Runtime 构造器」——不触碰（N5/RN6：exports 键集零改动）；③「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」——设计的 helper + 19 it 正是该义务的强执行化（AST 五形态 + 谓词收窄），谓词语义（矩阵）与「Registry 生产代码」逐一对应，no-conflict；潜伏基准错配见非阻塞发现 1。**§公共 Interface testing subpath 条款**：「测试 seam只位于受控 testing subpath，允许替换Runtime/document factory、Clock、timeout和observer，但不允许读取内部entry结构」——testing subpath 是注入**替代**工厂的非生产载体，自身不消费 internal；设计 D-C 把 `src/testing/` 列入谓词拒绝面（矩阵明示 deny + fixture 集成反例 `repo/…/src/testing/case.ts` 锚定），是 ADR 自身生产/非生产二分的忠实应用而非抵触，no-conflict |
| 0008 | 是 | 设计结构性保持全部冻结面：DENY list `src/**` 零改动、§7 契约改动连锁审计自证「无生产契约改动」、D-E 对旧测试文件其余 5 it 与断言逐字不动——ADR 0008 公共面、构造序、P0/sequencer/fatal/status/close 语义、稳定码注册全部原样；package.json 仅 version 元数据 bump，no-conflict |
| 0007 | 否（背景） | 仍有效的「业务调用方不得取得可写 Yjs 引用或绕过该入口」不受触碰；被 0008 取代的条款未涉及；no-conflict |
| 0006 | 否 | 零 persistence 代码改动（DENY list 明示无关面包零改动）；no-conflict |
| 0001–0005 | 否 | 与前置门禁盘点一致，本轮设计未新增任何触点（fixture 为代码 fixture 非 schema 文本；不触及求值/投影/协议/生成管线）；no-conflict |
| CONTEXT.md | 是 | 设计用语（internal subpath、生产代码、白名单、模块边界、写序列器等背景术语）与 CONTEXT 术语表一致，无 `_Avoid_` 词违规；no-conflict |

## 冲突点

无。全部对照结论为 no-conflict；无 override-declared、无 evolution、无 hard-violation。

设计引入的候选张力（逐条裁定，记录备查）：

| # | 候选张力 | 裁决 | 依据 |
|---|---|---|---|
| 1 | D-C 谓词排除 `src/testing/`（testing subpath 载体不得消费 internal）是否抵触 ADR 0009 §公共 Interface 对 testing subpath 的授权 | no-conflict | 该条款授权的是**替换** Runtime/document factory 等（测试注入面），从未授权 testing 载体消费生产 internal subpath；ADR 0009 自身将「Registry 核心（生产）」与「受控 testing subpath（非生产）」二分于同一 package 内——谓词拒绝 `src/testing/` 恰是该二分在白名单上的投影。设计 D-C 矩阵 + fixture 反例 `src/testing/case.ts`（检测到且判违规）双重锚定 |
| 2 | D-B 残差（计算式说明符 / eval / 经允许包的传递再导出不识别）是否使 L18「限制」义务未履行 | no-conflict | L18 规定义务未规定机制强度；静态 import 图审计的语法可观测边界是该义务的合理履行方式，且设计如实声明天花板、不虚假宣称覆盖（R12）；传递再导出归属 Registry 包自身导出面纪律（切片 5/6 验收域）——与 ADR 0009 把 Registry 包内部纪律留给该包的划分一致 |
| 3 | D-B `import type` 计为消费（过严方向） | no-conflict | internal subpath 零类型导出（Round 1 N2），类型导入本就解析失败；「模块图边即边界事实」与旧审计行为零漂移；收紧方向不违反任何条款 |
| 4 | D-B 扩充 E1（属性访问 `.require` callee）超出 SA6 冻结五形态契约 | no-conflict | 无 ADR 条款规定识别形态集合；E1 单调收紧（漏检→捕获，不可反向），服务 L18 强执行；设计自带可逆开关（删一行回五形态）并明示无独立探针——是否保留属 SA2 设计评审域 |
| 5 | D-D SKIP_DIRS 含 `test/tests/__tests__` → 真实门禁扫描面对未来 `packages/namespace-registry/src/{test,tests,__tests__}/**` 整目录剪枝（谓词虽拒绝但扫描不可达，形成「非生产目录消费不可见」盲区——与设计自身规则 3 的反盲区原则不一致） | no-conflict | 该跳过集合是简报架构的既定组成（fixture 隔离所必需：违规 fixture 位于 `test/` 下，简报现状事实明文），本轮前置门禁已随简报整体裁 clear；ADR 不规定扫描范围；且与发现 1 的基准错配同向叠加于 fail-closed 侧，不产生任何漏放行。盲区收窄机会（如仅对非 `src/` 子树跳过 test 目录名）路由 SA2 |
| 6 | D-E 整体删除旧 AC5 块（而非保留委托）是否中断 L18 义务承载 | no-conflict | rev1 文件对旧三 it 是严格超集（防空扫 + 真实门禁 violators 空 + 谓词自检扩张），义务迁移零空窗；简报 SA3 落地清单明文「迁移/删除」二选一；存量 AC1–AC4/AC6 锚点逐字不动（约束 7） |
| 7 | RN8：relPath 基准（相对扫描根）与谓词前缀（`packages/…`）基准错配（详机理见非阻塞发现 1） | no-conflict（潜伏、fail-closed） | 今日观察等价（F6：生产消费面为零 → importers 空 → 门禁绿）；错配只在切片 5/6 真实 Registry 消费方出现时显形，且显形方向是**假红**（拒绝放行）而非漏放行——ADR 0009 L18 的安全侧（禁止非 Registry 消费）在任何时点都不受损；设计声明的谓词语义（D-C 矩阵）本身与 L18 逐条一致。错配的消除属设计修订（SA1/SA2 域），不构成对条款的直接违反、无推翻意图（非 override/evolution） |

## 结论

**Verdict: clear，放行。** 设计是 L18 的强执行化：AST 五形态识别 + 白名单谓词收窄 + 单一实现双输入（探针/真实门禁），同时以 `src/**` 零改动结构性保持 ADR 0008/0009 全部冻结面；testing subpath 排除在白名单外是 ADR 0009 自身生产/非生产二分的忠实应用。无需 override，无需 Jim 裁决的演进项。

非阻塞发现（不构成冲突；发现 1 具最高优先级，强烈建议 SA2 全维评审优先处理）：

1. **relPath 基准错配——前瞻 allow 路径在默认门禁下结构性不可达（fail-closed 假红）**：
   - **机理**：§D-D 默认 `scanRoots = REPO_ROOT/{packages,domains,apps}`，`importers.push(path.relative(root, file))` 相对**扫描根**取路径 → 真实门禁下未来消费方 `packages/namespace-registry/src/registry.ts` 的 relPath 为 `namespace-registry/src/registry.ts`（`packages/` 段被剥离）；谓词首规则 `startsWith('packages/namespace-registry/src/')`（§D-C）永假 → 该文件必入 violators。domains/apps 两根下的任何文件同理永不可达白名单——**默认门禁配置下 allow 集合结构上为空**，与 ADR 0009 L18 首句授权的 Registry 生产构造路径（切片 5/6 落地时必然消费 internal）冲突显形即为门禁假红。
   - **实证**：fixture 探针不受影响（`find` 实测 `repo/` 根内含 `packages/` 层级 → 探针 relPath 带 `packages/` 前缀，谓词 allow 路径可达、19 it 可绿）；rev1 真实门禁两 it 仅断言 `prodFiles>0` 与 `violators=[]`（无路径常量），叠加 F6（生产消费面为零）→ 今日全绿，错配不可见。
   - **设计自证矛盾点**：§D-C 注释「ADR-0009 前瞻前缀」与 §4 R6「白名单收窄误伤未来 Registry 生产代码（假红阻塞切片 5/6）→ 已缓解」的声明，在默认 roots 基准下不成立——缓解只在谓词/fixture 基准成立。
   - **为何 no-conflict 而非 hard-violation**：义务今日已被履行（门禁绿且较旧审计严格）；错配显形于未来切片且方向为 fail-closed（假红阻塞，不会漏放行任何违规消费）；设计声明的谓词语义与 L18 逐条一致，偏差是实现级基准选择（SA1/SA2 修订域），无推翻 ADR 之意。若放任至切片 5/6 才发现，将把 ADR 授权的合法消费误报为「漏检形态的真实消费方」——§D-H 处置协议与 rev1 测试注释的病因诊断文案届时都会误诊（处置动作「停止回禀」本身仍安全）。
   - **修复方向（SA1/SA2 裁定，SA8 不代设计）**：默认门禁的 relPath 改为相对 `REPO_ROOT`（保持现有三根扫描面不变），或默认扫描根改为 `REPO_ROOT` 单根 + 顶层目录过滤——两者均使默认门禁 relPath 与谓词前缀/fixture 探针基准对齐；随附一个「未来 Registry 生产消费方放行」的正向锚（可在 fixture 树 `repo/` 侧已天然存在，真实侧待切片 5/6 补）。
2. **扫描面盲区**（张力 5）：`src/{test,tests,__tests__}/**` 在真实门禁被 SKIP_DIRS 剪枝、不可见——谓词已拒绝但扫描不可达，与设计自身规则 3「扫描面跳过非生产目录=新盲区」的原则不一致；与发现 1 同为 fail-closed 侧，可随发现 1 一并收窄（如 test 目录名跳过仅适用于 `src/` 之外的子树）。路由 SA2。
3. **E1 无独立探针**：属性访问 require 扩展超出 SA6 冻结五形态且 fixture 树冻结不可增——其安全性目前只靠设计论证（单调收紧 + 控制组不含该形态）。SA2 若判应贴齐契约字面最小面，设计的预置退让点（删一行）可直接采用。
4. **残差宣称边界**：后续轮次不得把 RN7 声明的残差（计算式说明符/eval/传递再导出）静默当作已覆盖；传递再导出的防线在 Registry 包导出面纪律（切片 5/6），届时 SA8 将按 L18 复审该包的再导出面。
