<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import { VueFlow, useNodesInitialized, useVueFlow, type NodeDragEvent } from '@vue-flow/core'
import { InkButton, InkDropdown, InkForm, InkLoading } from '@inkcre/ui-web'
import {
  CapabilityDelegationUnavailable,
  configStore,
  UnknownResolverError,
  getInfoBaseRouter,
  GraphNavigationRetrievalManager,
  LexicalRetrievalManager,
  presentLexicalMatches,
  ResolverCache,
  type Block,
  type GraphDirection,
  type GraphModel,
  type InfoBaseRoute,
  type Relation,
} from '@inkcre/core'

import { extensionHostRestoreState, getExtensionHost } from '@/core'
import BlockNodeComponent from '@/components/info-base/BlockNode/BlockNode.vue'
import RelationEdgeComponent from '@/components/info-base/RelationEdge/RelationEdge.vue'
import BlockInspectorPopup from '@/components/info-base/BlockInspectorPopup/BlockInspectorPopup.vue'
import RelationInspectorPopup from '@/components/info-base/RelationInspectorPopup/RelationInspectorPopup.vue'
import SolvedContentPopup from '@/components/info-base/SolvedContentPopup/SolvedContentPopup.vue'
import { blockNode, relationEdge, type BlockNode, type RelationEdge } from './graph-model'
import { openRecallSearch } from '@/components/recall/recall-search'

type SceneScale = 'compact' | 'standard' | 'broad'
type SceneStatus = 'loading' | 'ready' | 'empty' | 'missing' | 'not-found' | 'limit' | 'error'

const SCALE_LIMITS: Record<SceneScale, number> = { compact: 8, standard: 20, broad: 50 }
const container = ref<HTMLElement | null>(null)
const infoBaseRouter = getInfoBaseRouter()
const currentRoute = computed(() => infoBaseRouter.current.value)
const nodes = shallowRef<BlockNode[]>([])
const edges = shallowRef<RelationEdge[]>([])
const status = ref<SceneStatus>('loading')
const delegationUnavailable = ref(false)
const scale = ref<SceneScale>('standard')
const direction = ref<GraphDirection>('both')
const previewReady = ref(false)
const pendingCamera = ref(false)
const positionCache = new Map<string, { x: number; y: number }>()
const draggedNodes = new Set<string>()
let generation = 0
let realizing = false
let realizationRequested = false

const { fitView, zoomIn, zoomOut, getNodes, onMoveStart, updateNodeInternals } = useVueFlow()
const nodesInitialized = useNodesInitialized()
onMoveStart(() => {
  pendingCamera.value = false
})

const sceneAddress = computed(() => {
  const route = currentRoute.value
  if (!route) return null
  if (route.path_from !== undefined && route.path_to !== undefined) {
    return { type: 'path' as const, from: route.path_from, to: route.path_to }
  }
  if (route.focal_relation !== undefined) {
    return { type: 'relation' as const, relation: route.focal_relation }
  }
  if (route.focal_block !== undefined) {
    return { type: 'block' as const, block: route.focal_block }
  }
  if (route.q) return { type: 'recall' as const, query: route.q }
  if (route.name === 'relation') return { type: 'relation' as const, relation: route.relation }
  if (route.name === 'block' || route.name === 'solved-content') {
    return { type: 'block' as const, block: route.block }
  }
  return { type: 'random' as const }
})

const sceneKey = computed(() => JSON.stringify(sceneAddress.value))
// Restore may register reading destinations after the initial query has already returned.
watch(extensionHostRestoreState, (state) => {
  if (['restored', 'failed'].includes(state) && sceneAddress.value?.type === 'recall') {
    void loadScene()
  }
})
const focalBlock = computed(() => {
  const address = sceneAddress.value
  return address?.type === 'block' ? address.block : null
})
const focalRelation = computed(() => {
  const address = sceneAddress.value
  return address?.type === 'relation' ? address.relation : null
})

const sceneDescription = computed(() => {
  const address = sceneAddress.value
  if (address?.type === 'block') return `Around Block #${address.block}`
  if (address?.type === 'relation') return `Around Relation #${address.relation}`
  if (address?.type === 'path') return `Path from #${address.from} to #${address.to}`
  if (address?.type === 'recall') return `Results for “${address.query}”`
  return 'Explore your information'
})
const scaleOptions = [
  { value: 'compact', label: 'Small · 8 relations' },
  { value: 'standard', label: 'Standard · 20 relations' },
  { value: 'broad', label: 'Large · 50 relations' },
]
const directionOptions = [
  { value: 'both', label: 'Both directions' },
  { value: 'in', label: 'Incoming' },
  { value: 'out', label: 'Outgoing' },
]

