import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deriveSdkCandidate } from '../prepare-sdk-candidate.mjs'
import { pendingCoreVersion } from '../sdk-compatibility.mjs'

void test('committed release intent works in a detached checkout without main and survives read-only planning', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkcre-detached-plan-'))
  let root = path.join(directory, 'source')
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  try {
    await mkdir(path.join(root, 'packages/core'), { recursive: true })
    await mkdir(path.join(root, '.changeset'))
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'candidate',
        private: true,
        scripts: { 'release:version': 'changeset version' },
      })
    )
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    await writeFile(
      path.join(root, 'packages/core/package.json'),
      JSON.stringify({ name: '@inkcre/core', version: '0.4.3' })
    )
    await writeFile(
      path.join(root, '.changeset/config.json'),
      JSON.stringify({
        baseBranch: 'main',
        changelog: '@changesets/cli/changelog',
        commit: false,
        access: 'restricted',
      })
    )
    await writeFile(
      path.join(root, '.changeset/resource.md'),
      "---\n'@inkcre/core': patch\n---\n\nManaged resources.\n"
    )
    await writeFile(path.join(root, '.gitignore'), 'node_modules\n')
    git('init', '--quiet', '--initial-branch=fixture')
    git('add', '.')
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture'
    )
    const checkout = path.join(directory, 'checkout')
    execFileSync('git', ['clone', '--quiet', '--depth=1', pathToFileURL(root).href, checkout])
    root = checkout
    git('remote', 'set-url', 'origin', path.join(directory, 'unavailable-remote'))
    await symlink(
      fileURLToPath(new URL('../../node_modules', import.meta.url)),
      path.join(root, 'node_modules')
    )
    assert.equal(git('rev-parse', '--is-shallow-repository'), 'true')
    git('checkout', '--quiet', '--detach')
    git('branch', '-D', 'fixture')
    assert.equal(git('for-each-ref', 'refs/heads'), '')
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(await pendingCoreVersion(root), '0.4.4')
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(git('for-each-ref', 'refs/heads'), '')
    // The same committed intent must agree with the real version command, not a
    // hand-written version increment or a --since HEAD filter that loses it.
    const config = await readFile(path.join(root, '.changeset/config.json'), 'utf8')
    assert.equal(await deriveSdkCandidate(root), true)
    assert.equal(await readFile(path.join(root, '.changeset/config.json'), 'utf8'), config)
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8')).version,
      '0.4.4'
    )
    assert.equal(await pendingCoreVersion(root), null)
    assert.equal(await deriveSdkCandidate(root), false)
    // Extension-only intent still prepares a candidate; a failed version command
    // must restore the exact config bytes before propagating its failure.
    await mkdir(path.join(root, 'packages/extension'))
    await writeFile(
      path.join(root, 'packages/extension/package.json'),
      JSON.stringify({ name: '@inkcre/ext-example', version: '1.0.0' })
    )
    const extensionIntent = path.join(root, '.changeset/extension.md')
    const intent = "---\n'@inkcre/ext-example': patch\n---\n\nExtension behavior.\n"
    await writeFile(extensionIntent, intent)
    assert.equal(await pendingCoreVersion(root), null)
    assert.equal(await deriveSdkCandidate(root), true)
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'packages/extension/package.json'), 'utf8'))
        .version,
      '1.0.1'
    )
    await writeFile(extensionIntent, intent)
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'candidate',
        private: true,
        scripts: { 'release:version': 'node -e "process.exit(7)"' },
      })
    )
    await assert.rejects(deriveSdkCandidate(root))
    assert.equal(await readFile(path.join(root, '.changeset/config.json'), 'utf8'), config)
    assert.equal(git('for-each-ref', 'refs/heads'), '')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
