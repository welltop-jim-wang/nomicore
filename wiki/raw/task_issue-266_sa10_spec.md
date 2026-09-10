# SA10 Spec 审查报告 — Issue #266（VFSL 内容寻址 schema ID（sc1-）：窄派生接口与 envelope 校验）

> SA10（独立 Spec 审查者）spec-review 轮产物。dispatch `sa-353827a8-32cb-4ff5-98b5-df40bc9750d8`，
> phase spec-review，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-266`（branch `mabf/issue-266`）。
> **被审对象**: 已提交实现 commit `704398c`（`feat(vfsl): derive content-addressed schema
> identity`）；base = Authoritative Parent PR #158 head `a1ca2d7`（`docs/rest-namespace-create`，
> 携带 ADR 0015）——本轮 `git log`/`git diff a1ca2d7..704398c` 亲证。
> **Issue 评论输入**: 派发注记 `wiki/raw/task_266_dispatch.md` 明示 REST 已读 = 空
> （comments: none）；applicable owner requirements: none。验收口径 = Issue 正文 AC1–AC4。
> **输入产物（全部亲读）**: 任务简报 `task_issue-266.md`；SA6 验收契约
> `task_issue-266_sa6_contract.md` + 两份红跑日志；SA1 设计 `task_issue-266_design.md`
> （671 行）；SA2 攻击评审 `task_issue-266_sa2_review.md`（approve + C1/C2/C3 + F6 路由）；
> SA4 静态验尸 `task_issue-266_sa4_review.md`（pass）；SA3 实现日志
> `task_issue-266_sa3_impl.log`；SA8 前置门禁（`clear`，B1/B2/B3）与设计后复审
> （`clear`，N1/N2/N3）。
> **独立核验方式（本轮全部亲读/亲证，非转述）**: 四个生产改动文件（envelope.ts /
> fingerprint.ts / index.ts / schema-id.ts）全 diff 逐 hunk 亲读；三个契约测试文件 +
> 独立参考件全文亲读；Base32 编解码算法按 RFC 4648 §3.2/§6/§10 静态复算（含 KAT 抽验
> `'66'→'my'`、全零 digest→`a`×52、全 FF digest→`7`×51+`q'`）；导出面 / package.json /
> DENY LIST 零 diff 亲证；getCompiled 缓存键、RT-1a 指纹生产者引用面 grep 亲证。
> **边界**: 零业务代码/设计/测试改动；未运行测试、未启动服务（SA10 纪律；动态证据采用
> SA3/SA4 已归档的独立亲跑记录）；零 commit/push/PR；唯一写入 = 本文件。
> **不复用结论声明**: SA4 的 pass 已知悉，但本报告全部 spec 符合性结论基于对 Issue 正文、
> 契约、设计与提交 diff 的独立逐项核对，非转述。

---

## Verdict

**approve**。

**核心理由**：Issue #266 四条 AC 与「What to build」三段义务逐项全部满足，且全部有
包级契约测试锚定（SA3 日志：三契约文件 40/40 绿、vfsl 目录 588 绿、根门禁
295 files / 3163 tests + typecheck 全过；SA4 独立重跑一致 + 189 条对抗探针全过）；
SA1 设计 D1–D8、ALLOW/DENY 与 SA2 约束性交付条件 C1/C2/C3、F6 前置路由全部落实；
SA8 边界条件 B1/B2/B3 保持；无遗漏、无部分实现、无错误实现、无实质 scope creep。
须在 PR 披露的未达成/偏离项见 §6（均为已授权的过程偏离或明文移交总控的收官项，
无 AC 级缺口）。

---

## 1. AC 逐项核验（Issue 正文验收标准）

### AC1 — 窄接口可从 VFSL text 确定性派生 semantic fingerprint 与 `sc1-` schema ID，或返回 VFSL issues —— **满足**

