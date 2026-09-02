import { rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const packageDir = process.cwd()
const configPath = resolve(packageDir, 'tsconfig.build.json')
await rm(resolve(packageDir, 'dist'), { recursive: true, force: true })
await writeFile(configPath, `${JSON.stringify({
  extends: './tsconfig.json',
  compilerOptions: {
    noEmit: false,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    rootDir: 'src',
    outDir: 'dist',
    allowImportingTsExtensions: false,
  },
  include: ['src/**/*.ts'],
  exclude: ['test/**/*.ts'],
}, null, 2)}\n`)

await new Promise((resolvePromise, reject) => {
  const child = spawn('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: packageDir,
    stdio: 'inherit',
  })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (code === 0) resolvePromise()
    else reject(new Error(`package build failed (${signal ?? code})`))
  })
})
