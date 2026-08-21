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
      const filePersistence = new fileModule.FilePersistence({ rootDir })
      expect(filePersistence.getStatus()).toBe('ready')
      await filePersistence.dispose()
      expect(filePersistence.getStatus()).toBe('disposed')

      const memoryPersistence = new memoryModule.MemoryPersistence()
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
})