- 公共导出 `deriveSchemaIdentity(text: string)` 落地于 `packages/vfsl/src/index.ts`
  L255-273（本轮亲读）：`parseVfslImplementation(text)` → 失败零损透传原生
  `VfslIssue[]`；成功 → `semanticFingerprintOf('vfsl', 1, module)` → digest 提取 →
  `sc1IdFromDigestHex` → `{ ok: true, semanticFingerprint, schemaId }`。lang=vfsl、
  version=1 为接口上下文常量（简报最窄读法），不进参数表。
- 复用现有编译 pipeline（tokenize→parse→analyze→指纹单生产者），无第二套 parser/
  指纹路径——满足简报「复用现有编译 pipeline」与 ADR 0015 L125。
- 同步、纯函数、不抛错：顶层 catch 经共享 `vfslCrashIssue`（index.ts L166-176）镜像
  parseVfsl 同款 E100 结构化 issue（message/line/column 逐字同款，diff 亲证）。
- 确定性：全链无缓存、无共享可变状态；契约文件 2 describe 1 第 4 用例锚定同 text
  重复调用逐字节一致。
- 契约锚：`sc1-derive-schema-identity.test.ts` 8 用例（构造性红 → 实现后 8/8 绿，
  SA3 §3 / SA4 §2.1）。

### AC2 — schema ID = 完整 256-bit SHA-256 digest 的 52 位小写 Base32，与 `sha256:v1:<64 lowercase hex>` 同 digest 信息 —— **满足**

- `packages/vfsl/src/schema-id.ts`（新内部叶子，零 import、零运行时依赖）：
  `sc1IdFromDigestHex` = 32 bytes → 256 bits MSB-first → 52 个 5-bit 组（末组
  1 数据位 + `padEnd` 4 零 pad 位，RFC 4648 §3.5/§3.2）→ 小写字母表
  `abcdefghijklmnopqrstuvwxyz234567`（§6），无 `=`、不截断。
- **本轮静态复算**：KAT `'66'('f')` → `01100 110` → `m`(12) + `11000`pad(24)=`y` →
  `my` ✓；全零 digest → `a`×52 ✓；全 FF digest → `7`×51 + 末组 `10000`(16)=`q` ✓
  ——与契约参考件 KAT/钉位（测试 L146-153/L186-187）及 SA6/SA2/SA4 三轮独立跨验
  （Python `base64.b32encode` / node:crypto / 独立手写编码器）一致。
- 解码件 `digestHexFromCanonicalSc1Id`：前缀恰 `sc1-`（大小写敏感）、payload 恰 52、
  字母表外（含大写/`=`/空白）拒、**pad 位非零拒**（末 4 位全零校验——52 字末字符
  只能 `a`/`q` 的完整实现）。
- 「同 digest 信息」互证锚：契约文件 1 匹配正例 L309-322（id payload 解码 == 指纹
  digest；digest 重编码 == payload）+ 文件 2 describe 1（`r.semanticFingerprint`
  与既有 compileSchemaEnvelope 产物逐字节相等，FP_A 锚）。

### AC3 — 包级契约测试覆盖六场景 —— **满足**

| AC3 场景 | 契约位置（亲读核实） |
|---|---|
| fingerprint 与 `sc1-` 一一重编码 | 文件 1 L309-322（双向重编码断言）；文件 2 L139-148（独立参考件双向 + FP_A 相等） |
| 空白/普通注释稳定 | 文件 1 L324-335（WS/`//`/`/* */` trivia 变体 + ID_A 匹配）；文件 2 L163-171 |
| JSDoc 变化改变 ID | 文件 1 红灯 P2（L203-208）+ JSDoc 自洽正例（L337-344）；文件 2 L173-182（doc-a ≠ doc-b ≠ bare） |
| canonical Base32（含声明顺序） | 文件 1 格式矩阵 12 形态（L216-233：前缀大小写 ×3、sc2-、空、51/53 字、大写、`=`、非法字符、内嵌空白、pad 位非零）+ 独立形态 1（L235-241）+ KAT 自检 3（L144-188）；文件 2 声明顺序用例 L184-190 |
| 旧 ID 兼容 | 文件 1 负控 N1 两用例（L274-301：`vfs3-assets@1`/`compile-fixture`/`命名空间@schema版本`/任意旧标签 + `mysc1-provisional-id` 前缀精确性） |
| `sc1-` 格式错误与语义不匹配各产生稳定 issue code | 文件 1 describe 4（L249-268：同模式重复调用 code 相等、两码互异、纯数字 envelope 码、非 {1,2,3,4,5,100} 别名、冻结前缀 `VFSL-ENV-E<码>: `） |

