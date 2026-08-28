# SA2 攻击评审报告

**Date**: 2026-08-28（R1 reject）；2026-08-28（R2 复审——见文末 R2 节）
**Verdict**: R1：reject（窄范围）→ **R2 终裁：pass**。R1 四项必改 + 三项 LOW 记档全部闭合（逐项核验见 R2 节）；R1 修订过程新引入 1 项 MINOR 文字矛盾（N1，不变量 H 措辞）与 1 项 LOW 措辞（N2），均不阻塞任何 §13 锚点与行为决策，作为随附修订交 SA1 在 SA6 红灯定稿前并入、SA4 复核验收。

**被审对象**: `wiki/raw/task_diagnostic-log-stream-roll-repair_design.md`（R1：round 1 初版 628 行全读；R2：R1 修订版 666 行全读）
**约束基准**: `wiki/raw/task_diagnostic-log-stream-roll-repair_relevant_decisions.md`（ADR 摘录 + 设计后复审追加 10 决策点）＞ ADR-0012（含 2026-08-28 amendment）/ADR-0011/ADR-0008 ＞ #148 冻结契约 ＞ #152/R2 实现。
**审查方法**: 全新视角；对设计引用的全部代码坐标逐一实证（file.ts 799 行 / reader.ts 594 行 / storage-gate.ts / paths.ts / health.ts / testing.ts / memory.ts / 相关测试五件），非仅读设计文本。

---

## 事实核验记录（设计的可证宣称——全部属实，不构成攻击点）

以下宣称经代码实证为真，特此记录以缩小后续 SA 链的复查面：

