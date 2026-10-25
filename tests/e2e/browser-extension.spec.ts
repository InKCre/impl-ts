import { expect, test } from './browser-extension-fixture'

test('built Chromium extension loads its real popup', async ({ context, page, extensionId }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route(/^https?:\/\//, (route) =>
    route.fulfill({
      body: JSON.stringify({ code: 'PGRST116', message: 'Client not found in E2E fixture' }),
      contentType: 'application/json',
      status: 406,
    })
  )

  const [serviceWorker] = context.serviceWorkers()
  await serviceWorker.evaluate(
    async (metaConfig) => {
      await (
        globalThis as typeof globalThis & {
          chrome: {
            storage: {
              local: {
                set(value: Record<string, string>): Promise<void>
              }
            }
          }
        }
      ).chrome.storage.local.set({
        inkcre_app_config: JSON.stringify(metaConfig),
      })
    },
    {
      INKCRE_PEER_ID: '063cd1df-c495-5006-a119-67aa633b26be',
      INKCRE_JWT_SECRET: 'client-webext-e2e-secret-at-least-32-bytes',
      INKCRE_PGREST_URL: 'http://127.0.0.1:9/',
    }
  )

  await page.goto(`chrome-extension://${extensionId}/popup.html`)

  expect(pageErrors).toEqual([])
  await expect(page.getByText('Popup', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Options' })).toBeVisible()
})

test('saved API connections survive reload and switch across open option pages', async ({
  context,
  page,
  extensionId,
}) => {
  const [worker] = context.serviceWorkers()
  await worker.evaluate(async () => {
    const chrome = (globalThis as any).chrome
    await chrome.storage.local.set({ inkcreApi: 'https://first.example' })
  })
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(page.getByLabel('API 地址')).toHaveValue('https://first.example')
  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  await page.getByLabel('连接名称', { exact: true }).fill('工作')
  await page.getByLabel('API 地址').fill('https://second.example')
  await page.getByRole('button', { name: '保存并使用连接' }).click()
  await expect(page.getByRole('status')).toHaveText('已切换连接。')
  await page.reload()
  await expect(page.getByLabel('API 地址')).toHaveValue('https://second.example')
  const other = await context.newPage()
  await other.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(other.getByLabel('API 地址')).toHaveValue('https://second.example')
  await page.getByLabel('当前连接').selectOption({ label: 'first.example' })
  await expect(page.getByLabel('API 地址')).toHaveValue('https://first.example')
  await expect(other.getByLabel('API 地址')).toHaveValue('https://first.example')
  await other.reload()
  await expect(other.getByLabel('API 地址')).toHaveValue('https://first.example')
  await expect(other.getByLabel('当前连接').locator('option')).toHaveCount(2)
  await other.close()
})
