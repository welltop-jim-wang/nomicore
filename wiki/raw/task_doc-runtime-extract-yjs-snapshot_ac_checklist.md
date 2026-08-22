# AC 逐条确认门禁 — 建立 @nomicore/doc-runtime 并提取验证 Yjs ROOT（issue #73）

- 检查人：总控（88ec961b） · 2026-08-22 13:46
- 基线：HEAD = 79319a4（F-1 修复后）；总控亲验 `pnpm test` 51 files/709 tests + 根 typecheck 6 包 EXIT=0（`.mabf-bg/f1-verify.log`）
- AC 来源：TASK.md / issue #73 Acceptance criteria（6 条）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 新包依赖 `@nomicore/vfsl + yjs`；VFSL 不新增 yjs 依赖，Persistence 不新增 VFSL/doc-runtime 依赖 | ✅ | `packages/doc-runtime/package.json` dependencies 恰为 `@nomicore/vfsl: workspace:*` + `yjs: ^13.6.30`；`git diff f07462d...HEAD` 对 packages/vfsl、packages/persistence、packages/dsh-persistence（及 vfsl-protocol/vfsl-codegen）的 package.json **零改动**；SA8 前置门禁与 SA4 §1.1 scope 双重复核依赖边界 | 无需处理 |
| AC2 | ROOT 结构遍历覆盖 root/map/array/xml/leaf/plain/union/ref，Yjs 与 plain 载体错位响亮失败 | ✅ | 冻结契约 21 用例 10 组逐形覆盖：幸福路径全形态、root 固定 Y.Map 探针（异型 throw 收敛）、map 字段载体错位 fail-fast、array number 路径段、plain 纯值双向错位、leaf 标量位、Record 动态键、union/ref、XML、SCHEMA/META 隔离（`extract-yjs-snapshot.test.ts` describe 清单）；补充 `extract-union-trial.test.ts` 8 用例（Record 形成员/前置判定/成员仲裁） | 无需处理 |
| AC3 | fail-fast 单 issue 携带精确 string/number path、expected 与 actual，错误节点不继续下钻 | ✅ | 契约 F2/F3：`{ ok:false; issues: ExtractIssue[] }` fail-fast 单 issue（issues.length===1），四字段 message/path/expected/actual，path = `Array<string\|number>`（map 用 string、array 用 number、[]=ROOT）；「错误节点不下钻」由 map 错位组与 union-trial 跨成员 fail-fast 用例锚定；SA4 §1.5/探针与 SA7 23 探针实证 | 无需处理 |
| AC4 | 成功快照与 live doc 解耦；XML 保证语义等价而非逐字 round-trip | ✅ | 解耦双向用例（幸福路径组：快照改动不影响 live、live 改动不影响已提取快照；D6 深拷贝 + JSON 值域断言，P15 实测 yjs 返回原引用）；XML 组以 `withNormalizedXml` 归一化比较（折叠标签间空白），专项断言 `normalizeXml(body) === '<p>Hello <b>world</b></p>'`；SA7 INV-8 逐字节确定性 + 遍历期只读性（零 update 事件）探针实证 | 无需处理 |
| AC5 | 新 workspace 被根 typecheck 与 CI Node 20/24 显式覆盖 | ✅ | 根 `package.json` typecheck 串联第 6 项 `tsc -p packages/doc-runtime/tsconfig.json`（总控亲验 6 包全过）；`.github/workflows/ci.yml` matrix `node: [20, 24]` 跑 `pnpm typecheck` + `pnpm test`，doc-runtime 四测试文件经 vitest include 自动入测（SA4 §1.4 vitest 触发性自检结论 all-triggered）；SA7 以 docker node:20-slim 真实运行时复跑 40/40 全绿 | 无需处理 |
| AC6 | 行为测试覆盖结构错位、Record、union/ref、plain 与 XML | ✅ | 40 用例 / 4 文件全部行为断言（无源码 grep，SA4 §1.7）：结构错位（map/array/plain/leaf 双向 + ROOT 异型）、Record（动态键逐键 + F-1 `__proto__` 键空间 2 用例）、union/ref（判别式成员选择 + ref 深路径 + Record 形成员仲裁 8 用例）、plain（值域违规 9 用例：bigint/undefined/Date/function/symbol 内嵌）、XML（语义等价组） | 无需处理 |

**结论：6/6 全部 ✅，无需派发修订 SA。进入 Phase 4 收尾固化。**

---

## 发布后修订轮 AC 补核（2026-08-22 14:58，run_id: issue-73-rev-1787378789）

- 检查人：总控（本轮会话）· 基线：HEAD = f8f2ddd（PR #81 owner review P1 修复）
- AC 来源：PR #81 owner review「必补回归测试」8 条（修订轮验收基准）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| R-1 | leaf 位置的 `NaN` 拒绝 | ✅ | SA6 `extract-nonfinite-number.test.ts` 用例（owner schema 逐字 `{ n: YLeaf<number> }` + `set('n', NaN)`）；SA7 §2-A 探针 verbatim：`ok:false` 单 issue / `path=["n"]` / `actual="non-finite number"` | 无需处理 |
| R-2 | plain object 内的 `Infinity` 拒绝 | ✅ | SA6 用例（`YPlainArray<{ x: number }>` + `[{x:1},{x:Infinity}]`）；SA7 §2-B #2：`path=["arr"]` + message 含 `内部位置 [1].x` | 无需处理 |
| R-3 | plain array 内的 `-Infinity` 拒绝 | ✅ | SA6 用例（`YPlainArray<number>` + `[1,-Infinity]`）；SA7 §2-B #3：`path=["arr"]` + message 含 `内部位置 [1]` | 无需处理 |
| R-4 | 均返回 `ok:false`、fail-fast 单 issue | ✅ | SA6 helper 内建（ok:false + issues.length===1 + 四字段 + 非 internal 双守卫）；SA7 §2-B #4 多违规 `[1,2,∞,NaN,-∞,3]` → 单 issue 首违规 `[2]` | 无需处理 |
| R-5 | `expected === 'plain value'` | ✅ | SA6 全失败例精确断言；SA7 §2-B #5 逐例复核 | 无需处理 |
| R-6 | `actual === 'non-finite number'`（冻结词） | ✅ | SA6 测试 docblock 冻结 + 备选词否决（'NaN'/'number'/'Infinity'）；设计 D9②/§10 六词登记；SA4 R3 维度 3 三处口径一致复核 | 无需处理 |
| R-7 | issue path 锚定 schema 声明节点 | ✅ | SA6 断言 `['n']`/`['arr']`（内部位置线只进 message，bigint D2 先例同构）；SA7 §2-B #7 `JSON.stringify(path)` 深等 | 无需处理 |
| R-8 | 有限 number 正向对照 + 快照 JSON 往返全等 | ✅ | SA6 正向对照 2 用例（`{n:42,arr:[1,2,3]}` + `0`/`-0`/`0.1` 边界；-0 JSON 规范边界 docblock 登记）；SA7 §2-B #8 往返全等实测；SA4 探针 MAX_VALUE/MIN_VALUE/MAX_SAFE_INTEGER 零误伤 | 无需处理 |

**结论：8/8 全部 ✅；另 owner 要求的验证链（doc-runtime 针对性测试 48/48、全量 pnpm test 52 文件/717 用例、pnpm typecheck 6 包、CI Node 20/24 触发证据）全部由总控亲验 + SA4/SA7 独立复跑确认。修订轮门禁收口。**
