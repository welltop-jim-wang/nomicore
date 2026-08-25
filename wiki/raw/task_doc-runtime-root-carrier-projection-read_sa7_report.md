# SA7 动态验证报告 — doc-runtime：schema-independent ROOT 载体投影读取（issue #86）

**Date**: 2026-08-23
**Verifier**: SA7（Dynamic Verifier）
**被验对象**: HEAD commit `4014a8d`（readLogicalValueAtPath 双参载体驱动重写 + F1/R2-F1a 错误通道加固）
**设计基准**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md`（R5 版）
**环境**: worktree `/home/wangjian/nomicore-fix-issue-86`，Node v24.13.0 / pnpm 10.28.2 / yjs 13.6.32 / vitest 3.2.7
**测试执行规范**: 全部测试命令以独立进程运行（`setsid nohup … & disown` + 退出码落盘轮询，无 ACP session 内同步阻塞）；本任务为纯同步纯函数单测，无服务/端口依赖（fuser 预清场仅例行执行，无占用）。

---

## Step 0 — SA4 verdict 校对

`wiki/raw/task_doc-runtime-root-carrier-projection-read_sa4_review.md` 末节「R3 复审（当前生效裁决）」：**Verdict: pass ✅**（被审对象同为 4014a8d，无错位）。

```
[SA7 Step 0 结论]
SA4 verdict: pass（R3）
操作: 进 Step 1
```

---

## Step 1 — SA6 冻结契约测试运行（第二关）

命令（独立进程）：

```bash
pnpm exec vitest run \
  packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts \
  packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts \
  packages/doc-runtime/test/read-logical-value-at-path-guards.test.ts \
  --typecheck --passWithNoTests=false
```

结果（exit 0）：

```
 ✓ packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts (33 tests)
 ✓ packages/doc-runtime/test/read-logical-value-at-path-guards.test.ts (39 tests)
 ✓  TS  packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts (4 tests)
 Test Files  3 passed (3)
      Tests  76 passed (76)
Type Errors  no errors
```

```
[SA7 Step 1 结论]
SA6 红灯测试（实现后应转绿）: 🟢 GREEN（frozen 33+4=37 全绿 + guards 39 全绿）
操作: 进入 Step 2
```

### 冻结契约未收窄（任务简报硬约束）——核验

- **计数吻合**：行为层 `it` 计数 33、类型层 4（`--typecheck` 通道真实收集执行）= **37 例**，与简报声明逐 AC 吻合（AC1=5/AC2=7/AC3=5/AC4=6/AC5=6/AC6=4 + test-d 4）。
- **零改动证据**：`git log --oneline --all -- <两冻结文件>` 单提交 51621ca；`git diff --stat 51621ca HEAD -- <两冻结文件>` 为空——SA6 冻结面自落地后逐字节未动，SA3 后续两轮修复（5c5668f/4014a8d）只加 guards 锚（34→37→39），从未触碰冻结文件。

---

## Step 2 — SA4「SA7 动态验证重点（终版清单）」逐条验证

### 2.1 五向量敌意抛出物探针复跑（清单 #2）——✅ 全部结构化收编

探针（`pnpm exec tsx packages/doc-runtime/sa7-probe.tmp.ts`，公共 API 直接构造，跑后即删；fixture 与 SA4 R1-F1/R2-F1a 节逐字同构）：

```ts
// P1: Proxy trap 抛非 Error 对象且其 toString 再抛
const evil = { toString() { throw new Error('toString boom'); } };
doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw evil; } }));
readLogicalValueAtPath(doc, ['p']);

// P9: Error 子类 message 为 throwing getter
class EvilErr extends Error { get message() { throw new Error('message-getter boom'); } }

// P10: Proxy 包装数组 path（Array.isArray true 过 G0），Symbol.iterator get trap 抛出
const evilPath = new Proxy(['title','x'], { get(t,k,r){ if (k===Symbol.iterator) throw new Error('iterator boom'); return Reflect.get(t,k,r); } });

// NEW1: message 覆写为「带敌意 toString 的对象」的 own 数据属性
class EvilMsgObj extends Error { constructor(){ super('x'); this.message = { toString(){ throw new Error('message-object boom'); } }; } }

