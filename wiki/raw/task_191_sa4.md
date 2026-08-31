# SA4 静态验尸报告 — issue #191 yjs-server 根锁 stale 回收原子化（实现 f2bc4f0）

- **Date**: 2026-08-30（UTC）
- **Reviewer**: SA4（独立静态审核，未参与 SA1/SA3/SA6 任一环节）
- **审核对象**: HEAD = `f2bc4f0`（唯一实现 commit，父 `b66615c` = main/PR #130）
- **输入**: TASK.md、`wiki/raw/task_191_sa1.md`（R2）、`wiki/raw/task_191_sa2.md`（R2 复审 + N1 勘误）、`wiki/raw/task_191_sa6.md`、`wiki/raw/task_191_sa3.md`、diff 全量、实测复跑
- **Verdict**: **pass / APPROVE**（零阻断项；4 条非阻断观察 O1-O4 记录在案）

---

## 0. 独立验证证据（全部本机重跑，非转述 SA3）

| # | 命令（均 setsid/nohup 独立进程执行） | 结果 |
|---|---|---|
| V1 | `pnpm exec vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts` | **11 passed (11)**，Type Errors no errors，exit 0（与 SA6 基线 5 failed\|6 passed 对照：T1/T4/T5/T8/T9 五红转绿，T2/T3×2/T6a/T6b/T7 绿锚保持） |
| V2 | `pnpm typecheck`（root，12 个 tsc -p 项目，含 apps/yjs-server） | **exit 0** |
| V3 | `pnpm exec vitest run --no-file-parallelism` × 四存量锁面套件（smoke / phase5-three-instance / phase5-mgmt-verbs-sa7 / lifecycle-watchdog） | 首跑 2 failed\|14 passed（详见 O1 环境伪影）；**复跑 4 files / 16 tests 全绿，exit 0**（104.6s） |
| V4 | `git diff --check HEAD~1 HEAD` | 干净（exit 0） |
| V5 | 诊断文案程序化逐字节比对（`git show HEAD~1:…lifecycle.ts` vs HEAD，模板串归一化比对） | 三族冻结文案 **old==new 全等**（held-by-same-instance 247B / shared-root 184B / cannot-write 149B） |
| V6 | `grep -rn "flag: 'w'" apps/yjs-server/src/` | 零命中（`lifecycle.ts` 内两处 `writeFileSync` 均为 `{flag:'wx'}`（:122/:189）；`flag:'w'` 字样仅存在于注释/文档性文字 :101/:161，非代码） |
| V7 | `cat /proc/sys/kernel/pid_max` | 4194304 < DEAD_PID(2³¹−1) —— SA1 §8 P4 假设在本机成立 |

---

## 1. 总控指定核查项（逐条裁定）

### 1.1 unlink 前原始字节守卫 ✅

`lifecycle.ts:170-176`：判定读保存 grounding 原始字节（:136-141，读失败→`''` 语义等价旧 `readLockInfo` 吞错→`{}`），紧贴 unlink 重读并以 **`recheck !== raw` 字节串全等比对**（:176），不等或读失败（:173-175 catch→continue）均回环重判——是**原始字节比对而非解析后字段比对**（SA2 R2.4 移交点 1、N2 观察均满足：实现与 SA1 §4.2 ⑤b 文字一致）。T8 四重红锚（nothrow / `unlinkHookFired===1` / `rawSeen===seedPayload` / survivor 逐字节）在本实现下推演确定性绿（attempt0 守卫拒绝→continue→attempt1 判定读见 winner 活 pid→shared-root loud），V1 实测通过。

### 1.2 无 `flag:'w'` 生产残留 ✅

V6 证据：生产源码（`apps/yjs-server/src/`）零 `flag:'w'`。测试文件中的 `flag:'w'`（T2/T3/T4/T5/T6/T7/T8 种子与模拟注入）是**测试侧写锁文件**（SA1 §5 明文允许，模拟竞争者整体替换），非生产路径。`acquireRootLock` 持锁唯一出口 = 两次 `wx` 成功后的 `break`（:123/:190），SA2 §6 冻结面第 1 条（wx 唯一出口、flag:'w' 彻底消失）完好。

