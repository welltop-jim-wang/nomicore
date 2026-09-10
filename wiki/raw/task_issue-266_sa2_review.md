# SA2 独立攻击评审报告 — issue #266 设计（SA1）

**Date**: 2026-09-08
**Verdict**: **approve（pass，附 1 项约束性交付条件 + 1 项确认的必要前置路由 + 5 项非阻断建议）**
**requiresConflictRecheck**: **否**（约束性交付条件只增加测试锚，不新增公共面/失败语义/ADR 交叉面；设计本体已经 SA8 设计后复审 `clear`，本评审未发现新的冲突级修订需求）

- 评审对象：`wiki/raw/task_issue-266_design.md`（SA1，dispatch `sa-35ad400b-ff6d-4e0e-a76a-e1f856131355`，iteration 0，671 行）。
- 输入（全部读过）：任务简报 `wiki/raw/task_issue-266.md`（Issue #266，open，Parent PR #158；评论 REST 读取为空，无 Owner 要求）；SA6 契约 `wiki/raw/task_issue-266_sa6_contract.md` + 两契约测试文件与参考件全文 + 两份红跑日志；SA8 前置门禁 `wiki/raw/task_issue-266_conflict_report.md`（`clear`，B1/B2/B3）+ 设计后复审 `wiki/raw/task_issue-266_design_conflict_recheck.md`（`clear`，N1/N2/N3）；源码逐文件实读（证据锚见 §5）。
- 独立性声明：未采信 SA1/SA6/SA8 任何断言为前提。红灯基线独立重跑（§1）；Base32 数学与 RFC 4648 KAT 独立复算（§2）；设计全部事实锚点逐条对源码/ADR/CONTEXT 核对（§5）；保留族触发器的边界形态（Unicode 数字、`sc01-`、`sc-`、锚 id、`mysc1-…`）逐一按正则语义推演并抽验。
- 任务类型：Feature（SA8/SA6 同判）。本评审按「正确性 / API 边界 / 指纹与 Base32 语义 / envelope 顺序与错误码稳定性 / 旧式兼容 / 可测试性」六维全扫 + 竞态/缓存撕裂/极端输入/契约污染附加扫描（§3）。

---

## 1. 实证基线（本评审独立重跑）

```text
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
    packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts \
    packages/vfsl/test/sc1-derive-schema-identity.test.ts
 Test Files  2 failed (2)
      Tests  24 failed | 9 passed (33)     # 与 SA6 §13 完全一致（16+8 红 / 9 绿）
Type Errors  no errors
```

- 全仓 `sc<digits>-` 族 id 回归面独立复扫：`grep -rEn "id['\"]?\s*[:=]\s*['\"\`]sc[0-9]+" packages/ domains/ apps/ tests/`（排除 SA6 两契约文件）**零命中**；`packages/vfsl/src` 零 `sc1-` 实现——设计 §2.2 成立。
- `docs/vfsl/v1-spec.md` grep `ENV` 计数 = 0——B3②「envelope 注册表 source-resident」成立。

## 2. 攻击未遂面（设计经受住攻击的部分，附本评审独立验证方式）

