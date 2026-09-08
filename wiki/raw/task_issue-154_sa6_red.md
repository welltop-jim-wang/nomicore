# SA6 红灯测试报告 — Issue #154：Retain, lease, and delete namespace diagnostic logs

- **Worktree**: `/home/wangjian/nomicore-fix-issue-154`（branch `fix/issue-154-on-docs-namespace-diagnostic-change-log`，HEAD `722bddf`）
- **上游输入**：`wiki/raw/task_issue-154_sa1_analysis.md`（§6 可测试需求映射）、`wiki/raw/task_issue-154_sa2_design.md`（§9 红灯测试计划 T-A…T-E，§2 提议公共 API）
- **任务简报**：根目录 `TASK.md`（AC 1–5；Blocked by #153）
- **底座**：包 `packages/namespace-diagnostic-log@0.1.4`；基线 22 files / 381 tests 全绿（本报告实测复核）

---

## 1. 交付物（修改/新建文件清单）

| 文件 | 性质 | 内容 |
|---|---|---|
| `packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts` | **新建** | T-A1–A8（age/bytes 前沿、null、0/0、非法值、30d 默认、配置不持久化）+ T-B1–B5、B7–B10（闭组资格、协议产物零残留、开组保护两形、IO 失败止步、文法不可达、永不 throw、多 generation 候选序）——15 tests |
| `packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts` | **新建** | §6.1 中断矩阵 W0/W1/W2/W3（含 bin 存在/缺失两分支）+ T20（mid-deletion reader 视图）+ T-E8（`.deleting` 续走计数）——5 tests |
| `packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts` | **新建** | T-C1–C8（活跃租约阻塞、close 释放、TTL 过期放行、过期后 renew、maxLifetime 拒续、快照集语义、跨实例可见性 INV-9、注册表隔离）+ T-B6（租约洞=前缀纪律 INV-2）——9 tests |
| `packages/namespace-diagnostic-log/test/file-adapter-namespace-deletion.test.ts` | **新建** | T-D1–D9（全量覆盖、幂等 absent、非法 id 零 fs 触达、N1 半态门+零写入、N2/N3/N4 续走、`{s}.deleting` 文法、语义边界词汇、完成后 fresh、租约分区释放）——9 tests |
| `packages/namespace-diagnostic-log/test/file-adapter-retention-history.test.ts` | **新建** | T-E1–E7（trim 报告、中洞仍腐护锚、单段>1 仍腐护锚、resume-after-trim 零 rotate、中洞仍 rotate 护锚、全裁剪收敛护锚、orphan 清理）——7 tests |
| `packages/namespace-diagnostic-log/test/helpers/file.ts` | **修改（纯增量）** | 追加 7 个夹具/工具：`segmentEntriesOf`、`segmentPathsOf`、`groupBytesOf`、`bytesSnapshotOf`、`readAllSegmentRecords`、`synthesizeDeletingMarker`；仅新增 export + `node:fs` import 扩名——零既有函数改动、零既有断言变更 |
| `wiki/raw/task_issue-154_sa6_red.md` | **新建（本报告）** | — |

**未改任何生产代码**：`git status` 仅显示上述 helpers 修改（+96/−1）与 5 个新测试文件；`src/**`、`docs/**`、`package.json`、既有测试文件零改动。helpers 改动为纯新增（也供 SA7 复用）。

---

## 2. 红灯验证（真实运行证据）

### 2.1 包级全量（基线对比）

```bash
$ npx vitest run packages/namespace-diagnostic-log/
# exit 1
Test Files  5 failed | 22 passed (27)
     Tests  41 failed | 385 passed (426)
Type Errors  no errors
     Errors  49 errors        # = vitest --typecheck 收集的 49 条 TypeCheckError（全部为提议新 API 缺失）
```

- 既有 381 测试全绿零回归（22 passed files）；失败全部落在 5 个新文件。
- 45 个新测试中 **41 个红灯**、**4 个为已存在行为的护锚绿灯**（见 §3）。

### 2.2 新文件逐个（红灯命令与代表性失败）

```bash
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts
# 15 failed (15)——失败形如：TypeError: a.log.sweepRetention is not a function
#   ❯ test/file-adapter-retention.test.ts:119:24
#   （当前 FileDiagnosticLog 无 sweepRetention 成员——SA2 §2.2 提议增量 API）

$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts
# 4 failed | 1 passed（W0 护锚绿）
# W1 失败双重锚点①：TypeError: b.log.sweepRetention is not a function（:115）
# ②：（先修后视）readStreamStrict 对 .deleting+bin 中间态当前报 corrupt
#     （manifest-roll-target-violation + sequence-gap）——T20 契约 status=ok 此处必红。

$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts
# 9 failed (9)——失败形如：TypeError: (0 , openDiagnosticReadSession) is not a function
#   模块已加载（esbuild 属性访问）→ 调用即 TypeError（新导出缺失的红灯）

$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-namespace-deletion.test.ts
# 8 failed | 1 passed（T-D6 护锚绿）——同上：TypeError: deleteNamespaceDiagnosticLog is not a function

$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention-history.test.ts
# 5 failed | 2 passed（T-E5/T-E6 护锚绿）
# T-E1 失败证据（行为红，非仅 API 缺失）：
#   expect(read.status).toBe('ok') —— received 'corrupt'
#   expect(read.issues.some(i => i.code === 'sequence-gap')).toBe(false) —— received true
#   （现 reader 锚定 expectedSequence=1n，trim 前缀后判 gap→corrupt；§7.1 重定基契约缺失）
```

