import corePackage from '../../../packages/core/package.json'
import {
  RegistryReleaseReader,
  sortPublishedReleases,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
} from '@inkcre/extension-runtime-client-web'
import {
  ExtensionParticipationModel,
  ExtensionRegistryOriginResolver,
  Cron,
  CronForm,
  ExtensionModel,
  Peer,
  PeerConfigSchema,
  PeerManager,
  PeerProtocolRequestSchema,
  PeerProtocolResponseSchema,
  Source,
  SourceForm,
  type InstalledExtension,
  type ExtensionRuntimeStatus,
  type JsonValue,
} from '@inkcre/core'
import { z } from 'zod'

const EXTENSION_NAME = 'inkcre/twitter'
const EXTENSION_MANAGEMENT_CAPABILITY = 'core.extension.management.v2'
const TWITTER_SETUP_STATUS_CAPABILITY = 'inkcre.twitter.setup.status.v1'
const TWITTER_OAUTH_APP_CONFIGURE_CAPABILITY = 'inkcre.twitter.oauth-app.configure.v1'
const TWITTER_OAUTH_BEGIN_CAPABILITY = 'inkcre.twitter.oauth.begin.v1'
const TWITTER_OAUTH_TRANSACTION_READ_CAPABILITY = 'inkcre.twitter.oauth.transaction.read.v1'
const TWITTER_OAUTH_DISCONNECT_CAPABILITY = 'inkcre.twitter.oauth.disconnect.v1'
const BOOKMARK_SOURCE_TYPE = 'extensions.twitter.bookmark.Source'
const SOURCE_COLLECT_JOB_TYPE = 'core.source.collect.v1'
type TwitterPeerRequest = z.input<typeof PeerProtocolRequestSchema>

function hasAuthorityUserInfo(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value)
}

const HttpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return (protocol === 'http:' || protocol === 'https:') && !hasAuthorityUserInfo(value)
}, 'URL must use HTTP or HTTPS.')

const HttpsUrlSchema = z
  .url()
  .refine(
    (value) => new URL(value).protocol === 'https:' && !hasAuthorityUserInfo(value),
    'Authorization URL must use HTTPS without embedded credentials.'
  )

export const TwitterSetupStatusSchema = z.object({
  callback_url: HttpUrlSchema,
  x_monkey_base_url: HttpsUrlSchema.nullable().optional(),
  connected: z.boolean(),
  user_id: z.string().nullable(),
  handle: z.string().nullable(),
  scopes: z.array(z.string()),
  reconnect_required: z.boolean(),
})

export const OAuthTransactionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'exchanging', 'succeeded', 'failed', 'expired']),
  authorize_url: HttpsUrlSchema.nullable(),
  expires_at: z.coerce.date(),
  error: z.string().nullable(),
})

export type TwitterSetupStatus = z.infer<typeof TwitterSetupStatusSchema>
export type OAuthTransaction = z.infer<typeof OAuthTransactionSchema>

const TwitterOAuthAppConfigSchema = z.object({
  client_id: z.string().default(''),
  client_secret: z.string().default(''),
})

export type TwitterOAuthAppConfig = z.infer<typeof TwitterOAuthAppConfigSchema>

export async function readTwitterOAuthAppConfig(): Promise<TwitterOAuthAppConfig> {
  const extension = await ExtensionModel.get(EXTENSION_NAME)
  if (!extension) throw new Error(`${EXTENSION_NAME} is not installed.`)
  return TwitterOAuthAppConfigSchema.parse(extension.config)
}

export interface CorePeerCandidate {
  peer: Peer
  extension: InstalledExtension
  enabled: boolean
  setupAvailable: boolean
}

function advertises(peer: Peer, capability: string): boolean {
  try {
    return peer.capabilitySnapshot().some((candidate) => candidate.id === capability)
  } catch {
    return false
  }
}

export async function discoverCoreCandidates(signal?: AbortSignal): Promise<CorePeerCandidate[]> {
  signal?.throwIfAborted()
  const [extension, peers, participations] = await Promise.all([
    ExtensionModel.get(EXTENSION_NAME),
    PeerManager.listLive(),
    ExtensionParticipationModel.list(),
  ])
  signal?.throwIfAborted()
  if (!extension) return []
  const candidates = await Promise.all(
    peers
      .filter((peer) => advertises(peer, EXTENSION_MANAGEMENT_CAPABILITY))
      .map(async (peer) => ({
        peer,
        status: await readExtensionPeerStatus(peer.id, EXTENSION_NAME),
      }))
  )
  signal?.throwIfAborted()
  return candidates
    .filter(({ status }) => status.supported_distributions.includes('python'))
    .map(({ peer }) => ({
      peer,
      extension,
      enabled: participations.some(
        (row) => row.name === EXTENSION_NAME && row.peer_id === peer.id && row.enabled
      ),
      setupAvailable: advertises(peer, TWITTER_SETUP_STATUS_CAPABILITY),
    }))
}

export class TwitterSetupAPI {
  constructor(readonly peer: Peer) {}