| # | 攻击面 | 攻击手法 | 结果 |
|---|---|---|---|
| S1 | Base32 语义正确性 | 以 node:crypto + 独立手写 MSB-first 5-bit 编码器复算 RFC 4648 §10 全 KAT（`fo`→`mzxq`、`foobar`→`mzxw6ytboi` 等）、全零/全 FF 极端 digest、`sha256('')` 编码（52 字、末字符 `q`） | 与 SA6 参考件/设计 D8 逐字一致；52 字 = 51 全组 + 末组 1 数据位 + 4 pad 位、末字符 ∈ {a,q} 推论复算成立；「同 digest 双 canonical 编码」无第二套摘要语义 |
| S2 | 义务面边界的结构性保证 | 实读 `envelope.ts`：`envelopeStrictGate`（新格式步宿主）仅被 `compileSchemaEnvelope`（index.ts L320）消费；`envelopeTextGate`（`parseSchemaEnvelope` L184 / `getCompiledWith` L251）为独立函数 | 新格式步**结构上不可能**影响 `parseSchemaEnvelope`/`getCompiled`——D6 不只是裁决，是模块图事实 |
| S3 | 门后可达性论证 | 推演：gate 放行后 `id.startsWith('sc1-')` ⇔ 族内 + canonical（任何以 `sc1-` 开头的串必匹配 `/^sc[0-9]+-/i`；族内非 canonical 已在步骤⑤被拒） | §8.4 的 `if (gate.envelope.id.startsWith(SC1_ID_PREFIX))` 与门判定**逻辑等价**，无「族外 id 误入 mismatch 检查」或「族内漏检」窗口 |
| S4 | 相位序扰动 | 实读 `compile-schema-envelope.test.ts` L270 顺序锚（形状 → 方言 → 文本解释）与 `envelopeStrictGate` 步序 | 新步骤⑤在方言断言后：ENV-1/2/3 → ENV-5 → ENV-4 → **ENV-6** → parse → **ENV-7** → evaluate → ENV-100，既有锚断言的组合输入（无 sc 族 id）观察行为零变化 |
| S5 | ENV-4 与 ENV-6 组合 | `SC1-` 族 id + 未知方言：方言步 ④ 在格式步 ⑤ 前 | ENV-4（readOnly=true）先出——与「未知方言全盘只读拒收」纪律一致，既有 ENV-4 测试面零扰动 |
| S6 | 下游透传 | 实读 `namespace-runtime/src/p0.ts` L145（`SCHEMA_ENVELOPE_${code}` 动态拼接，注释明示不校验码域）、`runtime.ts` L337（默认编译 seam） | ENV_6/ENV_7 → `SCHEMA_ENVELOPE_6/7` 零改动流过；ADR 0008 L131 不透明透传成立。`schema-check-cli.ts` grep 零消费，§11 矩阵行成立 |
| S7 | RT-1a 静态守卫辖域 | grep `semanticFingerprintOf\|envelopeFingerprintOf`：仅 fingerprint.ts（定义）+ index.ts（调用） | 设计 D7 的 `digestHexFromFingerprint` 为新名、调用点仍在 index.ts——不触发「第三文件出现即 D2 违反」守卫 |
| S8 | 缓存/状态撕裂、竞态 | 设计不读不写 `compiledCache`（实读 index.ts L366 为 getCompiled 专属）；全部纯同步函数 | 无竞态面、无缓存一致性面、无部分状态（失败即返可幂等重试） |
| S9 | 对抗性输入崩溃 | 门/mismatch 的 regex（`^sc[0-9]+-i`、`^sc1-[a-z2-7]{52}$`）无嵌套量子——线性；id 含行终止符时经 `makeEnvelopeIssue` 既有单行 sanitizer（实读 envelope.ts L71-79）转义 | 无 ReDoS/注入面；E100/ENV-100 崩溃边界语义同款 |
| S10 | 规范基准逐字性 | 实读 ADR 0015 L117-144/L196、CONTEXT.md L70-75、`assertVfslDialect`（schemasource.ts，lang=vfsl ∧ version=1） | 设计对「窄接口形状 / sc1- 冻结格式 / 两稳定码授权 / 旧式兼容」的读法逐字成立；§8.4 mismatch 用 `gate.envelope.lang/version`（方言门后恒 vfsl/1）与 derive 的硬编码常量产出**同一 canonical 文档**，两路径指纹逐字节一致 |
| S11 | SA6 文件 2 未来绿灯可信度 | 抽验 H1–H4 断言与设计 §8.1 实现骨架逐条对位（`fn.length===1`、ok 分支恰三键、失败分支 `['issues','ok']`、issues 与 parseVfsl 深相等、E100 镜像 message/line/column 同款） | 落地 §8.1 后文件 2 的 28 断言全部可满足；无签名/键集/前缀格式偏差 |