### 1.3 仅独占的所有权出口 ✅

推演全部出环路径：② `wx` 成功 break（:122-123）、⑤d `wx` 成功 break（:189-190）——均经 O_EXCL 裁决；其余出口全部为 loud throw（活 owner 双态 :146-150、护栏 :156-158、`loudUnwritable` :126/:184/:194、其他 errno 原样 rethrow :127/:185/:195）。双回收者任意交错下不存在「写成功但可能覆盖他人」路径（败者必经 ③ 读到胜者活 pid → loud，T4 实测锚定）。

### 1.4 回环有界 ✅

`for (let attempt = 0; ; attempt += 1)`（:119）：全部 4 处 `continue`（:174 守卫读失败、:176 字节不等、:183 unlink ENOENT、:193 重取 wx EEXIST）均回到更新式 `attempt += 1`，无跳过计数的旁路；护栏 `attempt >= MAX_RECLAIM_ATTEMPTS(=8)` throw `did not converge`（:155-159）位于 **⑤a seam②（:164）与 ⑤c unlink（:180）之前**（SA2 R2.4 移交点「④ 先于 ⑤a/⑤c」满足）。不可读锁文件（EACCES/EISDIR）路径推演：每轮回环 → attempt 递增 → 第 9 轮护栏 loud 收口，无死循环、无静默（SA2 N-C 语义一致）。

### 1.5 错误诊断保全 ✅

V5 程序化逐字节比对：三族冻结文案（held-by-same-instance / shared-root-unsupported / cannot-write…writable-rootDir）与 `b66615c` 版**完全一致**（模板归一化后全等）。`loudUnwritable(errno)` 收敛为私有辅助（:87-91）是纯等价重构，四点映射（mkdir :115 / 首取 wx :126 / unlink :184 / 重取 wx :194）齐备。护栏新文案含可 grep 的 `did not converge`。N1 勘误核实：SA3 实现未依据 SA1 §7.6 错误描述改代码，acquire 侧不可读 → 回环 → 护栏 loud，与 SA2 R2 复审判定一致。

### 1.6 nonce 与 release 所有权保护 ✅

payload `{instanceId, pid, nonce: randomUUID()}`（:108，`node:crypto` import :15，零新增第三方依赖）；release（:208-216）读全文与**本 handle 获取时写入的 payload 字节串全等**才 unlink（:211），否则 no-op——全字节比较而非字段比较（SA2 §6 冻结面第 2 条），T5 逐字节断言实测绿。幂等保留（文件不存在/不可读 → 吞错，「静默 no-op 是刻意选择」JSDoc 已落地 :200-207，SA2 攻击点 7 闭环）。D2 生产路径（main.ts:118 reload→memory 残留 handle 二次 SIGTERM 误删后继者锁）在 main.ts 零改动前提下由内容校验闭合。

### 1.7 hooks / docs / export ✅

- `RootLockAcquireHooks`（:63-77）两成员位置正确：seam① = EEXIST 后/判定读前（:131），seam② = 判定读后/守卫重读前、携带 grounding 字节（:164）；JSDoc「**测试编排用、生产调用方不得传**」（:59-61）已落地（SA2 R2.4 移交点）；seam 内异常原样传播（调用点无 try/catch 包裹）。
- `index.ts:60` re-export `type RootLockAcquireHooks`（冻结公共入口导入依赖它；SA1 §9 兑现）。
- `docs/integration/hub-peer-deployment.md` 锁语义段（:194-207）与实现逐句一致：payload 含 nonce、stale = 守卫+unlink+wx 原子重取、败者 loud、release 只删所有权对应锁、pid 复用 caveat 保留。
- 生产调用方 `main.ts:122/:183` 两参调用不变（diff 为空，V 证据见 §3 边界）。

### 1.8 测试未被削弱 + 范围边界 ✅

**锚点齐备性**（对照 SA1 §5 / SA2 R2.4 移交点 2 逐条）：

