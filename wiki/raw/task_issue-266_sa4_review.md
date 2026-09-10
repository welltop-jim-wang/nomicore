# SA4 静态验尸报告 — issue #266（sc1- 内容寻址 schema ID）

**Date**: 2026-09-08
**Verdict**: pass
**Reviewer dispatch**: sa-8f09d3b8-914e-49db-9421-dfb38426eace（iteration 0，phase implementation-review）
**审查对象**: SA3 实现轮工作树改动（HEAD `a1ca2d7`，branch `mabf/issue-266`，全部改动未提交）

- 输入（全部读过）：任务简报 `task_issue-266.md`（Issue #266 AC1–AC4）；SA1 设计
  `task_issue-266_design.md`（671 行，§12 ALLOW/DENY、§7 D1–D8、§8 编排、§14.1）；SA2 攻击评审
  `task_issue-266_sa2_review.md`（approve + 约束性交付条件 C1/C2/C3 + F6 前置路由）；SA6 验收契约
  `task_issue-266_sa6_contract.md` + 两契约测试文件 + 参考件 + 两份红跑日志；SA8 前置门禁与设计后复审
  （均 `clear`，B1/B2/B3、N1/N2/N3）；SA3 实现日志 `task_issue-266_sa3_impl.log`。
- 独立性声明：未采信 SA3 日志任何"exit 0 / 全绿"断言为前提——typecheck、三契约文件、
  `packages/vfsl/test/` 全目录、根 `pnpm test` 均由本轮独立重跑；另以**完全独立的** RFC 4648
  Base32 编码器 + node:crypto SHA-256 写对抗探针（不 import 生产 codec、不 import SA6 参考件，
  双侧循环论证均不成立），对公共入口 `compileSchemaEnvelope` / `deriveSchemaIdentity` /
  `parseSchemaEnvelope` / `getCompiled` 打了 189 条断言（结果见 §2.3）。
- 无 `task_issue-266_relevant_decisions.md`（首次迭代）；Issue 评论 REST 读取为空，无 Owner 追加要求。

---

## 1. 审核结论（八项）

1. **设计一致性：✅ 一致**（两处 SA2 授权的命名/结构微偏离，见 §3 D-4/D-5，均有明文授权且更优）。
   - `schema-id.ts` 与设计 §8.2 逐项对齐：`SC1_ID_PREFIX`、`/i` 保留族触发器（Unicode 数字不在族内——
     头注明示 + T2 钉位）、完整解码式 canonical 判定（长度 52 / 字母表 / pad 位为零）、
     MSB-first 5-bit 编解码、零 import 叶子。
   - `envelope.ts`：注册表 append `ENV_6`/`ENV_7`（沿 1–5/100 序取未占用号）；`envelopeStrictGate`
     步骤⑤在方言断言后（实测序：形状 ENV-1/2/3 坍缩 → ENV-5 封闭 → ENV-4 方言 → ENV-6 → parse →
     ENV-7 → evaluate → ENV-100，与设计 §8.5 链逐环一致）；`readOnly=false` 不变量保持（仅 ENV-4 true）；
     单条 `{kind:'envelope'}` 纪律；issue 构造经 `makeEnvelopeIssue` 唯一构造点（单行 sanitizer）。
   - `index.ts`：`deriveSchemaIdentity` 与 §8.1 逐字同构（parse-only、E100 镜像、ok 分支恰三键、
     `fn.length===1`）；`compileSchemaEnvelope` ③b 在 parse 成功后 evaluate 前、成功路径 ⑤ 复用指纹
     （`earlySemanticFingerprint ??` 现算——legacy 路径成本剖面不变）；③b 位于顶层 try 内，
     `sc1MismatchIssueOrNull` 不变式破坏 throw 被 ENV-100 收编（设计 §8.3 注）。
   - **D6 义务面结构性成立**（不止是裁决）：`envelopeStrictGate` 全仓唯一消费者是
     `compileSchemaEnvelope`（index.ts L398）；`parseSchemaEnvelope`（L210）/`getCompiled`（L326）走
     `envelopeTextGate`，零 sc1- 步骤。探针实证：`sc1-garbage!!` id 经两入口均 ok（见 §2.3 A13）。
   - 指纹算法零改动：`fingerprint.ts` 两构造函数体一字未动，仅追加 digest 提取件；指纹生产者引用仍
     仅 fingerprint.ts（定义）+ index.ts（3 调用点：derive L261 / ③b L415 / ⑤ 回退 L436）——单生产者
     不变式保持，envelope.ts 只引用新名 `digestHexFromSemanticFingerprint`（非 RT-1a 守卫的两个
     构造函数名）。
   - B1 纪律：id 只影响放行/拒绝，不参与编译产物；`getCompiled` 缓存键仍纯文本哈希；envelope
     fingerprint 覆盖四键（含 id）的既有语义不动。
