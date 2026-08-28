---
status: complete
run_id: issue-134-1787847658-8367
task_type: bugfix
branch: fix/issue-134-on-docs-phase-5-websocket-replication
round: 2
issue: 134
started_at: 2026-08-28T06:05:00+08:00
finished_at: 2026-08-28T09:35:00+08:00
---

# issue #134 Round 2：PR #146 评审 12 项反馈修复（修订轮）

## 概要

按 PR #146 评审反馈（阻断 5 / 需明确 3 / 收口 4，共 12 项）对 round 1 交付做修订修复，
评审合同逐字收录于 `wiki/raw/task_namespace-lease-replication-session_round2.md`。核心
修复五件：epoch fence 前置到 bump 槽（旧 session outbound 立即停止投递）、Runtime close
同步段终止/detach 现存 sessions、复制扇出异步化（observer 零 listener 调用 + 每 channel
有界队列 16 + 自延伸微任务泵让步 20 + sticky `needsResync` 第 11 字段——ADR 0010 L113
字面落地）、受保护字段规范化深比较（白名单 = Y.Map/Y.Array ∪ plain array/object）、
lease release guaranteed cleanup（seam 抛错隔离、半释放结构性不可达）。另：committed
精确二分（beforeTransaction 探针）、no-op 置位语义明文、plugin role 贯通（含
createNamespaceRegistry 工厂漏转发第二根因）、AC7 竞态矩阵补齐、owned bytes 测试加严、
两包 README、PEER_ALLOWED_META_KEYS 空占位删除。

流水线全程（修订轮工作流）：SA8 前置门禁 **clear**（12/12 no-conflict + D-1..D-4 登记义务）
→ SA6 红灯锚定（29 新用例：21 预期红 + 8 绿锁定）→ SA1 设计增补 → SA8 设计复审 **clear**
（C-1'/C-2' 条件 + R-1'..R-4' 残留）→ SA2 攻击评审（R2 **reject** HIGH+MEDIUM → R2.1
**pass** → R2.2 **pass**）→ SA3 TDD 实现（8a68d82，偏离 3 项 + 发现 2 项全部经 SA1 R2.2
就地裁决）→ SA6 三项同步（9cfc1b6：fixture 类型面 / AC-2 ③ 时序演进 / spin 收尾）→
总控亲验三档全绿 → SA4 静态验尸（首轮 **reject** F-1 窄门 → 回流补锚闭合 → **pass**）→
SA7 动态验证 **PASS**（0 契约缺陷，R-1'/R-2' 满载复核闭合）→ AC-R2 门禁 **12/12** →
双轴终审**双 pass**（Standards 0 hard/2 minor/6 info；Spec 0 缺陷/5 INFO）→
终审非阻断项机械收口（79194dd）→ 最终验证全绿。

## 变更（diff 4cfaffd..HEAD = 8a68d82 + 2a7117a + 9cfc1b6 + 1e2c748 + 1128ef7 + 79194dd）

- `packages/namespace-runtime/src/replication-session.ts`：SessionChannel/Sep/Fanout
  异步化重构——observer 只做回声抑制谓词 + 容量检查（先于复制）+ `update.slice()` 入队 +
  调度泵；自延伸微任务泵（20 让步/项、交付时刻快照、逐 listener 自捕获、最外层 catch、
  finally 复位）；fenceStale/finalize/terminateAll/isTerminal 终态机；closedBy 记账 +
  A1 码域精化（runtime-close → RUNTIME_WRITE_DISABLED）；protectedValueEqual/
  deepEqualPlain/isWhitelistedValueContainer/projectOf 替换 protectedPrimitiveEqual；
  R5 beforeTransaction 探针 committed 精确二分；status 第 11 字段 needsResync；
  PEER_ALLOWED_META_KEYS 删除（语义冻结由 ADR 文字承载）。
- `packages/namespace-runtime/src/replication-write.ts`：bump 槽 E5.5'（同步投影步）
  `fenceStale(replicationId, nextEpoch)`——facts 整替之后、notifyDirty 之前；enable 槽零
  fence（显式裁决）。
- `packages/namespace-runtime/src/runtime.ts`：close() 同步段 lifecycle 翻转后、barrier
  入队前 `fanout.terminateAll('runtime-close')`；构造期 fanout 前移。
