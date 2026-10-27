/** Preserve facts explicitly present in loaded Discourse posts. */
export function discourseHTML(document: Document): string | null {
  const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content')
  if (!generator || !/^Discourse(?:\s|$)/i.test(generator)) return null

  const selector = '.crawler-post, article[data-post-id]'
  const posts = [...document.querySelectorAll(selector)].filter(
    (post) => !post.parentElement?.closest(selector)
  )
  if (!posts.length) return null

  const sections = new Map<string, string>()
  for (const post of posts) {
    const body = post.querySelector(':scope > .post, .cooked')
    if (!body?.textContent?.trim()) return null
    const header = [...post.querySelectorAll('.crawler-post-meta, .topic-meta-data')].find(
      (element) => !body.contains(element)
    )
    const number =
      post.getAttribute('data-post-number') ??
      header?.querySelector('[itemprop="position"]')?.textContent?.trim() ??
      /^post_([1-9][0-9]*)$/.exec(post.id)?.[1]
    if (!number || !/^[1-9][0-9]*$/.test(number)) return null
    const author = header?.querySelector('.creator, .names .username')
    const name = author?.textContent?.replace(/\s+/g, ' ').trim()
    const date = header?.querySelector('time[datetime], .post-date')
    const time = date?.getAttribute('datetime') ?? date?.textContent?.replace(/\s+/g, ' ').trim()
    const heading = [`#${number}`, name, time].filter(Boolean).join(' · ')

    const article = document.createElement('article')
    article.id = `post_${number}`
    const label = document.createElement('header')
    label.textContent = heading
    article.append(label, body.cloneNode(true))
    const section = article.outerHTML
    // Responsive copies may repeat a post; conflicting copies need the generic path.
    if (sections.has(number) && sections.get(number) !== section) return null
    sections.set(number, section)
  }
  return [...sections.values()].join('\n')
}
