# AC 逐条核对表 — issue #109 Round 2 修订轮（边界审计强化 + 白名单收窄）

核对时间：2026-08-25 22:5x（总控亲核；基线 0a4d460 → HEAD 8b8dcfd，SA3 commit）
驱动反馈：PR #116 review（反馈 1【阻塞】边界审计绕过路径 / 反馈 2【中】白名单过宽 / 非阻塞建议：共享 fixture 提取）

## 修订轮 AC（RAC，简报 §验收条件）

| RAC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| RAC1 | 反馈 1 全部绕过形式（副作用导入 / 再导出 / require() / import=require() / .js/.jsx/.mjs/.cjs 载体）均被边界门禁捕获，每种形式有探针证明 | ✅ | AST 五形态识别（helper `test/helpers/registry-seam-audit.ts`，TS compiler API，零正则）；rev1 19 it 探针逐形态锚定（8 形态 + 3 控制组反误报 + 防空扫）；SA7 注错反演：真实树注入 3 违规文件（副作用导入 .ts / require() .js 载体 / src/testing/ 消费）→ 门禁 it 变红逐名列出 violators，清理后复绿——门禁非纸面绿 | SA6 锚定 / SA1 R1 设计 / SA3 实现 / SA7 反演实证 |
| RAC2 | 只有明确的 NamespaceRegistry 生产模块可消费 internal subpath——白名单排除 testing/test/__tests__/fixtures 等非生产目录，正反例齐备 | ✅ | 谓词三规则（前缀 `packages/namespace-registry/src/` + 段拒绝 {testing,test,__tests__,fixtures,mock} 大小写不敏感 + `.test.`/`.spec.` 文件名拒绝）；rev1 矩阵 4 it + 集成 3 it（正例 2 / 反例 5 / 负例 1）；SA7 反演第三轴（src/testing/ 消费判红） | 同上 |
| RAC3 | 全量 typecheck/test 通过；Node 20/24 CI 继续通过 | ✅（本地）/⏳（CI 移交 Host） | 总控亲验（后台独立进程 .mabf-bg/verify-r2-*）：`pnpm test` 97 文件/1166 用例全绿 Type Errors no errors（rev1 19/19 + seam 5/5）；`pnpm typecheck` 7 包 exit 0；聚合 `tsc -p tsconfig.typecheck.json --noEmit` exit 0（SA6 期 2 条 TS2307 消解）；SA7 Run D 四附加门禁全绿（persistence-contract 7 / domains-scaffold 2 / materialize-root 59 / generate --check）。CI 腿：SA3 commit 8b8dcfd 未 push，发布与 Node 20/24 CI 属 Host 职责（SA7 报告附 push 后双腿复核清单）；SA7 前瞻风险核对：PR 基线前移（+packages/clock）与本 diff 零文件交集 | 本地验证闭环，CI 移交 Host |

## Round 1 AC 回归确认（本轮不得破坏）

| AC# | 描述 | 状态 | 证据 |
|---|---|---|---|
| AC1 | internal 仅导出一个 Registry 专用生产 factory | ✅ | seam.test.ts AC1/AC6 三 it 保持绿（5/5）；exports 键集恰 `['.', './internal']` 未动 |
| AC2 | factory 只接收 handle + dirty notifier | ✅ | type-guard.test-d.ts + 注入哨兵 it 全绿（存量未动） |
| AC3 | 主 entry 零生产构造器/DocHandle/Y.Doc/内部态导出 | ✅ | exports-audit 4/4 绿；src/ 零改动（SA4 §1.1 空 diff 实证） |
| AC4 | factory 产出 Runtime 保持全部现有语义 | ✅ | seam AC4 全链 it + sa7-dynamic 4 探针绿（存量未动） |
| AC5 | 模块边界测试证明仅 Registry 生产代码可消费 internal subpath | ✅（本轮强化主体） | 旧弱正则块删除，rev1 19 it + helper 承载严格超集断言（含 relPath 基准维度，SA2 R1 核验）；真实门禁 violators=[] 保持绿 + 注错反演红绿双向敏感 |
| AC6 | testing seam 不进入主 entry | ✅ | exports 键集不变；internal entry 零泄漏断言绿（存量） |
| AC7 | 全量 typecheck/test 与 Node 20/24 CI | ✅（本地）/⏳（CI 移交 Host） | 同 RAC3 |

## 评审反馈逐条处置

| 反馈 | 处置 | 状态 |
|---|---|---|
| 反馈 1【阻塞】绕过路径 | AST 审计（TS compiler API 五形态 + 八扩展名），违规 fixture/探针逐形态证明；SA7 注错反演补真实树证据 | ✅ 已解决 |
| 反馈 2【中】白名单过宽 | 谓词收窄（段拒绝 + 文件名拒绝，下界 {testing,test,__tests__,fixtures,mock}），正反例矩阵 + 集成探针 | ✅ 已解决 |
| 非阻塞建议：共享 fixture 提取 | 本轮显式不做（设计 §5 DENY 登记：触碰 SA7 动态测试资产无 RAC 背书，风险>收益，留后续轮） | ⏸ 显式裁定 |

结论：RAC 3/3 ✅（RAC3 CI 腿按职责边界移交 Host）；Round 1 AC 7/7 回归 ✅；无 ❌ 条目。
