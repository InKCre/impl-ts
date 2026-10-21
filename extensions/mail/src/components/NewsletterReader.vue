<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { configStore, type Block } from '@inkcre/core'
import { InkButton } from '@inkcre/ui-web'

const props = defineProps<{ block: Block; html: string }>()
const frame = ref<HTMLIFrameElement>()
const reader = ref<HTMLElement>()
const height = ref(400)
const headings = ref<Array<{ label: string; level: number }>>([])
const active = ref(0)
const outlineOpen = ref(true)
const resume = ref<number | null>(null)
const storageError = ref(false)
let elements: HTMLElement[] = []
let resize: ResizeObserver | undefined
let scrollRoot: HTMLElement | null = null
let scheduled = 0
let wide: boolean | undefined

function positionKey(): string {
  return `inkcre.mail.reading.v1:${JSON.stringify([
    configStore.metaConfig.INKCRE_PGREST_URL,
    props.block.id,
  ])}`
}

function savePosition(index: number): void {
  const heading = headings.value[index]
  if (!heading) return
  try {
    localStorage.setItem(
      positionKey(),
      JSON.stringify({
        version: props.block.updated_at.toISOString(),
        index,
        label: heading.label,
      })
    )
    storageError.value = false
  } catch {
    storageError.value = true
  }
}

function loadPosition(): void {
  resume.value = null
  try {
    const saved = JSON.parse(localStorage.getItem(positionKey()) ?? 'null')
    if (
      saved?.version === props.block.updated_at.toISOString() &&
      Number.isInteger(saved.index) &&
      saved.index > 0 &&
      headings.value[saved.index]?.label === saved.label
    )
      resume.value = saved.index
  } catch {
    storageError.value = true
  }
}

function scrollTopBoundary(): number {
  return scrollRoot === document.scrollingElement
    ? 0
    : (scrollRoot?.getBoundingClientRect().top ?? 0)
}

function updateActive(): void {
  scheduled = 0
  if (!frame.value || !scrollRoot || !elements.length) return
  const frameTop = frame.value.getBoundingClientRect().top
  const boundary = scrollTopBoundary() + 32
  let index = 0
  for (const [i, element] of elements.entries()) {
    if (frameTop + element.getBoundingClientRect().top > boundary) break
    index = i
  }
  if (active.value !== index) {
    active.value = index
    savePosition(index)
  }
}

function onScroll(): void {
  if (!scheduled) scheduled = requestAnimationFrame(updateActive)
}

function jump(index: number): void {
  const heading = elements[index]
  if (!heading || !frame.value || !scrollRoot) return
  const top =
    scrollRoot.scrollTop +
    frame.value.getBoundingClientRect().top +
    heading.getBoundingClientRect().top -
    scrollTopBoundary() -
    24
  scrollRoot.scrollTo({ top, behavior: 'instant' })
  heading.focus({ preventScroll: true })
  active.value = index
  resume.value = null
  savePosition(index)
  if (!wide) outlineOpen.value = false
}

async function loaded(): Promise<void> {
  resize?.disconnect()
  elements = []
  headings.value = []
  active.value = 0
  const content = frame.value?.contentDocument
  if (!content?.body || !reader.value) return
  elements = [...content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].filter((heading) =>
    heading.textContent?.trim()
  )
  for (const element of elements) element.tabIndex = -1
  headings.value = elements.map((element) => ({
    label: element.textContent!.replace(/\s+/g, ' ').trim(),
    level: Number(element.tagName.slice(1)),
  }))
  loadPosition()
  const measure = () => {
    height.value = Math.ceil(content.body.getBoundingClientRect().height)
    const nextWide = (reader.value?.clientWidth ?? 0) >= 720
    if (nextWide !== wide) {
      wide = nextWide
      outlineOpen.value = nextWide
    }
  }
  measure()
  resize = new ResizeObserver(measure)
  resize.observe(content.body)
  resize.observe(reader.value)
  await nextTick()
  if (frame.value?.contentDocument !== content) return
  scrollRoot = reader.value?.parentElement ?? null
  while (scrollRoot && !/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY)) {
    scrollRoot = scrollRoot.parentElement
  }
  scrollRoot ??= document.scrollingElement as HTMLElement
}