另：SA2 C1 顺序链 5 用例 + C3 边缘钉位 2 用例由新文件
`sc1-failure-order-chain.test.ts` 承载（见 §4）。契约断言强度本轮复核无弱化
（目标断言均为 `expect(r.ok).toBe(false)` + 恰 1 条 `kind:'envelope'` + 码形状断言，
与 SA6 红跑日志 25+8 用例标题/计数逐字一致——SA4 §2.2 已逐字比对，本轮抽验一致）。

### AC4 — 接口不暴露 IR、派生 schema、validator，不接受 provisional envelope ID —— **满足**

- 单参签名：`deriveSchemaIdentity(text)`，`fn.length === 1` 由契约文件 2 L122-125
  锚定；provisional envelope ID 无入参位置。
- ok 分支精确键集 `['ok','schemaId','semanticFingerprint']`（文件 2 L97）+ 显式
  `'module'/'derived'/'envelope' in r === false`（L134-136）；失败分支键集
  `['issues','ok']`（L209）。
- 内部件不进公共面：`schema-id.ts`（SC1_ID_PREFIX/isInScIdFamily/isCanonicalSc1Id/
  编解码）与 `digestHexFromSemanticFingerprint` 均不被 index.ts re-export（本轮 grep
  导出清单亲证）；包 exports 仅 `.`（package.json 亲读）。
- 非 REST endpoint：零 HTTP/REST 代码面（diff 全表见 §5）。

## 2. 「What to build」义务核验

1. **窄 Module interface**（第 1 段）：见 AC1/AC4——全部满足。
2. **schema ID 格式冻结 + 敏感度规则**（第 2 段）：`sc1-` + 52 位小写 RFC 4648
   Base32 无 padding、payload 完整 256-bit 不截断（AC2）；空白/普通注释不改 ID、
   JSDoc/声明顺序改 ID——**指纹算法零改动**（fingerprint.ts 两构造函数体一字未动，
   diff 亲证仅追加 digest 提取件），敏感度全继承 ADR 0007/#72 已冻面并由契约锚定。
3. **完整 envelope 编译强校验 + 旧式兼容**（第 3 段）：
   - `envelope.ts` 注册表 append `ENV_6`（sc1- 格式错误）/ `ENV_7`（digest 与 text
     语义指纹不匹配）两个稳定码——「编号由实施时按错误注册表分配」授权内取未占用
     6/7，落 envelope 层 `VFSL-ENV-E<码>:` 码空间（不触方言层 21 码冻结表，
     errors.ts 零 diff 亲证）；`readOnly=false`（makeEnvelopeIssue 默认，仅 ENV-4
     为 true 的不变量保持，L60-70 亲读）；issue 构造经唯一构造点 + 单行 sanitizer。
   - 格式步落 `envelopeStrictGate` 步骤⑤（方言断言后、parse 前，envelope.ts
     L325-331）；mismatch 步落 `compileSchemaEnvelope` ③b（parse 成功后、evaluate
     前，index.ts L408-424），成功路径步骤⑤复用已算指纹（`earlySemanticFingerprint
     ??`，legacy 路径成本剖面不变）。
   - 旧式 id 零触及：保留族触发器 `/^sc[0-9]+-/i` 族外路径字节不动（负控 N1 绿锚）。

## 3. SA1 设计符合性（D1–D8 + §12 ALLOW/DENY）

