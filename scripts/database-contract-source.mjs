import { projectDatabaseCompatibilityContract } from './core-release-lib.mjs'

/** Local development may consume an owner runtime without inventing a published release. */
export function validateDevelopmentContract(descriptor, contract) {
  if (descriptor.profile !== 'development' || descriptor.owner_repository !== 'InKCre/impl-py') {
    throw new Error('local type generation requires an impl-py development runtime')
  }
  if (descriptor.converging) throw new Error('database owner is still converging')
  if (contract.revision !== descriptor.contract_revision) {
    throw new Error('local runtime and exported source contract revisions differ')
  }
  if (!contract.migration_heads?.includes(descriptor.migration_head)) {
    throw new Error('local runtime and exported source migration heads differ')
  }
  return projectDatabaseCompatibilityContract(contract)
}