2. **读写路径一致性：✅ 一致**。sc1- 校验只读 id 与 text 派生 digest，无第二事实源：mismatch 比较
   `digestHexFromCanonicalSc1Id(id)` ⇔ `digestHexFromSemanticFingerprint(semanticFingerprintOf(
   gate.envelope.lang/version, parsed.module))`——方言门后 lang/version 恒 `'vfsl'`/`1`（schemasource.ts
   L94 严格等值断言实读），与 derive 的硬编码 `('vfsl', 1, module)` 产出**同一 canonical 文档**；
   探针实证匹配 id 时 `compileSchemaEnvelope().semanticFingerprint` 与 `deriveSchemaIdentity().
   semanticFingerprint` 逐字节相等。指纹复用点（③b pre-evaluate vs legacy ⑤ post-evaluate）经
   evaluate.ts 无赋值语句核验为纯函数——两时序无分歧。
3. **静默失败：✅ 无**。两条新失败路径均为显式 `ok:false` + 稳定码 + 单条 envelope issue（message
   内嵌违规 id / 双 digest，自解释）；derive 全程不抛错（非 string 输入探针实测落 E100 单条结构化
   issue，`undefined/null/42/{}/[]` 五类均不 throw）。
4. **降级方案：✅ 安全**。族外 id 零触及是规范定义的旧式兼容路径（P5/N1 负控 + 探针 8 形态含
   `sc１-` 全角、`sc1x-`、`sc-`），非降级；两处"不可达 throw"（digest null / 门未保证 canonical）
   均为 loud assert 且被既有崩溃边界收编，注释明示"实现缺陷通道，非静默降级"。
5. **极端攻击：✅ 未发现漏洞**（189 条独立探针全过，含：10k 字符超长 id、id 内嵌 `\n` 注入——
   ENV_6 message 经 sanitizer 单行化无原始行终止符、全零 digest `sc1-a*52` canonical → ENV_7 而非
   ENV_6、末字符 `b`（pad 位非零）→ ENV_6、`q`（pad 位零）→ canonical、幂等重复调用、深冻结 ok 路径、
   E100 崩溃边界、D6 两入口行为不变）。已知边界（设计明示非缺陷）：Unicode 数字 `sc１-` 走旧式
   放行（防仿冒主体 `SC1-`/`sc2-` 已拒；设计 D3 + SA2 F3 裁定，如需收紧走新决策）→ 交 SA7 知悉。
6. **错误处理：✅ 完整**。ENV-6/ENV_7 message 冻结前缀 `VFSL-ENV-E<码>: ` + 正文不冻结（envelope.ts
   既有纪律）；`readOnly=false`；下游透传经 p0.ts L145 `SCHEMA_ENVELOPE_${code}` 动态族零改动流过
   （ADR 0008 L131 不透明透传，实读核实）。
7. **架构评估：✅ 可行**。纯加法包内切片，无绕过架构约束点、无 FIXME、未触独立模块（改动半径 =
   设计 ALLOW LIST 的 4 个 src 文件 + SA2 授权的 3 个测试侧文件）；回滚路径与设计 §14.2 一致。
8. **过度设计：✅ 精简**。净增生产代码 ~209 行（含大量注释）兑现已冻结的设计契约，无"为将来需求"
   的抽象层；`vfslCrashIssue` 共享 helper 是设计 §8.1 注 (b) 明文授权的去重（两处同款 E100 构造）。

**Verdict = pass**（附 3 项非阻断过程偏离登记 §3 + SA7 动态清单 §5；无 REJECT 项）。

---

## 2. 独立验证证据

### 2.1 本轮亲跑（独立进程，setsid nohup）

