# 任务简报 — docs: add MABF multi-repo monitoring note (synthetic e2e test)

- Issue: #1
- Branch: refactor/docs-add-mabf-multi-repo-monitoring-note-synthetic
- Base branch: main
- Worktree: /home/wangjian/nomicore-refactor-docs-add-mabf-multi-repo-monitoring-note-synthetic
- 任务类型: 功能开发 (feature / docs)

## What to build

Add a short markdown document under `docs/` describing that the mabf-poller now
monitors this repository alongside film-studio-fe. This issue is a synthetic
end-to-end test of the multi-repo dispatch path; **no business code or
configuration may change**.

建议文件名：`docs/mabf-poller.md`（或 `docs/` 下任意合适的 markdown 文件名）。

## Acceptance criteria

- [ ] A new `docs/mabf-poller.md` (or similarly named markdown file under
      `docs/`) briefly explains:
      1. **multi-repo monitoring** — mabf-poller 同时监控本仓库与 film-studio-fe；
      2. **event-watch discovery** — 通过 event-watch 机制发现新任务/事件；
      3. **dispatch to idle issue-runner machines** — 将任务派发给空闲的
         issue-runner 机器执行。
- [ ] No business source, test, or CI configuration files are modified.
      仅允许新增 `docs/` 下的 markdown 文件（以及流水线产出的 `wiki/raw/` 档案）。

## Repository context

本仓库当前极简（合成 e2e 测试仓库），仅含：`LICENSE`、`.gitignore`、`TASK.md`。
- 无 `package.json`、无 `pnpm` workspace、无 TypeScript 源码、无测试框架。
- 无 `scripts/test-lock.sh`。
- 因此「本地验证」不涉及 tsc / pnpm test；验收方式为：检查 `docs/mabf-poller.md`
  存在且覆盖三条要点，且 `git diff` 仅新增 docs/ 与 wiki/raw/，不动业务/配置文件。

## Constraints

- ⛔ 禁止修改任何业务源码、测试、CI 配置文件。
- ⛔ 禁止 `git push` 与创建 PR（PR 由外部 check.sh 负责）。
- Wiki 档案必须随代码一起 commit。

---

## SA6 红灯测试记录（2026-08-18）

### 测试设计

- **测试文件**: `tests/docs_mabf_poller.sh`（自包含 shell 验收测试，仅依赖 bash + coreutils，无外部依赖、无端口）
- **运行命令**: `bash tests/docs_mabf_poller.sh`（退出码 0=绿，非 0=红）
- **契约锚点**（交付物即文档本身，可观察契约 = 文档存在 + 覆盖三条要点；锚定简报原文字面机制名，不锁定 SA3 措辞）：

| 类别 | 断言 | 对应验收标准 |
|------|------|-------------|
| 存在性（异常场景） | `docs/` 目录存在；目录下存在 markdown 文件（优先 `docs/mabf-poller.md`，允许同目录任意 *.md） | 新增 `docs/mabf-poller.md` 或类似命名文件 |
| 边界条件 | 文档非空（0 字节视为失败） | — |
| 要点 1 multi-repo monitoring | 文档同时出现 `film-studio-fe` 与多仓库语义（multi-repo / 多仓库 / 同时监控） | 同时监控本仓库与 film-studio-fe |
| 要点 2 event-watch discovery | 文档出现 `event-watch`，且说明发现/discover 新任务/事件 | 通过 event-watch 机制发现新任务/事件 |
| 要点 3 dispatch to idle issue-runner | 文档出现 `issue-runner` + 派发语义（dispatch/派发/分发/调度）+ 空闲（idle/空闲） | 派发给空闲的 issue-runner 机器 |

- **需求拆解**：本任务无运行时行为可锚定（纯文档任务，仓库无源码/测试框架），验收即文档交付物内容检查——非源码 GREP 伪测试，断言对象是被验收的文档本身。异常输入场景即当前红灯路径：交付物缺失/目录为空。

### 红灯运行结果（真实失败证据）

```
$ bash tests/docs_mabf_poller.sh
== SA6 验收测试: docs/mabf-poller.md ==
PASS: docs/ 目录存在
FAIL: docs/ 下没有任何 markdown 文件（期望 docs/mabf-poller.md 或同目录 *.md）

== 红灯确认 ==
RED: 1 项失败 / 2 项。交付物缺失，验收测试按契约失败。
EXIT_CODE=1
```

- **结论**: 🔴 红灯确认。`docs/` 目录当前为空，交付文档尚未创建，测试按契约失败（exit 1）。SA3 实现后应复跑此测试直至 GREEN。