window.addEventListener('scroll', onScroll, true)
onBeforeUnmount(() => {
  resize?.disconnect()
  window.removeEventListener('scroll', onScroll, true)
  cancelAnimationFrame(scheduled)
})
</script>

<template>
  <section ref="reader" class="newsletter-reader" aria-label="Newsletter 阅读">
    <div class="newsletter-reader__layout">
      <aside v-if="headings.length" class="newsletter-reader__outline">
        <details
          :open="outlineOpen"
          @toggle="outlineOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>本期目录 · {{ headings.length }}</summary>
          <nav aria-label="文章目录">
            <div class="newsletter-reader__steps">
              <InkButton size="sm" :disabled="active === 0" @click="jump(active - 1)"
                >上一篇</InkButton
              >
              <InkButton
                size="sm"
                :disabled="active >= headings.length - 1"
                @click="jump(active + 1)"
                >下一篇</InkButton
              >
            </div>
            <ol>
              <li v-for="(heading, index) in headings" :key="index">
                <button
                  type="button"
                  :aria-current="active === index ? 'location' : undefined"
                  :data-level="heading.level"
                  @click="jump(index)"
                >
                  {{ heading.label }}
                </button>
              </li>
            </ol>
          </nav>
        </details>
        <p v-if="storageError" role="status">浏览器暂时无法保存阅读位置。</p>
      </aside>
      <div class="newsletter-reader__body">
        <InkButton v-if="resume !== null" class="newsletter-reader__resume" @click="jump(resume)">
          继续阅读：{{ headings[resume]?.label }}
        </InkButton>
        <!-- Parent DOM access enables navigation; sandbox and CSP still prohibit all message scripts. -->
        <iframe
          ref="frame"
          title="Email HTML body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          :srcdoc="html"
          :style="{ height: `${height}px` }"
          @load="loaded"
        />
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.newsletter-reader {
  min-width: 0;
  container-type: inline-size;
  &__layout {
    display: grid;
    gap: sys-var(space, lg);
    align-items: start;
  }
  &__outline {
    min-width: 0;
    @include apply-font(body-sm);
    summary {
      cursor: pointer;
      font-weight: 600;
      padding-block: sys-var(space, sm);
    }
    nav {
      max-height: 64vh;
      overflow: auto;
      overscroll-behavior: contain;
    }
    ol {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    button:not(.ink-button) {
      display: block;
      width: 100%;
      border: 0;
      border-inline-start: 2px solid transparent;
      padding: sys-var(space, sm);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: start;
      overflow-wrap: anywhere;
      cursor: pointer;
      &[data-level='6'] {
        padding-inline-start: sys-var(space, lg);
      }
      &[aria-current] {
        border-color: sys-var(color, text, base);
        background: sys-var(color, surface, subtle);
        font-weight: 600;
      }
      &:focus-visible {
        outline: 2px solid sys-var(color, border, strong);
        outline-offset: -2px;
      }
    }
  }
  &__steps {
    display: flex;
    justify-content: space-between;
    gap: sys-var(space, sm);
    padding-block: sys-var(space, sm);
  }
  &__body {
    min-width: 0;
  }
  &__resume {
    margin-bottom: sys-var(space, md);
  }
  iframe {
    display: block;
    width: 100%;
    border: 0;
    background: #fff;
  }
}
@container (min-width: 720px) {
  .newsletter-reader__layout {
    grid-template-columns: 13rem minmax(0, 1fr);
  }
  .newsletter-reader__outline {
    position: sticky;
    top: 0;
    border-inline-end: 1px solid sys-var(color, border, subtle);
    padding-inline-end: sys-var(space, md);
  }
}
</style>