## 3. 攻击点清单（按严重度）

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| F1 | **MAJOR（转为约束性交付条件 C1）** | 可测试性：冻结顺序链零测试锚 | 设计 §8.5 把「ENV-6 先于 parse / ENV-7 后于 parse 先于 evaluate / ENV-5、ENV-4 先于 ENV-6」固化为可观察失败优先级链，且包 AGENTS.md 明文「issue ordering + envelope strictness = compatibility behavior」。但 SA6 契约两端各自只锁单态（格式错+合法文本；canonical id+坏文本），**全部组合态无任何现有或已规划测试锚**：SA6 §15.3 明言组合序未锁，设计 §13 又断言测试面「SA3 落地导出后无需新增」。无锚的冻结兼容面 = 未来重构可静默漂移（正是 AGENTS.md 把 ordering 列为兼容行为要防的事） | **不要求 SA1 返工改稿**；作为约束性交付条件并入 SA3 派发：实现轮新增 ≥4 条顺序链测试（红灯思路见 §4-T1） |
| F2 | MINOR | 防循环论证纪律的脆弱性 | 生产 `fingerprint.ts` 将新增内部导出 `digestHexFromFingerprint(fp)`，与测试参考件 `sc1-base32-ref.ts` 已有导出 `digestHexFromFingerprint` **同名同义**。独立性目前靠「不同模块、互不 import」的人为纪律维持；IDE 自动导入/复制粘贴极易让未来测试误 import 生产件，使 SA6 §1 的独立参考件防循环论证静默失效 | 建议生产侧改名（如 `digestHexFromSemanticFingerprint`）或在两文件头注加「互斥 grep」守卫注记（SA3 执行，一行成本） |
| F3 | MINOR | 保留族触发器的 Unicode/边缘形态边界未定义 | `/^sc[0-9]+-/i` 不匹配 Unicode 数字：`sc１-<52字>`（全角 1）、`sc١-`（阿拉伯-印度数字）**走旧式路径放行**（视觉仿冒面残留）；反之 `sc01-`、`sc1--` 在族内必被 ENV_6 拒但不在任何测试矩阵。这些形态规则上「由构造成立」，但无钉位测试 = 未来改 regex 时静默变更 | 设计注记一句「Unicode 数字不在保留族（如需收紧走新决策）」；SA3 测试加 2–3 行钉位（§4-T2）。非阻塞：当前规则与 ADR 0015 防仿冒意图自洽（仿冒主体 `SC1-`/`sc2-` 已拒） |
| F4 | LOW | 公共面文档不对称性 | §8.1 注 (d) 只说 index.ts 头注「补一段」，未明示须包含「`parseSchemaEnvelope`/`getCompiled` **不**校验 sc1-（义务面 = 完整 envelope 编译）」。缺此句，未来读者会假设引擎级全局强制，D6 的保守边界被误读为遗漏 | 头注补记内容明示该免责句（SA3 执行） |
| F5 | LOW | 外部存量数据兼容翻转 | 本仓零 `scN-` id，但 `@nomicore/vfsl` 是已发布库（v0.2.4）：外部消费者持久化信封若已有 `scN-` 族 id（如 `sc1-prod` 作标签），升级后 compileSchemaEnvelope 从 ok:true 翻为 ENV_6 → P0 `unavailable`。设计 §14.2 已评估为低概率且 ADR 0015 已把 `sc` 族登记为保留 | 收官清单加发布说明/CHANGELOG 注记一句（总控）。非阻塞 |
| F6 | **确认（非设计缺陷，必要前置路由）** | SA6 契约文件 1 fixture 锚缺陷 | 独立实读核实：`sc1-schema-id-envelope-validation.test.ts` L91 helper 用 `id:'sc1-fixture-anchor'`，L100-105 **模块作用域**调用取基准——实现落地后该 id 以 `sc1-` 前缀进族且非 canonical → ENV_6 → `expect(r.ok).toBe(true)` 于收集期抛出 → **整文件 25 用例（16 目标红 + 9 负控绿）全部不可用**。SA6 §10.3 的未来绿灯模拟只覆盖文件 2，缺陷因此漏检——SA1 §14.1 的分析准确 | **维持 SA1 §14.1 裁决与 SA8 N3 路由**：Controller 排 SA6 契约修订轮把锚更名（一处字符串，建议 `fixture-anchor`）；本评审附加验证：更名后 FP_*/ID_* 基准逐字节不变（id 排除在语义指纹外，#72 已冻结），9 绿可恢复、16 红可转绿。**此项是文件 1 验收的任务内必要条件**；文件 2 与生产实现不受影响可先行 |

**无 CRITICAL。** 无竞态/死锁（S8）、无缓存撕裂（S8）、无对抗输入崩溃（S9）、无契约污染（S2/S4/S6）、无静默失败或虚假降级（§7）。

## 4. 红灯测试思路（每漏洞对应的具体测试场景）

