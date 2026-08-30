# 双轴终审 — Standards 轴（issue #137 revision round 2）

- 审查 diff 范围：`58150ad..e483825`（3 commits / 17 文件 +1197/−63）
- 审查员：generic subagent（与总控同模型路由；engineering/code-review skill 规则）
- 审查时间：2026-08-29 13:1x

## Verdict: **clear**（零硬违规；8 项非阻断发现/观察，均不阻碍放行）

## 审查面逐项结论

### 1. 仓库约定遵守 — ✅ 全部合规
- Commit message 规范：3 个 commit 均遵循 Conventional Commits + issue 引用 + 中英双语摘要 + 结构化正文惯例（对照 `git log 58150ad` 前 15 条同型）。34bbfba=fix、c95c088/e483825=test。
- 测试文件组织：3 个新文件命名与既有 15 文件命名族一致，落 packages/ws-replication/test/，被根 vitest include 覆盖（实测全量 17 文件被收集执行）。
- harness/driver seam 纪律：r2-red 全程复用 bootMulti/deferred/settle/settleUntil/dropNext*/saveGate(s)；harness.ts 仅 +2 行契约镜像（设计 §5.4 登记）。transport 测试采用组合而非改造（自建 TcpTransport 适配器 + 复用 harness 公共 seam），文件头显式声明真实 timer 纪律边界。
- 注释风格：密集中文 + §条款锚定风格一致；9 处协议行号引用抽验全部逐字准确（§1 L22/§3 L54/§10.2 L279/§13.2 L371/§14 L391/§17 L479-486/L488/L490/L492）。

### 2. 文档与测试要求 — ✅ 合规
- 新行为测试锚定：R2-1~R2-4 每修复均有先行红灯锚（8 红，SA4 回退实验实证非软化）+ R2-5 落盘直绿 + SA7 补 2 文件 3 用例。
- 断言锚真行为：全部主锚落在 wire 帧/rootValue/状态投影；零源码 grep 断言。唯一私态触碰 = R2-2 lastSeq 注入（文件头登记唯一可达 seam）；hub `state` 经核为 types.ts:97 公共契约字段。
- c95c088 锚修正与 e483825 supplement 的 needs-resume 可快照断言语义自洽（前者 in-flight=0 恢复同步完成恒 live；后者 ACK 被结构性扣住故可观察）——互补非矛盾。

### 3. 生命周期/防御模式 — ✅ 合规
- teardown 完备性：R2-2 删帧后收口拓扑不变（hub sender.teardown() 先于 close；peer enterBlocked 承担 + 重入守卫 + onClose 1008 分类早退吸收）。
- timer 清理：poll/ackTimer 零改动；transport 测试 afterAll + socket.destroy() + unref 防挂进程。
- 重入安全：R2-1 收口 needsResync 先置（:147）再声明（:148）——声明链同步 drain 重入被 deliver 首行/pullAndSendOne 前置② 拦截。
- 异常收敛面：残余 transport.close 与既有形态一致；controlReserveBytes 构造期 positiveSafeInteger 响亮 TypeError、零 clamp（§17 L494-506）。

### 4. 可维护性 — 无阻断项（见非阻断发现）

## 逐项发现（全部非阻断）

| # | 严重度 | 位置 | 发现 |
|---|---|---|---|
| S1 | LOW | src/frame-io.ts:88 与 :149-150 | 注释漂移：两处仍描述「ERROR + close 1008」/「best-effort connection ERROR + close(1008)」，与 R2-2 后「零出站帧、直接 close」新语义矛盾（frame-io.ts 在本轮设计 DENY，注释随代码语义脱节）。建议下轮 1-2 行注释修订（勿改行为） |
| S2 | LOW | src/peer-connection.ts:479 | 自引用行号失鲜：「enterBlocked() 承担（:565-575）」实为 :556-566/:558。建议改函数名锚 |
| S3 | LOW | test/ws-replication-sa7-r2-supplement.test.ts:26-29 | 死代码：framesOfWire 辅助定义后零调用（测试体用 driver 公共 seam run.framesOf），Wire import 亦仅服务该死函数（tsc 无 noUnusedLocals 故静默） |
| S4 | TRIVIAL | test/ws-replication-issue137-r2-red.test.ts:2 | 错别字：「revison」→ revision |
| S5 | TRIVIAL | 同上 :531 | 注释残句「不相 20 笔」语义不通 |
| S6 | 观察（已登记） | r2-red R2-4 两用例 limits | as Partial<ReplicationLimits> 双 cast 在字段入 types.ts 后冗余——设计 §5.4 显式登记保留，将来清理候选 |
| S7 | 观察 | r2-red R2-2 (hub) :252/:261 | 双 cast 让公共 state 读取看似私态戳；断言语义无误 |
| S8 | 观察（接受） | r2-red R2-2 两用例 | 运行时私态注入 lastSeq 无套件先例；2^32 不可达 + 文件头登记 + 断言全在 wire 行为 ⇒ 可接受的已登记偏离；建议将来 harness 层提供显式 seam |

## 独立验证命令与结果（日志 .mabf-bg/final-standards-*）

| # | 命令 | 结果 |
|---|---|---|
| 1 | git log/diff --stat 58150ad..e483825 | 3 commits / 17 文件 +1197/−63，与 AC 清单/SA4/SA7 口径一致 |
| 2 | git diff --check 58150ad..e483825 | 干净 |
| 3 | tsc -p packages/ws-replication/tsconfig.json（setsid 后台） | exit 0 |
| 4 | vitest run --typecheck packages/ws-replication（setsid 后台） | 17 文件/106 测试全绿，exit 0 |
| 5 | 两个新增 SA7 文件单独复跑 | 2 文件/3 测试绿，exit 0 |
| 6 | SA4 grep 门禁独立复现 | peer encodeMessage=0/codecFieldLimits=0；hub 0/2 —— 精确命中 |
| 7 | 协议行号抽验（sed -n × 9 处） | 全部逐字准确 |
| 8 | 反模式扫描（.only/.skip/FIXME/TODO/readFileSync） | 0 命中 |
| 9 | seam/账务抽查（resolveLimits/validate 调用点/declareLocalResync 双端/controlReserveUsed 复位三路径） | 全部闭环 |

## 处置建议

放行（clear）；S1/S3 建议记入下一轮或收尾微修清单；S2/S4/S5 同型文字级微修可合并处理；S6/S7/S8 仅观察登记。
