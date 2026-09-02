# 本机包联调

在正式发布到 npm registry 前，使用 `pnpm link` 将另一个本机项目连接到 Nomicore workspace 中的包，适合高频修改、运行和调试。

这是一种**开发期**工作流，不验证最终发布 tarball 的内容、`files` 白名单或 registry 解析；发布前仍须用 `pnpm pack` 在干净消费者项目中验收。

## 前提

- Node.js `>=20`
- pnpm `10.28.2`（与仓库根 `package.json` 一致）
- Nomicore 依赖已安装：

  ```bash
  cd /home/wangjian/nomicore
  pnpm install --frozen-lockfile
  ```

- 先确认目标包是面向消费者的公开 API；只从它的 `src/index.ts`（或明确的子路径 export）导入，禁止依赖 `src/` 深路径。

## 首次连接：以 `@nomicore/vfsl` 为例

在 Nomicore 仓库注册全局链接：

```bash
cd /home/wangjian/nomicore
pnpm --filter @nomicore/vfsl link --global
```

在独立消费者项目中连接该包：

```bash
cd /path/to/consumer-project
pnpm link --global @nomicore/vfsl
```

消费者正常声明并导入包：

```ts
import { parseVfsl } from '@nomicore/vfsl'
```

`pnpm link` 默认不安装被链接包的依赖。先在 Nomicore 仓库执行 `pnpm install`，以保证该 workspace 包的依赖可供运行时解析。

## 高频联调循环

1. 在 Nomicore 中修改目标包的源码。
2. 在 Nomicore 中运行该包的相关测试和 typecheck，例如：

   ```bash
   pnpm --filter @nomicore/vfsl typecheck
   pnpm test
   ```

3. 在消费者项目中重启其开发进程或测试进程，并验证修改。

当前 package export 直接指向 TypeScript 源码。因此消费者需要能够执行 TypeScript/ESM（例如通过 Vite、Vitest、tsx 或其自身的 TypeScript 构建链）。纯 Node.js 不能直接执行 `.ts` export；这正是未来 `dist` 发布构建与 `pnpm pack` 验收要覆盖的问题。

## 连接多个包

消费者应显式连接它实际使用的每个 Nomicore 包：

```bash
cd /home/wangjian/nomicore
pnpm --filter @nomicore/doc-runtime link --global
pnpm --filter @nomicore/namespace-runtime link --global

cd /path/to/consumer-project
pnpm link --global @nomicore/doc-runtime @nomicore/namespace-runtime
```

优先从依赖图最上层的公共包开始。若消费者直接导入多个 `@nomicore/*` 包，应逐个链接，而非从仓库根目录创建链接。

## 解除连接

在消费者项目中恢复 package manifest/lockfile 中声明的常规依赖：

```bash
pnpm unlink --global @nomicore/vfsl
pnpm install
```

如不再需要全局注册链接，可在 Nomicore 仓库执行：

```bash
pnpm --filter @nomicore/vfsl unlink --global
```

## 故障排查

- **找不到链接包**：确认两个命令使用同一 pnpm 安装，并重新执行目标包的 `link --global`。
- **运行时找不到依赖**：回到 Nomicore 根目录执行 `pnpm install --frozen-lockfile`；`pnpm link` 不会自动安装被链接 workspace 包的依赖。
- **消费者不能解析 TypeScript**：使用支持 `.ts` 的开发工具链，或改用后续的 `pnpm pack` tarball 验收流程。
- **消费者仍在使用旧模块**：重启开发服务器/测试进程，并检查其是否对 `node_modules` 做了预打包或缓存。