**T1（对应 F1，约束性交付条件——SA3 实现轮必须交付，先红后绿或直接绿锚）**：

1. **组合序：ENV-6 先于 parse** — `compile({lang:'vfsl',version:1,id:'sc1-NotBase32!!',text:TEXT_BAD})`（格式错 id × 语法错文本）→ 断言 `ok:false`、恰 1 条 `kind:'envelope'` 且 code=格式码、**零 `kind:'vfsl'`**（证 parse 未运行；对照 N3 的镜像端）。
2. **组合序：ENV-7 先于 evaluate** — 用 `vi.mock('./evaluate.js')` 注入 `ok:false`（evaluate 既有唯一失败面是 E100，无法用真实文本构造领域级求值失败——设计 §5.3 已注记 evaluate 经 index.ts 顶部 import 绑定，可 mock）；喂 canonical-but-mismatched id（ID_B + TEXT_A）→ 断言 ENV_7 单条、零 vfsl issue（证 mismatch 早出省去注定失败的求值）。
3. **优先级：ENV-5 先于 ENV-6** — `{lang:'vfsl',version:1,id:'sc1-!!',text:TEXT_A,extra:1}` → 断言 ENV-5 单条（非 ENV_6）。
4. **优先级：ENV-4 先于 ENV-6** — `{lang:'wml',version:1,id:'SC1-bad',text:TEXT_A}` → 断言 ENV-4（`readOnly===true`，非 ENV_6）。
5. **正交：匹配 id + 求值失败** — 同 mock 下喂匹配 canonical id + 任意文本 → 断言 evaluate 的 vfsl issues 透传（ENV_7 不触发）——锁「真实性校验 ≠ 可求值性」的诚实边界（§9）。

**T2（对应 F3，SA3 顺手加钉位行）**：`sc１-<52字>`（全角）→ `ok:true`（族外钉位）；`sc01-<52字>` → ENV_6；`sc-`（无数字）→ `ok:true`。

**T3（对应 F6，SA6 修订轮验收）**：锚更名后该文件 vitest 收集期不再 error、25 用例全部可执行；既有 `mysc1-provisional-id` 负控行保持绿。

**T4（负控守护，已由 SA6 N1/N2 覆盖，本评审确认充分）**：旧式 id 四形态 + trivia 变体 + parse 失败锚——无需重复。

## 5. 协议假设依据审查（2026-06-13 立法）

- **章节存在性**：设计无以「协议假设依据」命名的章节。触发拒绝的条件是「章节缺失 **且** design 含 HTTP/WS 端点假设、端口/进程时序、第三方库行为假设」——本设计为进程内纯函数库切片：零 HTTP/WS 假设、零端口/进程时序、零第三方库行为假设（`package.json` 无 dependencies，实读核实），**不触发 reject 条款**。
- **依据可验证性**：设计全部外部依据可定位、可重跑——本评审逐条复验：源码锚点（envelope.ts L22-39/L82-87/L207-268、index.ts L140-166/L229-283/L313-357/L366、fingerprint.ts L24-58、evaluate.ts 崩溃边界、errors.ts L11-33）行号与内容全部对上；RFC 4648 §3.2/§6/§10 主张以独立编码器复算证实（§2 S1）；ADR 0015 L117-144/L196 与 CONTEXT.md L70-75 逐字比对一致；SA6「与 Python base64.b32encode 跨验」有过程记述，本评审以 node:crypto 独立二次交叉验证。
- **无「应该/通常/预计」类无据推断**：设计 §7 D2 有一处「parse-ok ⇒ evaluate-ok 在当前引擎内除内部缺陷外恒成立」的断言——依据可验证（evaluate.ts 唯一 ok:false 路径为 E100 崩溃边界，实读核实），且设计未将其用作行为承诺（§9 诚实边界明示 derive ok ⇏ evaluate ok，权威门仍是完整编译）。合格。

## 6. 错误处理链路审查（2026-05-07 立法）

