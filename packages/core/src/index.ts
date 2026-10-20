/**
 * @inkcre/core
 *
 * Core protocols and utilities for InKCre applications.
 * This package provides environment-agnostic interfaces for:
 * - Extension lifecycle (ExtensionModule)
 * - Content resolution (Resolver)
 * - Storage abstraction (Storage)
 */

// Core singleton
export { store } from './store'

// Base layer
export { APIError, DBAPIClient } from './base'

// Native Web Extension Host and Module Federation lifecycle
export {
  ExtensionNameSchema,
  ExtensionVersionSchema,
  InstalledExtensionSchema,
  InstallExtensionInputSchema,
  ExtensionModel,
  NativeDistributionSchema,
  ExtensionParticipationSchema,
  ExtensionParticipationModel,
  ExtensionRuntimeStatusSchema,
  type NativeDistribution,
  type ExtensionParticipation,
  type ExtensionRuntimeStatus,
  ExtensionPersistenceError,
  type ExtensionModule,
  type ExtensionSetupContribution,
  type InstalledExtension,
  type InstallExtensionInput,
  type ExtensionModelInstallInput,
  ExtensionRegistryOriginResolver,
  DEFAULT_EXTENSION_REGISTRY_ORIGIN,
} from './extension'

// Peer discovery and delegation
export {
  Peer,
  PeerManager,
  WebPeerRuntime,
  PeerHTTPOutbound,
  PeerReadinessSchema,
  probePeerReadiness,
  type PeerReadiness,
  type PeerReadinessObservation,
  CapabilityDelegationUnavailable,
  PeerOutcomeUnknown,
  PeerProtocolError,
  PeerRequestNotExecuted,
  PEER_EXECUTION_HEADER,
  PEER_HTTP_PROTOCOL,
  type CapabilityID,
  type JsonValue,
  type PeerProtocolRequest,
  PeerProtocolRequestSchema,
  type PeerProtocolResponse,
  PeerProtocolResponseSchema,
  type PeerRef,
  makePeerProp,
  makePeerRefProp,
} from './peer'

// Peer-delivered business capabilities
export {
  SemanticRetrievalManager,
  SemanticRetrievalDelegationError,
  SemanticRetrievalRequestSchema,
  SemanticRetrievalResultSchema,
  VectorRetrievalOptionsSchema,
  SEMANTIC_RETRIEVAL_CAPABILITY,
  type SemanticRetrievalRequest,
  type SemanticRetrievalResult,
} from './semantic-retrieval'
export {
  LexicalRetrievalManager,
  LexicalRetrievalDelegationError,
  LexicalRetrievalRequestSchema,
  LexicalRetrievalResultSchema,
  LexicalRetrievalMatchSchema,
  LexicalEvidenceSchema,
  LEXICAL_RETRIEVAL_CAPABILITY,
  type LexicalRetrievalRequest,
  type LexicalRetrievalResult,
  type LexicalRetrievalMatch,
  type LexicalEvidence,
} from './lexical-retrieval'
export {
  GraphNavigationRetrievalManager,
  GraphDirectionSchema,
  GraphModelSchema,
  BlockNeighborhoodSchema,
  RelationNeighborhoodSchema,
  PathResultSchema,
  type GraphDirection,
  type GraphModel,
  type BlockNeighborhood,
  type RelationNeighborhood,
  type PathResult,
} from './graph-navigation-retrieval'
export {
  OrganizationManager,
  OrganizationDelegationError,
  RUMINATION_CAPABILITY,
} from './organization'

// Source
export {
  Source,
  SourceForm,
  SourceType,
  SourceManager,
  SOURCE_COLLECT_JOB_TYPE,
  SOURCE_BACKFILL_JOB_TYPE,
  type SourceImplementation,
  type SourceRef,
  type SourceTypeRef,
  makeSourceProp,
  makeSourceRefProp,
} from './source'

// Durable background execution and recurring definitions
export {
  Job,
  JobType,
  JobManager,
  JobStatus,
  DuplicateJobHandlerError,
  type JobHandler,
  type JobRef,
  type JobTypeRef,
} from './job'
export { Cron, CronForm } from './cron'

// Observability
export {
  Log,
  type LogRef,
  initializeTelemetry,
  shutdownTelemetry,
  flushTelemetry,
  telemetryDiagnosticsUrl,
} from './obsrv'

// Info-Base (Blocks, Relations, Storage, Resolvers)
export {
  // Models
  Block,
  BlockForm,
  Relation,
  RelationForm,
  type BlockRef,
  type RelationRef,
  makeBlockProp,
  makeBlockRefProp,
  makeRelationProp,
  makeRelationRefProp,
  // Resolver protocols
  type ResolverContentState,
  type SolvedContentRendererProps,
  type InfoBaseRoute,
  type InfoBaseSceneAddress,
  type InfoBaseRouter,
  setInfoBaseRouter,
  getInfoBaseRouter,
  // Resolver implementations
  Resolver,
  ResolverCache,
  CORE_RESOLVER_IDS,
  DuplicateResolverRegistrationError,
  ResolverContractError,
  ResolverContentError,
  UnknownResolverError,
  UnsupportedResolverCapability,
  type CoreResolverId,
  type ProjectionOptions,
  type TextProjectionContext,
  TextResolver,
  AudioResolver,
  EpubResolver,
  FileResolver,
  ImageResolver,
  PdfResolver,
  VideoResolver,
  HtmlResolver,
  ZipResolver,
  registerCoreResolvers,
  type AudioSolvedContent,
  type ByteSolvedContent,
  type EpubSolvedContent,
  type FileSolvedContent,
  type HtmlRawContent,
  type ImageSolvedContent,
  type PdfSolvedContent,
  type VideoSolvedContent,
  type ZipSolvedContent,
  // Storage protocols
  Storage,
  WritableStorage,
  StorageType,
  type StorageTypeRef,
  StorageTypeRefZ,
  type StorageRef,
  StorageRefZ,
  type IStorageBlock,
  // HTTP storage implementations
  HttpStorage,
  StorageContentTooLargeError,
  PostgreSQLBinaryStorage,
  type HttpStorageConfig,
  type PostgreSQLBlobPointer,
} from './info-base'

// Configuration
export {
  configStore,
  PeerConfigSchema,
  MetaConfigSchema,
  AIConfigSchema,
  LLMProviderConfigSchema,
  localStorageAdapter,
  createWebextAdapter,
  CONFIG_STORAGE_KEY,
  type PeerConfig,
  type MetaConfig,
  type ProviderType,
  type LLMProviderConfig,
  type ConfigAdapterWithWrite,
  type WebextStorageLike,
} from './config'

// Database protocol
export {
  databaseRuntimeContract,
  peerJwtContract,
  type DatabaseRuntimeContract,
  type Database,
  type InkcreSchema,
  type Json,
  type RelationName,
  type RelationRow,
} from './database'

// Authentication
export { authStore } from './auth'

// Utils
export {
  unknownProp,
  numericProp,
  truthProp,
  makeRequiredProp,
  makeArrayProp,
  makeBooleanProp,
  makeNumberProp,
  makeNumericProp,
  makeStringProp,
  makeObjectProp,
  useOptionalVModel,
  type XOR,
  zinstance,
} from './utils'

// AI (placeholder)
export * from './libs/ai'