// NEW2: message 覆写为 Symbol（ToString(Symbol) 是 TypeError）
class EvilMsgSym extends Error { constructor(){ super('x'); this.message = Symbol('sym'); } }
```

实测输出（2026-08-23，Node 24.13.0，exit 0，零外抛）：

```
P1 hostile-toString:      structured ok=false | {"ok":false,"code":"PATH_NOT_ALLOWED","path":["p"],"message":"DOCRT-E100: 内部错误（意外异常）: unstringifiable"}
P9 hostile-message-getter: structured ok=false | 同上形，message=…unstringifiable
P10 hostile-path-iterator: structured ok=false | {"ok":false,"code":"PATH_NOT_ALLOWED","path":[],"message":"标量不可作为容器"}
NEW1 message-hostile-object: structured ok=false | 同上形，message=…unstringifiable
NEW2 message-symbol:      structured ok=false | 同上形，message=…unstringifiable
```

- P1/P9/NEW1/NEW2：`ok:false` 结构化返回 + `unstringifiable` 回退生效，**无一条 THREW OUT**——SA4 R1-F1/R2-F1a 六条外抛向量（含本轮五向量）全部关死，冻结契约 1「同步、不抛错」在敌意数据面前成立。
- P10：结构化返回 + `path` 回退 `[]`（safeSpreadPath 归一），与 guards P10 锚（`expect(r.path).toEqual([])`）行为一致。
- guards 内五个敌意锚真实存在且被执行：P1（L342）/P9（L356）/P10（L371）/NEW1（L390）/NEW2（L411），39 例全绿（见 Step 1）。

### 2.2 回归面——✅ 正常输入行为逐字节不变

| 向量 | 实测输出 | 与 SA4 记载比对 |
|---|---|---|
| trap 抛 plain `new Error('normal boom')` | `{"ok":false,…,"path":["p"],"message":"DOCRT-E100: 内部错误（意外异常）: normal boom"}` | 与 R3 探针 `R3-NORMAL-ERR` 逐字一致——正常 Error message 原样保留 |
| Y.Array 载体 + 字符串段 `['items','0']` | `message="第 1 段 0 与 Y.Array 载体不符（期望 非负整数）"`、`path=["items","0"]` | 与 R2 记载（同 fixture）**逐字节一致** |
| G0 path 非数组 | `{"ok":false,"path":[],"message":"DOCRT-E100: path 必须是段数组（readonly (string | number)[])"}` | 与 guards G0 前缀锚一致 |

（注：plain array 载体同型失败的 message 为「第 1 段 0 与 plain array 载体不符…」——载体词随实际载体正确分派，非回归。）

### 2.3 INFO 级异型载体（清单 #3，可选）——✅ 无 crash、无泄漏

`Object.create(ymapInstance)` 假载体（plain 对象以 Y.Map 实例为原型 → `instanceof Y.AbstractType` 为 true）嵌 plain 容器：

```
INFO-A fake-carrier read  (['holder','fake']):    structured ok=true | {"ok":true,"value":{"k":1}}
INFO-A fake-carrier drill (['holder','fake','k']): structured ok=true | {"ok":true,"value":1}
LEAK-CHECK fake-carrier: value={"k":1} liveRef=false directInstanceOf=false
```

借道 ymap 分支别名读真数据、投影为深拷贝；递归 `instanceof Y.AbstractType` 扫描确认结果树无 live 引用——与 SA4 静态推演一致，动态确认无 crash。

### 2.4 E16 destroyed doc（清单 #4，可选）——✅ 行为良性

```
E16 destroyed read-root ([]):    structured ok=true | {"ok":true,"value":{"a":1}}
E16 destroyed read-path (['a']): structured ok=true | {"ok":true,"value":1}
```

`doc.destroy()` 后读取不抛、不挂、返回末态本地视图——与 SA2 实测注记一致。

### 2.5 CI 真实 run 证据（清单 #1）+ vitest 触发证据（Step 4 立法）——⚠️ **environment-blocked（非 spec/vitest-not-triggered 类 fail）**

**事实链**（2026-08-23 实测取证）：

1. 本地分支 `fix/issue-86-on-docs-namespace-runtime` 跟踪 `origin/docs/namespace-runtime`，**ahead 3 未推送**——被验三 commit（51621ca/5c5668f/4014a8d）不存在于任何远端引用。
2. `gh pr list --state all --head fix/issue-86-on-docs-namespace-runtime` → `[]`（**无 PR**）；PR #85（head=docs/namespace-runtime）仅含 base commit 74b9cfd，不含被验 commit。
3. `gh run list --limit 8`：最近 run 全部在 issue-87/88 分支与 main/docs/namespace-runtime@74b9cfd——**没有任何 run 覆盖被验 commit**（base 74b9cfd 的 success run 不含本任务三个测试文件，它们在 51621ca 才诞生）。

**定性**：CI 动态触发证据在本阶段**结构上不可得**——被验 commit 未推送、无 PR，故无 run 可摘录。这与「CI 已跑但 package 未被收集」（`vitest-package-not-triggered`，verdict=FAIL）是两类事件：前者是流水线时序（推送/建 PR 归总控，SA7 无权代行），后者才是门禁失败。SA4 §1.4 静态触发性已核（vitest.config include `packages/*/test/**/*.test.ts` 覆盖三个文件；ci.yml node 20/24 矩阵跑 `pnpm typecheck`+`pnpm test`），本地等价复跑见 §3——静态触发面与本轮全量绿共同压低风险，但**动态 CI 摘录仍欠**，不宣称 CI 已绿。

**总控补录路径**（推送 + 建 PR 后，SA7 无权代行）：

```bash
gh run list --branch fix/issue-86-on-docs-namespace-runtime --limit 3   # 拿 run id
gh run view <run-id> --log --job="test (20,)"/--job="test (24,)" 2>&1 \
  | grep -E "read-logical-value-at-path|Running [0-9]+ tests|Test Files.*passed" | head -20