| 项 | 结论 |
|---|---|
| 静默失败 | **无**。两条新失败路径均为显式 `ok:false` + 稳定码 + 单条 `kind:'envelope'`；`deriveSchemaIdentity` 全程不抛错（E100 镜像崩溃边界，message/line/column 与 parseVfsl 同款，实读 L153-165 对位） |
| 状态闭环 | N/A——纯函数无中间状态；失败可幂等重试（同输入同结果），调用方修正 id 即转换结果 |
| 降级路径 | 族外 id 零触及是**规范定义的旧式兼容路径**（P5/N1 负控证明），不是降级；无任何「校验失败当成功」的路径 |
| **虚假降级识别** | 重点核查两处「不可达 throw」：`digestHexFromFingerprint` 返回 null（derive 路径）与 `idDigest/expected === null`（mismatch 路径）——均为**前置不变式破坏的 loud assert**（throw → E100/ENV-100 收编，注释明示「实现缺陷通道，非 ENV_6 静默降级」），非伪降级。`SC1-` 族 + 未知方言 → ENV-4 先出是既有只读 loud-fail 语义的优先级，非降级掩盖。**两处判定条件（指纹格式、canonical 保证）在正常流程恒满足，设计选择 loud 而非吞掉——正确处置** |
| 用户可感知性 | ENV_6 message 内嵌违规 id 与期望格式；ENV_7 内嵌双 digest（`id=<idDigest> text=<expected>`）——失败原因自解释，调用方可直接定位修正 |

## 7. 六维评审结论汇总

| 维度 | 结论 |
|---|---|
| 正确性 | 通过。编码数学独立复算成立（S1）；门后可达性等价（S3）；两路径指纹同文档同值（S10）；§8.4 编排对 legacy 路径字节级不变（步骤③b 被 startsWith 守卫跳过，⑤ 复用分支仅 sc1- 路径启用） |
| API 边界 | 通过。新导出仅经 index.ts（包 exports 只有 `.`，实读）；窄接口四不暴露有可观察锚（键集 + `fn.length===1`）；schema-id.ts/digest 提取件不进公共面；D6 义务面边界有模块图事实背书（S2） |
| 指纹/Base32 语义 | 通过。零指纹算法改动；同 digest 双 canonical 编码互证；pad 位为零 → 末字符 ∈ {a,q} 为数学推论非独立条款（SA6 §15.5 同判，本评审复算确认）；敏感度规则全继承 #72 冻结面 |
| envelope 顺序与错误码稳定性 | 语义通过（S4/S5）：ENV_6/ENV_7 append 式注册、`readOnly=false` 不变量保持、单条纪律保持、前缀冻结+正文不冻结与 envelope.ts 既有纪律一致、ENV-4→ENV-6 优先级与方言冻结纪律一致。**测试锚缺口见 F1（约束性交付条件）** |
| 旧式兼容 | 通过。零 sc 族 id 回归面（独立 grep）；族外判定语义推演 + `mysc1-provisional-id` 负控；外部存量翻转风险已诚实登记（F5） |
| 可测试性 | 通过（附条件）。SA6 契约红/绿对照干净且本评审独立重跑一致；文件 2 未来绿灯可信（S11）；文件 1 fixture 缺陷已诚实报告并正确路由（F6）；**顺序链组合态需 SA3 补锚（F1/C1）** |

## 8. 裁决与移交

1. **Verdict: approve（pass）**。设计本体无需返工：核心语义、API 边界、编码、相位序、兼容面全部经受住独立攻击验证；唯一 MAJOR（F1）属测试锚补齐，性质是随 SA3 交付的约束性条件而非架构缺陷（先例：task_237_sa2_review 同款处理）。
2. **约束性交付条件（Controller 派发 SA3 时必须并入 prompt）**：
   - **C1（F1）**：实现轮新增 ≥4 条 §8.5 顺序链测试（T1.1–T1.5 场景，含 evaluate mock 注入手法）；
   - **C2（F2/F4）**：生产 digest 提取件改名或加互斥守卫注记；index.ts 头注补记含 D6 免责句；
   - **C3（F3）**：Unicode/边缘形态钉位测试 2–3 行（T2）。
3. **必要前置路由（F6，与 SA8 N3 一致）**：SA6 契约修订轮更名文件 1 锚 id（一处字符串）——文件 1 验收的任务内必要条件，非 follow-up；文件 2 与生产实现可先行。
4. **收官清单移交（总控）**：F5 发布说明注记；SA8 N1 保留族词汇登记（ADR 0015 翻 accepted 时）。
5. 本 pass 仅放行设计；实现与活链路仍须 SA4/SA7 验证。
