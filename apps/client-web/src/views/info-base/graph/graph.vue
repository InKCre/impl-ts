<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useNodesInitialized, useVueFlow, type NodeDragEvent } from '@vue-flow/core'
import { InkButton, InkDropdown, InkForm, InkLoading, InkPlaceholder } from '@inkcre/ui-web'
import dagre from '@dagrejs/dagre'
import { forceSimulation, forceManyBody, forceLink, forceCollide, forceCenter, forceRadial } from 'd3-force'
import {
  CapabilityDelegationUnavailable,
  getInfoBaseRouter,
  GraphNavigationRetrievalManager,
  LexicalRetrievalManager,
  ResolverCache,
  type Block,
  type GraphDirection,
  type GraphModel,
  type InfoBaseRoute,
  type Relation,
} from '@inkcre/core'

import BlockNodeComponent from '@/components/info-base/BlockNode/BlockNode.vue'
import RelationEdgeComponent from '@/components/info-base/RelationEdge/RelationEdge.vue'
import BlockInspectorPopup from '@/components/info-base/BlockInspectorPopup/BlockInspectorPopup.vue'
import RelationInspectorPopup from '@/components/info-base/RelationInspectorPopup/RelationInspectorPopup.vue'
import SolvedContentPopup from '@/components/info-base/SolvedContentPopup/SolvedContentPopup.vue'
import InfoBaseViewTabs from '@/components/info-base/InfoBaseViewTabs.vue'
import { blockNode, relationEdge, type BlockNode, type RelationEdge } from './graph-model'
import { openRecallSearch } from '@/components/recall/recall-search'

type SceneScale = 'compact' | 'standard' | 'broad'
type SceneStatus = 'loading' | 'ready' | 'empty' | 'missing' | 'not-found' | 'limit' | 'error'
type ExpansionMode = 'smooth' | 'incremental'
type LayoutAlgorithm = 'hierarchical' | 'radial' | 'force'

const SCALE_LIMITS: Record<SceneScale, number> = { compact: 8, standard: 20, broad: 50 }
const EXPANSION_MODE_KEY = 'inkcre.graph.expansionMode'
const LAYOUT_KEY = 'inkcre.graph.layout'
const container = ref<HTMLElement | null>(null)
const infoBaseRouter = getInfoBaseRouter()
const { t } = useI18n()
const currentRoute = computed(() => infoBaseRouter.current.value)
const nodes = shallowRef<BlockNode[]>([])
const edges = shallowRef<RelationEdge[]>([])
const status = ref<SceneStatus>('loading')
const delegationUnavailable = ref(false)
const scale = ref<SceneScale>('standard')
const direction = ref<GraphDirection>('both')
const expansionMode = ref<ExpansionMode>(
  (localStorage.getItem(EXPANSION_MODE_KEY) as ExpansionMode) || 'smooth'
)
const layoutAlgorithm = ref<LayoutAlgorithm>(
  (localStorage.getItem(LAYOUT_KEY) as LayoutAlgorithm) || 'radial'
)
const previewReady = ref(false)
const pendingCamera = ref(false)
const transitioning = ref(false)
const realizing = ref(false)
const skipLayout = ref(false)
const selectedBlock = ref<number | null>(null)
const positionCache = new Map<string, { x: number; y: number }>()
const draggedNodes = new Set<string>()
let generation = 0
let realizationRequested = false

watch(expansionMode, (mode) => {
  localStorage.setItem(EXPANSION_MODE_KEY, mode)
})

watch(layoutAlgorithm, (algo) => {
  localStorage.setItem(LAYOUT_KEY, algo)
})

