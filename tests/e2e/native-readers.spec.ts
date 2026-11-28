import { expect, test as base } from '@playwright/test'
import { setupNativeDatabase, serveBuiltExtension } from './native-extension-fixture'

type Graph = {
  block(resolver: string, content: string | object): Promise<number>
  changeText(id: number, content: string): Promise<void>
  relate(from: number, to: number, role: string): Promise<void>
}

const test = base.extend<{ graph: Graph }>({
  async graph({ page }, use) {
    const { database, browserPeer } = await setupNativeDatabase(page)
    const created = [
      `peers?id=eq.${browserPeer}`,
      `extension_peer_participations?peer_id=eq.${browserPeer}`,
    ]
    async function insert(table: string, data: object) {
      const [row] = await database<{ id: number }>(table, 'POST', data)
      created.push(`${table}?id=eq.${row!.id}`)
      return row!.id
    }
    try {
      await use({
        block: (resolver, content) =>
          insert('blocks', {
            resolver,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            storage: null,
          }),
        async changeText(id, content) {
          await database(`blocks?id=eq.${id}`, 'PATCH', { content })
        },
        async relate(from, to, role) {
          await insert('relations', { from_: from, to_: to, content: role })
        },
      })
    } finally {
      if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
      for (const path of created.reverse()) await database(path, 'DELETE')
    }
  },
})

test('Capture reads ordered materials and a separate annotation, and reports incomplete stored captures', async ({
  page,
  graph,
}) => {
  const extension = await serveBuiltExtension(page, 'capture')
  await extension.install()
  const metadata = {
    submission_id: crypto.randomUUID(),
    payload_digest: 'a'.repeat(64),
    captured_at: '2026-11-01T01:00:00Z',
    entry: 'paste',
    origin: { title: 'Offline capture' },
  }
  const root = await graph.block('extensions.capture.capture.v1', metadata)
  const first = await graph.block('core.text.v1', 'First source passage')
  const second = await graph.block('core.text.v1', 'Second source passage')
  const note = await graph.block('core.text.v1', 'My own observation')
  await graph.relate(root, second, 'material:1')
  await graph.relate(root, note, 'annotation')
  await graph.relate(root, first, 'material:0')
  await page.goto(`/info-base/list/blocks/${root}/content`)
  const popup = page.getByRole('dialog', { name: 'Content' })
  const materials = popup.getByRole('region', { name: '原始材料' })
  await expect(materials).toContainText(/First source passage\s*Second source passage/)
  await expect(materials).not.toContainText('My own observation')
  await expect(popup.getByRole('region', { name: '补充想法' })).toContainText('My own observation')

  const empty = await graph.block('extensions.capture.capture.v1', {
    ...metadata,
    submission_id: crypto.randomUUID(),
  })
  await page.goto(`/info-base/list/blocks/${empty}/content`)
  await expect(popup).toContainText('采集内容缺少材料和附注。')
  await graph.relate(empty, note, 'annotation')
  await page.reload()
  await expect(popup.getByRole('region', { name: '补充想法' })).toContainText('My own observation')
})

test('Local Files reads the last saved body offline, using each stored resolver version', async ({
  page,
  graph,
}) => {
  const extension = await serveBuiltExtension(page, 'local-files')
  await extension.install()
  const metadata = {
    location: 'inkcre-peer-file://a143b185-f43d-47d1-8ef7-1d3857284b01/Notes/field%20log.md',
    format: 'markdown',
    available: false,
    observed_at: '2026-11-02T00:00:00Z',
    issue: '目录已离线',
    revision: {
      sha256: 'a'.repeat(64),
      extractor: 'mac-native-content.v2',
      extracted_at: '2026-11-01T00:00:00Z',
      scope: 'text',
    },
  }
  const legacy = await graph.block('extensions.local_files.file.v1', metadata)
  const modern = await graph.block('extensions.local_files.file.v2', metadata)
  const markdown = await graph.block(
    'core.markdown.v1',
    '# Field observations\n\nRecorded offline.'
  )
  const plain = await graph.block('core.text.v1', '# Legacy markup is literal')
  await graph.relate(legacy, plain, 'body')
  await graph.relate(modern, markdown, 'body')
  const popup = page.getByRole('dialog', { name: 'Content' })
  await page.goto(`/info-base/list/blocks/${legacy}/content`)
  await expect(popup).toContainText('# Legacy markup is literal')
  await page.goto(`/info-base/list/blocks/${modern}/content`)
  await expect(popup).toContainText('目录已离线')
  await expect(popup).toContainText('/Notes/field log.md')
  await expect(
    popup.frameLocator('iframe').getByRole('heading', { name: 'Field observations' })
  ).toBeVisible()

  const invalid = await graph.block('extensions.local_files.file.v1', metadata)
  await graph.relate(invalid, markdown, 'body')
  await page.goto(`/info-base/list/blocks/${invalid}/content`)
  await expect(popup).toContainText('文件正文不存在或类型不符。')
})

test('CalDAV displays the latest property Block in a stored v2 contact graph', async ({
  page,
  graph,
}) => {
  const extension = await serveBuiltExtension(page, 'caldav')
  await extension.install()
  const root = await graph.block('extensions.caldav.contact.v2', {
    href: 'contacts/team.vcf',
    remainder: 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:contact-42\r\nFN:Field team\r\nEND:VCARD',
  })
  const phone = await graph.block('core.text.v1', '+1 555 0100')
  await graph.relate(
    root,
    phone,
    'caldav:property:' +
      JSON.stringify({
        component: null,
        alarm: null,
        name: 'TEL',
        params: { TYPE: ['work'] },
        group: null,
        position: 0,
        representation: 'text',
        media_type: null,
      })
  )
  await page.goto(`/info-base/list/blocks/${root}/content`)
  const popup = page.getByRole('dialog', { name: 'Content' })
  await expect(popup).toContainText('Field team')
  await expect(popup).toContainText('+1 555 0100')
  await graph.changeText(phone, '+1 555 0199')
  await page.reload()
  await expect(popup).toContainText('+1 555 0199')
  await expect(popup).not.toContainText('+1 555 0100')
})
