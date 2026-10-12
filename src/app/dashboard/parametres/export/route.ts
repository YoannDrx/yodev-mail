import { requireDb } from "@/db";
import { auditEvents } from "@/db/schema";
import { workspaceExportChunks } from "@/features/workspace-data/export";
import { currentWorkspace } from "@/lib/current-workspace";

export const dynamic = "force-dynamic";

const forbidden = () => new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });

/** Owner-only JSON export of the current workspace, streamed as a download. */
export async function GET() {
  let context: Awaited<ReturnType<typeof currentWorkspace>>;
  try {
    context = await currentWorkspace({ admin: true });
  } catch {
    return forbidden();
  }
  if (!context.role.split(",").map((role) => role.trim()).includes("owner")) return forbidden();
  const { workspace, userId } = context;
  const now = new Date();
  await requireDb().insert(auditEvents).values({
    workspaceId: workspace.id,
    actorUserId: userId,
    action: "workspace.exported",
    entityType: "workspace",
    entityId: workspace.id,
    metadata: {},
    createdAt: now,
  });
  const encoder = new TextEncoder();
  const chunks = workspaceExportChunks(workspace.id, now);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch {
        // Never echo database errors: they can contain personal data.
        controller.error(new Error("export_failed"));
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  const slug = workspace.slug.replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="yodev-mail-${slug}-${now.toISOString().slice(0, 10)}.json"`,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