| 命令 | 结果 | 与 SA3 日志比对 |
|---|---|---|
| `pnpm typecheck`（根，15 tsconfig） | exit 0 | 一致 |
| `vitest run` 三契约文件（含 `--typecheck`） | 3 files / **40 passed**，Type Errors: no errors | 一致（25+7+8） |
| `vitest run packages/vfsl/test/`（全目录） | 31 files / **588 passed** | 一致（557 既有 + 31 新） |
| `pnpm test`（根全仓） | exit 0：**295 files / 3163 tests 全过**，Type Errors: no errors | 一致 |
| SA4 对抗探针（tsx，/tmp，零仓内残留） | **PASS 189 / FAIL 0** | — |

### 2.2 红灯基线链路核对（防"测试被改弱"）

- SA6 红跑日志（`task_issue-266_sa6_red.log`：16 failed | 9 passed；narrow：8 failed）的 **25+8 个
  测试标题与当前工作树两契约文件的用例名逐字一致、次序一致、计数一致**——文件 1 除锚更名
  （L96 `'fixture-anchor'` + L90-94 五行 documenting 注释）外无标题级变化迹象。
- 锚更名语义零变化有数学保证：id 排除在语义指纹外（#72 冻结），FP_A/ID_B/FP_JSDOC 基准逐字节不变
  （文件内 trivia 负控 + 探针独立复核）。
- **契约断言强度复核**：16 红的目标断言全部是 `expect(r.ok).toBe(false)` + 恰 1 条 `kind:'envelope'`
  + `expectEnvelopeCodeShape`（前缀正则 + 纯数字 + 非 {1,2,3,4,5,100} 别名）+ describe 4 的稳定性/
  互异性——与 SA6 契约 §13 的 16 红构成逐条对上；无一处被放宽为 `toMatch` 弱断言。
- **顺序链测试判别力核验**（SA2 C1）：T1.1 若 parse 先行则 TEXT_BAD 会混入 vfsl issue → 长度/kind
  断言即红；T1.2 若 ENV-7 后置则注入的 evaluate 失败被消费 → kind 断言 + `expect(evaluateMock).
  not.toHaveBeenCalled()` 双重判红；T1.5 锁"匹配 id ⇒ evaluate issues 透传、ENV_7 不触发"正交面。
  mock 手法与 compile-schema-envelope.test.ts / docscope-getcompiled.test.ts 既有先例同款（含一次性
  武装 drain 收尾卫生）。**无源码 grep 断言**（§1.7 禁令：三个测试文件零 `readFileSync`）。
- **防循环论证独立闭环**：本轮探针不依赖 SA6 参考件——自有 Base32 编码器 + node:crypto 直接验证
  生产 `deriveSchemaIdentity` 输出（解码(id)==指纹 digest、重编码(digest)==payload、全零/全 FF
  digest 极端钉位）。即使参考件被篡改，生产编码的 RFC 4648 正确性已由本轮独立证明；参考件与生产
  的一致性由契约测试传递成立。

### 2.3 探针攻击矩阵摘要（全过）

格式校验 12+ 形态（前缀大小写 ×3、`sc2-`/`sc10-`/`sc01-`/`sc007-`、空/51/53 字、大写、`=`、内嵌
`\n`、pad 位非零 `b`、10k 超长）→ ENV_6；canonical 全零/`q` 末位 → ENV_7；序链（ENV-5→ENV-6、
ENV-4(readOnly)→ENV-6、ENV-6 先于 parse、ENV-7 mismatch 双 digest message）；族外 8 形态（含
`sc１-` 全角、`sc1x-`、`mysc1-`、`sc-`、中日文旧标签）→ ok:true 且指纹稳定 = derive 值；parse 失败
文本 + canonical id → 原生 vfsl issues；D6（`parseSchemaEnvelope`/`getCompiled` 对 `sc1-garbage!!`
ok）；derive 崩溃边界 5 类非法输入 → E100 单条不抛；敏感性（trivia 稳定 / JSDoc / 声明顺序变）；
幂等；ok 路径深冻结 + id 回显。

### 2.4 触发性自检（§1.3/§1.4 立法）

