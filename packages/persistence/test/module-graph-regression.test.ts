/**
 * R3 module-graph regression (PR #66 owner review #2): the barrel cycle is
 * gone — contract.ts is the dependency leaf, and the index.ts barrel is a pure
 * aggregation re-export. Two anchors:
 *
 * 1. Runtime: deep imports of the adapter/core modules WITHOUT touching the
 *    index.ts barrel must evaluate safely (no "Class extends value undefined"
 *    TDZ) and construct real instances. Vitest keeps a per-file module
 *    registry, so the deep entry points below are genuinely evaluated.
 * 2. Static: no src module except index.ts may reverse-import the barrel
 *    (`import … from './index.js'`, `export … from './index.js'`, dynamic
 *    `import('./index.js')`), matched at statement level — comments or string
 *    literals mentioning './index.js' are not false positives.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as fileModule from '../src/file.js'
import * as lifecycleModule from '../src/lifecycle.js'
import * as memoryModule from '../src/memory.js'
import { createTestScheduler } from '../src/testing.js'

const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * Strip comments and string/template literals so only real code remains —
 * EXCEPT module specifiers: a string literal immediately preceded by `from` or
 * by `(` (dynamic `import(...)`) is the module specifier itself and is kept,
 * so `import … from './index.js'` / `import('./index.js')` stay matchable.
 * Comments and other string literals mentioning './index.js' are removed and
 * cannot cause false positives. (Variable-length lookbehind: V8, Node >= 8.10.)
 */