| 锚点 | 落点（test 文件行） | 状态 |
|---|---|---|
| T4 三重红锚 | :184 toThrow / :186 hookFired===1 / :188+191-192 winner+survivor | ✅ |
| T5 逐字节 | :213 exists + :215-218 `toBe(successorPayload)` | ✅ |
| T8 四重红锚 | :305 / :307 / :309 rawSeen===seedPayload / :311 survivor 逐字节 | ✅ |
| T1 nonce schema pin | :97 `typeof payload.nonce === 'string'` | ✅（SA6 冲突裁决合理，见 O4） |
| T6 双种子 | :227 not-json / :242 空文件 | ✅ |
| T9 root-skip + finally + 存在性守卫 | :316 skipIf / :329-333 finally | ✅ |
| T3.3 try/finally 还原 | :153-156 | ✅ |
| `import { …, type RootLockAcquireHooks }` | :42-47（冻结入口 `../src/index.js`） | ✅ |
| 护栏无虚构 churn 用例 | 全文件无 | ✅（§7.3 声明如实） |

**测试质量（技能 §1.7 源码 grep 断言禁令）**：全部断言锚定运行时可观察行为（锁文件字节 / existsSync / throw 文案 / handle 副作用）；`readFileSync` 目标是锁文件运行时产物，非源码字符串断言。零 sleep / 零真并发 / 零 spawn / 零 fake timer。**未被削弱**。

**范围边界（技能 §1.1 Scope Creep Guard）**：
- actual（HEAD~1..HEAD）= `lifecycle.ts`、`index.ts`、新测试文件、`docs/integration/hub-peer-deployment.md` + 5 个 `wiki/raw/task_191_*` 档案 → **恰等于 ALLOW LIST 4 文件 + 白名单档案，零越界**。
- DENY LIST（`main.ts` + 四存量测试 + `packages/**`）：diff 为空（V：`git diff HEAD~1 HEAD -- <deny files>` 空）。存量测试字节未动 → 「只许绿不许动」满足。
- BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）：零命中（TASK.md 在 .gitignore，未入 commit）。
- CI 触发性（技能 §1.4）：root `pnpm test` = `vitest run --typecheck`，默认 `vitest.config.ts` include `apps/*/test/**/*.test.ts` → 新测试文件被 CI `Test` step 覆盖；root `pnpm typecheck` 含 `apps/yjs-server` → 类型面同覆盖。§1.3（E2E spec）不适用（无 .spec.ts）。

---

## 2. 技能验尸清单结论

1. **设计一致性**：✅ 一致。§4.2 框图逐块落实（见 SA3 §1 表，经本审逐行核对无误）；`readLockInfo`→`parseLockInfo(raw)`（:40-47）私有等价重构，`'null'`/`'5'` 等奇异 JSON 与旧实现同归 `{}`（TypeError 被同一 try 捕获）或字段 undefined——语义零漂移。
2. **读写路径一致性**：✅。写（wx payload）与读（判定读/守卫读/release 校验）同经 `lockPath(rootDir)` 同一文件，无数据源分叉；payload 消费方全仓 grep 均字段挑选式（phase5:196 / mgmt-verbs:206 挑 `.pid`，smoke:334 匹配文件名），nonce 加键纯加法成立。
3. **静默失败**：✅ 无新增。唯一静默面 = release 内容不等 no-op + 幂等吞错——均为设计声明的保守正确行为（I3），且被 T5/T9 锚定；acquire 侧所有失败 loud。
4. **降级方案**：✅ 无降级引入。`continue` 是重试语义；守卫 catch→continue 的收口是护栏 loud（非静默降级）。
5. **极端条件攻击**：✅ 未发现可静态确认的漏洞。攻击推演记录：(a) 双回收者全交错变体——每态恰一胜者（wx 原子性）或败者 loud；(b) 恒变文件/恒重建文件的对抗写者——8 轮护栏 loud 收口；(c) `'null'`/非对象 JSON——同旧语义判 stale；(d) 残余窗仅 §7.1 变体 3（相邻守卫重读→unlink 四系统调用对撞）与 §7.5 部分写窗——均为设计已披露的 dotfile 锁固有语义，归 SA7 动态/推演域。
6. **错误处理链路**：✅ 完整。契约连锁审计（技能 §1.6）：`acquireRootLock` 仅增可选尾参（向后兼容），无 return→throw 翻转、无 async 化；新增护栏 throw 为 `Error`，被既有 caller catch 全覆盖（main.ts:183 try/catch→exit 1、:122 try/catch→failBoot）；release throw 面不变（永不 throw），caller :71/:118/:206 零风险。**无 uncaught rippling**。
7. **架构评估**：✅ 可行，无需退回 SA1。
8. **过度设计**：✅ 精简。hooks 两可选成员是确定性编排的最小形态（真并发/worker_threads/fs-adapter 备选被 SA1 §4.4 论证否决、SA2 攻击点 8 独立复核成立）；守卫即修复本体；护栏一个常量。修复半径 = ALLOW LIST 4 文件，无越界抽象。