- vitest include `packages/*/test/**/*.test.ts` 覆盖全部三个 sc1 测试文件（root `pnpm test` 同配置）。
- `.github/workflows/ci.yml` test 作业经 `scripts/ci-test-shard.mjs` **磁盘枚举**分片（注释明示
  "新测试文件自动落入某片"）+ `--passWithNoTests=false` 防假绿；typecheck 作业跑全部 15 tsconfig。
  静态判定：新测试文件均被 CI 接通（SA7 需从 `gh run view --log` 摘录动态证据）。
- BLACKLIST 扫描：diff 无 `package-lock.json`/`yarn.lock`/`TASK.md`/`.bak`/`.DS_Store`。

---

## 3. 过程偏离登记（非阻断，全部有上游授权；无 REJECT 项）

| # | 偏离 | 授权依据 | 本轮核验 | 回流目标 |
|---|---|---|---|---|
| D-1 | 锚更名（`sc1-fixture-anchor`→`fixture-anchor`）由 SA3 执行，而 SA1 §14.1/SA2 F6/SA8 N3 路由给"SA6 契约修订轮"；impl 日志与测试内注释均称"总控派发 SA3 执行"。wiki/raw 无独立 SA6 修订轮产物（无 r2 契约/日志） | 声称的总控路由（无法从产物独立证实） | 内容与处方完全一致：一处字符串 + 5 行注释；25 用例标题/次序/断言与 SA6 红日志逐字一致；FP 基准不变有数学保证 + 探针复核。**残余风险**：文件 1 验收证据落入 SA3 之手而非独立修订轮——本轮已用独立探针把 16 红语义全部经公共入口复证，验收价值不受损 | 总控（若确未派发 SA6 修订轮，收官时在 Issue/PR 注记此合并执行；SA7 动态复跑文件 1 作为独立证据） |
| D-2 | `sc1-base32-ref.ts` 在 SA1 §12 **DENY LIST** 上，但被加了头注互斥 grep 守卫（SA2 F2） | SA2 C2 明文"或在两文件头注加「互斥 grep」守卫注记（**SA3 执行**，一行成本）" | 注释级改动（无代码路径变化）；生产侧同步异名 `digestHexFromSemanticFingerprint`（C2 双管齐下）；防循环论证由本轮独立探针二次闭环 | SA1（设计 §12 DENY 行加一句"SA2 C2 授权的头注守卫除外"的修订注记，或在收官 design delta 登记） |
| D-3 | 新文件 `sc1-failure-order-chain.test.ts` 不在 SA1 §12 ALLOW LIST（设计 §13 称"无需新增"） | SA2 C1（F1 MAJOR→约束性交付条件："实现轮新增 ≥4 条顺序链测试"）+ C3（T2 钉位） | 已交付 7 用例（T1.1–T1.5 + T2×2），判别力核验见 §2.2 | SA1（§12/§13 补 ALLOW 行——收官卫生，不阻塞） |
| D-4 | 生产 digest 提取件命名 `digestHexFromSemanticFingerprint`，设计 §7 D7/§8.3 草案名为 `digestHexFromFingerprint` | SA2 F2/C2（与测试参考件同义导出异名，防 IDE 误导入破坏独立参考件纪律） | 两文件头注相互指认；生产名与参考件名互斥 | 无需动作（记录在案） |
| D-5 | `parseVfslImplementation` 的 E100 块重构为共享 `vfslCrashIssue`（既有代码行为等价改动） | 设计 §8.1 注 (b) 明文授权（"建议抽共享内部 helper 或内联复制，SA3 自由度，语义必须同款"） | message/line/column 逐字同款（diff 比对）；parseVfsl 行为零变化由 557 既有绿 + 探针 E100 断言守护 | 无需动作 |

**Scope 比对汇总**：tracked 改动恰为 ALLOW LIST 的 3 个 src 文件 + 1 新建 `schema-id.ts`；测试侧 3 项
均在上表授权范围内；`wiki/raw/task_*` 为 SA 流水线档案白名单。生产代码零越界。

---

## 4. 数据流路线审计（交 SA7）