function activeRelation(relation: Relation): boolean {
  if (direction.value === 'both') return true
  if (focalRelation.value === relation.id) return true
  if (focalBlock.value === null) return true
  return direction.value === 'out'
    ? relation.from_ === focalBlock.value
    : relation.to_ === focalBlock.value
}

function applyPresentation(): void {
  const activeBlocks = new Set<number>()
  if (focalBlock.value !== null) activeBlocks.add(focalBlock.value)
  for (const edge of edges.value) {
    if (activeRelation(edge.data.relation)) {
      activeBlocks.add(edge.data.relation.from_)
      activeBlocks.add(edge.data.relation.to_)
    }
  }
  edges.value = edges.value.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      focal: edge.data.relation.id === focalRelation.value,
      muted: !activeRelation(edge.data.relation),
    },
  }))
  nodes.value = nodes.value.map((node) => ({
    ...node,
    data: {
      ...node.data,
      focal: node.data.block.id === focalBlock.value,
      muted: direction.value !== 'both' && !activeBlocks.has(node.data.block.id),
    },
  }))
}

function setGraph(graph: GraphModel): void {
  const incident = new Map<number, Relation[]>()
  for (const relation of graph.relations) {
    incident.set(relation.from_, [...(incident.get(relation.from_) ?? []), relation])
    incident.set(relation.to_, [...(incident.get(relation.to_) ?? []), relation])
  }
  nodes.value = graph.blocks.map((block) =>
    blockNode(block, {
      focal: block.id === focalBlock.value,
      muted: false,
      position: positionCache.get(String(block.id)),
    })
  )
  edges.value = graph.relations.map((relation) =>
    relationEdge(relation, {
      focal: relation.id === focalRelation.value,
      muted: false,
    })
  )
  applyPresentation()
  void loadPreviews(graph.blocks, incident, generation)
}

interface PendingPreview {
  block: Block
  relations: Relation[]
  owns: () => boolean
}
const pendingPreviews = shallowRef<PendingPreview[]>([])

function updatePreviewReady(): void {
  previewReady.value = nodes.value.every((node) => node.data.previewStatus !== 'loading')
}
async function resolvePreview(entry: PendingPreview, allowRestoreRetry: boolean): Promise<void> {
  if (!entry.owns()) return
  const lookupBeforeRestore =
    allowRestoreRetry && ['idle', 'restoring'].includes(extensionHostRestoreState.value)
  try {
    const resolver = await ResolverCache.getResolver(entry.block, entry.relations)
    const solvedContent = await resolver.getSolvedContent({ materializeMissing: false })
    if (!entry.owns()) return
    nodes.value = nodes.value.map((node) =>
      node.data.block.id === entry.block.id
        ? { ...node, data: { ...node.data, resolver, solvedContent, previewStatus: 'success' } }
        : node
    )
  } catch (cause) {
    if (!entry.owns()) return
    if (lookupBeforeRestore && cause instanceof UnknownResolverError) {
      pendingPreviews.value = [...pendingPreviews.value, entry]
      return
    }
    console.error(`[InfoBase] Failed to resolve preview for Block ${entry.block.id}.`, cause)
    nodes.value = nodes.value.map((node) =>
      node.data.block.id === entry.block.id
        ? { ...node, data: { ...node.data, previewStatus: 'error' } }
        : node
    )
  }
  if (entry.owns()) updatePreviewReady()
}

// Both registration completion and a late early-lookup failure can make a retry ready.
watch([extensionHostRestoreState, pendingPreviews], ([state]) => {
  if (!['restored', 'failed'].includes(state) || pendingPreviews.value.length === 0) return
  const pending = pendingPreviews.value
  pendingPreviews.value = []
  for (const entry of pending) void resolvePreview(entry, false)
})
onUnmounted(() => {
  generation += 1
  pendingPreviews.value = []
})

async function loadPreviews(
  blocks: Block[],
  incident: Map<number, Relation[]>,
  current: number
): Promise<void> {
  previewReady.value = false
  const meta = { ...configStore.metaConfig }
  const host = getExtensionHost()
  const owns = () =>
    current === generation &&
    getExtensionHost() === host &&
    configStore.metaConfig.INKCRE_PEER_ID === meta.INKCRE_PEER_ID &&
    configStore.metaConfig.INKCRE_PGREST_URL === meta.INKCRE_PGREST_URL &&
    configStore.metaConfig.INKCRE_JWT_SECRET === meta.INKCRE_JWT_SECRET
  let index = 0
  async function worker(): Promise<void> {
    while (index < blocks.length) {
      const block = blocks[index++]!
      await resolvePreview({ block, relations: incident.get(block.id) ?? [], owns }, true)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, blocks.length) }, () => worker()))
  if (owns()) updatePreviewReady()
}