const { fitView, zoomIn, zoomOut, getNodes, onMoveStart, updateNodeInternals, setCenter, setViewport, getViewport } = useVueFlow()
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
  if (address?.type === 'block') return t('infoBase.graph.scene.block', { block: address.block })
  if (address?.type === 'relation')
    return t('infoBase.graph.scene.relation', { relation: address.relation })
  if (address?.type === 'path')
    return t('infoBase.graph.scene.path', { from: address.from, to: address.to })
  if (address?.type === 'recall') return t('infoBase.graph.scene.recall', { query: address.query })
  return t('infoBase.graph.scene.default')
})
const scaleOptions = computed(() => [
  { value: 'compact', label: t('infoBase.graph.scale.compact') },
  { value: 'standard', label: t('infoBase.graph.scale.standard') },
  { value: 'broad', label: t('infoBase.graph.scale.broad') },
])
const directionOptions = computed(() => [
  { value: 'both', label: t('infoBase.graph.direction.both') },
  { value: 'in', label: t('infoBase.graph.direction.in') },
  { value: 'out', label: t('infoBase.graph.direction.out') },
])
const expansionModeOptions = computed(() => [
  { value: 'smooth', label: t('infoBase.graph.expansion.smooth') },
  { value: 'incremental', label: t('infoBase.graph.expansion.incremental') },
])
const layoutAlgorithmOptions = computed(() => [
  { value: 'radial', label: t('infoBase.graph.layout.radial') },
  { value: 'force', label: t('infoBase.graph.layout.force') },
  { value: 'hierarchical', label: t('infoBase.graph.layout.hierarchical') },
])

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
  // Layout after a short delay to allow Vue Flow to measure nodes.
  setTimeout(() => {
    layoutMeasuredNodes()
    updateNodeInternals(nodes.value.map((node) => node.id))
    void nextTick(() => routeEdges())
  }, 100)
}

async function loadPreviews(
  blocks: Block[],
  incident: Map<number, Relation[]>,
  current: number
): Promise<void> {
  previewReady.value = false
  let index = 0
  async function worker(): Promise<void> {
    while (index < blocks.length) {
      const block = blocks[index++]!
      try {
        const resolver = await ResolverCache.getResolver(block, incident.get(block.id) ?? [])
        const solvedContent = await resolver.getSolvedContent({ materializeMissing: false })
        if (current !== generation) return
        nodes.value = nodes.value.map((node) =>
          node.data.block.id === block.id
            ? {
                ...node,
                data: { ...node.data, resolver, solvedContent, previewStatus: 'success' },
              }
            : node
        )
      } catch (cause) {
        if (current !== generation) return
        console.error(`[InfoBase] Failed to resolve preview for Block ${block.id}.`, cause)
        nodes.value = nodes.value.map((node) =>
          node.data.block.id === block.id
            ? { ...node, data: { ...node.data, previewStatus: 'error' } }
            : node
        )
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, blocks.length) }, () => worker()))
  if (current === generation) previewReady.value = true
}

async function loadScene(): Promise<void> {
  const current = ++generation
  // Only show full loading state when graph is empty (first load).
  // During smooth transitions, keep the existing graph visible while new data loads.
  const isFirstLoad = nodes.value.length === 0
  if (isFirstLoad) {
    status.value = 'loading'
  }
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
      graph = { blocks: result.matches.map((match) => match.block), relations: [] }
    }
    if (current !== generation) return
    transitioning.value = false
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
    transitioning.value = false
  }
}

function layoutMeasuredNodes(): void {
  if (layoutAlgorithm.value === 'radial') {
    layoutRadial()
  } else if (layoutAlgorithm.value === 'force') {
    layoutForce()
  } else {
    layoutHierarchical()
  }
}

function layoutHierarchical(): void {
  const measured = getNodes.value
  if (measured.length === 0) return
  const byId = new Map(measured.map((node) => [node.id, node]))

  // User drag owns its coordinates; skip layout for dragged nodes.
  const dragged = new Set(draggedNodes)
  const unpositioned = nodes.value.filter((node) => !dragged.has(node.id))
  if (unpositioned.length === 0) return

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 })

  for (const node of unpositioned) {
    const measuredNode = byId.get(node.id)
    // Use actual dimensions if available, otherwise estimate from block content.
    const width = measuredNode?.dimensions.width || 180
    const height = measuredNode?.dimensions.height || 80
    g.setNode(node.id, { width, height })
  }
  for (const edge of edges.value) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const node of unpositioned) {
    const dagreNode = g.node(node.id)
    if (dagreNode) {
      positions.set(node.id, {
        x: dagreNode.x - dagreNode.width / 2,
        y: dagreNode.y - dagreNode.height / 2,
      })
    }
  }
  // Keep dragged nodes at their current positions.
  for (const node of nodes.value) {
    if (dragged.has(node.id)) {
      const current = byId.get(node.id)?.position
      if (current) positions.set(node.id, current)
    }
  }

  nodes.value = nodes.value.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))
}

