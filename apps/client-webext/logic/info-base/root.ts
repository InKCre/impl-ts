// (Information) Base Root module index

import { inkcreApi, inkcreApiReady } from '~/logic/storage'
import type { BlockForm } from './block'

export interface RelationInput {
  content: string
}

export class ArcForm {
  constructor(
    public relation: RelationInput,
    public to_block: StarGraphForm | null = null,
    public from_block: StarGraphForm | null = null
  ) {}
}

export class StarGraphForm {
  constructor(
    public block: BlockForm,
    public out_relations: ArcForm[] = [],
    public in_relations: ArcForm[] = []
  ) {}

  async create() {
    await inkcreApiReady
    return fetch(new URL('/graph', inkcreApi.value), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        block: this.block,
        out_relations: this.out_relations,
        in_relations: this.in_relations,
      }),
    })
  }
}

export class Root {
  constructor() {}

  /**
   * @deprecated Use the local ExplainAgent instead (logic/agents).
   * This method calls InKCre Core's RAG API, which should not be used for content generation.
   * InKCre WebExt wraps InKCre Core (information repository) and should handle
   * content generation locally using the VoltAgent-based ExplainAgent.
   */
  static async RAG(params: {
    query: string
    retrieve_mode?: string
    context_blocks?: string
  }): Promise<string> {
    await inkcreApiReady
    const url = new URL('/sink/rag', inkcreApi.value)
    url.searchParams.set('query', encodeURIComponent(params.query))
    if (params.retrieve_mode) {
      url.searchParams.set('retrieve_mode', params.retrieve_mode)
    }
    if (params.context_blocks) {
      url.searchParams.set('context_blocks', params.context_blocks)
    }

    const response = await fetch(url)
    const result = await response.json()
    return result.message
  }
}
