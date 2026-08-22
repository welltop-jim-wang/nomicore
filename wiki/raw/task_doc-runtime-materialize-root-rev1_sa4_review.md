# SA4 静态验尸报告 — materializeRoot 修订轮 rev1（PR #84 owner Review 闭环）

**Date**: 2026-08-22
**Verdict**: pass
**审对象**: commit `638ad94`（分支 fix/issue-74-on-docs-doc-runtime-validation，base origin/docs/doc-runtime-validation@3e22795）
**设计定稿**: `wiki/raw/task_doc-runtime-materialize-root-rev1_design.md`（R2，SA2 R2 pass）
**红线**: W1（⑤ 仅 throw 形态三禁）/ W2（XML 语义等价断言）/ W3（语义归一化比较）

---

## 一、门禁清单逐项结论

### 1.1 文件清单 Scope Creep Guard — ✅ 通过

- 本轮 commit `638ad94` 非 wiki 变更恰 4 文件，与设计 §11 ALLOW LIST **逐项吻合**：
  `packages/doc-runtime/src/materialize.ts`（⑤+JSDoc，唯一生产变更）、
  `packages/doc-runtime/test/materialize-root.test.ts`（SA6 锚定）、
  `.github/workflows/ci.yml`（+6 行门禁步骤，既有步骤零改动）、
  `packages/doc-runtime/package.json`（仅 version 字段）。
- base..HEAD 全量 diff 中额外出现的 `extract.ts`/`resolve.ts`/`index.ts`/`xml-parse.ts`
  **全部只属于初轮 commit `ac0f487`**（`git log --oneline origin/docs..HEAD -- <f>` 逐文件核实），
  且均在初轮基线设计 §10 ALLOW LIST 内（rev1 设计明示复用该基线）——非本轮越界。
- DENY LIST 零触碰：`docs/adr/**`、`packages/vfsl/**`、`src/xml-parse.ts`、`src/carrier.ts`、
  `src/resolve.ts`、`src/extract.ts`、`src/index.ts`、`test/extract-*.test.ts`、
  `packages/persistence/**`、`packages/dsh-persistence/**` 在 638ad94 中均未出现。