// Force-directed layout using d3-force
function layoutForce(): void {
  const measured = getNodes.value
  if (measured.length === 0) return
  const byId = new Map(measured.map((node) => [node.id, node]))
  const dragged = new Set(draggedNodes)

  const nodeWidth = 182
  const nodeHeight = 122
  const centerX = 0
  const centerY = 0

  // Prepare nodes for simulation
  const simNodes = nodes.value.map((node) => ({
    id: node.id,
    x: byId.get(node.id)?.position.x ?? centerX + (Math.random() - 0.5) * 400,
    y: byId.get(node.id)?.position.y ?? centerY + (Math.random() - 0.5) * 400,
    radius: Math.sqrt(nodeWidth * nodeWidth + nodeHeight * nodeHeight) / 2,
  }))

  // Prepare links for simulation
  const simLinks = edges.value
    .filter(e => simNodes.some(n => n.id === e.source) && simNodes.some(n => n.id === e.target))
    .map(e => ({ source: e.source, target: e.target }))

  // Create force simulation
  const simulation = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-800))
    .force('link', forceLink(simLinks).id((d: any) => d.id).distance(250).strength(0.5))
    .force('collide', forceCollide().radius((d: any) => d.radius + 40).iterations(2))
    .force('center', forceCenter(centerX, centerY))
    .stop()

  // Run simulation synchronously
  for (let i = 0; i < 300; i++) {
    simulation.tick()
  }

  // Extract positions
  const positions = new Map<string, { x: number; y: number }>()
  for (const simNode of simNodes) {
    positions.set(simNode.id, {
      x: simNode.x - nodeWidth / 2,
      y: simNode.y - nodeHeight / 2,
    })
  }

  // Keep dragged nodes at their current positions
  for (const node of nodes.value) {
    if (dragged.has(node.id)) {
      const current = byId.get(node.id)?.position
      if (current) positions.set(node.id, current)
    }
  }

  nodes.value = nodes.value.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))
}