- 行号引用：`file.ts:309`（硬编码 `'00000001'`）、`file.ts:241`（injectedFrameOffsets per-segment 链）、`file.ts:253-259`（sequence 耗尽）、`file.ts:289-292`（fresh-stat）、`file.ts:684-718`/`736-784`/`780-784`、`reader.ts:104-119`（MANIFEST_KEYS 恰 14 键精确比对）、`reader.ts:230-241`（宽容残尾 parse）、`reader.ts:418`（字典序=数值序注）、`reader.ts:424-425/556-559`（跨段连续性状态机）、`reader.ts:583-593`（全函数兜底）、`storage-gate.ts:78-110`、`paths.ts:42-44/47/59-60`、`health.ts:22-82/108-134`、`testing.ts:94-98/108-118`、`memory.ts:186-197`——全部命中。
- §4.2 默认值与 `file.ts:220-225` 逐项一致（digest/false/1 MiB/4096）。
- §11.3「既有夹具全部以 `\n` 结尾」：`grep -rn "jsonlText" test/` 全部 5 处均带行尾 `\n`——属实。
- §18「包外零 caller」：`git grep "readStreamStrict|createFileDiagnosticLog|streamLayoutPaths"` 排除本包后零命中——属实。
- 链模型语义（攻击点 #1 的技术前提）：`storage-gate.ts:88` `expectedOffset !== null && offset !== expectedOffset → frame-boundary-invalid`——**严格相等链**；首引用 `expected=null` 免 boundary 检查（`storage-gate.ts:75-77`）。设计 §5.4 对该模型的描述准确。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **MEDIUM** | §5/§13/§14：writer 自产「链中 orphan」生命周期缺口 | 见下文 #1 详述 | 见下文 #1 修订要求 |
| 2 | **MINOR** | §4.1/§4.4/§13.18：RotateCause 判定次序自相矛盾 | 14 键被篡改 manifest（指纹不符）在 §4.1 的文序下先命中 `legacy-manifest`（17 键要求列在 INCOMPATIBLE_SET 之前），而 §13.18/§11.3 把 mismatch 测试（其 fixture 恰为 14 键篡改，`file-adapter-mismatch-interference.test.ts:263-281`）迁移锚定为 `stream-incompatible`。§4.4 承诺「同一磁盘状态+同一配置 ⇒ 唯一 cause（SA6 可独立锚定）」，但该状态有两个 cause 候选，SA6 无法落锚 | 钉死优先级：**先跑完整 manifest 门（invalid/incompatible 全部判定），后跑 resume 特有的 17 键要求**——使 analysis cause 与 reader 判定同向（篡改 14 键 → `stream-incompatible`；健康 14 键 → `legacy-manifest`）。§13.18 拆成两个 fixture 锚定（17 键篡改 / 14 键健康），并注明 mismatch 测试 fixture 的归因 |
| 3 | **MINOR** | §5.1：`J`/`B` 只定义「文件缺失 → 空字节串」，未钉死「存在但不可读/非常规文件」 | SegMax 的 `.jsonl` 为目录占位（EISDIR——恰是 D-A1 注入手段）或 EACCES 不可读时，`J` 取值未定义。若实现把「不可读」并入「缺失→空串」，会把 IO 故障降级为合法 BIN-first 崩溃窗口（**伪降级**：reader 对 EISDIR jsonl 记 `invalid-json` corrupt——`reader.ts:461-467` 只豁免 ENOENT——而分析侧却按零行健康续写，不变量 H 被实现撕裂）。`.bin` 不可读（`readBinOrNull` → null）且无引用时 reader 不读不判，尾部行走无 `B` 可走，处置同样未写明 | 修订 §5.1：`J`/`B` 读取区分 **ENOENT（缺失→空，合法崩溃窗口）与其它读失败/EISDIR/非常规文件（不可证明→ verdict `stream-corrupt`，与 reader `invalid-json`/`frame-missing` 同源）**。补一句 bin「不可读且无引用」的处置（建议：跳过修复、续写交运行期 IO 分类兜底，或保守 rotate——二选一写死） |
| 4 | **MINOR** | §8.1：resume 的 `writeCurrent`「失败仅事件」未指名事件 + 陈旧 locator 复合效应未记档 | (a) 事件通道存在（`storage-write-failed{stage:'current'}`，`health.ts:75-81`/`file.ts:720-734`）但设计未指名，SA3/SA6 无锚。(b) 复合场景：rotate 成功但 current.json 写失败 → locator 仍指旧 corrupt stream → 下次重启再次 rotate → 每次重启铸造一个新 generation 直至愈合；若期间 current.json 彻底丢失，③ 扫描 ≥2 候选 → `locator-ambiguous` disabled。机制上确定性成立（valid locator 权威、无可猜），但属应在 §14/README 记档的运维风险 | §8.1 指名复用 `storage-write-failed{stage:'current'}`；§14 风险表补一行「locator 写失败 → 重启期 generation 增殖直至愈合/歧义 disabled」；§13 可选锚：resume 愈合期注入 current.json 写失败 → 事件出现 + 日志能力不受影响 |
| 5 | LOW | §7 观测面 | `stream-exhausted` 复用原形状、无成因判别（sequence vs segment），消费方仅凭事件不可分 | 设计已自知且受冻结形状约束（加字段=改形状），「成因机械可判」成立。仅记档，不强制修订 |
| 6 | LOW | §9.1 前向兼容 | 17 键 manifest 对 #152 旧版 reader = `manifest-invalid`（精确键集比对 `reader.ts:135`）。混版本部署下旧 reader 读新流误判 corrupt | 今日包外零 reader（§18 已证），非本票义务；建议 README 记一句「升级顺序：reader 先于 writer」 |
| 7 | LOW | §13.7 | C1 退化变体（`J` 全文无 `0x0A` → truncate 至 0，首条 record 撕裂即此形）未显式锚定 | §13.7 补一变体锚：`J='{"sequence":"1",...}'`（无 `\n`）→ 截为 0 字节 + `lastCommittedSequence=null` + 续写 sequence 从 1 |

### #1 详述（本次评审唯一 MEDIUM）

**触发条件（全部为本仓库已实证的机制，无需新假设）**：

