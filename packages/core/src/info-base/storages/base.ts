/**
 * Info-Base Storage System
 *
 * Storages turn an opaque block pointer into bytes. Semantic interpretation belongs
 * to the block resolver rather than a storage implementation.
 *
 * This module defines the Storage class with DB integration and registry pattern.
 */

import { z } from 'zod'
import { Z } from 'zod-class'
import { DBAPIClient } from '../../base/db-api'
import type { RelationRow } from '../../database'

// ============================================================================
// Storage Type References
// ============================================================================

export type StorageTypeRef = string
export const StorageTypeRefZ = z.string()

export type StorageRef = number
export const StorageRefZ = z.number()

// ============================================================================
// Block Interface (minimal, for type compatibility)
// ============================================================================

/**
 * Minimal block interface for storage compatibility.
 */
export interface IStorageBlock {
  id: number
  storage: number | null
  content: string
}

// ============================================================================
// Storage Type Model
// ============================================================================

export class StorageType extends Z.class({
  id: StorageTypeRefZ,
  description: z.string().optional(),
  writable: z.boolean().default(false),
  config_schema: z.record(z.string(), z.unknown()).optional().default({}),
}) {
  static dbApi: DBAPIClient<'storage_types', StorageType> = new DBAPIClient<
    'storage_types',
    StorageType
  >('storage_types', StorageType)

  static async get(id: StorageTypeRef): Promise<StorageType> {
    return StorageType.parse((await this.dbApi.from().select().eq('id', id).single()).data)
  }

  static async getAll(): Promise<StorageType[]> {
    return ((await this.dbApi.from().select()).data ?? []).map((item) => StorageType.parse(item))
  }
}

// ============================================================================
// Storage Class with DB Integration
// ============================================================================

/**
 * Storage class - provides registry pattern, interface, and DB persistence.
 *
 * Subclasses implement _getRawContent to provide mechanics-specific byte retrieval.
 *
 * @template RawContentT - The type of content this storage returns
 */
export class Storage<RawContentT = unknown> {
  // Storage record data
  readonly id?: StorageRef
  readonly type: StorageTypeRef
  readonly nickname: string | null
  readonly config: Record<string, unknown>

  // ============================================================================
  // Static Registry (Storage Manager)
  // ============================================================================

  private static storageClasses: Map<StorageTypeRef, new (data: any) => Storage<any>> = new Map()
  private static dbApi: DBAPIClient<'storages'> = new DBAPIClient<'storages'>('storages')

  /**
   * Register a storage handler for a specific type.
   * @param type - The storage type identifier
   * @param handler - The handler class
   */
  static register(type: StorageTypeRef, handler: new (data: any) => Storage<any>): void {
    this.storageClasses.set(type, handler)
  }

  /**
   * Get a registered handler by type.
   * @param type - The storage type identifier
   * @returns The handler class or undefined if not found
   */
  static getHandler(type: StorageTypeRef): (new (data: any) => Storage<any>) | undefined {
    return this.storageClasses.get(type)
  }

  /**
   * Get all registered storage type identifiers.
   */
  static getRegisteredTypes(): StorageTypeRef[] {
    return Array.from(this.storageClasses.keys())
  }

  // ============================================================================
  // DB Integration Methods
  // ============================================================================

  /**
   * Get a storage record by ID from the database.
   * Returns an instance of the registered handler class.
   */
  static async get<RawContentT = unknown>(id: StorageRef): Promise<Storage<RawContentT>> {
    const storageRecord = Storage.fromRow(
      (await this.dbApi.from().select().eq('id', id).single()).data
    )
    const Handler = Storage.getHandler(storageRecord.type)
    if (!Handler) {
      throw new Error(`No handler registered for storage type: ${storageRecord.type}`)
    }
    return new Handler(storageRecord) as Storage<RawContentT>
  }

  /**
   * Get all storage records from the database.
   */
  static async getAll(): Promise<Storage[]> {
    return ((await this.dbApi.from().select()).data ?? []).map((row) => Storage.fromRow(row))
  }

  private static fromRow(row: RelationRow<'storages'> | null): Storage {
    if (!row) throw new Error('Storage relation returned no row.')
    return new Storage({
      ...row,
      config: z.record(z.string(), z.unknown()).parse(row.config),
    })
  }

  // ============================================================================
  // Constructor
  // ============================================================================

  constructor(data: {
    id?: StorageRef
    type: StorageTypeRef
    nickname?: string | null
    config?: Record<string, unknown>
  }) {
    this.id = data.id
    this.type = data.type
    this.nickname = data.nickname ?? null
    this.config = data.config ?? {}
  }

  // ============================================================================
  // Instance Methods
  // ============================================================================

  /**
   * Retrieve raw content for a block.
   * This method delegates to _getRawContent.
   *
   * @param block - The block to retrieve content for
   * @returns The raw content
   */
  async getRawContent(block: IStorageBlock): Promise<RawContentT> {
    return this._getRawContent(block)
  }

  /**
   * Internal method to retrieve raw content.
   * Subclasses override this to provide type-specific content retrieval.
   * Base instances are catalog projections and cannot hydrate block content.
   *
   * @param block - The block to retrieve content for
   * @returns The raw content
   */
  protected async _getRawContent(block: IStorageBlock): Promise<RawContentT> {
    throw new Error(
      `Storage type ${this.type} does not implement byte hydration for block ${block.id}.`
    )
  }
}

export abstract class WritableStorage<RawContentT> extends Storage<RawContentT> {
  abstract createRawContent(content: RawContentT): Promise<string>

  abstract updateRawContent(blockContent: string, content: RawContentT): Promise<boolean>

  abstract deleteRawContent(blockContent: string): Promise<boolean>
}
