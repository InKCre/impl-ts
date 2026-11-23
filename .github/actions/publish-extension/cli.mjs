import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { git, prepareExtension } from '../../../scripts/prepare-repository-extension.mjs'
import { publishExtension } from '../../../scripts/extension-release/publish.mjs'

async function main() {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'artifact-directory': { type: 'string' },
      format: { type: 'string' },
      repository: { type: 'string' },
      'prepare-only': { type: 'boolean' },
      output: { type: 'string' },
    },
  })
  if (values.help) {
    console.log(
      'Usage: node cli.mjs --package package.json --artifact-directory dist/web [--format manifest|script]\n' +
        'For local validation add --prepare-only --output <directory> --repository Owner/Repo.\n' +
        'To publish, provide GITHUB_REPOSITORY and GH_TOKEN for the checked-out repository.'
    )
    return
  }
  const prepareOnly = values['prepare-only']
  const repository = values.repository ?? process.env.GITHUB_REPOSITORY
  assert.ok(
    values.package && values['artifact-directory'],
    '--package and --artifact-directory are required'
  )
  assert.match(
    repository ?? '',
    /^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/,
    'GITHUB_REPOSITORY or --repository must be Owner/Repo'
  )
  if (prepareOnly) assert.ok(values.output, '--prepare-only requires --output')
  else {
    assert.equal(
      repository,
      process.env.GITHUB_REPOSITORY,
      'publication must target the current GitHub repository'
    )
    assert.ok(
      process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
      'a repository GitHub token is required'
    )
  }

  const workspace = git(process.cwd(), ['rev-parse', '--show-toplevel'])
  const sourceRevision = git(workspace, ['rev-parse', 'HEAD'])
  const output = values.output
    ? path.resolve(workspace, values.output)
    : await mkdtemp(path.join(os.tmpdir(), 'inkcre-extension-publish-'))
  try {
    const { candidate, asset } = await prepareExtension({
      workspace,
      packagePath: path.resolve(workspace, values.package),
      artifactDirectory: path.resolve(workspace, values['artifact-directory']),
      output,
      repository,
      format: values.format,
      sourceRevision,
    })
    if (prepareOnly) console.log(candidate.body)
    else {
      const tag = await publishExtension({
        workspace,
        repository,
        sourceRevision,
        candidate,
        asset,
      })
      console.log('Published ' + tag + ' (' + candidate.digest + ')')
    }
  } finally {
    if (!values.output) await rm(output, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
