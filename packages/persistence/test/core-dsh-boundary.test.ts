/**
 * SA6 边界守卫（绿色锚，非红灯）— Issue #59 AC7「持久化核心插件源码不 import DSH；
 * DSH wrapper/profile 保持薄 Adapter」
 *
 * 契约来源：ADR-0006「插件实现只依赖 Cordis、Yjs 与持久化 contracts，不得 import DSH 或
 * NomicoreServer app」「DSH 与 NomicoreServer 都只是 Cordis Host」。
 *
 * 断言纪律（2026-07-13 源码 GREP 禁令合规）：本文件不做任何源码文本断言，全部锚定
 * 运行时行为与模块解析行为——
 * 1. 核心插件（@nomicore/persistence）在裸 Cordis 上下文中独立启动/停止，本文件不导入
 *    DSH profile 任何模块；
 * 2. 从核心包模块位置解析 '@nomicore/dsh-persistence' 必须失败（运行时依赖方向守卫：
 *    核心包不依赖 DSH，Node 模块解析即证）；
 * 3. 补充锚点：核心包 package.json 依赖清单不含 DSH profile 包（manifest 依赖图断言，
 *    非源码文本）。
 *
 * 本文件当前即绿，作为 AC7 的持续回归锚；DSH profile 实现落地后仍必须保持绿色。
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import {
  createFilePersistencePlugin,
  createMemoryPersistencePlugin,
} from '../src/index.js'

describe('core plugin 与 DSH 的依赖边界（AC7）', () => {
  it('核心插件在裸 Cordis 上下文中独立启动/停止，无需 DSH 任何代码', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-core-dsh-boundary-'))
    const memCtx = new Context()
    const fileCtx = new Context()
    const memory = createMemoryPersistencePlugin()
    const file = createFilePersistencePlugin({ rootDir })
    memory.apply(memCtx)
    file.apply(fileCtx)

    expect(memCtx.get('docPersistence')).toBe(memory.instance)
    expect(fileCtx.get('docPersistence')).toBe(file.instance)
    expect(memory.instance!.getStatus()).toBe('ready')
    expect(file.instance!.getStatus()).toBe('ready')

    await memCtx.fiber.dispose()
    await fileCtx.fiber.dispose()
    expect(memCtx.get('docPersistence')).toBeUndefined()
    expect(fileCtx.get('docPersistence')).toBeUndefined()
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('从核心包模块位置解析不到 DSH profile 包（运行时依赖方向守卫）', () => {
    // 本文件位于 packages/persistence/test/：若核心包被加上对 DSH profile 包的依赖，
    // Node 模块解析将成功，此守卫即红。
    expect(() => import.meta.resolve('@nomicore/dsh-persistence')).toThrow()
  })

  it('补充锚点：核心包依赖清单不含 DSH profile 包', () => {
    const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@nomicore/dsh-persistence']).toBeUndefined()
  })
})
