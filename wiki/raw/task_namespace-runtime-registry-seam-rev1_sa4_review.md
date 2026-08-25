# SA4 静态验尸报告 — issue #109 Round 2 修订轮（registry-seam 审计强化）

**Date**: 2026-08-25
**Verdict**: **pass**
**被审对象**: SA3 commit `8b8dcfd` 相对 `0a4d460` 的 diff（29 文件：helper 新建 188 行 + 旧 seam 测试 AC5 块删除 + package.json bump + SA6 资产 19 it 测试与 19 文件 fixture 树入库 + 8 个 wiki 档案）
**评审基线**: R1 设计 `…_rev1_design.md`（SA2 R1 verdict: pass）+ 修订简报 RAC1–RAC3 + SA6 红灯契约 `runtime-registry-internal-seam-rev1.test.ts`（19 it）
**ADR 基准**: ADR 0009 L18（internal subpath 仅 Registry 生产代码可消费）+ §公共 Interface（testing 载体属非生产代码）

## 审核结论

1. 设计一致性：✅ 一致（SA3 声明的两点实现层偏差均经实测复核为行为等价；另有 1 项 SA2 指示的加固落实，见下）
2. 读写路径一致性：✅ N/A（只读审计基础设施，零写入面，无数据源分叉可能）
3. 静默失败：✅ 无（helper 全程零 catch/零吞错；全部 IO 错误上抛 → 测试响亮红）
4. 降级方案：✅ 无降级路径（无 existsSync 静默过滤、无 fallback 值；`?? ''` 仅类型收窄，设计 D-C 已论证）
5. 极端攻击：✅ 安全（谓词边界 6/6 实测符合设计；1 项 LOW 残差清单登记缺口，非阻塞，见「发现清单」#3）
6. 错误处理：✅ 完整（显式 roots 路径写错 → readdirSync ENOENT 直接抛；防空扫断言双层兜底在位）
7. 架构评估：✅ 可行（单一实现双输入 + 基准同构结构成立，无绕补丁/无 FIXME）
8. 过度设计：✅ 精简（~100 有效行实现冻结契约；零缓存/零抽象层；O-1 加固恰 1 行）

## 门禁逐项执行记录

### §1.1 文件清单 Scope Creep Guard — PASS

- ALLOW LIST 抽取自设计 §5（95 token 含 `**` glob）；actual = `git diff --name-only 0a4d460 8b8dcfd`（29 文件）。
- 集合比对（精确 token + `**` 目录前缀展开 + skill 5a 白名单豁免）：**creep = 0 文件**。
- BLACKLIST（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）：零命中。
- DENY 面核验：`git diff 0a4d460 8b8dcfd -- packages/namespace-runtime/src/` **空输出**——约束 5「src 零改动」成立；其余存量测试/tsconfig/vitest.config/README/无关包均零触碰。
- 工作树残留：`REPORT.md` 与 `…_rev1_dispatch.md` 为已修改未提交态（均属 ALLOW/白名单，总控随收尾 commit，非 SA3 越界）。

### §1.2 设计偏离审查 — PASS（2 项声明偏差实测等价 + 1 项 SA2 指示加固）