1. 当前 segment 内已有 ≥1 条 committed sidecar 引用（ref₁ 落 bin `[0..a)`）；
2. 后续某条 sidecar record：BIN append 成功（orphan 落 `[a..b)`）→ JSONL append **definitive** 失败（EISDIR/EACCES/ENOENT——`file.ts:576-579` 分类；D-A1 正是用 jsonl 路径目录占位注入 EISDIR，`file-adapter-sa7-dynamic.test.ts:84-88`）；
3. 故障清除（D-A1 第 ③ 步同款），candidate 复用，下一条 sidecar record fresh-stat 落 orphan 之后（`[b..c)`）并 committed。

**结果**：ref₂.offset=b ≠ ref₁.end=a → `storage-gate.ts:88` 严格相等链断 → reader 判 `frame-boundary-invalid`（corrupt）。R2 设计 §334 已承认此残态由「strict reader 如实报告 gap/corruption」吸收——**这是 #152 遗留的 writer 自伤路径，#153 逐字保留（§11.1）**。

**为什么是 #153 的设计缺口而非仅遗留问题**：

- D-A1 测试用 seq 1 **inline** 前置，恰好落进「orphan 在首引用之前」的健康变体（首引用免检）。把前置换成 sidecar（一字之差）即得 corrupt 变体——设计 §4.3 只备案了健康变体，§13.16 只锚了**手工 fixture** 的链断负例，**没有任何锚定覆盖「writer 自己造出 §13.16 状态」的全生命周期**（注入故障 → 复用续写 → reader corrupt → 重启 reopen → `stream-corrupt` rotate → 旧流永久只读）。
- 后果在 #153 下被放大：重启前该状态只是「读的时候 corrupt」；#153 后**每次重启必然 rotate**——一次瞬时 EISDIR（随后清除）就把整段历史永久封存为只读、后续日志另起 generation。ADR 合规（corrupt → 新 generation 是授权处置），但设计 §14 风险表、README 范围对此**零记载**，制造瞬间零专属信号（仅有一次泛化的 `storage-write-failed{stage:'jsonl'}`，与其后果的因果链无人可推）。
- 设计自身存在**未言明的内部张力**：自然的缓解手段是「definitive-JSONL-失败留下 orphan 后强制滚段隔离」（orphan 变闭段尾部字节=reader-ok 惰性残渣，§5.4 自己论证过），但强制滚段会闭一个**未达标**的段，被 §9.3 闭段核查判 `manifest-roll-target-violation` → 读者视角更糟。即 §9.3 的逆否核查**封死了**这条缓解路径，而设计没有讨论过这一点。

**修订要求（三选一或组合，SA1 须明示取舍理由）**：

- (a) **最低限度（必做）**：§14 风险表 + README 记载该 writer 自产不可修复状态及其 reopen 后果（一次瞬时 jsonl definitive 故障 → 永久 rotate），并说明制造瞬间的既有信号（`storage-write-failed{stage:'jsonl'}`）；
- (b) **§13 补锚（必做）**：新增生命周期锚——D-A1 同款注入但前置为 committed sidecar ref：进程内 `readStreamStrict` 判 `frame-boundary-invalid`；同 root 重启构造 → `stream-generation-rotated{cause:'stream-corrupt'}` + 旧流字节恒等 + 新 generation 续写。此锚同时覆盖 §4.3 特例备案的边界（orphan 位置一变结论翻转）；
- (c) **可选缓解（须连同 §9.3 的张力一起裁决）**：如 SA1 认为值得缓解，须评估「orphan 后强制滚段 + §9.3 豁免闭段尾部含未引用字节的段」或「writer 侧 in-memory lastRefEnd 检测链跳并上健康事件（走 §10 预授权路径）」；若不做，须写明拒绝理由（如：R2 冻结语义不可动 / 收益不抵词表膨胀）。

**不构成 CRITICAL 的理由**：无 ADR 违反（rotate 是 mandated 处置）、无数据丢失（旧流只读可检、新 generation 承接后续）、非本设计新引入（#152 逐字保留）。定级 MEDIUM = 设计完备性缺口（在以 reopen/修复为本票主旨的设计里，reachable 的 writer 自产终态无锚、无档、无讨论）。

---