async function loadScene(): Promise<void> {
  const current = ++generation
  pendingPreviews.value = []
  status.value = 'loading'
  delegationUnavailable.value = false
  previewReady.value = false
  pendingCamera.value = true
  try {
    const address = sceneAddress.value
    if (!address) return
    if (address.type === 'random') {
      const block = await GraphNavigationRetrievalManager.getRandomBlock()
      if (current !== generation) return
      if (!block) {
        nodes.value = []
        edges.value = []
        status.value = 'empty'
        return
      }
      await infoBaseRouter.push({ name: 'overview', focal_block: block.id })
      return
    }

    let graph: GraphModel | null = null
    let nextStatus: SceneStatus = 'empty'
    if (address.type === 'block') {
      const result = await GraphNavigationRetrievalManager.getBlockNeighborhood(address.block, {
        direction: 'both',
        limit: SCALE_LIMITS[scale.value],
      })
      graph = result?.graph ?? null
      if (!graph) nextStatus = 'missing'
    } else if (address.type === 'relation') {
      const result = await GraphNavigationRetrievalManager.getRelationNeighborhood(address.relation)
      graph = result?.graph ?? null
      if (!graph) nextStatus = 'missing'
    } else if (address.type === 'path') {
      const result = await GraphNavigationRetrievalManager.findPath(address.from, address.to)
      if (result.status === 'found') graph = result.graph
      else nextStatus = result.status === 'not_found' ? 'not-found' : 'limit'
    } else {
      const result = await LexicalRetrievalManager.retrieve({ query: address.query, limit: 20 })
      const groups = await presentLexicalMatches(result.matches)
      graph = { blocks: groups.map((group) => group.block), relations: [] }
    }
    if (current !== generation) return
    if (graph) {
      setGraph(graph)
      status.value = graph.blocks.length > 0 ? 'ready' : 'empty'
    } else {
      status.value = nextStatus
      nodes.value = []
      edges.value = []
    }
  } catch (cause) {
    if (current !== generation) return
    console.error('[InfoBase] Failed to load Graph scene.', cause)
    nodes.value = []
    edges.value = []
    delegationUnavailable.value = cause instanceof CapabilityDelegationUnavailable
    status.value = 'error'
  }
}

function layoutMeasuredNodes(): void {
  const measured = getNodes.value
  if (measured.length === 0) return
  const byId = new Map(measured.map((node) => [node.id, node]))
  const focalId = focalBlock.value !== null ? String(focalBlock.value) : measured[0]!.id
  const dimensions = (id: string) => {
    const node = byId.get(id)!
    return { width: node.dimensions.width, height: node.dimensions.height }
  }
  const gap = 32
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = []
  const positions = new Map<string, { x: number; y: number }>()
  const overlaps = (box: { x: number; y: number; width: number; height: number }) =>
    occupied.some(
      (other) =>
        box.x < other.x + other.width + gap &&
        box.x + box.width + gap > other.x &&
        box.y < other.y + other.height + gap &&
        box.y + box.height + gap > other.y
    )
  // User drag owns its coordinates. Keep automatic positions too unless a changed preview now collides.
  const retained = [...nodes.value].sort(
    (left, right) => Number(draggedNodes.has(right.id)) - Number(draggedNodes.has(left.id))
  )
  for (const node of retained) {
    const position = draggedNodes.has(node.id)
      ? byId.get(node.id)?.position
      : positionCache.get(node.id)
    if (!position) continue
    const box = { ...position, ...dimensions(node.id) }
    if (!draggedNodes.has(node.id) && overlaps(box)) continue
    positions.set(node.id, position)
    positionCache.set(node.id, position)
    occupied.push(box)
  }
  const focalSize = dimensions(focalId)
  const focalPosition = positions.get(focalId) ?? positionCache.get(focalId) ?? { x: 0, y: 0 }
  const center = {
    x: focalPosition.x + focalSize.width / 2,
    y: focalPosition.y + focalSize.height / 2,
  }
  const largest = Math.max(
    ...measured.map((node) => Math.hypot(node.dimensions.width, node.dimensions.height))
  )
  const step = Math.max(220, largest / 2 + gap)
  const farthest = Math.max(
    0,
    ...occupied.map((box) => Math.hypot(box.x - center.x, box.y - center.y) + largest)
  )
  // Beyond existing bounds, two more rings per new rectangle always provide an empty candidate.
  const maxRing = Math.ceil(farthest / step) + nodes.value.length * 2 + 2
  const unplaced = nodes.value
    .filter((node) => !positions.has(node.id))
    .sort((left, right) =>
      left.id === focalId ? -1 : right.id === focalId ? 1 : Number(left.id) - Number(right.id)
    )
  for (const node of unplaced) {
    const size = dimensions(node.id)
    let placed = false
    for (let ring = node.id === focalId ? 0 : 1; ring <= maxRing && !placed; ring++) {
      const radius = ring * step
      const slots = ring === 0 ? 1 : Math.max(8, Math.ceil((2 * Math.PI * radius) / 212))
      for (let slot = 0; slot < slots; slot++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * slot) / slots
        const position = {
          x: center.x + Math.cos(angle) * radius - size.width / 2,
          y: center.y + Math.sin(angle) * radius - size.height / 2,
        }
        const box = { ...position, ...size }
        if (overlaps(box)) continue
        positions.set(node.id, position)
        positionCache.set(node.id, position)
        occupied.push(box)
        placed = true
        break
      }
    }
    if (!placed) throw new Error('Graph layout exceeded its scene bound')
  }
  nodes.value = nodes.value.map((node) => ({ ...node, position: positions.get(node.id)! }))
}