| 路线 | SA1 设计路线 | SA4 实际追踪/补充 | SA7 必验跳点 | 预期可观察结果 | 失败判定 |
|---|---|---|---|---|---|
| R1 窄接口派生 | text → parse → 语义指纹 → Base32 → `{semanticFingerprint, schemaId}` / issues | index.ts L255-273：parseVfslImplementation → semanticFingerprintOf('vfsl',1,module) → digest 提取 → sc1IdFromDigestHex；无缓存读写；E100 镜像 | 大文本（深嵌套）下的确定性与耗时；同 text 跨进程重启后 ID 一致（无隐藏状态） | ok 三键 / 原生 issues；ID 逐字节可复现 | ID 漂移、键集多出 module/derived、抛错外泄 |
| R2 envelope 格式校验 | 门步骤⑤（方言后、parse 前） | envelope.ts L325-331；探针 12+ 形态全拒、族外 8 形态全放 | CI 真实运行中的 ENV_6 拒绝日志（若有消费者） | ENV_6 单条、族外零触及 | ENV_6 混入 vfsl issue / 族外被误拒 |
| R3 envelope 语义匹配 | parse 成功后、evaluate 前；指纹复用 | index.ts L408-424；成功路径 ⑤ 复用（L434-436）；evaluate 纯函数（无 module 赋值）故 pre/post 无分歧 | T1.2 mock 已静态证 evaluate 不被调用；SA7 在真实 Registry/P0 链路喂 mismatched id | ENV_7 单条（message 双 digest）→ P0 unavailable | mismatch 被求值失败掩盖 / 匹配 id 被误拒 |
| R4 下游透传 | `SCHEMA_ENVELOPE_6/7` 不透明透传，runtime 零改动 | p0.ts L145 动态拼接（实读）；namespace-runtime / diagnostic-log / registry 均未改（git status 证实） | 在 namespace-runtime P0 真实链路上确认 `SCHEMA_ENVELOPE_6` 摘要出现且 schemaState='unavailable' | 既有 unavailable/fatal 语义不变 | runtime 侧因未知码崩溃或静默 |

无运行时数据流变更的路径（`parseVfsl`/`evaluate`/`validateLogicalSnapshot`/`validatePatch`/
`getCompiled`/SchemaSource）：diff 证据——tracked 改动仅 envelope/fingerprint/index 三文件，其中
fingerprint 仅追加新导出、index 的 parse/getCompiled 段零触及（L204-226/L304-360 无 diff）。

---

## 5. 动态审核重点（交 SA7）

1. **CI 触发证据**：`gh run view --log` 摘录三份 sc1 测试文件在 shard 中的执行记录（磁盘枚举分片
   静态已接通，需动态确认无分片脚本权重表意外）。
2. **R4 真实链路**：经 namespace-runtime P0（或 Registry create）喂 `sc1-` mismatched envelope，
   确认 `SCHEMA_ENVELOPE_6/7` 摘要 + unavailable 语义（本轮仅静态读 p0.ts + 全仓测试绿）。
3. **已知边界知悉项**（设计明示、非缺陷，SA7 无需修复但应记录观测）：`sc１-`（全角数字）族外放行
   的视觉仿冒残留——设计 D3/SA2 F3 裁定"如需收紧走新决策"。
4. **外部消费者翻转面**（SA2 F5 → 收官清单）：`@nomicore/vfsl` 已发布版本的外部使用者若持久化了
   `scN-` 族标签 id，升级后 compileSchemaEnvelope 从 ok:true 翻 ENV_6——发布说明/CHANGELOG 注记
   （总控收官，非本票代码面）。
5. **文件 1 验收独立性**（D-1 残余）：SA7 动态复跑 `sc1-schema-id-envelope-validation.test.ts`
   25/25 绿，作为独立于 SA3 自报日志的证据。

---

## 6. 移交总控收官清单（非本票代码面）

- ADR 0015 翻 accepted + 对 ADR 0005 D1 交叉注记 + N1 保留族词汇登记（`sc<digits>-` 为内容寻址保留
  命名族）——SA8 B1/B2 与前置门禁既定移交项。
- SA2 F5 发布说明注记（见 §5.4）。
- SA1 设计卫生（可选）：§12 ALLOW/DENY 按 §3 D-2/D-3 补授权注记，使设计文档与 SA2 约束性条件
  一致（不阻塞合并）。

**根 `pnpm test` 补记**：本轮独立重跑 exit 0——**295 files / 3163 tests 全过，Type Errors: no errors**
（Duration 552s）。与 SA3 impl 日志 §7（295/3163）逐位一致。
