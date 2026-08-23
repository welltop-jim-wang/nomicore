# SA7 动态验证报告 — task_xml-attr-quote-domain（Issue #94，Bug 修复）

**Date**: 2026-08-23
**验证对象**: commit `a2e6c52`（SA3 实现；基线 `b0512aa`），design R2，SA4 R2 verdict: pass
**环境**: Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / yjs@13.6.32（lockfile 锁定，declared `^13.6.30`）
**Verdict**: **pass**

---

## Step 0 — SA4 verdict 校对

SA4 R2 最终 verdict = **pass**（`task_xml-attr-quote-domain_sa4_review.md` 头部 Verdict（R2 最终）行）。
代码自 R1 后零变化（HEAD 仍为 `a2e6c52`，`git status -- packages/` 干净）。→ 合法进入动态验证。

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2 最终）
操作: 进 Step 1
```

## Step 1 — SA6 红灯测试运行（修复后必须转绿）

命令（独立进程 setsid nohup，立法规范）：`pnpm exec vitest run packages/doc-runtime/test --typecheck.enabled=false`

```text
 ✓ packages/doc-runtime/test/materialize-root-rev2.test.ts (23 tests)
 ✓ packages/doc-runtime/test/materialize-root.test.ts (59 tests)
 ✓ packages/doc-runtime/test/xml-attr-quote-domain.test.ts (26 tests)   ← SA6 新契约主锚
 …（共 13 文件）
 Test Files  13 passed (13)
      Tests  235 passed (235)
EXIT=0
```

R1 登记 12 条红灯（RT-A×2 + RT-C T-1~T-9 + RT-E）**全部转绿**；SA6 登记的 26 用例数逐字吻合。

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（235/235）
操作: 进入 Step 2
```

## Step 2 — SA4「动态审核重点」三条逐条验证

### ① CI vitest 触发证据 → 本地 CI 同款动态证据 ✅；CI run log 待 push（流水线时序，非门禁失败）

**CI 侧事实**（如实区分）：分支 `refactor/-xml-logical-validation--materialization-` **未推送**、无 issue #94 PR
（`gh run list --branch <branch>` 为空、`gh pr list` 无对应条目）→ **CI run 尚不存在**。SA7 按权限边界
不执行 push/建 PR，CI runner log 摘录留待总控 push 后补采（命令见文末「vitest 触发证据」）。

**本地动态等价证据**（与 `.github/workflows/ci.yml` 步骤逐字同款命令，独立进程执行）：