| # | 偏差 | SA4 实测复核 | 判定 |
|---|---|---|---|
| ① | `createSourceFile` 省略第 5 参 scriptKind（设计伪代码传 `ts.getScriptKindFromFileName(fileName)`） | 复跑验证：`getScriptKindFromFileName` 在 typescript@5.9.3 **运行时存在（typeof function）但不在公开 .d.ts**（SA3 前提准确，显式传入反而 type error）；8 扩展名（.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs）缺省推断值与该函数返回值 **8/8 MATCH**；`.jsx` 真实 JSX 语法解析 `parseDiagnostics=0` 且副作用 import 正确检出。代码注释 L79–81 已登记 | ✅ 等价 |
| ② | AC5 块删除边界按实际块尾 **L396**（设计写 L316–395） | `git show 0a4d460` 实测：旧文件恰 396 行，AC5 describe 收尾 `});` 在 **L396**（设计行号差一）；diff hunk `@@ -313,84 +313,3 @@` 删除 L316–396 整块，弱正则零残留（`importRe`/`SKIP_DIRS`/`REPO_ROOT` 在存留文件零命中），余 5 it 逐字不动 | ✅ 等价 |
| ③ | （SA3 未声明、来源 SA2 R1 复审 O-1 建议项）初始 `inSrc` 由扫描根 basename 判定：`walk(root, true, path.basename(root) === 'src')` | 设计伪代码为 `walk(root, true, false)`；SA2 R1「建议 SA3 实现时一行加固」原文落地，代码注释 L144–145 登记。方向单调 fail-closed（显式 `…/src` 根下 test/tests/__tests__ 不再误剪）；当前三类 caller 根（REPO_ROOT / repo / bypass）basename 均非 `src`，行为零漂移 | ✅ 有据加固 |

helper 其余部分（常量集、五形态识别、谓词三规则、walk 规则、`violators` 契约字面）与 R1 设计 §D-A–§D-D 伪代码逐行一致；白名单下界 {testing, test, __tests__, fixtures, mock} + `.test.`/`.spec.` 文件名未被缩减（落地清单 5 ✓）。

### §1.3 E2E spec 触发性 — N/A（PASS）

diff 无 runner `*.spec.ts` 文件。fixture 内 `registry.spec.tsx`/`registry.test.tsx` 是**探针数据**：vitest include 恰 `packages/*/test/**/*.test.ts`（后缀精确匹配，`.tsx` 不命中）——配置实测 + 全量 97 文件绿双重证明不被误收集（fixture 注释亦自证该设计意图）。

### §1.4 vitest 触发性 — PASS

- 新测试 `packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts` 命中根 vitest include `packages/*/test/**/*.test.ts`；CI（`.github/workflows/ci.yml`，单 workflow）`Test` step = `pnpm test` = `vitest run --typecheck`（全 workspace 无 filter）→ Node 20/24 双矩阵腿均触发。
- helper（非 `*.test.ts`）不被当测试收集 ✓；聚合 tsc include `packages/*/test/**/*.ts` 覆盖 helper ✓（见 §1.5-P4）；逐包 `pnpm typecheck` 的 namespace-runtime tsconfig 仅 `src/**` 不含 helper——与 F12 既有 helper 惯例一致。

### §1.5 协议假设审查 — PASS（P1–P7 逐条复核，实测重跑非纸面采信）