## 协议假设依据审查

**结论：通过。**

- §17 章节存在，8 行假设逐行给出依据类型与具体引用（源码行号/官方文档/POSIX/ADR 摘录），无「应该/通常/预计」类无据推断，无「实测验证」字样故无贴命令义务。
- 抽查可验证性：`appendFileSync` 惰性创建（`file.ts:559/573` + `file-adapter-layout.test.ts:190` ✅ 实证）、`readdir` throw 收敛先例（`reader.ts:397-409` ✅）、8 位定宽字典序=数值序（`reader.ts:418` 注 ✅）、`P_STREAM_ID` 定长（`schema-patterns.ts:13` ✅）——SA4 可全部重跑定位。
- `truncateSync` 掉电语义（「旧/新长度之一」）引 Node docs + POSIX ftruncate 收缩为元数据更新——分析性论断、标注风险低、与 #152 temp+rename 同级保守；接受，但提请注意该行属不可实测的崩溃语义假设，SA7 不应试图造掉电用例（设计亦未承诺）。
- 两行「中」风险（单进程独占、slot 外构造）均已标为部署纪律/接线票验收项，无掩饰。

## 错误处理链路审查

**静默失败**：新增路径全部有专属事件——locator 歧义（`stream-init-failed{reason:'locator-ambiguous'}`）、七值 rotate cause、逐次 repair、双耗尽、非法 targets loud 配置门（明确拒绝静默钳制 ✅）。唯一含糊点是 resume `writeCurrent` 失败未指名事件（攻击点 #4a，既有通道可复用，属精度而非缺通道）。

**状态闭环**：构造任何失败终态（disabled/failed/rotate/repair-io-failure）均事件化且不外抛；构造级 crash 包络（`file.ts:780-784`）保留；事件总量有界（≤2 repair + 1 rotate/exhausted + 既有初始化事件）——无逐 record 洪泛面。

**降级路径**：disabled/rotate/耗尽均「丢弃 + 上报 + 业务不受影响」，与 ADR-0011 一致；J6 形状完备（disabled 模式 emitter 照常构造）。

**虚假降级识别（三度立法项）**：逐一拷问——`legacy-manifest` rotate：14 键 manifest 是 #152 合法产物，缺冻结 targets 下「无法安全续写」是能力边界的诚实表达，非 bug 掩盖；`locator-ambiguous` disabled：ADR 明文「要求显式处置」；`invalid-roll-targets`：loud 门反钳制。**唯一伪降级风险实现面**在攻击点 #3（把「不可读」当「缺失」处理会把 IO 故障洗成合法崩溃窗口）——已要求钉死，设计文本修订后该风险消除。

## 红线测试思路（SA6 锚定方向，对应攻击点）

1. **#1(b) 生命周期锚（核心红灯）**：小 targets + updateCapture=true：① emit sidecar（ref₁ 落 bin）；② jsonl 路径换目录占位 → emit sidecar（orphan 落 bin，`storage-write-failed{stage:'jsonl',code:'EISDIR'}`）；③ 还原 → emit sidecar（fresh-stat 跳 orphan，committed）；④ 断言 `readStreamStrict` = corrupt 且含 `frame-boundary-invalid`；⑤ 同 root 同配置重启构造 adapter B → 断言 `stream-generation-rotated{cause:'stream-corrupt'}`、B.streamId ≠ A、旧 segments/manifest 字节恒等、B emit 落新 generation。（D-A1 健康变体 §13.17 后半保持为对照组。）
2. **#2 cause 唯一性**：两 fixture 各自重启构造——14 键健康 manifest → `legacy-manifest`；14 键篡改指纹 manifest → 按修订后钉死的次序断言唯一 cause（并与 `readStreamStrict` 对同流的判定同向：ok / incompatible）。15/16 键 → `manifest-invalid`。
3. **#3 不可读非缺失**：SegMax `.jsonl` 换成目录（EISDIR）+ 其余健康 → 重启构造 → `stream-generation-rotated{cause:'stream-corrupt'}`（绝不断言「续写成功/零事件」）；SegMax `.bin` chmod 000（无引用）→ 按钉死处置断言（不修复、不误修复、事件符合所选语义）。
4. **#4 locator 愈合失败**：resume 成功路径注入 current.json 写失败（目录占位 namespaceDir 或只读）→ 断言 `storage-write-failed{stage:'current'}` 出现、resume 续写不受影响；再重启一次 → 仍可经 locator/扫描恢复（不落 ambiguous）。
5. **#7 C1 全截断**：`J` 单行无 `\n`（且内容为合法 JSON 变体）→ 截为 0 字节 + `stream-tail-repaired{repair:'jsonl-incomplete-line', truncatedBytes:|J|}` + 续写首条 sequence='1'。

