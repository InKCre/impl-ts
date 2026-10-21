import DOMPurify from 'dompurify'
import type { SolvedEmail } from './schema'

export const NEWSLETTER_HTML = 'extensions.mail.newsletter_html.v1'
export const NEWSLETTER_TEXT = 'extensions.mail.newsletter_text.v1'
export const HTML_BODIES = new Set(['core.html.v1', NEWSLETTER_HTML])
export const TEXT_BODIES = new Set(['core.text.v1', NEWSLETTER_TEXT])

const control =
  /^(?:unsubscribe(?: from (?:this list|these emails))?|manage (?:your )?(?:email )?(?:preferences|subscription)|(?:email|subscription) preferences|update your email preferences or unsubscribe here|click here to unsubscribe\.?|read online|share (?:on|via) (?:facebook|twitter|x|threads|linkedin)|view (?:this email |this message )?in (?:your )?browser|退订|取消订阅|管理订阅|管理订阅偏好|在浏览器中(?:查看|阅读))$/i
const hiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?|max-height\s*:\s*0(?:px)?)\s*(?:!important\s*)?(?:;|$)/i
const trackingParameters = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid'])
const signatureParameters = new Set(['signature', 'sig', 'x-amz-signature', 'x-goog-signature'])

export function cleanLink(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return value
    if ([...url.searchParams.keys()].some((key) => signatureParameters.has(key.toLowerCase())))
      return value
    // Keep the original encoding of signed and functional query values.
    const [withoutFragment, ...fragment] = value.split('#')
    const queryIndex = withoutFragment!.indexOf('?')
    if (queryIndex < 0) return value
    const query = withoutFragment!
      .slice(queryIndex + 1)
      .split('&')
      .filter((item) => {
        const key = new URLSearchParams(item).keys().next().value?.toLowerCase() ?? ''
        return !key.startsWith('utm_') && !trackingParameters.has(key)
      })
      .join('&')
    if (query === withoutFragment!.slice(queryIndex + 1)) return value
    return (
      withoutFragment!.slice(0, queryIndex) +
      (query ? `?${query}` : '') +
      (fragment.length ? `#${fragment.join('#')}` : '')
    )
  } catch {
    return value
  }
}

export function cleanNewsletterHtml(source: string): string {
  const document = DOMPurify.sanitize(source, { RETURN_DOM: true }) as HTMLElement
  for (const element of document.querySelectorAll<HTMLElement>('*')) {
    if (!document.contains(element)) continue
    const hidden =
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden')?.toLowerCase() === 'true' ||
      hiddenStyle.test(element.getAttribute('style') ?? '')
    const pixel =
      element.tagName === 'IMG' &&
      ['width', 'height'].some((size) =>
        /^[01](?:px)?$/.test(element.getAttribute(size)?.trim() ?? '')
      )
    const label =
      element.textContent?.trim() ||
      (element.tagName === 'A'
        ? [...element.querySelectorAll('img')].map((image) => image.alt).join(' ')
        : '')
    if (['HEAD', 'SCRIPT', 'STYLE', 'TEMPLATE'].includes(element.tagName) || hidden || pixel) {
      element.remove()
    } else if (
      ['A', 'P'].includes(element.tagName) &&
      control.test(label.replace(/\s+/g, ' ').trim())
    ) {
      element.remove()
    } else if (element.tagName === 'A' && element.hasAttribute('href')) {
      element.setAttribute('href', cleanLink(element.getAttribute('href')!))
    }
  }
  return document.innerHTML.trim()
}

export function cleanNewsletterText(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const label = line.trim()
      if (control.test(label)) return false
      const link = /^(.+?)\s*(?::\s*|\s+)(https?:\/\/\S+)$/.exec(label)
      return !link || !control.test(link[1]!.trim())
    })
    .map((line) => line.replace(/https?:\/\/[^\s<>]+/g, cleanLink))
    .join('\n')
    .trim()
}

export function htmlText(source: string, includeLinkTargets = true): string {
  const document = DOMPurify.sanitize(source, { RETURN_DOM: true }) as HTMLElement
  if (!includeLinkTargets) {
    const walker = document.ownerDocument.createTreeWalker(document, NodeFilter.SHOW_TEXT)
    const words: string[] = []
    while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '')
    return words.join(' ').replace(/\s+/g, ' ').trim()
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    anchor.append(` (${anchor.getAttribute('href')})`)
  }
  for (const block of document.querySelectorAll('p,div,li,h1,h2,h3,h4,br,tr')) {
    block.append('\n')
  }
  return document.textContent?.trim() ?? ''
}

export function readingBodies(bodies: SolvedEmail['bodies']): SolvedEmail['bodies'] {
  if (bodies.length && bodies.every((body) => body.relation.alternative_groups === null)) {
    // Legacy relations lost the MIME tree; preserve the established HTML-first view.
    const body = bodies.find((item) => HTML_BODIES.has(item.block.resolver)) ?? bodies[0]!
    return [body]
  }
  const ordered = [...bodies].sort((left, right) =>
    left.relation.part_id.localeCompare(right.relation.part_id, 'en', { numeric: true })
  )
  const preferred = new Map<string, string>()
  for (const body of ordered) {
    for (const group of body.relation.alternative_groups ?? []) {
      const depth = group === 'root' ? 0 : group.split('.').length
      const branch = body.relation.part_id.split('.')[depth]!
      if (!preferred.has(group) || HTML_BODIES.has(body.block.resolver))
        preferred.set(group, branch)
    }
  }
  return ordered.filter((body) => {
    return (body.relation.alternative_groups ?? []).every((group) => {
      const depth = group === 'root' ? 0 : group.split('.').length
      return body.relation.part_id.split('.')[depth] === preferred.get(group)
    })
  })
}
