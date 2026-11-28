import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from '@playwright/test'

const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL
let graph
let headers

async function createRows(table, rows) {
  const response = await fetch(new URL(table, postgrestUrl), {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  })
  assert.equal(response.status, 201, `Cannot create graph fixture in ${table}`)
  return response.json()
}

async function removeBlocks(ids) {
  if (ids.length === 0) return
  const response = await fetch(new URL(`blocks?id=in.(${ids.join(',')})`, postgrestUrl), {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' },
  })
  assert.equal(response.status, 204, 'Cannot remove graph fixture Blocks')
}

async function createBlock(alias) {
  const [{ id }] = await createRows('blocks', {
    resolver: 'core.text.v1',
    storage: null,
    content: `graph-contract.${randomUUID()}.${alias}`,
  })
  return id
}

async function readScenario({ operation, input }, blocks, relations) {
  const { direction, contents, limit } = input
  switch (operation) {
    case 'block_neighborhood':
      return graph.getBlockNeighborhood(blocks.get(input.focal), { direction, contents, limit })
    case 'relation_neighborhood':
      return graph.getRelationNeighborhood(relations.get(input.focal))
    case 'find_path':
      return graph.findPath(blocks.get(input.from), blocks.get(input.to), {
        direction,
        contents,
        maxHops: input.max_hops,
        maxExploredBlocks: input.max_explored_blocks,
      })
    default:
      assert.fail(`Unknown graph operation ${operation}`)
  }
}

function verifyPath(result, input, blocks) {
  const { block_path: blockPath, relation_path: relationPath, graph: actual } = result
  assert.equal(blockPath[0], blocks.get(input.from))
  assert.equal(blockPath.at(-1), blocks.get(input.to))
  assert.equal(blockPath.length, relationPath.length + 1)
  assert.deepEqual(new Set(blockPath), new Set(actual.blocks.map((block) => block.id)))
  assert.deepEqual(new Set(relationPath), new Set(actual.relations.map((edge) => edge.id)))
  const edges = new Map(actual.relations.map((edge) => [edge.id, edge]))
  for (const [index, relationId] of relationPath.entries()) {
    const relation = edges.get(relationId)
    assert.ok(relation)
    const from = blockPath[index]
    const to = blockPath[index + 1]
    const follows = relation.from_ === from && relation.to_ === to
    const reverses = relation.from_ === to && relation.to_ === from
    assert.ok((input.direction !== 'in' && follows) || (input.direction !== 'out' && reverses))
    if (input.contents?.length) assert.ok(input.contents.includes(relation.content))
  }
}

function verifyScenario(scenario, result, blocks, relations) {
  const { operation, input, assert: expected } = scenario
  const status = result === null ? 'missing' : (result.status ?? 'found')
  assert.equal(status, expected.status)
  if (status !== 'found') return

  const blockIds = new Set(result.graph.blocks.map((block) => block.id))
  const relationIds = new Set(result.graph.relations.map((edge) => edge.id))
  if (expected.focal) assert.equal(result.focal_block, blocks.get(expected.focal))
  if (operation === 'relation_neighborhood') {
    assert.equal(result.focal_relation, relations.get(input.focal))
  }
  if (expected.block_set) {
    assert.deepEqual(blockIds, new Set(expected.block_set.map((alias) => blocks.get(alias))))
  }
  if (expected.relation_set) {
    assert.deepEqual(
      relationIds,
      new Set(expected.relation_set.map((alias) => relations.get(alias)))
    )
  }
  if (expected.endpoint_closed) {
    for (const edge of result.graph.relations) {
      assert.ok(blockIds.has(edge.from_) && blockIds.has(edge.to_))
    }
  }
  if (expected.block_path) {
    assert.deepEqual(
      result.block_path,
      expected.block_path.map((alias) => blocks.get(alias))
    )
  }
  if (expected.relation_path) {
    assert.deepEqual(
      result.relation_path,
      expected.relation_path.map((alias) => relations.get(alias))
    )
  }
  if (expected.hop_count !== undefined)
    assert.equal(result.relation_path.length, expected.hop_count)
  if (operation === 'find_path') verifyPath(result, input, blocks)
}

