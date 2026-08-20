# SA4 静态验尸报告 — 投影生成器 `@nomicore/vfsl-codegen`（Issue #26 / F2 / R3 返修后终态）

**Date**: 2026-08-20
**Verdict**: **pass**（附 2 项 MINOR 非阻塞残留路由 + 1 项已闭合的越界备注；SA7 可进入动态验证）

- **验尸对象**: commit `008e34c`（首轮实现）+ `9cd33d2`（R3 返修：UnsupportedRootReferenceError 三检查点 + kindOfAlias 同形裁决 + 消息尾同步）+ `a23195e`（.gitignore 卫生，非业务），基点 `0be8c11`
- **评审基准**: 设计 R3 定稿（§3 算法条文 / §5 CLI / §7 接线 / §8 版本 / §12 ALLOW-DENY）+ SA2 R3 pass 路由清单 + SA6 契约记录（简报 R2–R6）
- **评审方法**: 全源码逐行阅读（8 src 文件）+ 配置/CI/lockfile 对账 + 独立边界攻击探针（11 组，tsx 直驱真实 evaluate+generateProjection，/tmp 沙箱）+ CLI 行为验证（10 组 hermetic fixture，全部临时目录，仓内零写入）+ 全量基线复跑（独立后台进程）

---

## 一、审核结论（skill 验尸清单八项）

