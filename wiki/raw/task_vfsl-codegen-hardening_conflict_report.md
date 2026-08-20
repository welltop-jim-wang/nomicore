# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_vfsl-codegen-hardening.md`（Issue #45，fix(vfsl-codegen): 生成物编译级加固，Bug 修复）
- 冲突基准：`docs/adr/0001–0005` 全集（5/5 逐篇全读）+ `CONTEXT.md`。代码与 wiki 其他文档不构成阻塞依据。
- 门禁类型：前置门禁（SA 派发前）
- 报告：SA8（Conflict Gatekeeper），只读裁决，未改动任何文件

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订节） | 相关（修订节直接放行本任务所在领域） | no-conflict：正文「没有任何形式的 codegen」已被同文修订节「§8 编译期类型投影回到范围内：生成器 + CI 新鲜度校验」在阶段态放行；修订节与正文同属 ADR-0001 现行文本，非 superseded |
| 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted（无显式状态行；未被任何 ADR 标记 superseded） | 无关（任务不触 authority / 写入管线 / 旧系统兼容） | no-conflict |
| 0003 | 求值器与派生 schema——evaluate 接缝、ROOT 根别名约定、联合的分支列表表示 | accepted | 部分相关（ROOT 保留名与「其余别名合法」界定 N3 守卫对象域；parse 层错误表冻结为 AC-3 对照背景） | no-conflict：任务不改 evaluate/parse 契约；N3 守卫作用于生成器层，别名命名（除 ROOT 外）在 ADR-0003 中本就合法、无冻结约束 |
| 0004 | vfsl-protocol 类型协议包——编译期路径投影的五个设计决策 | accepted | 相关（D3 的 `PathSchema` 正是 AC-1 import 行的导入对象；「生成契约 = 类型映射表」约束生成物形态） | no-conflict：恒定 import 行是模块级接线，不在 §8.3 类型映射表（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc 注释）任何一项之内，类型树形状不变 |
| 0005 | 投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓 | accepted | 高度相关（本任务全部改动落在该 ADR 冻结的生成管线内） | no-conflict（附一致性要求，见冲突点 #5） |

无 ADR 处于 superseded 状态；无条款触发 override / evolution 判定。

## 冲突点

无 hard-violation、无 override-declared、无 evolution。以下为逐条对照中值得复核的边缘项，均裁 no-conflict（严重度列「—」表示非冲突）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR-0001 正文：「没有作为类型源的 schema 源文件，也没有任何形式的 codegen。」 | 任务修订 `@nomicore/vfsl-codegen` 生成器行为（AC-1 恒定 import 行、AC-3 碰撞守卫） | no-conflict | ADR-0001 2026-08-19 修订节明文：「§8 编译期类型投影回到范围内：生成器 + CI 新鲜度校验」＋「阶段态放行」。codegen 由现行文本放行，正文旧句被修订节收窄，不是独立有效约束 |
| 2 | — | ADR-0004 后果：「类型树形状 = 生成契约：票 F 生成器的输出规格即本 ADR + 设计文档 §8.3 映射表（……）」 | AC-1：生成器对任意领域（含零别名域）恒定发射 `import type { PathSchema } from '@nomicore/vfsl-protocol'` | no-conflict | import 行属模块级基础设施，不改动 §8.3 映射表任何一项、不改变类型树形状；相反，它是 D3「领域包增广 / fail-closed」机制能正常编译的必要接线（无 import → 文件非 module → `declare module` 退化为环境声明遮蔽协议包，即 N2 实证形态） |
| 3 | — | ADR-0005 §3：「物化折叠、联合三分类、判别式检测只计算一次（单一真相），生成器是纯发射器」 | AC-3：生成器新增命名碰撞响亮守卫（领域别名 vs 协议导入名，独立错误码响亮失败） | no-conflict | 条款语境是「输入 = evaluate 的派生 schema、语义分类不重算」，约束的是语义计算归属；碰撞守卫是对固定协议导出名清单的发射期检查，非语义分类重算，输入仍是派生 schema。「响亮失败」是本管线既定模式（§1 方言断言「否则响亮失败」、§2「三键全部必需，缺失或方言不符 → 响亮拒绝」） |
| 4 | — | ADR-0003 后果：「§4 错误表新增 E310/E311（19 → 21 码）」 | AC-3：以「独立错误码」响亮失败 | no-conflict | 冻结的是 parseVfsl 层（v1 规格 §4）的 E 码表；生成器层错误码无任何 ADR 条款约束。AC-3 自身要求「独立错误码、非归并」，与 parse 层 E 码空间隔离相容 |
| 5 | — | ADR-0005 §4：「schema 改动与重新生成同一原子提交」；「CI `generate --check`……源漂移与生成器逻辑漂移双抓」 | AC-1 改变全部生成物形态（新增恒定 import 行）；AC-5 含 `pnpm generate --check --allow-empty-domains` exit 0 | no-conflict（附一致性要求） | 生成器逻辑漂移正是 §4 CI 双抓的显式对象；本票生成器改动必须伴随既有生成物再生成并同票提交——AC-5 的 `generate --check` 与 §4 机制一致，构成兜底。这是合规执行要求，不是冲突 |

## 结论

**Verdict: clear，放行。** 任务简报五项 AC 及 Owner 三项裁定逐条对照 ADR-0001（含修订节）至 0005 与 CONTEXT.md 全部硬性条款，未发现直接违反；无条目需 override，无条目属演进（evolution）需 Jim 裁决。

给下游 SA 的非阻塞提示（源自上表边缘项，非裁决）：

1. **ADR-0005 §4 一致性**（边缘项 #5）：生成器行为变更必须与既有生成物再生成同票原子提交；AC-5 的 `pnpm generate --check` 即为此设计，SA3 执行时勿漏再生步骤。
2. **AC-3 错误码命名**（边缘项 #4）：无 ADR 强制，但建议 SA1 设计时使生成器错误码与 parse 层 E 码空间（v1 规格 §4，21 码）保持可区分，避免两套诊断体系混淆。
3. **AC-1/AC-2 的「恒定」语义**（边缘项 #2）：锚定的是 import 行恒定存在，不触碰 ADR-0004 §8.3 映射表与 D5 路径形状——SA1/SA2 复审设计时以此为界。