// Radial layout using d3-force with radial force
function layoutRadial(): void {
  const measured = getNodes.value
  if (measured.length === 0) return
  const byId = new Map(measured.map((node) => [node.id, node]))
  const dragged = new Set(draggedNodes)

  const nodeWidth = 182
  const nodeHeight = 122
  const centerX = 0
  const centerY = 0

  // Build adjacency from edges
  const adjacency = new Map<string, string[]>()
  for (const edge of edges.value) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, [])
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, [])
    adjacency.get(edge.source)!.push(edge.target)
    adjacency.get(edge.target)!.push(edge.source)
  }

  // BFS from focal node to assign ring depths
  const focalId = focalBlock.value !== null ? String(focalBlock.value) : null
  const ringDepth = new Map<string, number>()
  const visited = new Set<string>()

  if (focalId) {
    const queue: Array<[string, number]> = [[focalId, 0]]
    visited.add(focalId)
    ringDepth.set(focalId, 0)

    while (queue.length > 0) {
      const [current, depth] = queue.shift()!
      const neighbors = adjacency.get(current) ?? []
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          ringDepth.set(neighbor, depth + 1)
          queue.push([neighbor, depth + 1])
        }
      }
    }
    const maxDepth = Math.max(...ringDepth.values(), 0)
    for (const node of nodes.value) {
      if (!ringDepth.has(node.id)) {
        ringDepth.set(node.id, maxDepth + 1)
      }
    }
  } else {
    for (const node of nodes.value) {
      ringDepth.set(node.id, 1)
    }
  }

  // Calculate radius for each depth
  const maxDepth = Math.max(...ringDepth.values(), 1)
  const baseRadius = 300
  const radiusStep = 250

  const depthRadius = new Map<number, number>()
  for (let d = 1; d <= maxDepth; d++) {
    depthRadius.set(d, baseRadius + (d - 1) * radiusStep)
  }

  // Prepare nodes with target radius
  const simNodes = nodes.value.map((node) => {
    const depth = ringDepth.get(node.id) ?? 1
    const targetRadius = depth === 0 ? 0 : depthRadius.get(depth) ?? baseRadius
    return {
      id: node.id,
      x: byId.get(node.id)?.position.x ?? centerX + (Math.random() - 0.5) * 400,
      y: byId.get(node.id)?.position.y ?? centerY + (Math.random() - 0.5) * 400,
      radius: Math.sqrt(nodeWidth * nodeWidth + nodeHeight * nodeHeight) / 2,
      targetRadius,
    }
  })

  // Prepare links
  const simLinks = edges.value
    .filter(e => simNodes.some(n => n.id === e.source) && simNodes.some(n => n.id === e.target))
    .map(e => ({ source: e.source, target: e.target }))

  // Create simulation with radial force
  const simulation = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-500))
    .force('link', forceLink(simLinks).id((d: any) => d.id).distance(200).strength(0.3))
    .force('collide', forceCollide().radius((d: any) => d.radius + 30).iterations(2))
    .force('radial', forceRadial((d: any) => d.targetRadius, centerX, centerY).strength(0.8))
    .stop()

  // Run simulation
  for (let i = 0; i < 300; i++) {
    simulation.tick()
  }

  // Extract positions
  const positions = new Map<string, { x: number; y: number }>()
  for (const simNode of simNodes) {
    positions.set(simNode.id, {
      x: simNode.x - nodeWidth / 2,
      y: simNode.y - nodeHeight / 2,
    })
  }

  // Keep dragged nodes at their current positions
  for (const node of nodes.value) {
    if (dragged.has(node.id)) {
      const current = byId.get(node.id)?.position
      if (current) positions.set(node.id, current)
    }
  }

  nodes.value = nodes.value.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))
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
  if (realizing.value) {
    realizationRequested = true
    return
  }
  realizing.value = true
  const current = generation
  try {
    // Trigger node measurement
    updateNodeInternals(nodes.value.map((node) => node.id))
    // Use setTimeout instead of await to avoid blocking
    setTimeout(() => {
      if (current !== generation) {
        realizing.value = false
        return
      }
      // Skip layout when in incremental merge mode (nodes already positioned)
      if (!skipLayout.value) {
        layoutMeasuredNodes()
      }
      routeEdges()
      if (current !== generation || !pendingCamera.value) {
        realizing.value = false
        return
      }
      pendingCamera.value = false
      const narrow = (container.value?.clientWidth ?? 0) < 640
      const focalId =
        focalBlock.value ?? (sceneAddress.value?.type === 'path' ? sceneAddress.value.from : null)
      const visibleNodes =
        narrow && focalId !== null ? [String(focalId)] : nodes.value.map((node) => node.id)
      void fitView({
        nodes: visibleNodes,
        minZoom: 0.05,
        maxZoom: 1,
        padding: 0.3,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
      }).finally(() => {
        realizing.value = false
        if (realizationRequested) {
          realizationRequested = false
          void realizeScene()
        }
      })
    }, 100)
  } catch (e) {
    realizing.value = false
    console.error('[Graph] realizeScene error:', e)
  }
}

watch([sceneKey, scale], () => {
  // In incremental mode, scene changes are handled by mergeGraph; skip full reload.
  if (expansionMode.value === 'incremental' && status.value === 'ready') return
  void loadScene()
}, { immediate: true })
watch(direction, applyPresentation)
watch(layoutAlgorithm, () => {
  // Re-layout when algorithm changes
  layoutMeasuredNodes()
  void nextTick(() => routeEdges())
})
watch(
  [
    nodesInitialized,
    () =>
      getNodes.value
        .map((node) => `${node.id}:${node.dimensions.width}:${node.dimensions.height}`)
        .join(','),
  ],
  () => {
    if (nodesInitialized.value) void realizeScene()
  }
)

function setNodeFocusing(blockId: number | null): void {
  nodes.value = nodes.value.map((node) => ({
    ...node,
    data: {
      ...node.data,
      focusing: blockId !== null && node.data.block.id === blockId,
    },
  }))
}

function focusBlock(block: number): void {
  transitioning.value = true
  selectedBlock.value = block
  setNodeFocusing(block)
  if (expansionMode.value === 'incremental') {
    // Incremental: load new neighborhood and merge into existing graph.
    void loadIncrementalBlock(block).finally(() => {
      transitioning.value = false
      setNodeFocusing(null)
    })
  } else {
    // Smooth: replace graph, animate camera to new focal.
    pendingCamera.value = true
    void infoBaseRouter.push({ name: 'overview', focal_block: block })
  }
}

