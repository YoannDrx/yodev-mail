export const SES_ENVIRONMENT_TAG = "yodev:environment";

// Deterministic names isolate a workspace even when its database is cloned.
// Do not truncate or sanitize arbitrary input into another workspace's name.
export function sesResourceNames(workspaceId: string, environment: string | undefined) {
  if (environment !== "dev" && environment !== "prod") return null;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId)) return null;
  const tenantName = `ym-${environment}-${workspaceId.toLowerCase()}`;
  return { tenantName, configurationSetName: `${tenantName}-txn` };
}