export function registerGraphNavigationTests() {
  test.describe('Graph navigation SDK', () => {
    test.beforeAll(async () => {
      const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET
      assert.ok(postgrestUrl && jwtSecret, 'Run this test with the isolated Web E2E database')
      const { GraphNavigationRetrievalManager, configStore } =
        await import('../../packages/core/dist/index.js')
      const { signDatabaseToken } = await import('../../packages/core/dist/sdk/sdk.js')
      graph = GraphNavigationRetrievalManager
      Object.assign(configStore.metaConfig, {
        INKCRE_PGREST_URL: postgrestUrl,
        INKCRE_JWT_SECRET: jwtSecret,
        telemetry_enabled: false,
      })
      headers = {
        Authorization: `Bearer ${await signDatabaseToken(jwtSecret)}`,
        'Content-Type': 'application/json',
      }
    })

    test('Web Core matches the shared graph navigation corpus over PostgREST', async () => {
      const corpus = JSON.parse(
        await readFile(
          new URL(
            '../../docs/_shared/20-product-tdd/graph-navigation-retrieval.corpus.json',
            import.meta.url
          ),
          'utf8'
        )
      )
      assert.equal(corpus.contract, 'core.graph_navigation_retrieval.v1')
      const blocks = new Map()
      const relations = new Map()
      try {
        for (const alias of [...corpus.topology.blocks, 'missing']) {
          blocks.set(alias, await createBlock(alias))
        }
        await removeBlocks([blocks.get('missing')])
        for (const edge of corpus.topology.relations) {
          const [{ id }] = await createRows('relations', {
            from_: blocks.get(edge.from),
            to_: blocks.get(edge.to),
            content: edge.content,
          })
          relations.set(edge.alias, id)
        }
        for (const scenario of corpus.scenarios) {
          await test.step(scenario.name, async () => {
            verifyScenario(
              scenario,
              await readScenario(scenario, blocks, relations),
              blocks,
              relations
            )
          })
        }
      } finally {
        await removeBlocks([...blocks.values()])
      }
    })

    test('graph navigation preserves relations whose endpoints are present', async () => {
      const start = await createBlock('start')
      const blockIds = [start]
      try {
        const target = await createBlock('target')
        blockIds.push(target)
        const [connected, ...incomplete] = await createRows('relations', [
          { from_: start, to_: target, content: 'connected' },
          { from_: start, to_: null, content: 'first absent target' },
          { from_: start, to_: null, content: 'second absent target' },
          { from_: null, to_: target, content: 'first absent source' },
          { from_: null, to_: target, content: 'second absent source' },
        ])
        assert.equal(incomplete.filter((relation) => relation.to_ === null).length, 2)
        assert.equal(incomplete.filter((relation) => relation.from_ === null).length, 2)
        for (const focal of blockIds) {
          const result = await graph.getBlockNeighborhood(focal, { limit: 1 })
          assert.equal(result.focal_block, focal)
          assert.deepEqual(new Set(result.graph.blocks.map((block) => block.id)), new Set(blockIds))
          assert.deepEqual(
            result.graph.relations.map((relation) => relation.id),
            [connected.id]
          )
          assert.equal(result.next_cursor, null)
        }

        const outgoing = await graph.findPath(start, target, { direction: 'out' })
        const incoming = await graph.findPath(target, start, { direction: 'in' })
        for (const [path, expectedBlocks] of [
          [outgoing, [start, target]],
          [incoming, [target, start]],
        ]) {
          assert.equal(path.status, 'found')
          assert.deepEqual(path.block_path, expectedBlocks)
          assert.deepEqual(path.relation_path, [connected.id])
        }

        const { Relation } = await import('../../packages/core/dist/index.js')
        for (const relation of incomplete) {
          assert.equal(await graph.getRelationNeighborhood(relation.id), null)
          await assert.rejects(() => Relation.find(relation.id), { name: 'ZodError' })
        }

        const [selfLoop] = await createRows('relations', {
          from_: start,
          to_: start,
          content: 'self loop',
        })
        const neighborhood = await graph.getRelationNeighborhood(selfLoop.id)
        assert.equal(neighborhood.focal_relation, selfLoop.id)
        assert.deepEqual(
          neighborhood.graph.blocks.map((block) => block.id),
          [start]
        )
        assert.deepEqual(
          neighborhood.graph.relations.map((relation) => relation.id),
          [selfLoop.id]
        )
      } finally {
        await removeBlocks(blockIds)
      }
    })

    test('parallel relations cannot mask a path within the Block budget', async () => {
      const [start, bridge, target, noise] = await createRows(
        'blocks',
        ['start', 'bridge', 'target', 'noise'].map((alias) => ({
          resolver: 'core.text.v1',
          storage: null,
          content: `graph-parallel.${randomUUID()}.${alias}`,
        }))
      )
      try {
        const path = await createRows('relations', [
          { from_: start.id, to_: bridge.id, content: 'path' },
          { from_: bridge.id, to_: target.id, content: 'path' },
        ])
        const response = await fetch(new URL('relations', postgrestUrl), {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(
            Array.from({ length: 10_000 }, (_, index) => ({
              from_: start.id,
              to_: noise.id,
              content: `parallel-${index}`,
            }))
          ),
        })
        assert.equal(response.status, 201)
        const options = { direction: 'out', maxHops: 4, maxExploredBlocks: 10 }
        const result = await graph.findPath(start.id, target.id, options)
        assert.equal(result.status, 'found')
        assert.deepEqual(result.block_path, [start.id, bridge.id, target.id])
        assert.deepEqual(
          result.relation_path,
          path.map((relation) => relation.id)
        )
        const insufficient = await graph.findPath(start.id, target.id, {
          ...options,
          maxExploredBlocks: 3,
        })
        assert.deepEqual(insufficient, { status: 'limit_reached' })
      } finally {
        await removeBlocks([start.id, bridge.id, target.id, noise.id])
      }
    })
  })
}