**协议假设（技能 §1.5）**：SA1 §8 存在且 P1-P7 均有依据类型；P4 本机复核成立（V7）；P1/P2/P7 为 POSIX/Node 文档语义且有现网依赖先例。无「应该/通常」类裸推断。

---

## 3. 非阻断观察（记录在案，不 gating）

- **O1（环境伪影，运维知悉）**：本审 V3 首跑四存量套件（顺序执行）出现 2 failed + 1 unhandled error；**立即复跑全绿（16/16，exit 0）**。时点恰逢本机三个 worktree（issue-139/168/191）数十个 node/tsx 进程并发，与 SA3 §2.4 记录的同类资源伪影（spawn EAGAIN / pthread_create / code 134）一致，非实现缺陷。建议 SA7 全量回归顺序执行并避开并发高峰。
- **O2（理论边角，无需动作）**：守卫与 release 的比较是 utf8 解码后的字符串全等。两个**不同的非法 UTF-8 字节序列**可同解码为 U+FFFD 而被误判相等（例如 0xFF→0xFE 顶替逃过守卫）。可达前提是锁文件内容为非法 UTF-8——真实 payload 恒为 ASCII JSON，且该窗叠加在 §7.1 变体 3 残余窗之内。记录供 SA7 推演域参考，不构成修复要求。
- **O3（文档勘误随附）**：SA2 N1（SA1 §2/§7.6 对 acquire-侧不可读现状文案的描述与源码不符）维持「以勘误为准」处置；SA3 未据以改代码，实现与 SA2 R2 复审语义一致。SA1 后续文档整合时顺手修正即可。
- **O4（SA6 冲突裁决认可）**：SA6 对设计 §5 T1 文字（nonce pin）与红绿矩阵（T1 🟢🟢）冲突的裁决——以文字为准、T1 现状即红——本审认可：nonce 是修复本体契约与 SA2 §6 冻结面第 2 条的载体，T1 nonce 锚是唯一 pin 住该契约的用例（T5 靠 instanceId 差异即可绿，删锚会开假绿洞）。矩阵格应视为 SA1 笔误。

---

## 4. 动态审核重点（交 SA7）

1. **§7.5 部分写入可见窗**（现状既有）：并发读者在竞争者 `wx` open→write 之间读到空/半截文件 → 判 stale → 误回收。推演域；T6b 已 pin「空内容=可回收」语义。
2. **§7.1 变体 3 残余窗**：相邻「守卫重读→unlink」两条系统调用间被完成「unlink+wx」顶替 → 双持。四系统调用精确对撞，dotfile 锁固有语义；真对撞不要求构造，推演+披露即可。
3. **（新增，可选）O2 非法 UTF-8 解码碰撞**在极端人为构造下的可达性确认（预期不可达）。
4. 全量回归执行形态：顺序文件执行（--no-file-parallelism），避开本机多 worktree 并发高峰（O1）。

---

## 5. 裁决

**pass / APPROVE**。SA3 实现 `f2bc4f0` 与 SA1 R2 设计逐条一致、SA2 六项冻结面完好、SA6 红灯契约全锚齐备且五红转绿、存量测试零改动实测全绿、范围边界零越界、无 `flag:'w'` 残留、回环有界、诊断逐字保全。零阻断项；O1-O4 为非阻断记录。可进入 SA7 动态验证。