function focusRelation(relation: number): void {
  transitioning.value = true
  setNodeFocusing(null)
  if (expansionMode.value === 'incremental') {
    void loadIncrementalRelation(relation).finally(() => {
      transitioning.value = false
    })
  } else {
    pendingCamera.value = true
    void infoBaseRouter.push({ name: 'overview', focal_relation: relation })
  }
}

async function loadIncrementalBlock(block: number): Promise<void> {
  const current = generation
  try {
    const result = await GraphNavigationRetrievalManager.getBlockNeighborhood(block, {
      direction: 'both',
      limit: SCALE_LIMITS[scale.value],
    })
    if (current !== generation || !result?.graph) return
    mergeGraph(result.graph, block)
    // Update URL to reflect new focal without full reload
    void infoBaseRouter.push({ name: 'overview', focal_block: block })
  } catch (cause) {
    console.error('[InfoBase] Failed to load incremental neighborhood.', cause)
  }
}

async function loadIncrementalRelation(relation: number): Promise<void> {
  const current = generation
  try {
    const result = await GraphNavigationRetrievalManager.getRelationNeighborhood(relation)
    if (current !== generation || !result?.graph) return
    mergeGraph(result.graph, null, relation)
    void infoBaseRouter.push({ name: 'overview', focal_relation: relation })
  } catch (cause) {
    console.error('[InfoBase] Failed to load incremental relation.', cause)
  }
}

function mergeGraph(graph: GraphModel, newFocalBlock: number | null, newFocalRelation?: number): void {
  const existingBlockIds = new Set(nodes.value.map((n) => n.data.block.id))
  const existingRelationIds = new Set(edges.value.map((e) => e.data.relation.id))

  const newBlocks = graph.blocks.filter((b) => !existingBlockIds.has(b.id))
  const newRelations = graph.relations.filter((r) => !existingRelationIds.has(r.id))

  if (newBlocks.length === 0 && newRelations.length === 0) {
    // Just update focal highlighting and move camera to focal block
    applyPresentation()
    if (newFocalBlock !== null) {
      setTimeout(() => {
        focusCameraOnNode(newFocalBlock)
      }, 100)
    }
    return
  }

  const incident = new Map<number, Relation[]>()
  for (const relation of graph.relations) {
    incident.set(relation.from_, [...(incident.get(relation.from_) ?? []), relation])
    incident.set(relation.to_, [...(incident.get(relation.to_) ?? []), relation])
  }

  // Add new nodes with temporary positions (will be laid out below)
  const newNodes = newBlocks.map((block) =>
    blockNode(block, {
      focal: block.id === newFocalBlock,
      muted: false,
      position: { x: 0, y: 0 }, // Temporary, will be positioned by layoutNewNodes
    })
  )

  // Add new edges
  const newEdges = newRelations.map((relation) =>
    relationEdge(relation, {
      focal: relation.id === newFocalRelation,
      muted: false,
    })
  )

  // Merge into existing graph
  nodes.value = [...nodes.value, ...newNodes]
  edges.value = [...edges.value, ...newEdges]

  // Update focal highlighting
  const targetFocal = newFocalBlock ?? focalBlock.value
  const targetFocalRelation = newFocalRelation ?? focalRelation.value

  nodes.value = nodes.value.map((node) => ({
    ...node,
    data: {
      ...node.data,
      focal: node.data.block.id === targetFocal,
    },
  }))
  edges.value = edges.value.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      focal: edge.data.relation.id === targetFocalRelation,
    },
  }))

  // Load previews for new blocks only
  void loadPreviews(newBlocks, incident, generation)

  // Layout only new nodes around existing graph, then focus camera
  // Set skipLayout to prevent realizeScene from re-layouting all nodes
  skipLayout.value = true
  setTimeout(() => {
    layoutNewNodes(newBlocks.map(b => b.id))
    updateNodeInternals(nodes.value.map((n) => n.id))
    void nextTick(() => {
      routeEdges()
      // Focus camera on new focal block after layout
      if (newFocalBlock !== null) {
        focusCameraOnNode(newFocalBlock)
      }
      // Reset skipLayout after a delay to allow watcher to fire
      setTimeout(() => {
        skipLayout.value = false
      }, 200)
    })
  }, 100)
}