### 2.3 类型面证据（tsc 全包）

```bash
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json; echo $?
# 2；共 49 条 error TS，全部位于 5 个新测试文件：
#   TS2305: Module '"../src/index.js"' has no exported member
#     'deleteNamespaceDiagnosticLog' / 'NamespaceLogDeletionRequest' / 'NamespaceLogDeletionResult' /
#     'openDiagnosticReadSession' / 'DiagnosticReadSession' / 'DiagnosticReadSessionRequest'
#   TS2339: Property 'sweepRetention' does not exist on type 'FileDiagnosticLog'（16 处）
#   TS2339: Property 'historyTrimmed' / 'earliestRetainedSequence' does not exist on type 'StrictStreamRead'（5 处）
#   TS7006（1 处，同源级联：historyTrimmedStreams 成员缺失导致回调参数隐式 any）
# 既有文件 0 错误。
```

三档红灯齐备：**运行时 TypeError（方法/成员缺失）→ 断言期红（corrupt 而非 ok）→ 编译期红（tsc/49）**。

---

## 3. 测试 → 验收标准映射

| TASK.md AC | 本报告测试（红灯） | 护锚（已达契约、防回归） |
|---|---|---|
| 1. age/bytes 可配置，`null` 关、`0` 非无限 | T-A1（=边界）、T-A2（组内 max+回拨钟）、T-A3（字节 =边界）、T-A4（双 null 仍卫生）、T-A5（0/0 尽删闭组、开组字节如实）、T-A6（非法值→恰一次 `retention-config-invalid`+失活）、T-A7（缺省 30d 精确边界）、T-A8（不持久化+不 rotate） | — |
| 2. 仅 closed+unleased 可删；JSONL-as-commit-marker 跨重启 | T-B1–B5、T-B7、T-B8、T-B10、W1/W2/W3、T-E8、T-B6（租约洞） | W0（未中断零动作） |
| 3. 短期可续租 read-session；过期不阻塞 | T-C1/C2（活跃/close）、T-C3（过期放行——AC 后半句核心）、T-C4（过期 renew 不复活）、T-C5（maxLifetime 拒续）、T-C6（快照语义）、T-C7（INV-9 跨实例）、T-C8（ns 隔离） | — |
| 4. namespace 逻辑删除；无 secure erase 暗示 | T-D1（逐对象清单）、T-D2（absent 幂等）、T-D3（非法 id 零 fs）、T-D4（N1 门+零写入）、T-D5（N2/N3/N4 续走）、T-D7（词汇=deleted/absent、无 tombstone）、T-D8（完成后 fresh）、T-D9（租约分区释放） | T-D6（`{s}.deleting` 文法不可达——现行为已正确） |
| 5. 前沿/开组/租约/每步中断/orphan/保留历史/完整删除 | T-A/T-B/T-C/T-D 全表 + T-E1（trim 报告）、T-E4（resume 零 rotate）、T-E7（orphan） | T-E2（中洞仍腐）、T-E3（单段>1 仍腐 = §7.1-E 复刻锚）、T-E5（中洞 resume 仍 rotate）、T-E6（全裁剪收敛 seq1 备案） |

红灯计数：41；护锚绿灯：4（W0、T-E5、T-E6、T-D6）。T-E2/T-E3 的 `historyTrimmed === false` 断言在类型面加字段前为值差红（undefined ≠ false），SA3 后转绿——它们锚定【不得把非 trim 情形误报为 trim】这一关键分界。

---

## 4. 契约歧义与实现注意事项（SA3/SA4 必读）