```

期望证据形态：两个 node 版本的 `Test` step log 中出现 `read-logical-value-at-path-{guards,schema-independent}.test.ts`（39+33 collected）与 `read-logical-value-at-path-schema-independent.test-d.ts`（typecheck 通道 4 例）。若届时任一 package 未出现在收集列表 → 才按 `vitest-package-not-triggered` 判 FAIL。

**Node 20/24 双矩阵**：本地仅 Node 24.13.0 可用（无 nvm/node20 安装），24 侧全量绿；Node 20 侧证据随上述 CI 补录（SA4 静态判定：纯同步纯函数、无版本敏感 API 面）。

---

## Step 3 — E2E spec 触发证据

本任务 SA1 设计**无任何 `*.spec.ts`**（SA4 §1.3 门禁自检：N/A）——本节不适用。

---

## 全量门禁独立复跑（本地 CI 等价）

命令（独立进程，exit 码落盘）：`pnpm typecheck && pnpm test`

```
TYPECHECK_EXIT=0
TEST_EXIT=0
 Test Files  61 passed (61)
      Tests  919 passed (919)
Type Errors  no errors
```

与 SA4 R3 独立复跑（919 例）及总控亲验三方一致；CI 的 `Materialize root tests` 专项步所涉 materialize-root.test.ts 亦在其中绿。

---

## 验证证据总表

| # | 验证 | 命令 | 结果 |
|---|---|---|---|
| 1 | SA6 冻结三件套+guards | `pnpm exec vitest run <三文件> --typecheck --passWithNoTests=false`（独立进程） | `76 passed (76)`（33+4+39）、`Type Errors no errors`、exit 0 |
| 2 | 五向量探针 | `pnpm exec tsx sa7-probe.tmp.ts`（fixture 同 SA4） | 全部 `structured ok=false`，零 THREW OUT；P1/P9/NEW1/NEW2 含 `unstringifiable`，P10 path 回退 `[]` |
| 3 | 回归面 | 同探针 R-NORMAL-ERR/R-ECHO/R-G0 + Y.Array 精确复刻 | message/path 回显与 SA4 R2/R3 记载逐字节一致 |
| 4 | INFO 假载体 | 同探针 INFO-A + 递归 instanceof 扫描 | `ok:true` 深拷贝、liveRef=false、无 crash |
| 5 | E16 destroyed doc | 同探针 INFO-B | `ok:true` 良性返回 |
| 6 | 冻结未收窄 | `git log --all` + `git diff 51621ca HEAD` + 计数 | 37 例逐 AC 吻合、冻结文件零改动 |
| 7 | 全量门禁 | `pnpm typecheck && pnpm test`（独立进程） | 61 文件 / 919 例 / no type errors / 双 exit 0 |
| 8 | CI run 摘录 | `gh pr list` / `gh run list --limit 8` / `git ls-remote` | **无 PR、无覆盖被验 commit 的 run（分支未推送）→ environment-blocked** |
| 9 | guards 五锚存在性 | grep guards 文件 | P1/P9/P10/NEW1/NEW2 锚在（L342/L356/L371/L390/L411）且实跑绿 |

## 工作区状态

探针临时文件已删除（`git status` 仅余 wiki 档案与 .mabf/，对 HEAD 的非 wiki diff 为空）——**零生产代码改动、零测试面改动**（五向量锚已由 SA3 在 guards 落地并本轮验证在位，无新增测试缺口）。

---

## Verdict

verdict: pass（本地动态验证全绿；CI 触发证据 = environment-blocked，随分支推送 + 建 PR 后按 §2.5 补录闭环）

- SA4 R3 pass 前提下，SA7 独立动态验证**未发现任何 fail**：五向量零外抛、回归面逐字节一致、INFO 两项良性、冻结 37 例未收窄且全绿、全量门禁 919 例全绿。
- 唯一未闭合项为 **CI 真实 run 摘录（node 20/24 双矩阵 + vitest 收集证据）**：被验 commit 未推送、无 PR，证据结构上不可得——属环境阻塞而非门禁失败，**交总控**：推送分支 + 建 PR 后按 §2.5 命令补录两行 log 摘录即可闭环（静态触发性 + 本地全量绿已将其风险压至最低）。
- SA7 不宣称 CI 已绿；本 verdict 不上调/不下调 SA4 裁决。
