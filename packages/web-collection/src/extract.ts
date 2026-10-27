import { Readability } from '@mozilla/readability'
import { discourseHTML } from './discourse'

/** Only consumes already acquired data; no peer, network or storage initialization. */
export function extractPage(html: string, url: string, structuredData: readonly string[] = []) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const title = document.title
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
  const embedded = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
    (element) => element.textContent ?? ''
  )
  for (const element of document.querySelectorAll(
    'script,style,noscript,template,form,input:not([type="checkbox"]),textarea,select,button,[contenteditable]:not([contenteditable="false" i])'
  ))
    element.remove()
  // Acquisition owns the base address, never an untrusted <base> declaration.
  for (const element of document.querySelectorAll('[href],[src],[poster]')) {
    for (const attr of ['href', 'src', 'poster']) {
      const value = element.getAttribute(attr)
      if (!value || value.startsWith('#')) continue
      try {
        const target = new URL(value, url)
        if (['http:', 'https:'].includes(target.protocol)) element.setAttribute(attr, target.href)
        else element.removeAttribute(attr)
      } catch {
        element.removeAttribute(attr)
      }
    }
  }
  const host = new URL(url).hostname
  let body: string | null | undefined = discourseHTML(document)
  const fragment = document.createElement('section')
  if (!body && host === 'github.com') {
    const objects = document.querySelectorAll('[data-testid="issue-body"], .react-issue-comment')
    if (objects.length) {
      const state = document.querySelector('[data-testid="header-state"]')
      if (state) fragment.append(state.cloneNode(true))
      for (const object of objects) fragment.append(object.cloneNode(true))
    } else
      for (const object of document.querySelectorAll('.markdown-body')) {
        if (!object.parentElement?.closest('.markdown-body'))
          fragment.append(object.cloneNode(true))
      }
  }
  if (!body && host === 'chatgpt.com') {
    for (const message of document.querySelectorAll(
      '[data-message-id][data-message-author-role]'
    )) {
      const article = document.createElement('article')
      article.id = message.getAttribute('data-message-id')!
      const author = document.createElement('header')
      author.textContent = message.getAttribute('data-message-author-role')
      article.append(author, message.cloneNode(true))
      fragment.append(article)
    }
  }
  if (!body && (host === 'notion.site' || host.endsWith('.notion.site'))) {
    const content = document.querySelector('main.notion-frame')
    if (content) fragment.append(content.cloneNode(true))
  }
  if (!body && fragment.textContent?.trim()) body = fragment.innerHTML
  if (!body && host === 'bsky.app') {
    // Loaded DOM may cover a different range than the embedded profile. Keep it whole.
    const main = document.querySelector('main, [role="main"]')
    if (main?.querySelector('a[href*="/post/"]')) body = main.outerHTML
    else body = blueskyHTML(document, [...structuredData, ...embedded])
  }
  if (
    !body &&
    ((host === 'chatgpt.com' && new URL(url).pathname.startsWith('/share/')) ||
      (host === 'bsky.app' && new URL(url).pathname.startsWith('/profile/')) ||
      host === 'notion.site' ||
      host.endsWith('.notion.site'))
  )
    throw new Error('未取得已加载正文，需要打开原页补采。')
  if (!body) body = new Readability(document.cloneNode(true) as Document).parse()?.content
  if (!body?.trim()) body = document.body.innerHTML
  const check = new DOMParser().parseFromString(body, 'text/html')
  // Article cleanup may drop media; retain already acquired files and caption references.
  const targets = new Set(
    [...check.querySelectorAll('[href],[src],[poster]')].flatMap((element) =>
      ['href', 'src', 'poster'].map((name) => element.getAttribute(name)).filter(Boolean)
    )
  )
  for (const media of document.querySelectorAll('video,audio')) {
    const resources = [media, ...media.querySelectorAll('source,track')]
    const urls = resources.flatMap((element) =>
      ['src', 'poster']
        .map((name) => element.getAttribute(name))
        .filter((value): value is string => !!value)
    )
    if (urls.some((url) => !targets.has(url))) {
      check.body.append(media.cloneNode(true))
      for (const url of urls) targets.add(url)
    }
  }
  if (!check.body.textContent?.trim()) throw new Error('未取得可读正文，需要打开原页补采。')
  if (/sign\s?in|log\s?in|登录|验证码|captcha/i.test(title) && check.body.textContent.length < 2000)
    throw new Error('该页可能需要登录或交互，请在浏览器中打开后保存。')
  let canonicalURL: string | undefined
  if (canonical) {
    try {
      canonicalURL = new URL(canonical, url).href
    } catch {
      /* Invalid source metadata has no target. */
    }
  }
  return { html: check.body.innerHTML, title, canonical: canonicalURL }
}

function blueskyHTML(document: Document, data: readonly string[]): string | null {
  const root = document.createElement('section')
  const seen = new Set<string>()
  function post(value: unknown): HTMLElement | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    if (
      item['@type'] !== 'DiscussionForumPosting' ||
      typeof item.url !== 'string' ||
      typeof item.text !== 'string'
    )
      return null
    if (!/^https:\/\/bsky\.app\/profile\/[^/]+\/post\/[^/?#]+$/.test(item.url)) return null
    const article = document.createElement('article')
    const header = document.createElement('header')
    const link = document.createElement('a')
    link.href = item.url
    const author =
      item.author && typeof item.author === 'object'
        ? (item.author as Record<string, unknown>)
        : null
    link.textContent = typeof author?.name === 'string' ? author.name : item.url
    header.append(link)
    if (typeof item.datePublished === 'string') {
      const time = document.createElement('time')
      time.dateTime = item.datePublished
      time.textContent = item.datePublished
      header.append(' · ', time)
    }
    const text = document.createElement('p')
    // JSON-LD text is text, never HTML or executable bootstrap state.
    text.style.whiteSpace = 'pre-wrap'
    for (const [index, line] of item.text.split('\n').entries()) {
      if (index) text.append(document.createElement('br'))
      text.append(line)
    }
    article.append(header, text)
    const quote = post(item.sharedContent)
    if (quote) {
      const block = document.createElement('blockquote')
      block.append(quote)
      article.append(block)
    }
    return article
  }
  for (const source of data) {
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      continue
    }
    const items = Array.isArray(parsed) ? parsed : [parsed]
    for (const value of items) {
      if (!value || typeof value !== 'object') continue
      const posts = 'hasPart' in value && Array.isArray(value.hasPart) ? value.hasPart : [value]
      for (const item of posts) {
        const article = post(item)
        const address = article?.querySelector('a')?.href
        if (article && address && !seen.has(address)) {
          seen.add(address)
          root.append(article)
        }
      }
    }
  }
  return root.childElementCount ? root.innerHTML : null
}