function routeEdges(): void {
  const centers = new Map(
    getNodes.value.map((node) => [
      node.id,
      {
        x: node.position.x + node.dimensions.width / 2,
        y: node.position.y + node.dimensions.height / 2,
      },
    ])
  )
  edges.value = edges.value.map((edge) => {
    const source = centers.get(edge.source)
    const target = centers.get(edge.target)
    if (!source || !target) return edge
    const dx = target.x - source.x
    const dy = target.y - source.y
    const [from, to] =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? ['right', 'left']
          : ['left', 'right']
        : dy > 0
          ? ['bottom', 'top']
          : ['top', 'bottom']
    return { ...edge, sourceHandle: `source-${from}`, targetHandle: `target-${to}` }
  })
}

async function realizeScene(): Promise<void> {
  if (!previewReady.value || !nodesInitialized.value) return
  if (realizing) {
    realizationRequested = true
    return
  }
  realizing = true
  const current = generation
  try {
    await nextTick()
    updateNodeInternals(nodes.value.map((node) => node.id))
    // VueFlow's public update schedules measurement on the next animation frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    if (current !== generation || !previewReady.value || !nodesInitialized.value) return
    layoutMeasuredNodes()
    await nextTick()
    routeEdges()
    await nextTick()
    if (current !== generation || !pendingCamera.value) return
    pendingCamera.value = false
    const narrow = (container.value?.clientWidth ?? 0) < 640
    const focalId =
      focalBlock.value ?? (sceneAddress.value?.type === 'path' ? sceneAddress.value.from : null)
    const visibleNodes =
      narrow && focalId !== null ? [String(focalId)] : nodes.value.map((node) => node.id)
    await fitView({
      nodes: visibleNodes,
      minZoom: narrow && focalId !== null ? 0.75 : 0.05,
      padding: 0.18,
      maxZoom: 1.25,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
    })
  } finally {
    realizing = false
    if (realizationRequested) {
      realizationRequested = false
      void realizeScene()
    }
  }
}

watch([sceneKey, scale], () => void loadScene(), { immediate: true })
watch(direction, applyPresentation)
watch(
  [
    nodesInitialized,
    previewReady,
    () =>
      getNodes.value
        .map((node) => `${node.id}:${node.dimensions.width}:${node.dimensions.height}`)
        .join(','),
  ],
  () => {
    if (nodesInitialized.value && previewReady.value) void realizeScene()
  }
)

function focusBlock(block: number): void {
  pendingCamera.value = true
  void infoBaseRouter.push({ name: 'overview', focal_block: block })
}

function focusRelation(relation: number): void {
  pendingCamera.value = true
  void infoBaseRouter.push({ name: 'overview', focal_relation: relation })
}

function inspectBlock(block: number): void {
  void infoBaseRouter.push({ name: 'block', block })
}

function inspectRelation(relation: number): void {
  void infoBaseRouter.push({ name: 'relation', relation })
}

function onNodeDragStart(event: NodeDragEvent): void {
  pendingCamera.value = false
  draggedNodes.add(event.node.id)
}