| 设计决策 | 落实核验 |
|---|---|
| D1 签名采纳 SA6 H1 原样 | 逐字一致（index.ts L231-273：`DeriveSchemaIdentityOk`/`Result` + 单参函数） |
| D2 parse-only（不跑 evaluate） | 落实；诚实边界（derive ok ⇏ evaluate ok）写入 docstring + T1.5 正交锚 |
| D3 保留族触发器 `/^sc[0-9]+-/i`，族内仅 canonical `sc1-` 合法 | schema-id.ts L27/L40-50 落实；`SC1-`/`sc2-`/`sc01-` 全拒（ENV_6），族外零触及 |
| D4 ENV_6/ENV_7 append、冻结前缀、单条纪律 | envelope.ts L33-34/L213-256 落实 |
| D5 相位序（格式步在方言后 envelope 相位内；mismatch 在 parse 后 evaluate 前） | envelope.ts 步骤⑤ + index.ts ③b 落实；可观察链与设计 §8.5 逐环一致 |
| D6 义务面 = 仅 compileSchemaEnvelope | `envelopeTextGate` 零 sc1- 步（parseSchemaEnvelope/getCompiled 行为不变）；getCompiled 缓存键仍 `sha256Hex(text)`（L334 亲读，id 不参与） |
| D7 模块布局（schema-id.ts 零 import 叶子；digest 提取件在 fingerprint.ts；issue 构造唯一构造点；无环） | 逐文件亲读一致；命名按 SA2 F2 异名化为 `digestHexFromSemanticFingerprint`（授权偏离 D-4，见 §6） |
| D8 编码算法（MSB-first 5-bit、小写、无 `=`、pad 位为零） | 本轮独立复算正确（§1 AC2） |
| §12 ALLOW（4 src + 1 处测试锚更名）/ DENY | diff 全表 = 恰 4 src + 4 测试侧文件 + wiki 档案；errors.ts/package.json/schemasource.ts/docs/domains/其余 packages 全部零 diff（亲证） |

指纹生产者引用面（RT-1a 辖域）：`semanticFingerprintOf`/`envelopeFingerprintOf` 仅
fingerprint.ts（定义）+ index.ts（3 调用点）出现；envelope.ts 只引用新名
`digestHexFromSemanticFingerprint`——单生产者不变式保持（grep 亲证）。

## 4. SA2 约束性交付条件与 SA8 边界条件

| 条件 | 落实 |
|---|---|
| **C1**（F1 MAJOR→约束性）：≥4 条 §8.5 顺序链测试 | **5 条交付**（`sc1-failure-order-chain.test.ts` T1.1–T1.5，213 行亲读）：ENV-6 先于 parse（零 vfsl issue 混入锚）、ENV-7 先于 evaluate（vi.mock 注入 + `not.toHaveBeenCalled()` 双判）、ENV-5/ENV-4 先于 ENV-6（ENV-4 readOnly=true）、匹配 id 正交透传——判别力设计正确（若顺序漂移则长度/kind/调用计数断言即红） |
| **C2**（F2/F4）：生产提取件异名 + 互斥守卫注记；index.ts 头注 D6 免责句 | `digestHexFromSemanticFingerprint`（与参考件 `digestHexFromFingerprint` 互斥异名）；schema-id.ts L20-22 / sc1-base32-ref.ts L20-24 / fingerprint.ts L63-70 三处头注相互指认；index.ts 头注明示「`parseSchemaEnvelope`/`getCompiled` 不校验 sc1- id（D6——保守义务面，扩面须新决策）」（diff L43-46 亲证） |
| **C3**（F3）：Unicode/边缘形态钉位 2–3 行 | T2×2 交付：全角 `sc１-` 族外放行（ok:true + 指纹不变）、`sc01-` 族内 ENV_6、`sc-`（无数字）族外放行 |
| **F6**：SA6 文件 1 fixture 锚 `sc1-fixture-anchor` 更名 | 已执行：L96 `'fixture-anchor'` + L90-94 五行 documenting 注释——与 SA1 §14.1 处方逐字一致（一处字符串、零断言语义变化；id 排除在语义指纹外 ⇒ FP 基准逐字节不变）。执行者偏离见 §6 D-1 |
| SA8 **B1**（id 可校验不外溢） | 校验仅产出放行/拒绝，不参与编译产物；无唯一性依赖（同一 sc1- id 可多 namespace）；doc/复制身份零涉；getCompiled 键纯文本哈希——全部亲证保持 |
| SA8 **B2**（不重开 ADR 0015） | ADR 0015/CONTEXT.md 零 diff；条款全部以兑现方式引用 |
| SA8 **B3**（新码落点） | ENV_6/ENV_7 落 envelope 层注册表；errors.ts 方言层 21 码表与 docs/vfsl/ 零触及（grep 亲证 v1-spec 无 ENV 码记载的前提不变） |