| # | 假设 | SA4 复核证据 |
|---|---|---|
| P1 | AST 五形态行为 + scriptKind 推断 | 独立进程复跑：rev1 19/19 + seam 5/5 全绿（`Test Files 2 passed / Tests 24 passed / Type Errors no errors`，exit 0）；scriptKind 8/8 MATCH（§1.2①） |
| P2 | `import ts from 'typescript'` 双通道可用 | vitest 运行绿 + 聚合 tsc exit 0（该 import 在 verbatimModuleSyntax/无 interop 标志链下经先例同款成立） |
| P3 | helper/fixture 不被误收集 | vitest.config include 实测核读；全量 97 文件/1166 tests 绿（无 fixture 混入迹象） |
| P4 | 聚合 tsc 覆盖 helper 且 TS2307 消解 | 自跑 `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` → **exit 0 零输出**（原 2 条 TS2307 消失，零新增） |
| P5 | 真实门禁保持绿 | tsx 直接驱动已落地 helper：`prodFiles=69`（=设计 F6 逐值）、`importers=[]`、`violators=[]` |
| P6 | fixture relPath 与断言常量对齐 | 19/19 绿含全部 `toContain` 路径断言 |
| P7 | 默认门禁 relPath 基准与谓词前缀对齐 | 结构验证：L131 顶层白名单仅 `atScanRoot && filterTopLevel`（仅扫描根层、仅默认模式）+ L167 `path.relative(root, file)` 单一构造行——默认根唯一 = REPO_ROOT，packages/** 文件 relPath 必带顶层段（探针输出形 `packages/…` 与 fixture `repo/` 根同代码行产出，逐字符同构由同构性构造保证）；R0 CRITICAL 基准错配未回退 |

无「应该/通常/预计」类无据推断。

### §1.6 契约改动连锁 — PASS

- 生产契约：**零改动**（src/ 空 diff；§7 声明属实）。
- 被删面：旧 AC5 块内局部函数 `auditInternalSubpathImporters`/`isWhitelistedConsumer` 随块消亡，全仓 grep 零残余引用（仅 helper 定义 + rev1 测试 3 调用点）。
- 新增面 caller 矩阵（helper 全部消费方）：`runtime-registry-internal-seam-rev1.test.ts:92`（beforeAll 同步）、`:219`、`:227`（it 内同步）——三处裸调用无 catch，throw（fixture 根缺失 ENOENT / 文件不可读）→ 测试红，即设计意图（响亮失败）。无 async 时序、无 unhandled rejection 面。

### §1.7 源码 GREP 断言禁令 — PASS（1 命中为启发式误报）

- rev1 测试：**零 `readFileSync`**——19 it 全部锚定 helper 运行时行为（fixture 扫描结果 + 谓词纯函数矩阵），完全合规。
- seam 测试命中 `readFileSync + toContain` 共现：经查 `readFileSync`（L106）读 **package.json 配置元数据**（断言形态为 `toEqual` 键集），`toContain`（L292）断言**运行时结果对象**的序列化文本——二者无数据关联，均为 Round 1 存量断言、本轮 diff 未触碰（仅 import 行收窄）。非源码 grep 伪测试。

### 其余验尸项

- **读写路径**（§2）：只读审计，无分叉面。
- **静默失败**（§3）：`if (found) return` 为纯谓词短路；无任何「操作触发但零可观察效果」路径——审计域全部剪枝（顶层白名单/ALWAYS_SKIP/条件剪枝/SKIP_FILES）均为设计冻结的扫描面决策且逐条注释。
- **降级**（§4）：无降级路径可审。
- **极端攻击**（§5）：谓词边界实测 6/6——`src/Test/case.ts` deny（E2）、`testing-utils`/`mockery` 放行（无子串误伤）、`src/Mock/` deny、`src/a.test/registry.ts` 放行（契约只锁文件名，冻结面）、空串 deny；`auditInternalSubpathImporters([])` → prodFiles=0 由防空扫兜底；不存在根 → readdirSync ENOENT（helper 全文零 catch，静态确认）；符号链接环 = SA2 #6 已裁定的后续轮残差（`statSync` 同旧语义，零漂移）。
- **错误处理**（§6）：见 §1.6/静默失败——完整。
- **架构**（§7）：无退回信号——实现绕过架构约束 0 处、FIXME 0 处、触及模块 = 设计 ALLOW 面。
- **过度设计**（§8）：无——为「将来」引入的抽象为零；变更半径 = 恰 ALLOW 三文件 + SA6 资产入库。

### 版本与资产纪律

- `package.json` 唯一 diff = version 0.1.6 → 0.1.7（硬门禁 #9 ✓）；pnpm-lock.yaml 无该包版本引用（workspace importer 不记自身版本）→ CI `--frozen-lockfile` 不受影响。
- SA6 资产零漂移：rev1 测试 233 行（=SA2 R1 核验值）；fixture 树 19 文件（=F9 磁盘实测）；19 it 断言结构逐 it 核对与 SA6 锚定记录一致（10 探针/控制组+防空扫 + 3 集成 + 4 矩阵 + 2 真实门禁）。
- 逐文件读取 19 个 fixture：8 绕过形态载体 + 3 反误报控制组 + repo 树正例×2/反例×5/负例×1，内容与声称形态逐一真实对应，无空转探针。

## 发现清单（均非阻塞）

| # | 级别 | 发现 | 处置建议 |
|---|---|---|---|
| 1 | 观察 | 偏差②（删除边界 L396 vs 设计 L395）的登记载体是任务简报/总控口径而非代码注释——被删块无存留锚点，客观上无处可注，无行为影响 | 接受现状；总控归档口径已覆盖 |
| 2 | 观察 | 大写扩展名（`FOO.TS`）不入审计面（`path.extname` 大小写敏感）——旧实现同语义继承，非本轮回退，Linux/Mac 仓常规不出现 | 后续轮如需可并入契约演进 |
| 3 | LOW | **别名 require 残差未入设计 §D-B 残差清单**：`const req = require; req('@nomicore/namespace-runtime/internal')` 不被检出（tsx 实测：探针树仅 `normal-require.cjs` 被检出，`alias-require.ts`/`module.require` 均漏）——属性访问 require（残差#1）已声明，别名赋值属同族对抗性规避但清单缺项 | 按 SA2 #7 纪律（残差不得静默当作已覆盖），建议 SA1 后续轮在残差清单补登一条；**不构成本轮 REJECT**（门禁威胁模型明文「架构纪律防误用，非对抗性代码」；RAC1 点名形态全部覆盖+探针在位；冻结五形态契约未越） |
| 4 | 观察 | 聚合 typecheck 面（`tsc -p tsconfig.typecheck.json --noEmit`）不是 CI step（ci.yml 仅逐包 `pnpm typecheck` + vitest `--typecheck`，后者 typecheck.include 只覆盖 `*.test-d.ts`）→ helper 的**类型面**在 CI 不可见（运行时面经 vitest 覆盖）。属仓级既有属性（memory-testkit/tsc-helper 等全部 helper 同船），非本任务缺陷；RAC3 已由总控本地三面亲验 | 交 SA7/总控评估是否后续轮把聚合面加进 CI（超出本轮 ALLOW） |

## 动态审核重点（交 SA7）

1. **vitest 触发证据（§1.4 联动义务）**：`gh run view --log` 摘录 PR CI run 中 `runtime-registry-internal-seam-rev1.test.ts`（19 tests）在 **Node 20 与 Node 24 两条矩阵腿**均实际执行的日志行（本 SA4 已静态证明 include 命中 + 本地复跑 24/24 绿，CI 侧执行证据待动态留痕）。
2. **Node 矩阵交叉面**：`import ts from 'typescript'`（CJS default import）+ `import.meta.url` 在 Node 20/24 vitest 变换链下双绿（Round 1 同款先例已过，本轮 helper 为新增消费点）。
3. **真实门禁前瞻锚（P7 兑现点，切片 5/6）**：首个真实 Registry 生产消费方落地当轮，`真实全仓 violators=[]` it 必须保持绿——绿即 P7 实测兑现，红即基准回退信号（设计 §D-H 前瞻验收锚，本轮静态已验结构成立）。
4. （可选）发现清单 #3 的别名 require 规避在真实评审流程中的暴露面评估（对抗性场景，非本轮义务）。

## 复核命令存档（关键证据均可重现）

```bash
cd /home/wangjian/nomicore-fix-issue-109
git diff --name-only 0a4d460 8b8dcfd | sort                      # 29 文件清单
git diff 0a4d460 8b8dcfd -- packages/namespace-runtime/src/      # 空输出（src 零改动）
pnpm exec vitest run packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts \
  packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts --typecheck
  # → Test Files 2 passed (2) / Tests 24 passed (24) / Type Errors no errors / exit 0
pnpm exec tsc -p tsconfig.typecheck.json --noEmit                # → exit 0（TS2307×2 消解）
pnpm exec tsx -e "…auditInternalSubpathImporters()…"             # → prodFiles=69, importers=[], violators=[]
node -e "…ts.createSourceFile scriptKind 对照…"                   # → 8/8 MATCH；jsx parseDiagnostics=0
```