---

## 结论

**reject（窄范围）**。架构主干（三分支 locator、C1/C2/C3 判定式、17 键冻结、双耗尽 latch、write-slot 构造期纪律、事件只增不改）经攻击验证全部站得住——与 ADR/相关决议无冲突（SA8 设计复审 clear 的结论独立复核一致）。驳回仅针对四项可修文本缺口：**#1 writer 自产链中 orphan 的生命周期无锚无档（MEDIUM）、#2 RotateCause 次序矛盾、#3 不可读≠缺失未钉死（伪降级风险实现面）、#4 locator 愈合失败事件未指名**。SA1 按上文修订要求更新设计（#1 至少落实 (a)+(b)）后提交重审；#5–#7 为记档项，不阻塞。

**pass 不替代 SA4 静态验尸与 SA7 活链路验证**（本报告即使转 pass 后亦然）。

---
---

# R2 复审（2026-08-28）

**被审对象**: R1 修订版设计（628 → 666 行，全文重读）。
**复审范围**（按总控指令）：仅复核 R1 七项的修订闭合质量 + 是否引入新漏洞；R1 已验证的代码事实（见上「事实核验记录」）不重复验证，新增代码核验仅限修订新增宣称。

## R1 七项逐项闭合核验

| R1 项 | 修订落点（设计 R1 版） | 闭合质量核验 | 结论 |
|---|---|---|---|
| #1(a) MEDIUM 链中 orphan 风险记档 | §14 R1 风险行①（L559）+ §4.3 R1 翻转边界段（L174）+ §16 README 义务①（L605） | 触发机制（inline→sidecar 前置翻转、`storage-gate.ts:88`/`file.ts:576-579` 坐标）、后果边界（每次重启必然 rotate、历史永久只读、无数据丢失且逐 record 诊断保留）、制造瞬间唯一信号（`storage-write-failed{stage:'jsonl'}`）与因果不可推性、ADR 合规性论证——与 R1 发现逐点对应，无淡化。§4.3 段落对「#153 行为=诚实检测（AC4 授权处置）」的定性准确 | **闭合** |
| #1(b) 全生命周期红灯锚 | §13.31（L538） | 五步锚（ref₁ commit → EISDIR 注入+事件断言 → 还原+fresh-stat 复用 → 进程内 reader `frame-boundary-invalid` 实证 → 重启 rotate 恰一次+字节恒等+新 generation 承接）与 R1 红灯思路逐条对齐，D-A1 健康变体保留对照组（§13.17 后半） | **闭合** |
| #1(c) 缓解取舍明示 | §14 风险行①「缓解取舍」段 | 双变体均拒绝且理由成文：(i) 强制滚段——除 R1 指出的 §9.3 逆否核查封死外，补强出「ADR 只定义 target-触发滚动」+「豁免尾部含未引用字节的段会让 never-rolling writer 逃检（无标记可区分）→ 拆掉 §4.2 一致可验证性」——经独立推演该逃检论证成立（豁免条件下伪造 orphan 尾即可规避一切闭段核查）；(ii) lastRefEnd 检测——reopen 已有专属信号、词表/状态面成本、根治须动 R2 冻结 candidate 复用语义（D-A1 锚定），记未来切片候选。取舍诚实、理由可查证 | **闭合**（论证质量超出 R1 要求） |
| #2 MINOR RotateCause 次序 | §4.1 步骤 1 a–d 短路序（L138-142）+ §13.18 拆三锚（L520）+ §11.3 对齐（L476-477）+ §4.4 注（L184） | 次序恰为 R1 要求：manifest 门全判（a missing/b invalid/c incompatible）先于 resume 特有 17 键要求（d legacy）。与 reader `manifestGateIssue` 实际判定序逐状态同向核验：14 键篡改指纹 → 双方 `incompatible`（reader：形状 14 键合法过形状门→指纹门败，`reader.ts:134-137/172-181`）；14 键健康 → reader ok / analysis `legacy-manifest`；15/16 键 → 双方 `manifest-invalid`。mismatch fixture（14 键篡改，`mismatch-interference.test.ts:263-281`）归因 `stream-incompatible` 三处（§4.1/§11.3/§13.18(c)）一致 | **闭合** |
| #3 MINOR 不可读≠缺失 | §5.1 R1 三分支表（L199-207）+ 非 SegMax 段二分（L207）+ §13.32 三子锚（L539）+ §4.4 注 | ENOENT（stat 证明）=合法窗口空串；非 ENOENT 读失败/非常规文件 → SegMax jsonl **与 bin 一律保守 rotate(`stream-corrupt`)**。bin 无引用亦选保守分支并给出独立理由（续写需可证字节 + 「跳过修复续写」自产 `frame-missing` 陷阱——`readBinOrNull` 惰性 null 语义，代码实证 `reader.ts:214-222/438`）——比 R1 的「二选一钉死」更强且方向正确；§13.32(c) 对照锚防 ENOENT 豁免被侵蚀。非 SegMax 段（jsonl 不可读→corrupt / bin 有引用必读 / bin 无引用不读、§9.3 以 stat 计）补全 | **闭合**（行为正确；但该修订引入 N1 文字矛盾，见下） |
| #4 MINOR writeCurrent 事件+复合效应 | §8.1 R1 注（L369-370）+ §14 R1 风险行②（L560）+ §13.33（L540） | 指名复用 `storage-write-failed{stage:'current', code:<errno>}`（`file.ts:720-734`/`health.ts:75-81` 既有通道，形状零新增）；复合效应（重启期 generation 增殖直至愈合/恶化 ambiguous disabled）机制、有界性、无数据丢失、运维告警面（stage:'current' 持续出现=未愈合窗口）记档完整；锚 33 含「清除注入后重启仍确定性恢复同一 stream」——对 resume 路径成立（current.json 原值即指向被续写流，愈合写幂等） | **闭合** |
| #5/#6/#7 LOW 记档 | §7 LOW-1 段（L337）/ §9.1 LOW-2 段+§14 行（L406/561）/ §13.7 R1 变体（L507）+ §5.1 C1 判定式内联退化形（L211） | #5：受只增不改约束+两路径处置相同+成因机械可判，观测粒度限制定性准确；#6：零外部 reader（§18）+co-deploy+README「reader 先于 writer」；#7：截 0 字节+`truncatedBytes=\|J\|`+`lastCommittedSequence=null`+续写首条 sequence='1'——三处落位 | **闭合** |

