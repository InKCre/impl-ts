import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareNativeCheckout } from '../prepare-native-checkout.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'inkcre-native-checkout-'))
  const source = join(root, 'source')
  const output = join(root, 'candidate')
  const input = {
    'package.json': { name: 'fixture', private: true },
    'packages/core/package.json': { name: '@inkcre/core', version: '0.4.3' },
    'extensions/example/package.json': {
      name: '@inkcre/example',
      version: '0.1.0',
      inkcre: {
        name: 'inkcre/example',
        module_federation: { host_sdk: '@inkcre/core', host_sdk_version: '>=0.4.4 <0.5.0' },
      },
    },
    '.changeset/compatible.md': '---\n"@inkcre/core": patch\n---\nCompatible capability\n',
  }
  for (const [file, value] of Object.entries(input)) {
    await mkdir(join(source, file, '..'), { recursive: true })
    await writeFile(join(source, file), typeof value === 'string' ? value : JSON.stringify(value))
  }
  const calls = []
  const run = async (command, args, cwd) => {
    calls.push({ command, args, cwd })
    if (command === 'git' && args[0] === 'rev-parse') return 'a'.repeat(40)
    if (command === 'git' && args[0] === 'status') return ' M packages/core/package.json\n'
    if (command === 'git' && args[0] === 'ls-files') return Object.keys(input).join('\0') + '\0'
    if (command === 'pnpm' && args[0] === 'release:version') {
      await writeFile(
        join(cwd, 'packages/core/package.json'),
        JSON.stringify({ name: '@inkcre/core', version: '0.4.4' })
      )
      await unlink(join(cwd, '.changeset/compatible.md'))
    }
    return ''
  }
  return { root, source, output, calls, run, input }
}

void test('the existing version command prepares an isolated candidate without consuming source intent', async () => {
  const context = await fixture()
  try {
    const result = await prepareNativeCheckout({
      sourceDirectory: context.source,
      outputDirectory: context.output,
      run: context.run,
      offline: true,
    })
    assert.equal(result.versions['@inkcre/core'].prepared, '0.4.4')
    assert.equal(
      JSON.parse(await readFile(join(context.source, 'packages/core/package.json'), 'utf8'))
        .version,
      '0.4.3'
    )
    assert.match(
      await readFile(join(context.source, '.changeset/compatible.md'), 'utf8'),
      /Compatible capability/
    )
    assert.ok(
      context.calls.some(
        (call) =>
          call.command === 'pnpm' &&
          call.args[0] === 'release:version' &&
          call.cwd === result.candidate
      )
    )
    assert.ok(
      context.calls.some((call) => call.command === 'pnpm' && call.args.includes('--offline'))
    )
    assert.equal(
      context.calls.some((call) => call.args[0] === 'commit'),
      false
    )
    assert.equal(result.source_modified, true)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

void test('a version command that leaves the Host below the producer minimum is rejected', async () => {
  const context = await fixture()
  try {
    const run = async (command, args, cwd) => {
      if (command === 'pnpm' && args[0] === 'release:version') {
        await unlink(join(cwd, '.changeset/compatible.md'))
        return ''
      }
      return context.run(command, args, cwd)
    }
    await assert.rejects(
      prepareNativeCheckout({
        sourceDirectory: context.source,
        outputDirectory: context.output,
        run,
      }),
      /versions are not prepared/
    )
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

void test('loosening a future producer range cannot masquerade as version preparation', async () => {
  const context = await fixture()
  try {
    const run = async (command, args, cwd) => {
      const result = await context.run(command, args, cwd)
      if (command === 'pnpm' && args[0] === 'release:version') {
        const file = join(cwd, 'extensions/example/package.json')
        const value = JSON.parse(await readFile(file, 'utf8'))
        value.inkcre.module_federation.host_sdk_version = '>=0.4.3 <0.5.0'
        await writeFile(file, JSON.stringify(value))
      }
      return result
    }
    await assert.rejects(
      prepareNativeCheckout({
        sourceDirectory: context.source,
        outputDirectory: context.output,
        run,
      }),
      /changed native identity or Host SDK range/
    )
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

void test('source changes during preparation invalidate the candidate without reverting the writer', async () => {
  const context = await fixture()
  try {
    const run = async (command, args, cwd) => {
      const result = await context.run(command, args, cwd)
      if (command === 'pnpm' && args[0] === 'release:version')
        await writeFile(join(context.source, '.changeset/compatible.md'), 'concurrent source work')
      return result
    }
    await assert.rejects(
      prepareNativeCheckout({
        sourceDirectory: context.source,
        outputDirectory: context.output,
        run,
      }),
      /Source changed after snapshot/
    )
    assert.equal(
      await readFile(join(context.source, '.changeset/compatible.md'), 'utf8'),
      'concurrent source work'
    )
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

void test('new source files added during preparation require a fresh snapshot too', async () => {
  const context = await fixture()
  try {
    const run = async (command, args, cwd) => {
      const result = await context.run(command, args, cwd)
      if (command === 'pnpm' && args[0] === 'release:version') {
        context.input['extensions/example/new-source.ts'] = 'export const added = true\n'
        await writeFile(
          join(context.source, 'extensions/example/new-source.ts'),
          context.input['extensions/example/new-source.ts']
        )
      }
      return result
    }
    await assert.rejects(
      prepareNativeCheckout({
        sourceDirectory: context.source,
        outputDirectory: context.output,
        run,
      }),
      /Source file set changed after snapshot/
    )
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})
