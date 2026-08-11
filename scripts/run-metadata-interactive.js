const { spawnSync } = require('child_process')

const npmCli = process.env.npm_execpath
if (!npmCli) {
  throw new Error('npm_execpath is missing; run this script with npm run metadata-interactif')
}

const versionResult = spawnSync(process.execPath, [npmCli, 'run', 'generate-version'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
})

if (versionResult.error) {
  throw versionResult.error
}
if (versionResult.status !== 0) {
  process.exitCode = versionResult.status ?? 1
  return
}

const tsxCli = require.resolve('tsx/cli')
const result = spawnSync(process.execPath, [tsxCli, 'tests/metadata.live.test.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PAPERBACK_CLOUDFLARE_INTERACTIVE: '1',
    PAPERBACK_METADATA_SCRIPT: '1'
  },
  stdio: 'inherit'
})

if (result.error) throw result.error

process.exitCode = result.status ?? 1
