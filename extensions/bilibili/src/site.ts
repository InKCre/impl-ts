import { BrowserAccess, type BrowserPage } from '@inkcre/core'
import { parseAccount, parseFavoritePage, parseFolders } from './normalize.ts'
import type { BilibiliSourceConfig } from './schema.ts'

const apiOrigin = 'https://api.bilibili.com'

async function readJson(page: BrowserPage, path: string, parameters: Record<string, string> = {}) {
  const url = new URL(path, apiOrigin)
  url.search = new URLSearchParams(parameters).toString()
  return page.evaluate(async (address) => {
    // This runs in the selected logged-in tab; credentials never leave the browser profile.
    const response = await fetch(address, { credentials: 'include' })
    if (!response.ok) throw new Error(`B 站请求失败（HTTP ${response.status}）。`)
    const value: unknown = await response.json()
    return value
  }, url.href)
}

export async function readAccount(page: BrowserPage) {
  return parseAccount(await readJson(page, '/x/web-interface/nav'))
}

export async function discoverFavorites(provider: string, signal: AbortSignal) {
  return BrowserAccess.withPage({ provider, target: { kind: 'new' }, signal }, async (page) => {
    await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' })
    signal.throwIfAborted()
    const account = await readAccount(page)
    const folders = parseFolders(
      await readJson(page, '/x/v3/fav/folder/created/list-all', {
        up_mid: account.mid,
      }),
      account.mid
    )
    signal.throwIfAborted()
    return { account, folders }
  })
}

export class FavoriteSession {
  constructor(
    private readonly page: BrowserPage,
    readonly config: BilibiliSourceConfig
  ) {}

  async open(folder: string) {
    await this.page.goto(
      `https://space.bilibili.com/${this.config.account_mid}/favlist?fid=${folder}&ftype=create`,
      {
        waitUntil: 'domcontentloaded',
      }
    )
  }

  async account() {
    const account = await readAccount(this.page)
    if (account.mid !== this.config.account_mid)
      throw new Error('所选浏览器的 B 站账号已改变，请重新确认采集源。')
    return account
  }

  async read(folder: string, pageNumber: number) {
    return parseFavoritePage(
      await readJson(this.page, '/x/v3/fav/resource/list', {
        media_id: folder,
        pn: String(pageNumber),
        ps: '20',
        order: 'mtime',
        type: '0',
        tid: '0',
        platform: 'web',
      }),
      this.config.account_mid,
      folder,
      pageNumber
    )
  }
}
