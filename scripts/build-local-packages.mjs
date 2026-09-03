import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishPackages as packages } from './package-catalog.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, process.argv[2] ?? 'artifacts/local-packages')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

for (const entry of packages) {
  const packageDir = join(root, entry.root, entry.name)
  await run('pnpm', ['run', 'build'], packageDir)
  await run('pnpm', ['pack', '--out', join(outDir, '%s-%v.tgz')], packageDir)
}

const manifest = {}
for (const entry of packages) {
  const pkg = JSON.parse(await readFile(join(root, entry.root, entry.name, 'package.json'), 'utf8'))
  manifest[pkg.name] = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
}
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`${outDir}\n`)

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`))
    })
  })
}