- BLACKLIST 零命中（无 package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）。
- wiki/raw/* 全部走白名单豁免；工作树未提交物仅 `REPORT.md`（MABF runtime 残留）与
  dispatch 档案增量，均未进 commit，不构成 creep。

### 1.2 设计偏离审查 — ✅ 一致

- **⑤ verifyInstall**（materialize.ts:94-115）：与设计 §2.2 伪代码逐行一致——位于
  `doc.transact` 正常返回后、`return {ok:true}` 前；size + 逐键身份同一性（`===`）双断言；
  两条 throw 的 message 与设计模板逐字一致（含期望/实际键集诊断）；模块私有函数不导出
  （与 §11「E201 非导出实体」一致）；不在任何 try/catch 内（INV-5 结构保持）。
- **W1 三禁全避**：⑤ 无 ok:false 返回路径、无补偿修复写、message 明示
  「写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态」。
- **JSDoc**（materialize.ts:51-72）：与设计 §2.4 文本逐字对应——⚠️ 前置条件段（R-7 最外层
  事务前提）、成功语义 INV-2+INV-10、检测面边界（顶层 exact / 身份级基准 / 嵌套就地与
  异步不覆盖 / observer 抛错 ⑤ 不运行）。
- **W2**：R3 成功行全部经 `expectXmlSemanticallyEqual`（canonical 解析 + 属性按名排序 +
  引号归一 + self-closing 展开 + 重复属性 last-wins + 文本/不透明 span 逐字），无投影逐字
  断言（U12 的 normalizeXml 为初轮冻结用例，零改动承诺下保留合法）。
- **W3**：R4 用例 A/B 的 XML 叶子均走语义比较器（body 解构后单独比较），未退化为字节相等。
- **CI 步骤**（ci.yml:51-55）：命令与设计 §7 逐字一致；落位「紧随 Domain scaffolds check
  之后、regen-diff 之前」与 §7 明示位置一致（§15 #6 落实）。
- **测试落位与设计 §10 对账**：R1 主组 6 向量 + T-1 + T-4 + 空 entries；R2 十行矩阵
  （±Infinity 与 Y.Array 拆行）；R3 25 行（X-F9 与 C-8 同锚不重复实现——§4.3「落一条即可」
  为规范条款，§10「26 行」计数与实际 25+1 的差异由此解释，非偏离）；R4 用例 A/B/C；
  U13 收紧恰为 §6 表四断言（`toThrow('observer-boom')` + `observeCalls===1` + 保留
  updates===1 与值未回滚）。合计 60 用例（25 it + 3 个 it.each 展开 35），与 vitest
  实测 60 一致。
- **U1–U12 零改动声明属实**：`git diff 529f774 638ad94 -- test` 的删除行仅 3 行，
  全部位于 U13 内（标题行 + 注释行 + 泛化 `toThrow()`），即「U13 仅收紧」。

### 1.3 E2E spec 触发性 — N/A（本轮无 `*.spec.ts` 改动）

### 1.4 vitest 触发性自检 — ✅ 通过（双重触发）

- `materialize-root.test.ts` 属 `@nomicore/doc-runtime`（packages/doc-runtime/package.json）。
- 触发面一：CI test job L38-39 `pnpm test` = 根 `vitest run --typecheck`（全 workspace 收集，
  doc-runtime 在 tsconfig typecheck 清单内）。
- 触发面二：新增专项门禁 L54-55
  `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false`
  ——显式路径 + 存在性门禁，文件被删/改名/未收集必红。
- 无「测试存在但从未被触发」黑洞。

### 1.5 协议假设审查 — ✅ 通过（假设章节齐备 + 独立复跑吻合）

设计 §12 P-R1~P-R13 全部为「设计期实测验证」类且命令/输出内联，无「应该/通常」类无据推断。
SA4 独立重跑两类验证：

1. **门禁命令复跑**（P-R12 + P-R1~P-R11 行为面）：
   `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false`
   → `Test Files 1 passed (1) / Tests 60 passed (60) / Type Errors no errors / exit 0`，
   与设计 §9.5 及 SA6 记录一致。
2. **yjs 行为探针独立复跑**（/tmp/sa4-probe.mjs，对照设计 §9.1）：

   | 探针 | 设计 §9.1 宣称 | SA4 复跑 | 一致 |
   |---|---|---|---|
   | G1 delete one-shot | updates=2 size=1 title=undefined | updates=2 size=1 title=undefined count=7 | ✅ |
   | G4 同值重插 | identityOk=true | identityOk=true | ✅ |
   | G5 组合向量 | sizeOk=true 而 identity 破坏 | sizeOk=true identityOk=false keys=["count","extra"] | ✅ |
   | V6 单事务回调 | observeCalls=1 | calls=1（3 set） | ✅ |
   | N1 嵌套边界（R-7） | atVerify fired=0 updates=0 → afterOuter fired=3 updates=3 keys=["count","extra"] | 完全一致 | ✅ |
   | N2 最外层对照 | sizeOk=true identityOk=false | 完全一致 | ✅ |

   P-R1 成立域与边界域（R-7）、P-R3/P-R5/P-R6/P-R8 全部复现，无 protocol-assumption-mismatch。

### 1.6 契约改动连锁审查 — ✅ 通过（caller 矩阵全绿）

改动：`materializeRoot` 新增 throw 路径（DOCRT-E201，事务正常返回后的偏离检测——
「新增 unconditional throw 在原本 return 的路径上」触发条件命中，审计必做）。

| Caller（SA4 全仓 grep 独立核实） | 位置 | A 直接 try/catch | B await 链 | C 顶层 catch-all | 判定 |
|---|---|---|---|---|---|
| 生产 caller | **0 个**（唯一非测试命中为 `packages/vfsl/src/validate.ts:640` doc comment 文字提及，非调用） | — | — | — | 与设计 §13 清单一致，无遗漏 |
| `materialize-root.test.ts` R1 组 | 5 处 E201 断言 | `expect(() => …).toThrow('DOCRT-E201')` 包裹 | 同步直调 | 无 | ✅ |
| `materialize-root.test.ts` U13/既有 | observer 抛错自 ④ 传播，⑤ 不运行 | toThrow 包裹 | 同步 | 无 | ✅（F10 不受 ⑤ 侵蚀，60/60 绿实证） |

- C 层：全仓 `packages/*/src`、`apps/*/src` 无 `process.on('unhandledRejection'/'uncaughtException')`
  catch-all；函数为同步 throw，无 unhandled rejection 面。
- 未来消费者契约载体 = JSDoc（§2.4），E201 message 自明「fatal 家族、不可重试为干净失败」。

### 1.7 源码 GREP 断言禁令 — ✅ 通过

`materialize-root.test.ts` 无 `readFileSync`、零 `toMatch`/`toContain`。全部断言锚定
可观测运行时输出（materializeRoot/extractYjsSnapshot/validateLogicalSnapshot 返回值、
doc 状态、update 事件计数、observer 回调计数）。

---

## 二、核心验尸清单结论

1. **设计一致性**：✅ 一致（§1.2 逐项；⑤/JSDoc/CI/测试四落位与设计文本级吻合，W1/W2/W3 全守）。
2. **读写路径一致性**：✅ 一致——⑤ 读取的 `ready.rootMap` 即 ④ 写入的同一 `doc.getMap('ROOT')`
   实例（prepare 一次解析、双阶段共用引用），无数据源分叉。
3. **静默失败**：✅ 无——新增路径只有两个出口：不变量成立 → ok:true（INV-10 使该返回有据）；
   偏离 → throw E201（含期望/实际键集诊断）。无「操作触发但外部无可观察效果」路径。
4. **降级方案**：✅ 安全——未引入任何 fallback/补偿；R-1（嵌套就地修改）、R-3（异步修改）、
   R-7（外层事务前提破坏）三个残余面以 JSDoc + 设计 §2.3 明文登记而非纸面掩盖，
   T-1 characterization 将 R-7 边界测试化（未来漂移必走红灯 → 设计评审）。
5. **极端攻击**：✅ 未发现可触达漏洞。攻击面推演与处置：
   - NaN/undefined 混入 entries → `get(k) !== NaN` 恒真会造成 E201 假阳性——**静态不可达**
     （copyJsonDomain 六词拒绝，C-3/C-4/C-7 行为锁定「逻辑校验通过 + 构造失败」支路）；
   - entries 重复键 → size 假阳性——不可达（单 JS object 键迭代，键唯一）；
   - size 断言与 identity 循环之间被 observer 插入修改——不可能（verifyInstall 纯只读，
     yjs 读操作不触发任何回调，无重入窗口）；
   - throw 构造自身抛错（throw-in-throw）——message 仅 JSON.stringify 字符串键集，不可抛；
   - 空 entries → size 0===0 恒过、循环空转 → ok:true（R-6 退化，测试锁定）；
   - observer 抛错 → ⑤ 不运行，F10 原样传播（U13 收紧后仍绿，两族互不侵蚀）。
6. **错误处理**：✅ 完整——E201 两条 throw 均携带期望/实际状态与处置明示；无缺失错误态。
7. **架构评估**：✅ 可行——无绕过架构约束的补丁（无 FIXME、无硬编码绕行、无 `doc._transaction`
   私有 API 耦合——SA2 #1 定谳的文档化前提 + characterization 路线被正确执行）。
8. **过度设计**：✅ 精简——⑤ 净增约 +34 行（双断言 + message）+ JSDoc 约 +30 行，恰为 P1
   契约闭环所需；语义比较器（~160 行）落测试文件（SA6 owned），不进公共面。

## 三、专项核验记录

- **bump 检查**：`packages/doc-runtime/package.json` diff 仅 `-  "version": "0.1.2"` →
  `+  "version": "0.1.3"`（其余字段零改动；529f774 侧确认前值 0.1.2），符合 §11「仅 version
  字段」授权。
- **测试规模**：文件 1016 行、60 用例（25 `it` + 3 `it.each` 展开 35），与简报「1019 行 60 用例」
  同口径（1019 为 SA6 落位时点计数，行数微差非契约项）。
- **门禁命令复跑**：60/60 passed、Type Errors no errors、exit 0（§1.5 已录）。
- **doc-runtime 包全量回归**（独立进程复跑）：`pnpm exec vitest run packages/doc-runtime
  --typecheck --passWithNoTests=false` → **6 文件 108 用例全绿**（materialize-root 60 +
  extract 五文件 48=21+8+9+8+2，与设计「既有 48 用例回归锚」口径一致）、Type Errors no
  errors、exit 0——⑤ 无跨文件 ripple，extract 读侧零影响。

## 四、动态审核重点（交 SA7）

1. **CI 触发证据**（§1.4/§1.5 的动态侧）：从 `gh run view --log` 摘录 test job（node 20/24 双腿）
   中「Materialize root tests」步骤的存在与通过证据（60 tests / no type errors），确认 PR CI
   真实执行该门禁。
2. **全量回归**：CI `pnpm test`（820 用例口径）在两条 node 腿上的绿灯证据（总控本地已验
   820/820，SA7 摘 CI 日志侧即可）。
3. （可选）R-7 前提的可运维性观察：若后续 ADR-0006 create 流程把 materializeRoot 包进外层
   事务，T-1 characterization 即红灯——属设计预警非本轮缺陷，SA7 无需动作，仅登记。

## 五、复验命令（SA4 已执行，可复制重跑）

```bash
WT=/home/wangjian/nomicore-fix-issue-74
# 1. Scope：本轮 commit 文件清单
git -C $WT diff --name-status 529f774 638ad94
# 2. 门禁命令（P-R12 + R1~R4 行为面）
cd $WT && pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false
#    → Tests 60 passed (60) / Type Errors no errors / exit 0
# 3. yjs 协议假设探针（/tmp/sa4-probe.mjs，对照设计 §9.1）→ G1/G4/G5/V6/N1/N2 全一致
# 4. U1–U12 零改动：git -C $WT diff 529f774 638ad94 -- packages/doc-runtime/test/ | grep -E '^-[^-]'
#    → 仅 3 行且全在 U13 内
# 5. caller 审计：grep -rn "materializeRoot" --include='*.ts' . | grep -v node_modules
#    → 生产 caller 0（定义/再导出/测试/doc-comment/ci 注释以外无命中）
```

---

**最终判定：pass** —— RAC-1（⑤+E201+JSDoc+回归测试）、RAC-2（10 行构造失败零写入矩阵）、
RAC-3（表驱动+语义比较器+attr-`"` 定谳锁定）、RAC-4（全量语义比较+嵌套隔离）、RAC-5（U13
收紧）、RAC-6（CI 门禁）六项全部以可复核证据闭环；W1/W2/W3 三红线零违反；scope 零越界；
无静默失败、无降级掩盖、无过度设计。SA7 可进入动态验证。
