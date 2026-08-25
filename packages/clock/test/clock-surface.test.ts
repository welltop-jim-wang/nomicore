/**
 * 红灯契约（静态面）— @nomicore/clock 能力边界与模块边界审计
 *（issue #106 AC5「不提供 timeout/interval/cron，不与 Cordis Timer 职责重叠」
 * + issue #104「受控 testing subpath」模块边界纪律）。
 *
 * 审计锚点：
 * 1. 生产 src 的真实代码（剥离注释与字符串后）不得出现 setTimeout / setInterval /
 *    setImmediate / cron 调度记号——Clock 只做当前时间观察；
 * 2. `Date.now` 只允许出现在 system.ts（production provider）；manual/contract
 *    不得读系统时间（manual clock 确定性纪律）；
 * 3. 主入口 index.ts 不得 re-export manual testing provider（受控子路径边界，
 *    对齐 persistence module-graph-regression 的语句级匹配方式）；
 * 4. package.json exports 恰为 "." 与 "./testing" 两个子路径。
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
const pkgDir = fileURLToPath(new URL('../', import.meta.url))

/**
 * 剥离注释和字符串/模板字面量，只留真实代码——EXCEPT module specifier：
 * 紧跟 from 或 ( 的字符串是模块说明符本身，予以保留（对齐 persistence
 * module-graph-regression 的剥离方式），因此 `from './manual.js'` 仍可匹配；
 * 文档注释中「不提供 timeout/interval/cron」之类的否定性陈述被剥离，不误报。
 */
const COMMENTS_AND_STRINGS =
  /(?<!from\s|\(\s*)(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g

function realCode(file: string): string {
  return fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(COMMENTS_AND_STRINGS, ' ')
}

const SRC_FILES = ['contract.ts', 'system.ts', 'manual.ts', 'index.ts', 'testing.ts']

describe('静态审计：Clock 能力边界（AC5）', () => {
  it('生产 src 真实代码不含任何调度记号（setTimeout/setInterval/setImmediate/cron）', () => {
    for (const file of SRC_FILES) {
      const code = realCode(file)
      expect(code, `${file} 不得出现调度记号`).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bcron\b/i)
    }
  })

  it('Date.now 只允许出现在 system.ts：manual/contract 不读系统时间', () => {
    for (const file of SRC_FILES) {
      const code = realCode(file)
      if (file === 'system.ts') {
        expect(code, 'system.ts 必须委托 Date.now').toMatch(/\bDate\.now\b/)
      } else {
        expect(code, `${file} 不得读系统时间`).not.toMatch(/\bDate\.now\b/)
      }
    }
  })
})

describe('静态审计：受控 testing 子路径边界（#104）', () => {
  it('主入口 index.ts 不 re-export manual testing provider', () => {
    const code = realCode('index.ts')
    expect(code).not.toMatch(/\bcreateManualClock\b|\bManualClock\b/)
    // 主入口也不得从 testing.js / manual.js 模块取任何东西
    expect(code).not.toMatch(/from\s*['"]\.\/testing\.js['"]/)
    expect(code).not.toMatch(/from\s*['"]\.\/manual\.js['"]/)
  })

  it('testing.ts 只从 manual.js re-export（testing 面单一来源）', () => {
    const code = realCode('testing.ts')
    expect(code).toMatch(/from\s*['"]\.\/manual\.js['"]/)
  })

  it('package.json exports 恰为 "." 与 "./testing"', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>
    }
    expect(pkg.exports).toEqual({
      '.': './src/index.ts',
      './testing': './src/testing.ts',
    })
    expect(fs.existsSync(`${pkgDir}src/testing.ts`)).toBe(true)
  })
})