| CI 步骤 | 本地复演命令 | 结果（逐字） |
|---|---|---|
| Typecheck | `pnpm typecheck`（6 包 tsc --noEmit） | `TSC=0` |
| Test（Node 24 侧同款） | `pnpm test`（= `vitest run --typecheck`，含 SA7 补充 11 例后） | `Test Files 67 passed (67)` / `Tests 963 passed (963)` / `Type Errors no errors` / `Errors 0` / **exit 0** |
| Materialize root tests（ci.yml:55 具名门禁） | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` | `Test Files 1 passed (1)` / `Tests 59 passed (59)` / exit 0 |
| （模拟存在性门禁）新契约主锚 | `pnpm exec vitest run packages/doc-runtime/test/xml-attr-quote-domain.test.ts --typecheck --passWithNoTests=false` | `Test Files 1 passed (1)` / `Tests 26 passed (26)` / exit 0 |

（push 前同一命令全量基线：`Test Files 66 passed (66)` / `Tests 952 passed (952)`——与 SA4 独立复跑逐字一致。）

### ② RT-E/RT-5 observer 时序一致性 → ✅（含断言级变体 C 锁定 + 重复/乱序压测）

- **压测**：RT-E/RT-5/S-10 所在 3 文件连跑 5 次 → 每轮 `Test Files 3 passed (3)` / `Tests 60 passed (60)`，5/5 exit 0；
  doc-runtime 全目录 `--sequence.shuffle` 乱序 ×2（其一 `--sequence.seed=94`）→ 每轮 `14 passed (14)` / `246 passed (246)`，
  0 失败——无时序/顺序依赖。
- **变体特异性**（超越 SA6 断言 `/DOCRT-E201/`，锁定「检测面升级」而非「防线未能运行」）：新增 S-10a/S-10b
  断言 throw 消息匹配变体 C 标志（`语义校验偏离`+`疑似 observer 修改已安装子树`），RT-E 与 RT-5（rev2）两场景均绿。
- **逐字消息实证**（`[SA7-DIAG]` 临时脚本，跑后已删）：

```text
DOCRT-E201: ROOT 逻辑快照安装后语义校验偏离：键 "body" 读回 "<p q=\"x&quot;y\" title=\"a&quot;b\">x</p>"
与对照安装读回 "<p title=\"a&quot;b\">x</p>" 不等价（ROOT.body）——疑似 observer 修改已安装子树
（与同一输入经同一管线的未修改安装读回不等）；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态
```

  ——**变体 C** 实锤：⑥ canonical/extract 双侧投影均含 `&quot;`（同域可扫描，AC-⑦）且真实属性集差异被检测
  （`q` 注入），绝不假成功。与 design §4.5 预期逐字吻合。

### ③ yjs ^13.6.30 版本窗口抽样 → ✅（源码级全窗口 + 运行时实测下沿）

- **源码级全窗口**：npm registry 现存 ^13.6.30 窗口恰为 13.6.30/13.6.31/13.6.32（latest=13.6.32=仓内锁定）。
  下载 13.6.30/13.6.31 tarball 与仓内 13.6.32 diff 序列化相关 4 文件
  （`src/types/YXmlElement.js`、`YXmlFragment.js`、`YXmlText.js`、`types/AbstractType.js`）——**全部逐字节相同**
  （`YXmlElement.js:124 key + '="' + attrs[key] + '"'` 零转义形态在窗口内无漂移）。
- **运行时实测**（下沿 13.6.30）：临时将 `packages/doc-runtime/node_modules/yjs` symlink 切至 /tmp 独立安装的
  13.6.30（resolve 验证 `resolved yjs version = 13.6.30`）→ `pnpm exec vitest run packages/doc-runtime/test
  --typecheck.enabled=false` → **`Test Files 14 passed (14)` / `Tests 246 passed (246)` / exit 0**，含 S-3
  「自建序列化器与 yjs 原生 toString 逐字节相同」回归锁（§8 实测 #3 在窗口下沿成立）。跑毕 symlink 已恢复并
  复核（`post-restore yjs = 13.6.32`），临时目录已删。
- 结论：SA1 自我声明（以替换而非依赖 yjs 实现，漂移只影响回归保证）在现窗口内无需额外防御。

## Step 2.5 — SA7 补充测试（新增 `packages/doc-runtime/test/xml-attr-quote-domain-sa7.test.ts`，11 用例）

固化 SA4 一次性脚本攻击角 [B][C][D][E] 与 design §8 实测 #3 为常驻回归锚（deep-import 内部件
`xml-serialize.js`，与 read.ts 直引先例同款纪律；零源码 grep 断言）：

| 用例 | 锁定内容 | 结果 |
|---|---|---|
| S-1 | direct API 写入 `x"y'z`（`"`+`'` 同存——parse 不可构造、外壳切换无解的决定性死角）→ 投影恰 2 引号字符（不变式 B）+ revalidate ok + 存储真值无损 | ✓ |
| S-2 | 嵌套 Y.XmlFragment 子树（SA2 MINOR #2 递归分支）后代 `title='a"b'` 转义生效 | ✓ |
| S-3 | quote-free 复杂树：`xmlFragmentToString(frag) === frag.toString()` 逐字节（§8 实测 #3 回归锁） | ✓ |
| S-4 | valueOf 对象属性值 → `k="42"`（与 yjs ToPrimitive 镜像，防 String() 漂移成 `[object Object]`） | ✓ |
| S-5 | detached fragment → loud throw（拒绝静默空投影） | ✓ |
| S-6 | escapeAttrValue 只转义裸 `"`、不碰 `&`（T-13 反例）、幂等 | ✓ |
| S-7 | materialize→extract→re-materialize→re-extract 投影逐字节不动点 + §5.5 表示漂移精确锁（一代存 `a"b`、二代存字面 `a&quot;b`，语义等价） | ✓ |
| S-8 | `'a"b'` 与 `"a&quot;b"` 两种写法投影收敛同一字节串（canonical 无歧义，§4.4） | ✓ |
| S-9 | `readLogicalValueAtPath` XML 终点与 extract 同一投影（D7 单一语义源） | ✓ |
| S-10a/b | RT-E / RT-5 observer 注入 → **变体 C** 特异性断言（动态重点②断言级锁定） | ✓ |

**过程记录（诚实登记）**：首跑 2 红——S-2 引号计数笔误（div 无属性，恰 2 非我预写的 4）、S-7 预期与 design
§5.5 明文行为冲突（再物化逐字存实体字面量）；另全量 `--typecheck` 抓出 S-2 构造的类型面 cast 缺失
（yjs 声明不接受 fragment 占 element 子位——正是该攻击构造「类型不设防」的本体）。三处均为**测试侧修正，
生产代码零缺陷、零改动**；修正后单文件 `1 passed (1)/11 passed (11)` + 全量 67/963 exit 0 + TSC=0。

## 破坏性/对抗性验证汇总（全部通过，无假成功向量）