function onNodeDragStop(event: NodeDragEvent): void {
  positionCache.set(event.node.id, { ...event.node.position })
  routeEdges()
}

function refocus(): void {
  pendingCamera.value = true
  void realizeScene()
}

function onRuminated(): void {
  void loadScene()
}

function isRoute(route: InfoBaseRoute | null, name: InfoBaseRoute['name']): boolean {
  return route?.name === name
}
</script>

<template>
  <main ref="container" class="graph-view">
    <header class="graph-view__toolbar">
      <div class="graph-view__context">
        <h1>{{ sceneDescription }}</h1>
        <p v-if="status === 'ready'">{{ nodes.length }} blocks · {{ edges.length }} relations</p>
      </div>
      <div class="graph-view__actions">
        <InkButton
          v-if="focalRelation !== null"
          text="Relation details"
          theme="subtle"
          :aria-label="`Inspect Relation #${focalRelation}`"
          @click="inspectRelation(focalRelation)"
        />
        <InkButton text="Search" theme="subtle" @click="openRecallSearch" />
        <details v-if="focalBlock !== null" class="graph-view__options">
          <summary>View options</summary>
          <InkForm layout="col">
            <InkDropdown v-model="scale" label="Neighborhood size" :options="scaleOptions" />
            <InkDropdown
              v-model="direction"
              label="Emphasize relations"
              :options="directionOptions"
            />
          </InkForm>
        </details>
      </div>
    </header>

    <div v-if="status === 'loading'" class="graph-view__state" role="status">
      <InkLoading />
      <p>Loading graph…</p>
    </div>
    <div v-else-if="status !== 'ready'" class="graph-view__state">
      <div>
        <h2 v-if="status === 'empty'">No information here yet</h2>
        <h2 v-else-if="status === 'missing'">This item is no longer available</h2>
        <h2 v-else-if="status === 'not-found'">No connecting path found</h2>
        <h2 v-else-if="status === 'limit'">The path exceeds the exploration limit</h2>
        <h2 v-else role="alert">Unable to load the graph</h2>
        <p v-if="status === 'empty' || status === 'missing'">Search for another starting point.</p>
        <p v-else-if="status === 'limit'">Try two closer starting points.</p>
        <p v-else-if="status === 'not-found'">Try another pair of blocks.</p>
        <p v-else-if="delegationUnavailable">
          No retrieval Peer is available right now. Your query is preserved. Wait for a Peer to
          become ready, then retry to check live Peers again.
        </p>
        <p v-else>Your current location is preserved. You can try loading it again.</p>
        <InkButton v-if="status === 'error'" text="Retry" theme="primary" @click="loadScene" />
        <InkButton v-else text="Search information" theme="subtle" @click="openRecallSearch" />
      </div>
    </div>

    <VueFlow
      v-else
      v-model:nodes="nodes"
      v-model:edges="edges"
      class="graph-view__flow"
      :min-zoom="0.05"
      :max-zoom="2.4"
      :nodes-draggable="true"
      @node-drag-start="onNodeDragStart"
      @node-drag-stop="onNodeDragStop"
    >
      <template #node-block="nodeProps">
        <BlockNodeComponent v-bind="nodeProps" @focus="focusBlock" @inspect="inspectBlock" />
      </template>
      <template #edge-relation="edgeProps">
        <RelationEdgeComponent v-bind="edgeProps" @focus="focusRelation" />
      </template>
      <div class="graph-view__viewport-controls">
        <InkButton
          icon="i-mdi-plus"
          aria-label="Zoom in"
          type="square"
          theme="subtle"
          @click="zoomIn()"
        />
        <InkButton
          icon="i-mdi-minus"
          aria-label="Zoom out"
          type="square"
          theme="subtle"
          @click="zoomOut()"
        />
        <InkButton
          icon="i-mdi-crosshairs-gps"
          aria-label="Focus current"
          type="square"
          theme="subtle"
          @click="refocus"
        />
      </div>
    </VueFlow>

    <BlockInspectorPopup
      v-if="isRoute(currentRoute, 'block') && currentRoute?.name === 'block'"
      :block="currentRoute.block"
      @ruminated="onRuminated"
    />
    <RelationInspectorPopup
      v-else-if="isRoute(currentRoute, 'relation') && currentRoute?.name === 'relation'"
      :relation="currentRoute.relation"
    />
    <SolvedContentPopup
      v-else-if="isRoute(currentRoute, 'solved-content') && currentRoute?.name === 'solved-content'"
      :block="currentRoute.block"
    />
  </main>
</template>

<style scoped lang="scss" src="./graph.scss" />
