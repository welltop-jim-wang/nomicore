import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const [sourcePath, outputPath] = process.argv.slice(2)
if (sourcePath === undefined || outputPath === undefined) {
  throw new Error('usage: create-publish-manifest <source-package.json> <output-package.json>')
}

const pkg = JSON.parse(await readFile(sourcePath, 'utf8'))
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  if (pkg[field] === undefined) continue
  const sorted = {}
  for (const name of Object.keys(pkg[field]).sort()) {
    const range = pkg[field][name]
    if (typeof range !== 'string' || !range.startsWith('workspace:')) {
      sorted[name] = range
      continue
    }
    const protocol = range.slice('workspace:'.length)
    if (protocol !== '*' && protocol !== '^' && protocol !== '~') {
      throw new Error(`${pkg.name}: unsupported workspace range ${range} for ${name}`)
    }
    const workspaceRoot = resolveWorkspaceRoot(sourcePath)
    const dependencyName = name.replace('@nomicore/', '')
    const candidates = [
      join(workspaceRoot, 'packages', dependencyName, 'package.json'),
      join(workspaceRoot, 'apps', dependencyName, 'package.json'),
    ]
    let dependency
    for (const candidate of candidates) {
      try { dependency = JSON.parse(await readFile(candidate, 'utf8')); break } catch { /* try next */ }
    }
    if (dependency === undefined) throw new Error(`${pkg.name}: workspace dependency ${name} not found`)

    sorted[name] = protocol === '*' ? dependency.version : `${protocol}${dependency.version}`
  }
  pkg[field] = sorted
}

const ordered = {}
for (const key of Object.keys(pkg).sort()) ordered[key] = pkg[key]
await writeFile(outputPath, `${JSON.stringify(ordered, null, 2)}\n`)

function resolveWorkspaceRoot(path) {
  return dirname(dirname(dirname(path)))
}