const COMMENTS_AND_STRINGS = /(?<!from\s|\(\s*)(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g

function hasReverseBarrelImport(source: string): boolean {
  const code = source.replace(COMMENTS_AND_STRINGS, ' ')
  const staticImportOrExport = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*['"]\.\/index\.js['"]/m
  const dynamicImport = /import\s*\(\s*['"]\.\/index\.js['"]\s*\)/
  return staticImportOrExport.test(code) || dynamicImport.test(code)
}

/**
 * AC4 静态守卫（R1/B1）：扫描前先剥注释与字符串字面量（复用上方 COMMENTS_AND_STRINGS），
 * 守卫目标 = **host 全局 timer API**，非任何同名调用。三条正则：
 *  ① 裸调用（负向 lookbehind 排除 `scheduler.`/`globalThis.` 等属性调用 ——
 *     `readonly setTimeout: (…) => unknown` 的 property-signature 成员位因
 *     `:` 阻断 `\s*\(` 不命中，B1 教训：旧 `\b…\s*\(` 正则对本设计自身缝签名
 *     ≥9 处误报、任何正确实现下永不绿）；
 *  ② 显式 `globalThis.…`（旧自建 system timer 的确切形态）；
 *  ③ `Date.now(`。
 * 守卫自带正反样本表先证判别力，再扫七生产文件（testing.ts 豁免：`withTimeout`
 * 是 never-settle 测试守卫，非生产调度；fake-timer.ts 形态锁定 property-signature
 * ——method-shorthand 会被上方 ① 判为裸调用，改动即红灯）。
 */
const HOST_GLOBAL_TIMER_BARE = /(?<![\w$.])(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/
const HOST_GLOBAL_TIMER_GLOBALTHIS = /\bglobalThis\s*\.\s*(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/
const DATE_NOW = /\bDate\s*\.\s*now\s*\(/

function hasHostGlobalTimerApi(source: string): boolean {
  const code = source.replace(COMMENTS_AND_STRINGS, ' ')
  return HOST_GLOBAL_TIMER_BARE.test(code) || HOST_GLOBAL_TIMER_GLOBALTHIS.test(code) || DATE_NOW.test(code)
}

describe('module graph regression (R3, owner #2)', () => {
  it('deep-imports each adapter/core module without the barrel: no TDZ, real instances', async () => {
    // All class/factory bindings must be defined — a residual module cycle
    // would crash here with "Class extends value undefined" during evaluation.
    expect(typeof fileModule.FilePersistence).toBe('function')
    expect(typeof fileModule.createFilePersistencePlugin).toBe('function')
    expect(typeof memoryModule.MemoryPersistence).toBe('function')
    expect(typeof memoryModule.createMemoryPersistence).toBe('function')
    expect(typeof lifecycleModule.PersistenceLifecycle).toBe('function')

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomicore-module-graph-'))
    try {
      const filePersistence = new fileModule.FilePersistence({ rootDir, scheduler: createTestScheduler() })
      expect(filePersistence.getStatus()).toBe('ready')
      await filePersistence.dispose()
      expect(filePersistence.getStatus()).toBe('disposed')

      const memoryPersistence = new memoryModule.MemoryPersistence({ scheduler: createTestScheduler() })
      expect(memoryPersistence.getStatus()).toBe('ready')
      await memoryPersistence.dispose()
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('static guard: no src module except index.ts reverse-imports the barrel', () => {
    const offenders: string[] = []
    for (const fileName of fs.readdirSync(srcDir)) {
      if (!fileName.endsWith('.ts') || fileName === 'index.ts') continue
      const source = fs.readFileSync(path.join(srcDir, fileName), 'utf8')
      if (hasReverseBarrelImport(source)) offenders.push(fileName)
    }
    expect(offenders).toEqual([])
  })

  it('guard matches import/export statements only: comments and strings pass, dynamic imports fail', () => {
    const legalSamples = [
      '// a comment mentioning ./index.js is fine',
      '// import { x } from \'./index.js\' inside a comment is fine',
      "const note = 'import ./index.js inside a string is fine'",
      "const full = \"import { x } from './index.js'\" // a string literal, not a statement",
      "const url = `see ./index.js inside a template literal`",
      "import { type User } from './contract.js'",
      "export { FilePersistence } from './file.js'",
      "import type { Context } from '@deepseek-ai/cordis'",
      "import { a } from './plugin.js'\nconst s = 'from ./index.js inside a later string'",
    ]
    const illegalSamples = [
      "import { x } from './index.js'",
      "export { x } from './index.js'",
      "export * from './index.js'",
      "  export type { A, B } from './index.js'",
      "import { a,\n  b } from './index.js'",
      "const m = import('./index.js')",
      "import { a } from './x.js'\nimport { b } from './index.js'",
    ]
    for (const source of legalSamples) {
      expect(hasReverseBarrelImport(source), `legal sample flagged: ${JSON.stringify(source)}`).toBe(false)
    }
    for (const source of illegalSamples) {
      expect(hasReverseBarrelImport(source), `illegal sample missed: ${JSON.stringify(source)}`).toBe(true)
    }
  })

  it('AC4 static guard: discriminator samples first, then zero host-global timer API hits in production src', () => {
    // 判别力样本表先证后扫（B1 教训：旧 `\b…\s*\(` 正则对本设计自身的 scheduler 缝
    // 签名 ≥9 处误报、任何正确实现下永不绿）。合法样本 = 属性调用 / property-signature
    // 成员位 / 注释或字符串内提及；非法样本 = 裸调用 / globalThis / Date.now。
    const legalSamples = [
      'this.scheduler.setTimeout(callback, 10)', // 属性调用：scheduler 缝
      'timer.setTimeout(cb, 10)',
      'readonly setTimeout: (callback: () => void, delayMs: number) => unknown', // 接口 property-signature 成员位
      'setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs)',      // service.ts 桥接箭头形态
      'this.scheduler.clearTimeout(handle)',
      '// a comment mentioning setTimeout(cb, 10) is fine',
      "const note = 'setTimeout(cb, 10) inside a string is fine'",
      "const named = `globalThis.setTimeout(cb, 10) in a template literal`",
    ]
    const illegalSamples = [
      'setTimeout(callback, 10)',
      'globalThis.setTimeout(cb, 10)',
      'setInterval(cb, 10)',
      'clearTimeout(x)',
      'globalThis.clearTimeout(x)',
      'Date.now()',
    ]
    for (const source of legalSamples) {
      expect(hasHostGlobalTimerApi(source), `legal sample flagged: ${JSON.stringify(source)}`).toBe(false)
    }
    for (const source of illegalSamples) {
      expect(hasHostGlobalTimerApi(source), `illegal sample missed: ${JSON.stringify(source)}`).toBe(true)
    }

    // 七生产文件（testing.ts 豁免：withTimeout 的 globalThis.setTimeout 是
    // never-settle 测试守卫，非生产调度；dsh 包由 probe/profile 另行锚定）。
    const offenders: string[] = []
    for (const fileName of ['contract.ts', 'lifecycle.ts', 'memory.ts', 'file.ts', 'index.ts', 'service.ts', 'fake-timer.ts']) {
      const source = fs.readFileSync(path.join(srcDir, fileName), 'utf8')
      if (hasHostGlobalTimerApi(source)) offenders.push(fileName)
    }
    expect(offenders).toEqual([])
  })
})