- `packages/namespace-registry/src/lease.ts`：doRelease guaranteed cleanup（① released
  ② entry 删除 ③ releasePromise+observer 先于 ④ 幂等直调 close（`Promise.resolve(closing)
  .catch` 原生同化 + try/catch）→ ⑤ onReleased 无条件）；Equal 锁自锁第 11 字段同步。
- `packages/namespace-registry/src/plugin.ts`：NamespaceRegistryPluginConfig +role 键 +
  校验序 ①形状→②键集→③role 域（NAMESPACE_REGISTRY_ROLE_INVALID）→④idleTimeoutMs +
  apply 透传。
- `packages/namespace-registry/src/registry.ts`：createNamespaceRegistry 工厂补转发
  options.role（L1333-1339 展开缺 role 键的生产缺口修复）+ 跨包 Equal 双锁同步。
- `packages/namespace-registry/src/types.ts`：PLUGIN_CONFIG 文案更新；status 类型第 11
  字段 needsResync。
- 测试：SA6 round-2 红套件两文件 29 用例全部转绿（runtime 17 + registry 12）；SA3 新建
  包内套件 runtime-replication-session-round2.test.ts 25 用例（泵/队列/交付集/fence/
  terminateAll/深比较矩阵/F-1 补锚/探针锚）；SA6 R2-10 加严 round-1 两文件（直存原始
  callback 参数断言）+ R2.2 三项同步（fixture 类型面、AC-2 ③ flushMicrotasks 时序演进、
  spin fixture 收尾 close——全部零断言语义变化、登记在案）。
- 文档：ADR 0010 修订节 append-only round-2 小节（D-1..D-4 全条目：异步队列+needs-resync
  交付集冻结、主动 fence、close 终止语义含 closedBy 码映射、深比较规则表+成本注记、
  committed 二分+例外方向、成功接纳即置位）；phase-5 C-1 显式撤销改写 + 词汇追加；
  CONTEXT.md needs-resync 一句；两包 README（runtime「ReplicationSession 内部宿主」8 条 +
  Lifecycle 增补；registry Public API 5 条 + Plugin configuration）。
- 版本：namespace-runtime 0.1.9→0.1.10；namespace-registry 0.1.5→0.1.6（恰 version 字段）。
- wiki 归档：round-2 简报/冲突报告×2/相关决策/设计 R2.2.1（含 R2.1/R2.2/R2.2.1 修订记录）
  /SA6 红灯报告/SA2 评审（含更正记录）/SA3 实现报告/SA4 验尸（含 F-1 追节）/SA7 动态报告
  /AC-R2 checklist/双轴终审两份/dispatch 追加段。

## 验证（最终档，总控亲跑）

| 验证 | 命令 | 结果 |
|---|---|---|
| whitespace | `git diff --check 4cfaffd..HEAD` | **exit 0** |
| 类型 | `pnpm typecheck` | **exit 0**（`.mabf-bg/r2final-typecheck.log`） |
| 全量测试 | `pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` | **141 文件 / 1735 用例全绿；Type Errors: no errors；零 TypeCheckError / 零 Unhandled；exit 0**（92.73s；`.mabf-bg/r2final-test.log`） |

评审 12 项逐项处置详见 `wiki/raw/task_namespace-lease-replication-session_round2_ac_checklist.md`
（12/12 通过：阻断 5 修复+回归锚、需明确 3 项全部裁决落盘、收口 4 项完成）。
SA7 附加实测：red #9 forks 池满载 ×3 复跑最坏 202ms<400ms；泵活链路 13/13、fence/terminate
活链路 18/18、敌意 beforeTransaction 探针 11/11、敌意 close 六型直构 unhandledRejection
Δ0；round-2 三文件 ×3 连跑零 flaky。

## 遗留事项（全部登记归属，不阻断）

- SA7 §十 N 级表征 4 条（跨 channel 首投递墙钟交错、Proxy 种子延迟域、RAW_UPDATE_INVALID
  码语义面向、突发弃新计数）——设计 §18/SA7 报告登记，属知情接受。
- Standards I-1（SessionClosedBy 'explicit-close' 死联合成员）等 info 级项记录在案。
- needs-resync 消费面（transport reset/bootstrap 清零路径）属切片 6（ADR 0010 L151 域分界
  维持）。
- CI 状态不在本地完成门槛内：发布（push/PR）与 CI 观察由 Host 执行。
