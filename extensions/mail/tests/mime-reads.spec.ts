import { expect, test } from '@playwright/test'

const cases = [
  ['parallel', { reads: 1, content: ['Persisted MIME payload', 'Persisted MIME payload'] }],
  ['options', Array(3).fill('Error: Content is already loading')],
  ['failure', { failures: [true, true], reads: 2, retry: 'Persisted MIME payload' }],
  ['self', { error: 'Error: Content is already loading' }],
  ['custom-cycle', { error: 'Error: Content is already loading' }],
  ['custom', { content: 'Custom content remains supported' }],
] as const

for (const [scenario, expected] of cases) {
  test(`MIME read contract: ${scenario}`, async ({ page }) => {
    await page.goto(`/mime-reads.html?case=${scenario}`)
    const result = page.locator('#result')
    await expect(result).not.toHaveText('running')
    expect(JSON.parse(await result.innerText())).toEqual(expected)
  })
}
