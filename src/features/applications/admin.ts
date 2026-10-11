import "server-only";

import { requireAdmin } from "@/lib/page-auth";
import { type BetaApplicationStatus, queryBetaApplications } from "@/features/applications/store";

/**
 * Admin-only list of beta applications, newest first (at most 200). For a
 * Server Component of the admin area. Applications precede any workspace,
 * so this list is platform-scoped; access is checked here as well.
 */
export async function listBetaApplications(options: { status?: BetaApplicationStatus; limit?: number } = {}) {
  await requireAdmin();
  return queryBetaApplications(options);
}
