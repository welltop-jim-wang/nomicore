# Nomicore

[![CI](https://github.com/welltop-jim-wang/nomicore/actions/workflows/ci.yml/badge.svg)](https://github.com/welltop-jim-wang/nomicore/actions/workflows/ci.yml)

Nomicore 是以 Yjs 为载体的自描述 Namespace 运行时。每个 Namespace 把 VFSL schema 作为数据存入 `SCHEMA` 信封；宿主使用同一份 `schema.vfsl` 生成 TypeScript 路径投影，并在运行时通过 Registry lease 执行受控读写。Hub/Peer replication 在不同实例、不同 Persistence root 之间复制完整副本。

## 当前能力

- **VFSL v1**：解析、求值、schema envelope、逻辑 ROOT 校验、路径与载体投影。
- **TypeScript codegen**：从宿主拥有的 `schema.vfsl` 生成 `VfslPathMap` augmentation，用于强类型写路径和值。
- **Namespace Runtime**：同步读取、VFSL 校验写、严格 FIFO write sequencer、SCHEMA replacement。
- **Namespace Registry**：namespace create/open、lease、idle retention、生命周期与有序 shutdown。
- **Persistence**：Memory/File adapters、dirty/flush、恢复、归档与 replica reset；File root 由单一 active process 独占。
- **Instance identity**：不可变的 `instanceId + role` Cordis service。
- **WebSocket replication**：角色专用 Hub/Peer Cordis plugins、认证授权、bootstrap/reconcile、backpressure、liveness、GOAWAY drain 与受控恢复。
- **Standalone server**：`@nomicore/yjs-server` CLI，以及可供嵌入式 Node Host 使用的 Hub listener 和 Peer dial adapters。

权威术语见 [`CONTEXT.md`](CONTEXT.md)，架构决策见 [`docs/adr/`](docs/adr/)，wire contract 见 [`docs/protocols/instance-replication-v1.md`](docs/protocols/instance-replication-v1.md)。

## 关键使用规则

1. 宿主项目拥有自己的 `schema.vfsl`、生成类型、业务代码、配置、测试与部署；Nomicore 是依赖，不接管宿主领域。
2. Namespace 写入必须使用生成的 `VfslPathMap` 投影和 projection-aware typecheck，通过宿主 typed adapter 调用 `NamespaceLease.mutateData()`。运行时 SCHEMA 校验不能代替编译期路径和值检查。
3. 业务 mutation 应最小、可合并、有语义；修改一个叶子时不要读取并替换整个 ROOT 或父对象。
4. File Persistence `rootDir` 是单进程私有存储，不是共享数据库。跨进程数据修改使用拥有者业务接口或不同 root 之间的 Hub/Peer replication；不得并发打开同一 root 或直接编辑 snapshot。
5. SCHEMA replacement 只由 Hub 通过 existing namespace lease 执行。更新后需刷新类型投影，并按文档协调 Peer reset/re-bootstrap 或重启。

相关指南：

- [外部项目 VFSL Codegen 与类型安全访问](docs/integration/external-project-vfsl-codegen.md)
- [第三方 Cordis Host 装配](docs/integration/cordis-plugin-hosting.md)
- [Hub/Peer standalone 部署与运维](docs/integration/hub-peer-deployment.md)
- [本机源码 linking](docs/integration/local-package-linking.md)

## 包与目录

```text
packages/
├── vfsl-protocol/          # 生成类型使用的路径访问协议
├── vfsl/                   # VFSL parser/evaluator/validator
├── vfsl-codegen/           # TypeScript projection generator
├── doc-runtime/            # Yjs 载体物化、读取和校验 mutation
├── namespace-runtime/      # Namespace 能力与 write sequencer
├── clock/                  # Cordis wall-clock service
├── instance/               # instanceId + role service
├── persistence/            # Memory/File persistence
├── namespace-registry/     # Registry、lease 与 replication sessions
├── replication-protocol/   # instance replication v1 codec
├── ws-replication/         # Hub/Peer controllers 与 Cordis plugins
└── dsh-persistence/        # DSH 开发/探针 profile

apps/yjs-server/            # standalone Hub/Peer composition root 与 Node WS adapters
domains/                    # 仓库内示例/测试领域
docs/                       # ADR、protocol、VFSL 与 integration guides
artifacts/local-packages/   # 本地集成 tarballs 和 manifest
```

## 构建本地 tarballs

这些包尚未统一发布到 npm registry。与独立项目做接近正式安装的集成时，使用编译后的完整 tarball 集，而不是只安装顶层 server 包。

### 1. 准备 checkout

```bash
git switch main
git pull --ff-only origin main
pnpm install --frozen-lockfile
```

要求 Node.js 20+ 和仓库声明的 pnpm 版本。

### 2. 构建完整包集

```bash
pnpm run pack:local
```

该命令会：

1. 清空 `artifacts/local-packages/`；
2. 依依赖顺序编译每个可集成包的 `dist`；
3. 为每个包运行 `pnpm pack`；
4. 写入 `artifacts/local-packages/manifest.json`。

默认输出示例：

```text
artifacts/local-packages/
├── manifest.json
├── nomicore-vfsl-protocol-<version>.tgz
├── nomicore-vfsl-<version>.tgz
├── nomicore-doc-runtime-<version>.tgz
├── nomicore-clock-<version>.tgz
├── nomicore-instance-<version>.tgz
├── nomicore-persistence-<version>.tgz
├── nomicore-namespace-runtime-<version>.tgz
├── nomicore-namespace-registry-<version>.tgz
├── nomicore-replication-protocol-<version>.tgz
├── nomicore-ws-replication-<version>.tgz
└── nomicore-yjs-server-<version>.tgz
```

可选地将输出写到其他目录：

```bash
pnpm run pack:local -- /absolute/path/to/output
```

`manifest.json` 是包名到实际版本化文件名的权威映射。不要在消费项目中硬编码 README 示例中的版本号。

> 只要 tarball 内容发生变化，相应 package 的 `version` 就必须先更新；构建脚本会把版本写入文件名和 manifest。不要以相同版本号覆盖不同内容。

### 3. 在独立项目中安装

独立消费项目必须为其使用的全部未发布 `@nomicore/*` 传递依赖提供本地 tarball。仅安装 `@nomicore/yjs-server` 会让包管理器尝试从 npm 解析其余未发布依赖。

示例 `package.json`（文件名以本次生成的 manifest 为准）：

```jsonc
{
  "dependencies": {
    "@nomicore/instance": "file:../nomicore/artifacts/local-packages/nomicore-instance-0.1.0.tgz",
    "@nomicore/clock": "file:../nomicore/artifacts/local-packages/nomicore-clock-0.1.0.tgz",
    "@nomicore/persistence": "file:../nomicore/artifacts/local-packages/nomicore-persistence-0.2.2.tgz",
    "@nomicore/namespace-registry": "file:../nomicore/artifacts/local-packages/nomicore-namespace-registry-0.1.6.tgz",
    "@nomicore/replication-protocol": "file:../nomicore/artifacts/local-packages/nomicore-replication-protocol-0.1.0.tgz",
    "@nomicore/ws-replication": "file:../nomicore/artifacts/local-packages/nomicore-ws-replication-0.1.3.tgz",
    "@nomicore/yjs-server": "file:../nomicore/artifacts/local-packages/nomicore-yjs-server-0.1.1.tgz"
  }
}
```

实际闭包还可能包含 `vfsl-protocol`、`vfsl`、`doc-runtime` 和 `namespace-runtime`；以 package manager 报告及 `manifest.json` 为准。更新 tarballs 后，在消费项目重新执行其 package manager install，确保 lockfile 指向新文件和内容。

### 4. 验证 tarball 消费

消费项目应从 packed `dist` 导入，不应通过 `nomicore-source` condition、源码路径或 checkout 内部 subpath 运行生产集成。至少执行：

```bash
pnpm install
pnpm typecheck
pnpm test
```

对于 typed Namespace writers，还要执行宿主自己的：

```bash
pnpm nomicore:generate
pnpm nomicore:generate:check
pnpm exec tsc -p <projection-aware-tsconfig> --listFilesOnly
```

`--listFilesOnly` 输出必须包含该业务 package 消费的准确 projection 文件。

## 第三方 Cordis Host 装配

嵌入式 Host 使用公开 plugin factories，按以下依赖顺序启动：

```text
Instance
→ Clock
→ Host-owned Timer
→ Memory/File Persistence
→ Namespace Registry
→ role-specific Hub/Peer replication plugin
→ namespace lease / replication readiness
→ domain service
```

Node Host 可从 `@nomicore/yjs-server` 使用：

- `createNodeHubListenAdapter()`
- `createNodePeerDial()`

详细的 readiness、Timer 所有权、File root、Peer reconnect 与 teardown 规则见 [Cordis Host 指南](docs/integration/cordis-plugin-hosting.md)。

## Standalone Hub/Peer

`@nomicore/yjs-server` tarball 提供 `nomicore-yjs-server` CLI。安装完整 tarball 闭包后：

```bash
pnpm exec nomicore-yjs-server --config /path/to/config.json
# 或
NOMICORE_CONFIG=/path/to/config.json pnpm exec nomicore-yjs-server
```

配置、NDJSON 管理面、TLS、root lock、Hub restart、Peer recovery 和 reset runbook 见 [Hub/Peer 部署指南](docs/integration/hub-peer-deployment.md)。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm run pack:local
```

常用工具：

```bash
pnpm schema:check /absolute/path/to/schema.vfsl
pnpm generate --domains /absolute/path/to/host
```

CI 使用 Node 20 / 24 矩阵，配置位于 `.github/workflows/ci.yml`。