1. **`renew()` 与 `maxLifetimeMs` 的判定时点（T-C5 裁决）**：SA2 §2.3 仅写「已 close 或超出 maxLifetimeMs → false」。本报告钉死为**越界即拒**：续租后 `leasedUntil + ttl > openTime + maxLifetimeMs` ⇒ `renew()===false`。若实现改为「当前时刻已超才拒」，T-C5 的第二次 renew 将返回 true 而失败——需 SA4 在实现评审中确证读法。
2. **`.deleting` 组的 reader 枚举规则（T20/W1 裁决）**：契约要求 mid-deletion（`.deleting`+bin）组**整体从 READER 与 RESUME 枚举中剔除**（jsonl 与 bin 都不可见），从而最低幸存段=00000002 → `historyTrimmed=true` 重定基，且不产生 `manifest-roll-target-violation`/`sequence-gap`/`frame-missing`。若实现改为「bin 仍枚举但零行零 issue」，W1 的 status=ok 断言将因 sequence-gap 失败——该读取法由 SA2 §4.2「组从枚举消失」背书。
3. **`deletingMarkersCompleted` 计数位置**：SA1 主张构造期先收尾 `.deleting`、SA2 §2.2 主张构造完成自动 sweep；两处都可能在显式 `sweepRetention` 之前完成删除。为不锁定时序，窗口测试只断言**终态**（marker/bin 无残留、no-rotate、failedSteps=0）；T-E8 特意在**构造之后**合成 W2 态，保证显式 sweep 承担续走并计数——实现只要满足「任一触发点完成⇒终态一致」即绿。
4. **T-B9 与「只读根目录构造」偏差**：SA2 T-B9 原文为「只读根目录下构造+sweep」——但构造本身必须 mkdir/write 才会 ready，只读根下构造只能进入 failed 模式（无法表达 INV-5 的「ready 照常」）。本报告改为**构造成功后注入只读 segments 目录再 sweep**（chmod 0555 + skipIf(root)，同 #153 EACCES 护栏），保留 INV-5 实质（sweep 永不 throw、失败计数、恢复后 emit 照常）。建议 SA4 确认此等价替代可接受。
5. **T-A7 的 1 GiB 默认值只验了一半**：30d 默认已精确钉死（2_592_000_000ms 边界双向）；1 GiB 字节默认未做全量 Fixture（写入 >1 GiB 不具可执行性），仅由「total ≪ 1 GiB 时零字节删除」间接覆盖。实现若把字节默认钳错（如 0），T-A1～T-A4 的小预算用例会大面积失败，风险面仍在。
6. **非法 retention 配置与 `retention-swept` 事件**：T-A6 钉死「配置违规 ⇒ retention 失活 + **零** `retention-swept` 事件」（事件规则「有动作才发」+失活=零动作）。若实现把「失活 sweep」也算动作发事件，T-A6 的 `toHaveLength(0)` 会失败。
7. **T-B10 的字节口径**：定价的候选序断言依赖「字节核算跨代合计（INV-10）」——若实现只计当前 writer 的 generation，预算 `total−1` 将不足以触发旧代首删，`deletedGroups=1` 与 `reclaimedBytes=a1` 断言失败。这与 SA2 §4.5「Σ 全部流全部组」一致，请实现遵行。
8. **`earliestRetained` / `historyTrimmedStreams` 空流语义**：T-E6 刻意未钉死（空 segments 目录下 earliestRetained 项取 `null` 还是缺省），留 SA3 按「扫描重建」自然的实现；T-A1/A2 已钉死非空形态（`[{streamId, sequence}]`）。
9. **文档措辞测试的取舍**：T-D7 以**运行时行为**实现「无 secure erase 暗示面」——结果词汇 `{status:'deleted'|'absent'|'failed'}`、无 erased/purged/wipe/secure 字样（对运行时返回对象断言，非源码 grep）、删除后无 tombstone 残留。README/AGENTS 的措辞属文档面，SA6 不做文本断言（源码/文档 grep 禁令延伸），请 SA3 在实现 diff 中落实「不承诺 secure erase」与 `0`/`null` 语义，SA4 静态复核。
10. **事件形态**：新事件 `retention-swept`/`retention-config-invalid` 与 `stream-init-failed.reason='namespace-log-deleted'` 均经 `eventsOfTypeRaw`（字符串判别）断言字段值——SA3 只需按 SA2 §2.6 形状实现，测试对类型面冻结期兼容。

---

## 5. 实现建议顺序（对应 SA2 §13，供 SA3 参考）

1. `src/retention.ts` 纯策略 + `reader.ts` 锚容差/枚举剔除/两新字段（先绿 T-A1/A2、T-E1–E4 的 reader/resume 面）；
2. `src/adapters/file.ts` 协议 + `sweepRetention` + 构造序（T-A3–A8、T-B、W 矩阵）；
3. `src/read-session.ts` + index 导出（T-C、T-B6）；
4. `deleteNamespaceDiagnosticLog` + marker 门（T-D）；
5. `src/index.ts` 增量导出全部 §2 名字；AGENTS.md 同步；全量门。

**验证命令（CI 同款）**：`npx vitest run packages/namespace-diagnostic-log/`（绿灯目标：27 files / 426 tests 全绿 + typecheck 零 TypeCheckError）与 `npx tsc -p packages/namespace-diagnostic-log/tsconfig.json`（零错误）。
