import metadata from '../package.json' with { type: 'json' }

/** Version of the SDK providing this runtime, including Module Federation Hosts. */
export const CORE_SDK_VERSION: string = metadata.version