- 两种引号同存值（S-1）、嵌套 fragment（S-2）、valueOf 对象（S-4）、detached（S-5）、observer 注入（S-10、
  SA6 RT-E/RT-5）、malformed 8 行零写入双证（SA6 RT-D，本次复跑绿）、实体字面量不动点（S-6/S-7）。
- 零写入/单事务结构未触碰：RT-A `events.count === 1`、RT-D `encodeStateAsUpdate` 逐字节不变（复跑绿）。
- 生产代码自 SA3 commit 后零改动（`git status -- packages/doc-runtime/src/` 干净；唯一新增物 = 本测试文件）。

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法)

**CI Run**: 无——分支未推送、无 PR（`gh run list --branch refactor/-xml-logical-validation--materialization-` 为空）。
SA7 无 push/建 PR 权限（边界约束），CI runner log 动态摘录**顺延至总控 push 后**，非门禁失败（下方本地证据已
证 glob 收集与执行；SA4 §1.4 静态门禁同结论）。push 后补采命令：
`gh run view <run-id> --log --job="test (20)" | grep -E "xml-attr-quote-domain|materialize-root|Test Files"`（node 24 同款）。

| Workspace Package | CI Step Name | 触发结果 | 证据摘录（本地 CI 同款命令，逐字） |
|---|---|---|---|
| **@nomicore/doc-runtime**（design §7 全部 `*.test.ts` 所在唯一 package） | Test（`pnpm test` = `vitest run --typecheck`，glob `packages/*/test/**/*.test.ts`） | ✓ 触发且通过（本地动态） | `Test Files 67 passed (67)`、`Tests 963 passed (963)`、`Type Errors no errors`、exit 0；文件清单含 `✓ packages/doc-runtime/test/xml-attr-quote-domain.test.ts (26 tests)`、`✓ …materialize-root.test.ts (59 tests)`、`✓ …materialize-root-rev2.test.ts (23 tests)`、`✓ …xml-attr-quote-domain-sa7.test.ts (11 tests)` |
| @nomicore/doc-runtime | Materialize root tests（ci.yml:55 具名门禁） | ✓ 触发且通过（本地复演） | `Test Files 1 passed (1)`、`Tests 59 passed (59)`、exit 0 |
| @nomicore/vfsl / vfsl-protocol / vfsl-codegen / persistence / dsh-persistence | Test（同一 `pnpm test` 步骤） | ✓ 触发且通过（本地动态，非本任务改动面） | 上述 67 文件/963 tests 全集中，其余 package 测试文件全绿（`Test Files 67 passed (67)` 总集已含） |
| （存在性门禁模拟） | 无 CI 具名步骤（SA4 §1.4 OBSERVATION 原样保留） | ✓ 本地模拟通过 | `--passWithNoTests=false` 单跑新契约文件：`Tests 26 passed (26)`、exit 0 |

**verdict**: ✅ 本地动态全触发（design 所列全部 `*.test.ts` 均被收集执行且全绿）；CI run log 摘录待 push 后补
（时序顺延，非 `vitest-package-not-triggered`——该分类指「已运行 CI 中 package 未出现」，与本情形成因不同）。

## 结论

| 项 | 结果 |
|---|---|
| Step 0 SA4 verdict 校对 | pass（R2）→ 合法进入 |
| Step 1 SA6 红灯 | 🟢 235/235 全绿（12 红全转绿） |
| SA4 动态重点 ① | ✅ 本地 CI 同款证据齐全；CI log 待 push（如实登记，非门禁失败） |
| SA4 动态重点 ② | ✅ 5 连跑 + 2 乱序 0 抖动；变体 C 逐字实证 + 断言级锁定（S-10a/b） |
| SA4 动态重点 ③ | ✅ 窗口 3 版本源码全同 + 13.6.30 运行时实测 246/246 绿 |
| SA7 补充测试 | 新增 11 用例全绿；测试侧修正 3 处（登记如上），生产代码零缺陷 |
| 全量 | `pnpm test` 67 文件/963 tests exit 0 + `pnpm typecheck` exit 0 |

**Verdict: pass** —— commit `a2e6c52` 在真实运行链路上完整兑现 AC-①~⑧；未发现任何假成功向量、静默失败或
时序不稳定。遗留事项（不阻塞）：CI run log 摘录待总控 push 后按上文命令补采；SA4 §1.4 OBSERVATION
（新契约文件无具名存在性门禁步骤）维持建议后继任务评估。

## 产物清单

- `wiki/raw/task_xml-attr-quote-domain_sa7_report.md`（本报告）
- `packages/doc-runtime/test/xml-attr-quote-domain-sa7.test.ts`（新增补充测试，11 用例，235 行）
- 临时诊断/抽样物（`[SA7-DIAG]` 脚本、/tmp yjs 13.6.30 抽样树、symlink 切换）全部已删除/复原