**§15 反馈表**：6 行 SA8 钉死 + SA2 七项（#1 拆 a/b/c 三行）全部登记且落点标注与实际修订位置一致（本表逐一回核）。

**超出 R1 要求的两处预防性加固**（独立核验通过，记录为质量加分）：§3.1 末段（L95）locator「不可读→扫描」与 §5.1 历史载荷「不可读→保守 rotate」的纪律分界——论证成立（current.json 是可重建 locator，三下游结局确定；历史文件须被续写故要求更强）；§9.3 逃检论证（见 #1(c) 行）。

## 新漏洞扫描（R1 修订引入面）

| # | 严重度 | 发现 | 定性与处置要求 |
|---|---|---|---|
| **N1** | **MINOR（随附修订，不阻塞）** | **不变量 H 逆命题被 §5.1 R1 修订证伪（文字级内部矛盾）**：§4.3（L170）断言「verdict=rotate（corrupt/incompatible 类）⇒ `readStreamStrict` 对未修复旧 stream 必非 ok」；但 §5.1 R1 表（L204）钉死「SegMax bin 存在但不可读（如 chmod 000）→ `stream-corrupt` rotate **无论有无引用**」。当该 bin **无任何引用**时 reader 惰性读取永不触达它（`readBinOrNull` 仅在 `checkSidecar` 有 carrier 时调用，`reader.ts:436-438` 实证）→ reader 判 **ok**。即：同一磁盘状态下 analysis rotate(corrupt 类) 而 reader ok——H 逆命题出现可构造反例（§13.32(b) 锚即构造该状态，只是未断言 reader 判定，故测试面不冲突） | 行为无需改（保守 rotate 正确：分析必须向 SegMax bin 续写，其字节须可证；reader 只须读取被引用内容——分析严于 reader 是必要且有意）。**处置：§4.3 H 逆命题补一行豁免**——「例外：§5.1『文件存在但不可读』类 rotate 允许 reader 因惰性读取判 ok（reader 只证被引用内容，分析须证可续写性，后者更强）」；或将 H 逆命题限定为「reader 可见的损坏类」。SA1 于 SA6 红灯定稿前并入，SA4 复核按本行验收；不改变任何 §13 锚点与 SA3 行为决策 |
| **N2** | LOW（随附修订，不阻塞） | §14 R1 风险行①运维指引「在重启前处置 orphan 尾」措辞不可执行：链**中** orphan（已有 ref₂ 跳链）无法手工处置（删字节会移动 ref₂.frameOffset，改写历史被 ADR 禁止）；真正可执行的窗口是 definitive `stage:'jsonl'` 事件后、**任何后续 sidecar append 之前**——此时 orphan 仍是 bin 尾部，重启经 C3 自动截断 → 健康 resume（§5.4 后缀性质的自然推论，设计未点破） | README 义务①的处置建议改为：「见 `storage-write-failed{stage:'jsonl'}` definitive 事件后尽快重启（先于任何后续 sidecar append）——C3 自动修复尾部 orphan 并健康续写；若已有后续 sidecar append 则接受 rotate（合规处置，无数据丢失）」。文字级，SA1 并入 README 条目即可 |