## 5. Scope creep 与回归面核验

- **提交全表**（`git diff a1ca2d7..704398c --name-only` 亲证）：生产 =
  `packages/vfsl/src/{envelope,fingerprint,index,schema-id}.ts`（恰 ALLOW LIST）；
  测试 = 4 个 sc1 文件（SA6 两契约 + 参考件 + SA2 C1/C3 授权新文件）；其余 =
  wiki/raw SA 流水线档案（白名单）。**零越界**：无 REST/apps/namespace-api 面
  （简报明文非目标），无下游 runtime 改动（ADR 0008 L131 不透明透传成立），
  零新运行时依赖（package.json 无 dependencies，未动）。
- **既有行为零回归**：族外 id 路径字节不动；门既有步骤序不动（新步在方言断言后）；
  既有 557 vfsl 测试绿由 SA3/SA4 双跑亲证（588 = 557 + 31 新；根 3163 全过）。
- **红灯链路未弱化**：契约文件 2 与 SA6 版零改动（SA3 日志 §1 + SA4 §2.2 标题逐字
  比对）；文件 1 除锚更名外零变化；断言强度抽验一致（§1 AC3 表）。

## 6. PR 必须披露的未达成/偏离项（均非 AC 级缺口，不阻断 approve）

1. **D-1 过程偏离（SA4 §3 已登记）**：SA1 §14.1/SA2 F6/SA8 N3 路由的「SA6 契约修订轮」
   实际由 SA3 在实现轮合并执行（wiki/raw 无独立 SA6 r2 产物）。内容与处方逐字一致
   （一处字符串 + 注释），且 SA4 已用独立探针把 16 红语义全部经公共入口复证，验收
   价值不受损——但 PR 应如实披露该合并执行事实。
2. **已知边界（设计 D3/SA2 F3 明文裁定，非缺陷）**：Unicode 数字形态（全角 `sc１-`
   等）不在保留族内 → 走旧式路径放行（视觉仿冒面残留）；如需收紧须走新决策。
   T2 钉位测试已锁定当前语义。
3. **D6 义务面边界（设计明文）**：`parseSchemaEnvelope`/`getCompiled` 不校验 sc1- id
   ——义务面 = 完整 envelope 编译（`compileSchemaEnvelope`）；index.ts 头注已明示，
   扩面须新决策。
4. **收官移交项（非本票代码面，总控清单）**：ADR 0015 翻 accepted + 对 ADR 0005 D1
   交叉注记 + 保留族词汇登记（SA8 N1）；SA2 F5 发布说明注记（已发布库的外部消费者
   若持久化 `sc<digits>-` 族标签 id，升级后 compileSchemaEnvelope 行为翻转 ok:true →
   ENV_6）。
5. **MINOR（备案，不阻断）**：`wiki/raw/task_issue-266.md` 与两份 SA6 红跑日志当前为
   untracked（未随 704398c 提交）——流水线档案卫生，移交总控/Host 收尾；契约文件 2
   头注保留「当前整文件红」的历史状态描述（契约文件惯例，非断言弱化）。

## 7. 结论

Issue #266 的 committed 实现（704398c on a1ca2d7）对 Issue 正文 AC1–AC4、SA6 验收
契约、SA1 设计、SA2/SA4 约束与 SA8 边界条件**严格符合**：无遗漏、无部分实现、无
错误实现、无实质 scope creep。§6 五项披露事项全部为已授权偏离或明文移交项，无
CRITICAL/MAJOR 缺口。

**Verdict: approve**。

审查日期：2026-09-08（dispatch `sa-353827a8-32cb-4ff5-98b5-df40bc9750d8`，iteration 0，
phase spec-review）。
