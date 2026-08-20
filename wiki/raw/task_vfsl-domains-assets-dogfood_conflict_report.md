# 冲突门禁报告 — task_vfsl-domains-assets-dogfood（issue #27，第 0 阶段前置门禁）

被审对象：`wiki/raw/task_vfsl-domains-assets-dogfood.md`（任务简报，domains/vfs3-assets 领域包 dogfood / 票 G）
冲突基准：`docs/adr/` 全集 5 份（0001–0005，逐个全读）+ `CONTEXT.md`
参照证据（非约束）：`docs/vfsl/v1-spec.md` §3 ROOT 约定 / §10 fixture；`.github/workflows/ci.yml` regen-diff 步骤；F2 设计交接注记（TODO(#27)）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订：目标态/阶段态二分） | 是 | 无冲突——仓内 schema.vfsl 属修订节明确放行的「阶段态脚手架」；简报未要求任何消费方绕开 SchemaSource 接缝；头部 `@`-指令按 ADR 0005 §2 属文件格式约定，不触及无机器标签条款 |
| 0002 | nomicore 是重写，authority 出范围 | accepted | 弱（范围背景） | 无冲突——简报不触及 authority 规则体系 |
| 0003 | 求值器与派生 schema（evaluate 接缝 / ROOT 约定 / 联合表示 / 按名引用 / YXmlFragment 不透明） | accepted | 是 | 无冲突——简报采用「规格 §10 修订版 fixture」，该 fixture（实读核实）以 `type ROOT = YMap<{…}>` 为根、map 形合规；`YXmlFragment` 位于 text 成员 `body` 演示位；与 ADR 0003 §2/§5 及后果（fixture `AssetsDoc` 改名 `ROOT`）逐点吻合 |
| 0004 | vfsl-protocol 类型投影（D1–D5） | accepted | 是 | 无冲突——AC 的 §8.4 正负例（expectTypeOf / @ts-expect-error）即 D4 装置的复刻执行；「旧路径 → `UnknownPath` 编译错误」正是 D3 fail-closed 语义的演示；路径不含 ROOT 前缀（D5）由生成器既有契约承载，简报未提出相左要求 |
| 0005 | 投影生成管线（SchemaSource / 文件格式 / 输入契约 / 入仓+CI / domains/ 位置） | accepted | 是（直接依据） | 无冲突——本任务即 ADR 0005 后果所列票 G；AC 逐条落在 §5（包组成：schema.vfsl + generated.ts + 挂载点 + dogfood 测试 + 顶层 `domains/`）、§4（生成物入仓 + CI regen-diff）、§2（头部指令三键）；docs 三锚位 TSDoc 断言对应 §3「派生 schema 必须携带 docs」的验收兑现 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | 无冲突点 | 全部对照项均为 no-conflict（详见下表逐项） |

逐项对照记录（无冲突明细）：

| # | ADR 条款 | 简报要求 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | ADR-0005 §5：「`domains/` = 业务 schema 包（schema.vfsl + generated.ts + 挂载点 + dogfood 测试）」 | AC-1「包结构符合 ADR 0005 §5（schema.vfsl + generated.ts + index.ts + test/ + package.json 纯类型）」 | no-conflict | 逐字对齐；「package.json 纯类型」与生成物「纯类型文本」（§4）及 ADR 0004 D3 类型空间纪律同向（index.ts 增广挂载为 `declare module` 类型空间产物），无 ADR 条款要求领域包含运行时代码 |
| 2 | ADR-0005 §2：头部三键「全部必需，缺失或方言不符 → 响亮拒绝」 | 「schema.vfsl 用规格 §10 修订版 fixture 文本 + 头部指令」 | no-conflict | 简报显式要求头部指令；规格 §10 fixture 本体不含头部（实读核实），「fixture 文本 + 头部指令」的组合正是 §2 文件格式 |
| 3 | ADR-0005 §4：「生成文件入仓……CI `generate --check`……双抓」 | AC-2/AC-4「generated.ts 入仓」「CI regen-diff 覆盖本包」 | no-conflict | 直接执行 §4 |
| 4 | ADR-0005 §4（方向性）+ F2 既定交接 | AC-4「移除 F2 阶段门 `--allow-empty-domains`——零领域重新成为响亮失败」 | no-conflict | `--allow-empty-domains` 是 F2 设计引入的显式阶段门，自带 TODO(#27)「G 票种植首领域后移除」（ci.yml 注记与 F2 设计 §5.5/§6 实证）；移除后零领域集 exit 2，强化而非削弱 §4「双抓」意图。注：阶段门本身是 F2 票设计产物、非 ADR 条款，其移除不构成 ADR 演进 |
| 5 | ADR-0004 D4：「正例用 `expectTypeOf`……负例用 `@ts-expect-error`……§8.4 矩阵原样复刻」 | AC-2「§8.4 正负例在真实 fixture 类型表上全过（expectTypeOf / @ts-expect-error）」 | no-conflict | 逐字对齐 |
| 6 | ADR-0004 D3：「空 `VfslPathMap` 默认 fail-closed……一切路径解析为 `UnknownPath`」 | AC-3「迁移演示：模拟字段重命名后旧路径全部编译错误（每行一个 `@ts-expect-error`）」 | no-conflict | 演示的正是 D3 fail-closed 与 ADR 0004 后果所引 §8.5 迁移清单价值 |
| 7 | ADR-0003 §2：ROOT「必须 map 形……大小写是契约」；§5：YXmlFragment 终态节点 | fixture 采用 §10 修订版 | no-conflict | 实读规格 §10：`type ROOT = YMap<{…}>`（map 形正例），`YXmlFragment` 在 text 成员 `body` 演示位——与 ADR 0003 §5 fixture 修订描述逐字吻合 |
| 8 | ADR-0005 §3：「派生 schema 必须携带 `docs`……TSDoc 发射」 | AC-5「docs 三锚位 TSDoc 断言：别名/字段/标记位的 fixture JSDoc 全部出现在 TSDoc 注释上」 | no-conflict | 直接兑现 §3 要求（并补齐 F2 评审证据缺口，#46 Spec 轴） |
| 9 | ADR-0001 修订节：「一切脚手架消费方必须经 SchemaSource 接缝取文本」 | 简报未设任何消费方 | no-conflict | 本任务只生产脚手架与生成物；消费经既有 `@nomicore/vfsl-codegen` 管线（FileSchemaSource 接缝内），无绕行要求 |
| 10 | ADR-0001：「语义层不设机器标签」 | 头部指令 `// @lang/@id/@version` | no-conflict | ADR 0005 §2 已显式切割：「这是文件格式约定，不是语义层机器标签（ADR 0001 的无机器标签条款不触及）」 |
| 11 | CONTEXT.md：`ROOT` / 标记类型大小写契约 / 信封 / 方言冻结 | fixture 与头部指令 | no-conflict | fixture 用 `ROOT`（非 root/Root）；六标记拼写合规；头部 `lang: vfsl, version: 1` 与方言断言条款一致 |

## 结论

**Verdict: clear** —— 任务简报与 ADR 全集（0001–0005）及 CONTEXT.md 无任何冲突点；无 override 声明需求、无 evolution 存疑项、无 hard-violation。

补充观察（非阻塞，供总控/下游 SA 知悉）：

1. 本任务即 ADR 0005 后果中的票 G，`Blocked by` 所列 #45（PR #49 已合入本分支基底 `adr/vfsl-protocol`）与 #26 均已闭环——前置链完整，可开工。
2. AC-4 的 flag 移除应与首领域种植同票完成（schema 改动与再生成同原子提交的 §4 纪律延伸至 CI 步骤改动），避免中间态 CI 假绿/假红。
3. 规格 §10 fixture 本体不含头部指令三键，SA1/SA3 须按 ADR 0005 §2 补足 `// @lang: vfsl` / `// @id: vfs3.assets@1` / `// @version: 1`——缺失将触发生成管线响亮拒绝（该行为本身合规）。
