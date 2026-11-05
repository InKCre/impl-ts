/**
 * Storage Handler Registration
 *
 * Import this file to auto-register all storage handlers.
 * Storage handlers are imported from @inkcre/core.
 */

// Import all storage handlers to trigger @Storage.registry decorator
import { HttpStorage, PostgreSQLBinaryStorage } from '@inkcre/core'

// Handlers are auto-registered via decorator, no need to do anything else
// Just ensure they're imported
export { HttpStorage, PostgreSQLBinaryStorage }