// Focus camera on a specific node without changing zoom
function focusCameraOnNode(blockId: number): void {
  const node = getNodes.value.find((n) => n.id === String(blockId))
  if (!node) return
  const centerX = node.position.x + (node.dimensions?.width ?? 180) / 2
  const centerY = node.position.y + (node.dimensions?.height ?? 80) / 2
  const container = document.querySelector('.vue-flow')
  const rect = container?.getBoundingClientRect()
  const currentZoom = getViewport()?.zoom ?? 1
  void setViewport({
    x: (rect?.width ?? 800) / 2 - centerX * currentZoom,
    y: (rect?.height ?? 600) / 2 - centerY * currentZoom,
    zoom: currentZoom,
  }, {
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400,
  })
}

// Layout only new nodes, positioning them near their connected existing nodes
function layoutNewNodes(newBlockIds: number[]): void {
  if (newBlockIds.length === 0) return

  const newNodeIds = new Set(newBlockIds.map(id => String(id)))
  const existingNodes = nodes.value.filter(n => !newNodeIds.has(n.id))
  const newNodes = nodes.value.filter(n => newNodeIds.has(n.id))

  if (existingNodes.length === 0) {
    // No existing nodes, layout all nodes with dagre
    layoutMeasuredNodes()
    return
  }

  // Build a map of existing node positions
  const existingPositions = new Map<string, { x: number; y: number }>()
  for (const node of existingNodes) {
    existingPositions.set(node.id, node.position)
  }

  // For each new node, find its connected existing nodes and position near them
  const nodeWidth = 182
  const nodeHeight = 122
  const spacing = 250 // Distance from connected node

  const positions = new Map<string, { x: number; y: number }>()
  const connectionCount = new Map<string, number>() // Track how many new nodes connect to each existing node

  for (const newNode of newNodes) {
    // Find edges connecting this new node to existing nodes
    const connectedEdges = edges.value.filter(
      e => (e.source === newNode.id && existingPositions.has(e.target)) ||
           (e.target === newNode.id && existingPositions.has(e.source))
    )

    if (connectedEdges.length > 0) {
      // Position near the first connected node
      const firstEdge = connectedEdges[0]
      const connectedNodeId = firstEdge.source === newNode.id ? firstEdge.target : firstEdge.source
      const connectedPos = existingPositions.get(connectedNodeId)

      if (connectedPos) {
        // Get offset index for this connection
        const offsetIndex = connectionCount.get(connectedNodeId) ?? 0
        connectionCount.set(connectedNodeId, offsetIndex + 1)

        // Position in a fan pattern to the right of the connected node
        const x = connectedPos.x + nodeWidth + spacing
        const y = connectedPos.y + offsetIndex * (nodeHeight + 50)
        positions.set(newNode.id, { x, y })
        continue
      }
    }

    // No connected edges, position near center of existing nodes
    let sumX = 0, sumY = 0
    for (const pos of existingPositions.values()) {
      sumX += pos.x
      sumY += pos.y
    }
    const centerX = sumX / existingPositions.size
    const centerY = sumY / existingPositions.size
    const fallbackIndex = newNodes.indexOf(newNode)
    positions.set(newNode.id, { x: centerX + nodeWidth + spacing, y: centerY + fallbackIndex * (nodeHeight + 50) })
  }

  // Apply positions to new nodes only
  nodes.value = nodes.value.map((node) => {
    if (newNodeIds.has(node.id)) {
      const pos = positions.get(node.id)
      if (pos) {
        return { ...node, position: pos }
      }
    }
    return node
  })
}

function inspectBlock(block: number): void {
  selectedBlock.value = block
  void infoBaseRouter.push({ name: 'block', block })
}

function inspectRelation(relation: number): void {
  selectedBlock.value = null
  void infoBaseRouter.push({ name: 'relation', relation })
}

// Check if side panel is open (block or relation detail)
const isSidePanelOpen = computed(() => {
  return currentRoute.value?.name === 'block' || currentRoute.value?.name === 'relation'
})

function closeSidePanel(): void {
  selectedBlock.value = null
  void infoBaseRouter.back()
}

function onNodeDragStart(event: NodeDragEvent): void {
  pendingCamera.value = false
  draggedNodes.add(event.node.id)
}

function onNodeDrag(_event: NodeDragEvent): void {
  // Update edge routing in real-time during drag for responsive feel
  routeEdges()
}

