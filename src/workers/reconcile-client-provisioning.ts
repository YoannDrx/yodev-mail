import { reconcilePendingOwnerInvitations } from "@/features/onboarding/reconcile-owner";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const result = await reconcilePendingOwnerInvitations();
  if (result.failed) {
    emitOperationalMetric("ClientProvisioningReconciliationFailed", result.failed);
    throw new Error(
      `Client provisioning reconciliation failed for ${result.failed} run(s).`,
    );
  }
  return result;
}
