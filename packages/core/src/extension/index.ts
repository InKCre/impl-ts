export {
  NativeDistributionSchema,
  ExtensionParticipationSchema,
  ExtensionParticipationModel,
  ExtensionRuntimeStatusSchema,
  type NativeDistribution,
  type ExtensionParticipation,
  type ExtensionRuntimeStatus,
  ExtensionNameSchema,
  ExtensionVersionSchema,
  InstalledExtensionSchema,
  InstallExtensionInputSchema,
  ExtensionModel,
  ExtensionPersistenceError,
  type ExtensionModule,
  type ExtensionSetupContribution,
  type InstalledExtension,
  type InstallExtensionInput,
  type ExtensionModelInstallInput,
} from './model'

export {
  DEFAULT_EXTENSION_REGISTRY_ORIGIN,
  EXTENSION_REGISTRY_CONFIG_KEY,
  EXTENSION_REGISTRY_CONFIG_SCHEMA,
  ExtensionRegistryOriginResolver,
} from './registry-origin'
