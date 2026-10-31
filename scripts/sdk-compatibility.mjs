import { getReleasePlan } from '@changesets/get-release-plan'

/** Read all pending intent without Git branch/history assumptions or checkout mutation. */
export async function pendingCoreVersion(root) {
  const plan = await getReleasePlan(root)
  return plan.releases.find((item) => item.name === '@inkcre/core')?.newVersion ?? null
}