function onNodeDragStop(event: NodeDragEvent): void {
  positionCache.set(event.node.id, { ...event.node.position })
  draggedNodes.delete(event.node.id)
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
    <div class="graph-view__view-switch">
      <InfoBaseViewTabs />
    </div>
    <header class="graph-view__toolbar">
      <div class="graph-view__context">
        <h1>{{ sceneDescription }}</h1>
        <p v-if="status === 'ready'">
          {{ t('infoBase.graph.stats', { blocks: nodes.length, relations: edges.length }) }}
        </p>
      </div>
      <div class="graph-view__actions">
        <InkButton
          v-if="focalRelation !== null"
          :text="t('infoBase.graph.relationDetails')"
          theme="subtle"
          :aria-label="t('infoBase.graph.inspectRelation', { relation: focalRelation })"
          @click="inspectRelation(focalRelation)"
        />
        <InkButton :text="t('infoBase.graph.search')" theme="subtle" @click="openRecallSearch" />
        <details v-if="focalBlock !== null" class="graph-view__options">
          <summary>{{ t('infoBase.graph.viewOptions') }}</summary>
          <InkForm layout="col">
            <InkDropdown
              v-model="scale"
              :label="t('infoBase.graph.neighborhoodSize')"
              :options="scaleOptions"
            />
            <InkDropdown
              v-model="direction"
              :label="t('infoBase.graph.emphasizeRelations')"
              :options="directionOptions"
            />
            <InkDropdown
              v-model="expansionMode"
              :label="t('infoBase.graph.expansionMode')"
              :options="expansionModeOptions"
            />
            <InkDropdown
              v-model="layoutAlgorithm"
              :label="t('infoBase.graph.layoutAlgorithm')"
              :options="layoutAlgorithmOptions"
            />
          </InkForm>
        </details>
      </div>
    </header>

    <div v-if="status === 'loading' && nodes.length === 0" class="graph-view__state" role="status">
      <InkLoading />
      <p>{{ t('infoBase.graph.loading') }}</p>
    </div>
    <InkPlaceholder
      v-else-if="status !== 'ready' && nodes.length === 0"
      class="graph-view__placeholder"
      :state="status === 'error' ? 'error' : 'empty'"
      :title="
        status === 'empty'
          ? t('infoBase.graph.emptyTitle')
          : status === 'missing'
            ? t('infoBase.graph.missingTitle')
            : status === 'not-found'
              ? t('infoBase.graph.notFoundTitle')
              : status === 'limit'
                ? t('infoBase.graph.limitTitle')
                : t('infoBase.graph.errorTitle')
      "
      :description="
        status === 'empty' || status === 'missing'
          ? t('infoBase.graph.emptyHint')
          : status === 'limit'
            ? t('infoBase.graph.limitHint')
            : status === 'not-found'
              ? t('infoBase.graph.notFoundHint')
              : delegationUnavailable
                ? t('infoBase.graph.delegationUnavailableHint')
                : t('infoBase.graph.genericHint')
      "
    >
      <template #actions>
        <InkButton
          v-if="status === 'error'"
          :text="t('infoBase.graph.retry')"
          theme="primary"
          @click="loadScene"
        />
        <InkButton
          v-else
          :text="t('infoBase.graph.searchInformation')"
          theme="subtle"
          @click="openRecallSearch"
        />
      </template>
    </InkPlaceholder>

    <VueFlow
      v-else
      v-model:nodes="nodes"
      v-model:edges="edges"
      class="graph-view__flow"
      :min-zoom="0.05"
      :max-zoom="2.4"
      :nodes-draggable="true"
      :node-drag-threshold="0"
      :pan-on-drag="[0, 1, 2]"
      @nodeDragStart="onNodeDragStart"
      @nodeDrag="onNodeDrag"
      @nodeDragStop="onNodeDragStop"
    >
      <template #node-block="nodeProps">
        <BlockNodeComponent
          v-bind="nodeProps"
          :selected="nodeProps.data.block.id === selectedBlock"
          @focus="focusBlock"
          @inspect="inspectBlock"
        />
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

    <!-- Transparent scrim for side panels -->
    <div
      v-if="isSidePanelOpen"
      class="graph-view__scrim"
      @click="closeSidePanel"
    />

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