其余新增面（§4.1 步骤 b 对 manifest 自身的 ENOENT/不可读二分、§3.1 预防性澄清、§13.31-33 锚、§16 README 三义务）经扫描未发现其它矛盾；§17/§18 未变动，R1 已验证。

## R2 结论

**pass**。

- R1 reject 的全部载荷（4 必改 + 3 LOW）经逐项核验**全部闭合**，其中 #1(c) 与 #3 的修订质量超出 R1 的最低要求（拒绝理由经独立推演成立、bin 无引用分支给出比「二选一」更强的保守钉死）。
- R1 修订新引入 **N1（MINOR，不变量 H 逆命题的例外未写明）与 N2（LOW，运维指引措辞）**——二者均为文字级、不影响任何 §13 锚点与行为决策，作为随附修订要求 SA1 在 SA6 红灯定稿前并入（N1 同时是 SA4 复核 H 时的验收依据，防 SA4 按现行字面误报「实现违反 H」）。
- 同意放行：后续 SA6 红灯锚定 → SA3 TDD 实现可按本设计（含 N1/N2 并入后）执行。**本 pass 不替代 SA4 静态验尸与 SA7 活链路验证。**

**R2 验证证据**：设计 R1 修订版 666 行全文重读；新增代码核验 2 处——`sed -n '213,222p' src/reader.ts` + `grep -n "readBinOrNull\|bins.get" src/reader.ts`（确认 bin 惰性读取仅在 `checkSidecar` 有引用路径触发，N1 反例成立）；§4.1 新次序与 `reader.ts:134-183` manifestGateIssue 判定序逐状态比对（#2 闭合）。其余代码事实沿用 R1「事实核验记录」。