  async enableCore(signal?: AbortSignal): Promise<ExtensionRuntimeStatus> {
    const existing = await ExtensionParticipationModel.get(this.peer.id, EXTENSION_NAME)
    if (!existing) {
      const peerConfig = PeerConfigSchema.parse(this.peer.config)
      const origin = await new ExtensionRegistryOriginResolver(
        () => peerConfig.extension_registry_url
      ).resolve()
      const reader = new RegistryReleaseReader({
        registryOrigin: origin,
        hostSdk: { name: '@inkcre/core', version: corePackage.version },
      })
      const catalog = await reader.getExtension(EXTENSION_NAME, 'python')
      const release = sortPublishedReleases(catalog.releases ?? [])[0]
      if (!release) throw new Error('Twitter has no published Python distribution.')
      await manageExtensionOnPeer(this.peer.id, {
        action: 'select',
        extension: EXTENSION_NAME,
        distribution: 'python',
        version: release.version,
      })
    }
    signal?.throwIfAborted()
    return manageExtensionOnPeer(this.peer.id, { action: 'enable', extension: EXTENSION_NAME })
  }

  status(signal?: AbortSignal): Promise<TwitterSetupStatus> {
    return delegateTwitterRequest(
      this.peer,
      TWITTER_SETUP_STATUS_CAPABILITY,
      {},
      TwitterSetupStatusSchema,
      signal
    )
  }

  saveOAuthApp(
    clientId: string,
    clientSecret: string,
    confirmAccountReset: boolean,
    signal?: AbortSignal
  ): Promise<TwitterSetupStatus> {
    return delegateTwitterRequest(
      this.peer,
      TWITTER_OAUTH_APP_CONFIGURE_CAPABILITY,
      {
        body: {
          client_id: clientId,
          client_secret: clientSecret,
          confirm_account_reset: confirmAccountReset,
        },
      },
      TwitterSetupStatusSchema,
      signal
    )
  }

  beginOAuth(signal?: AbortSignal): Promise<OAuthTransaction> {
    return delegateTwitterRequest(
      this.peer,
      TWITTER_OAUTH_BEGIN_CAPABILITY,
      {},
      OAuthTransactionSchema,
      signal
    )
  }

  oauthTransaction(transactionId: string, signal?: AbortSignal): Promise<OAuthTransaction> {
    return delegateTwitterRequest(
      this.peer,
      TWITTER_OAUTH_TRANSACTION_READ_CAPABILITY,
      { body: { transaction_id: transactionId } },
      OAuthTransactionSchema,
      signal
    )
  }

  disconnect(signal?: AbortSignal): Promise<TwitterSetupStatus> {
    return delegateTwitterRequest(
      this.peer,
      TWITTER_OAUTH_DISCONNECT_CAPABILITY,
      {},
      TwitterSetupStatusSchema,
      signal
    )
  }
}

export interface BookmarkCollectionSetup {
  sources: Source[]
  source: Source | null
  cron: Cron | null
}

export class TwitterBookmarkSetup {
  static async read(sourceId?: number | null): Promise<BookmarkCollectionSetup> {
    const sources = (await Source.getAll()).filter((source) => source.type === BOOKMARK_SOURCE_TYPE)
    const source =
      sources.find((candidate) => candidate.id === sourceId) ??
      (sourceId == null && sources.length === 1 ? sources[0]! : null)
    const crons = source ? await Cron.getBySource(source.id) : []
    const cron =
      crons.find(
        (candidate) =>
          candidate.job_type === SOURCE_COLLECT_JOB_TYPE &&
          candidate.job_parameters.source === source?.id
      ) ?? null
    return { sources, source, cron }
  }

  static async createSource(nickname: string): Promise<Source> {
    return new SourceForm({
      type: BOOKMARK_SOURCE_TYPE,
      nickname,
      config: {},
      state: {},
      storage: null,
    }).create()
  }

  static async saveSchedule(source: Source, hour: number, minute: number): Promise<Cron> {
    const current = await this.read(source.id)
    const form = new CronForm({
      schedule: `${minute} ${hour} * * *`,
      enabled: current.cron?.enabled ?? false,
      job_type: SOURCE_COLLECT_JOB_TYPE,
      job_parameters: { source: source.id, config: { full: false, result_limit: 40 } },
      job_timeout_seconds: current.cron?.job_timeout_seconds ?? null,
    })
    return current.cron ? current.cron.update(form) : form.create()
  }

  static async finish(source: Source, cron: Cron): Promise<Cron> {
    const enabled = await cron.update(
      new CronForm({
        schedule: cron.schedule,
        enabled: true,
        job_type: SOURCE_COLLECT_JOB_TYPE,
        job_parameters: { source: source.id, config: { full: false, result_limit: 40 } },
        job_timeout_seconds: cron.job_timeout_seconds,
      })
    )
    await enabled.runNow()
    return enabled
  }
}

async function delegateTwitterRequest<Result>(
  peer: Peer,
  capability: string,
  request: TwitterPeerRequest,
  schema: z.ZodType<Result>,
  signal?: AbortSignal
): Promise<Result> {
  signal?.throwIfAborted()
  const delegated = await PeerManager.delegate(capability, request as JsonValue, peer.id)
  signal?.throwIfAborted()
  const response = PeerProtocolResponseSchema.parse(delegated)
  if (response.status < 200 || response.status >= 300 || response.body === undefined) {
    const detail =
      typeof response.body === 'object' &&
      response.body !== null &&
      !Array.isArray(response.body) &&
      typeof response.body.detail === 'string'
        ? response.body.detail
        : `Peer capability ${capability} returned HTTP ${response.status}.`
    throw new Error(detail)
  }
  return schema.parse(response.body)
}