1. **设计一致性**：✅ 一致。§3 算法六要件逐条对齐（见 §三·6 明细）；SA2 R3 两必修路由项确认落地（① kindOfAlias union→unionKind〔emitter.ts L313-320，旧 `case 'map': case 'union': return 'map'` 硬编码已除〕③ 三错误消息尾「见后续票」→「由总控开后续票登记」〔L39/L57/L76 + 探针 F/P5 stderr 逐字核〕）；R3 路由项 2（规则 1「恒为」措辞纠偏）与 1②（R2-3 对齐声明 erratum）已在设计文档落地。
2. **读写路径一致性**：✅ 一致。单一数据流 `FileSchemaSource.load → assertVfslDialect → parseVfsl → evaluate → generateProjection → 写盘/diff`，无第二数据源；`--check` 全量重生成后逐字节 diff（P7 幂等性 sha256 双跑一致），保鲜判定不依赖哈希（设计 §4 明令）。
3. **静默失败**：✅ 无。全部失败路径 stderr + 非零退出（P1–P10 十组实证：零领域集 2/带 flag 0、missing-directive 2 结构化、dialect-mismatch 2 结构化、idBase 破坏 2 + 规则本体、ref→ROOT 2 + 前缀、孤儿 1、漂移 1、未知参数 2、同 base 冲突 2）。发射器三命名化错误 + desync 守卫 + 环守卫全 loud。
4. **降级方案**：✅ 无虚假降级。唯一「降级样」路径 = 空领域集阶段门（§5.5 显式论证 + CI 带 flag + TODO(#27)，已裁决的阶段态）；`--allow-empty-domains` 的 post-G 掩蔽风险随 G 移除 flag 转为响亮失败（设计闭环）。
5. **极端攻击**：✅ 未发现漏洞（11 组探针 + 10 组 CLI 攻击全部命中预期行为；两处探针失败均为解析层冻结约束〔E100 引号键/保留名〕而非 codegen 缺陷，见 §四）。
6. **错误处理**：✅ 完整（§三·2 专项核对 + 全部 CLI 错误族实测；1 项 MINOR 见残留 R1）。
7. **架构评估**：✅ 可行。纯发射器/接缝消费/具名别名 + 引用位包装/regen-diff 双抓的架构与 ADR 0005 §3/§4 无冲突；无绕过架构约束的补丁痕迹。
8. **过度设计**：✅ 精简。emitter 394 行实现 §3 全部规则；公共导出面恰一项函数 + 一项类型；全仓新增直接依赖恰一个（tsx，esbuild 复用既有树——lockfile 佐证）。

## 二、特别核对项（任务简报六项）

| # | 核对项 | 结论 | 证据 |
|---|---|---|---|
| 1 | §9.3 步骤 4：仅 src 的 program `tsc --noEmit` 通过（@types/node 显式化行为断言，SA2 #5） | ✅ **通过** | 包内探针 tsconfig（include 仅 `src/**`，extends 包 tsconfig）→ `tsc -p` **exit 0 零错误**（无任何 test/vitest 导入入 program，`node:crypto`/`node:fs/promises`/`process` 全解析）。devDeps `@types/node: ^20`（package.json）+ `packages/vfsl-codegen/node_modules/@types/node` 软链（@types+node@20.19.43）实证。⚠️ 方法学注记：探针 tsconfig 若放在 /tmp（包外）会因 TS 的 @types 自动包含随 **tsconfig 所在目录** 解析而假失败——本报告以包内放置的探针为准 |
| 2 | §5.3 步骤 7：cli.ts 顶层 catch 覆盖 SchemaSourceError/ENOTDIR/EACCES + 三命名化错误 → 结构化 stderr + exit 2 | ✅ 通过 | cli.ts L135-159：SchemaSourceError 分支打印 `[code] message（id=… path=…）`（P2 实测 `SchemaSourceError [missing-directive]: …（path=…）`、P3 实测 dialect-mismatch 含 id+path）；通用 Error 分支带 `err.code` 前缀（ENOTDIR/EACCES 冒泡路径）；三命名化错误经通用分支打印消息 + exit 2（P5 实测 stderr 前缀「ROOT 不可被引用」+ exit 2） |
| 3 | §5.2 启动精简：cli.ts 模块级零重活（SA2 #8b） | ✅ 通过 | 模块级仅 import + 类/函数声明，`main()` 在文件底调用（L155-160）；无顶层 await、无大对象构造、无启动期 readdir 预扫；参数解析先行（parseArgs 于 main 首行）。本地全量套件 23.2s（CLI 测试 3 it 含 6 次 spawn 均过）——CI matrix 余量交 SA7 watch-item 1 |
| 4 | Hard Gate 9：新包 0.1.0 起版；既有包 vfsl 0.1.8 / vfsl-protocol 0.1.0 零改动零 bump | ✅ 通过 | `git diff 0be8c11..HEAD -- packages/vfsl/package.json packages/vfsl-protocol/package.json` = **0 行**；codegen `version: 0.1.0`；根 package.json 不 bump（设计 §8：私有聚合根） |
| 5 | §12 ALLOW/DENY 逐项比对 | ✅ 通过（1 项预裁决备注） | 净改动 24 文件全部落在 ALLOW 项或白名单（wiki/raw 任务档案/SA5 报告/pnpm-lock）；DENY 面（packages/vfsl/**、vfsl-protocol/**、domains/**、docs/adr/**、pnpm-workspace.yaml、tsconfig.base.json）**零触碰**（diff 文件清单核）；黑名单（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）零命中；HEAD 树无 TASK.md/.mabf-bg（0a3855b auto-commit 误扫已由 a23195e 净零修复，详见 §五·V1）。`.gitignore`（a23195e）不在 ALLOW LIST——总控预裁决的卫生 commit（任务简报明示「非业务」），改动仅 +4 行 ignore 规则（TASK.md/.mabf-bg/），备注不阻塞 |
| 6 | §3 算法条文 ↔ emitter.ts 逐条对齐 | ✅ 通过 | 见下表 |

### §3 算法对齐明细

| 条文 | 实现落点 | 判定 |
|---|---|---|
| 规则 0（值侧 ref 优先） | emitNode L183-188 首查 `value.kind === 'ref'` → kindOfAlias；emitInner L196-199 值侧 ref 位一律返回别名名（结构侧任意形不属失配） | ✅（R4/A leafRef/metaRef 判别性断言 + 探针 E 别名链 `b: PathSchema<B,'array'>` 亲证） |
| 规则 1（optional 剥壳） | splitOptional L375-377 **条件剥壳**（`kind === 'optional'` 才剥——与 R3 措辞纠偏后的「非 optional 不包装」一致），字段位三处（接口成员/对象字面量成员/Record `<key>` 值）统一剥后递 emitNode；`?` 单次（E 契约 `not.toMatch(/title\?\?/)` 锚定） | ✅ |
| 失配守卫（仅两侧均非 ref） | emitInner 值侧 ref 首查先行 → 结构 ref × 非-ref 值落 switch default → desync throw；未知 kind 同理 | ✅ |
| union 行（同形裁决） | unionKind L347-354：全员同形 → 该 kind；异形 → UnsupportedUnionKindError（消息含成员 kind 清单）。**双路径落地**：inline/段②（emitAlias/emitInner case union）与 **kindOf 引用位**（kindLiteral L317-320 union→unionKind——9cd33d2 返修点，R6 锚点 `u: PathSchema<U,'array'>` 断言在套件内） | ✅ |
| root 行 + §3.2.1 | L106-112：structure 非 root / 内层非封闭 map（含 Record 形 isRecordForm）/ union → UnsupportedRootShapeError，**形态检查先于任何引用走查**（错误次序确定） | ✅（探针 F Record ROOT 消息+尾串逐字；C 块联合 ROOT 断言） |
| §3.4 三检查点（(a) 案） | ① 值侧 ref 目标 ROOT：emitInner L197；② kindOf 链：kindOfAlias L304 首行；③ 段② 走查：经 ① 覆盖（emitAlias→emitInner），联合成员位（第 7 形态）经 ② 覆盖（structureKind→kindOfAlias）——按位点设防，与 SA2 R3-1「形态枚举不全但检查点全覆盖」的判定一致 | ✅（D 块字段位断言 + 探针 K 第 7 形态亲证 `UnsupportedRootReferenceError …引用位 U 抵达 ROOT`） |
| §3.5 引号双规则 / §3.4 具名别名 + 引用位包装 / §3.6 值投影 / §3.7 docs 三槽 / §3.8 判别联合 / §4 头注 | isIdentifier L380-382 + emitObjectMembers 一律引号；段② emitAlias（未引用别名也发射，探针 O）；valuetype.ts 九 kind 全覆盖 + ValueContextCycleError 环守卫；docs.ts + emitter 各位点查表（探针 M2 fieldDocs 接口成员位亲证）；§3.8 无特判（判别字段经 leaf×enum → 精确字面量，天然成立）；header.ts 惰性版本自同步 + 非空 string 守卫（R2-5）+ sha256 全长 + 无时间戳 | ✅ |

## 三、测试质量与触发性

- **§1.7 源码 grep 断言禁令**：✅ 四测试文件零 `readFileSync`；全部 `toMatch/toContain` 作用于 `generateProjection` **运行时输出**（真行为断言）。CLI 测试 spawnSync 真跑 `pnpm generate`。
- **§1.4 vitest 触发性**：✅ 3 个 `*.test.ts` 落根 include `packages/*/test/**/*.test.ts` → CI `Test` 步骤 `pnpm test` 覆盖；`generate-discriminated-narrow.test-d.ts` 落 typecheck include + `tsconfig.typecheck.json`（include `packages/*/test/**`）——空转绿已消除（SA2 V4 注入错误实验 + 本轮 T1 `Type Errors no errors` typecheck 1.59s 真编译）。
- **§1.3 E2E spec**：N/A（本任务无 *.spec.ts）。
- **§1.5 协议假设**：设计 §10 十二行依据齐备且 SA2 V3 复跑；本轮 T1/T2/T3/P 系探针对接线假设（tsx 载体、workspace 链、退出码上浮、参数转发）独立复证。
- **§1.6 契约改动连锁**：N/A——既有包零文件改动（无既有函数签名/throw 契约变化）；根 scripts 纯增量；vitest typecheck 重指的共存安全经 SA2 §7.3 审计 + 本轮 408 全绿复证。
- **基线复跑**（独立后台进程，`.mabf-bg` 外独立日志）：`pnpm test` → **24 文件/408 测试全绿 + Type Errors no errors（exit 0）**；`pnpm typecheck` 三包 exit 0；`pnpm generate --check --allow-empty-domains` exit 0——与总控亲验基线（orch-r2-accept-{test,tsc,gen}.log）逐字一致。

## 四、边界攻击记录（红队探针，全部 /tmp 沙箱 + 临时目录）

| 探针 | 输入 | 结果 | 判定 |
|---|---|---|---|
| G | `type ROOT = Meta`（ROOT 直引 map 别名，测试零覆盖的合法形态） | 接口成员 = Meta 字段，正确发射 | ✅ |
| I | `type ROOT = YMap<{}>`（空 ROOT） | `interface VfslPathMap { }`——合法 TS、诚实（无字段可发射） | ✅（G 票注记见 §六） |
| E | `type B = C; type C = YArray<…>`（别名链 kindOf） | `b: PathSchema<B,'array'>` + `export type B = C;` 链解析正确 | ✅ |
| B | `label: YLeaf<string \| null>`（可空叶） | `PathSchema<string \| null, 'leaf'>` | ✅ |
| F | Record 形 ROOT | `UnsupportedRootShapeError`，消息+尾串与设计模板逐字一致 | ✅ |
| K | `type U = A \| ROOT`（第 7 触发形态：联合成员位） | `UnsupportedRootReferenceError`（检查点②，引用位 U） | ✅ |
| M2 | 字段级 JSDoc | fieldDocs → 接口成员位 TSDoc（测试只锚 aliasDocs，此项为超额覆盖） | ✅ |
| N | 无 sourceText | `sha256:<未提供>` + 双跑逐字节一致（确定性） | ✅ |
| O | 未引用别名 + aliasDocs | 段② `export type Unused = …` + doc 在场 | ✅ |
| J / A | 引号字段名 / 裸 `YXmlFragment` 别名 | **解析层** E100 拒（引号记号/保留名）——冻结方言约束，非 codegen 缺陷；emitter 的 isIdentifier 分支为纵深防御 | ✅（不可达归因） |
| P1–P10 | 零领域集 2/0/2、missing-directive 2、dialect-mismatch 2、idBase 2、ref→ROOT CLI 2、孤儿 1、幂等 sha256 一致、未知参数 2、同 base 冲突 2（`'demo@2' 与 'demo@1' 均映射到 …/generated.ts`）、源漂移 1 | 全部符合 §5.4 退出码表 | ✅ |

## 五、残留与路由（非阻塞）

- **R1（MINOR → SA3 顺手项，不构成 reject）**：`checkFreshness`（cli.ts L87-91）把 generated.ts 读取的**一切**错误吞为 `disk=null` → 按「生成物缺失」报告 exit 1；§5.4 字面将 EACCES 归硬错误 exit 2。可观测语义仍响亮非零（不静默），仅错误类别归并。修复 = catch 内仅 ENOENT 置 null、其余 rethrow（一行）。可与 G 票前任意返修同车，或由 SA7 动态确认实际可达性后定级。
- **R2（备注，SA2 R3-2 已裁决等价）**：optional `?` 的判定源实现取值侧 splitOptional 而非设计钦定的结构侧 MapField.optional——同源 IR `f.optional` 恒同步、无双 `?` 路径、E 契约锚定行为；维持 SA2 裁决，无需动作。
- **V1（越界备注，已闭合）**：`0a3855b` auto-commit 曾将 TASK.md/.mabf-bg/** 扫入分支（违 §12 DENY）；`a23195e` 移出跟踪 + .gitignore 防复发，HEAD 树已零残留（`git ls-tree -r HEAD` 实证）。`.gitignore` 本身不在 ALLOW LIST——总控预裁决的基础设施卫生（任务简报明示「非业务」），本报告备注存档，不计 scope creep。
- **V2（commit 归属脚注）**：9cd33d2 内含 emission 测试 R6 块 +21 行——内容为 SA6 契约增补（dispatch #22，总控 diff 复核通过；断言与 SA2 R3-3 ③ 逐字一致），随 SA3 commit 入库属提交归属脚注，非断言篡改（既有断言零改动经 git diff 核）。

## 六、动态审核重点（交 SA7）

1. **CLI 启动耗时**（SA2 #8b / 设计 §9.4-1）：本地 23.2s 全量（CLI 3 it 舒适通过）；CI matrix node 20 慢 runner 上 `generate-cli-check.test.ts` 每 it 双 spawn 的 5s 超时余量需实测。
2. **ref→ROOT 的 CLI 层断言**（设计 §9.2.2 建议 D CLI 半部；dispatch #21 裁决由 SA7 兜底）：本报告已静态预验（P5：exit 2 + stderr 前缀「ROOT 不可被引用」），SA7 在 CI 环境复证即可闭环。
3. **R1 的 EACCES 类别归并**：CI 上构造不可读 generated.ts 验证（若不可达则降级为文档备注）。
4. **生成物 tsc 干跑**（SA2 R2.6-3 前移 G 风险）：`generateProjection` 对 mapping fixture 的输出写临时文件过 `tsc --noEmit`（约 3 行脚本；本报告探针已间接覆盖同构输出——408 测试的 narrow test-d 参照样板编译级绿，但生成器真输出的编译干跑仍建议 SA7 执行一次）。
5. **多域 TS2717 顶层键合并**（设计 §5.3 G 交接注记）：F2 不可修、不验，G 票 #27 落地多域时定夺。
6. **空 ROOT 形态**（本报告探针 I 新增）：`YMap<{}>` 发射空接口合法但退化——G 票种植领域时的 ROOT 形态选型可加注（非 F2 缺陷）。

## 七、证据清单（可复现命令 → 结果）

| 命令（后台独立进程执行） | 结果 |
|---|---|
| `pnpm test` | exit 0；24 passed (24) / 408 passed (408) / Type Errors no errors |
| `pnpm typecheck` | exit 0（三包） |
| `pnpm generate --check --allow-empty-domains` | exit 0 |
| 包内 `tsconfig.srconly-sa4-probe.json`（include 仅 src）→ `tsc -p` | **exit 0**（SA2 #5 行为断言；探针文件已删，git status 干净） |
| `pnpm exec tsx /tmp/sa4-probe.ts`（11 组边界探针） | 全部符合预期（§四表） |
| CLI 十组 hermetic fixture（`pnpm generate [--check] --domains <mkdtemp>`） | 退出码/消息逐项符合 §5.4（§四 P 行） |
| `git diff 0be8c11..HEAD --name-only` | 24 文件；DENY 面零触碰；黑名单零命中 |
| `git diff 0be8c11..HEAD -- packages/vfsl/package.json packages/vfsl-protocol/package.json` | 0 行（零 bump ✓） |
| `git ls-tree -r HEAD --name-only \| grep -E '^TASK\.md$\|^\.mabf-bg/'` | 空（净零 ✓） |
| 完整日志 | `/tmp/sa4.log`、`/tmp/sa4-results/{t1,t2,t3,t4b,t5,p*}.log` |
