import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  emitOperationalMetric: vi.fn(),
  loadRuntimeSecrets: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/aws", () => ({
  awsClients: vi.fn(async () => ({ s3: { send: dependencies.s3Send } })),
}));
vi.mock("@/lib/operational-metric", () => ({
  emitOperationalMetric: dependencies.emitOperationalMetric,
}));
vi.mock("@/workers/runtime-secrets", () => ({
  loadRuntimeSecrets: dependencies.loadRuntimeSecrets,
}));

import { databasePool, requireDb } from "@/db/runtime";
import { attachments, workspaces } from "@/db/schema";
import { handler as scanAttachment } from "@/workers/attachment-scan";
import { handler as purgeAttachments } from "@/workers/purge-attachments";

const db = requireDb();
const pool = databasePool!;
const cleanPdf = new TextEncoder().encode("%PDF-1.4\ncanary\n");

function scanEvent(storageKey: string, scanResultStatus: string) {
  return {
    detail: {
      s3ObjectDetails: { objectKey: storageKey },
      scanResultDetails: { scanResultStatus },
    },
  };
}

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = result.rows
    .map(({ tablename }) => tablename)
    .filter((name) => /^[a-z0-9_]+$/.test(name))
    .map((name) => `\"${name}\"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function seedAttachment(input: {
  expiresAt?: Date;
  expectedSha256?: string;
  status?: "pending_upload" | "scanning" | "clean" | "rejected" | "deleted" | "expired";
} = {}) {
  const workspaceId = randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Attachment integration",
    slug: `attachment-${workspaceId.slice(0, 8)}`,
    status: "approved",
  });
  const [attachment] = await db.insert(attachments).values({
    workspaceId,
    fileName: "canary.pdf",
    declaredContentType: "application/pdf",
    sizeBytes: cleanPdf.length,
    expectedSha256: input.expectedSha256 ?? createHash("sha256").update(cleanPdf).digest("hex"),
    storageKey: `pending/${randomUUID()}`,
    status: input.status ?? "pending_upload",
    expiresAt: input.expiresAt ?? new Date(Date.now() + 3_600_000),
  }).returning();
  return attachment;
}

beforeEach(async () => {
  await cleanDatabase();
  dependencies.emitOperationalMetric.mockReset();
  dependencies.loadRuntimeSecrets.mockReset();
  dependencies.s3Send.mockReset();
  process.env.ATTACHMENTS_BUCKET_NAME = "integration-attachments";
});

afterAll(async () => {
  delete process.env.ATTACHMENTS_BUCKET_NAME;
  await pool.end();
});

describe("attachment GuardDuty lifecycle", () => {
  it("marks an exact clean object as ready and ignores duplicate clean events", async () => {
    const attachment = await seedAttachment();
    dependencies.s3Send.mockResolvedValue({
      Body: { transformToByteArray: async () => cleanPdf },
    });

    await scanAttachment(scanEvent(attachment.storageKey, "NO_THREATS_FOUND"));
    await scanAttachment(scanEvent(attachment.storageKey, "NO_THREATS_FOUND"));

    const [stored] = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(stored).toMatchObject({
      detectedContentType: "application/pdf",
      scanResult: "NO_THREATS_FOUND",
      status: "clean",
      verifiedSha256: attachment.expectedSha256,
    });
    expect(dependencies.s3Send).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatching object after a clean malware scan", async () => {
    const attachment = await seedAttachment({ expectedSha256: "0".repeat(64) });
    dependencies.s3Send.mockResolvedValue({
      Body: { transformToByteArray: async () => cleanPdf },
    });

    await scanAttachment(scanEvent(attachment.storageKey, "NO_THREATS_FOUND"));

    const [stored] = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(stored.status).toBe("rejected");
    expect(dependencies.emitOperationalMetric).toHaveBeenCalledWith("AttachmentScanRejected");
  });

  it("never lets a delayed clean result overwrite a malware rejection", async () => {
    const attachment = await seedAttachment();
    let releaseRead!: (value: unknown) => void;
    dependencies.s3Send.mockImplementationOnce(() => new Promise((resolve) => {
      releaseRead = resolve;
    }));

    const cleanScan = scanAttachment(scanEvent(attachment.storageKey, "NO_THREATS_FOUND"));
    await vi.waitFor(() => expect(dependencies.s3Send).toHaveBeenCalledTimes(1));
    await scanAttachment(scanEvent(attachment.storageKey, "THREATS_FOUND"));
    releaseRead({ Body: { transformToByteArray: async () => cleanPdf } });
    await cleanScan;

    const [stored] = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(stored).toMatchObject({ scanResult: "THREATS_FOUND", status: "rejected" });
  });

  it("does not resurrect a deleted object when a late event arrives", async () => {
    const attachment = await seedAttachment({ status: "deleted" });

    await scanAttachment(scanEvent(attachment.storageKey, "NO_THREATS_FOUND"));
    await scanAttachment(scanEvent(attachment.storageKey, "THREATS_FOUND"));

    const [stored] = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(stored.status).toBe("deleted");
    expect(dependencies.s3Send).not.toHaveBeenCalled();
  });
});

describe("attachment expiration", () => {
  it("deletes expired objects and leaves future objects untouched", async () => {
    const expired = await seedAttachment({ expiresAt: new Date(Date.now() - 60_000), status: "clean" });
    const future = await seedAttachment({ expiresAt: new Date(Date.now() + 60_000), status: "clean" });
    dependencies.s3Send.mockResolvedValue({});

    const result = await purgeAttachments();

    const [storedExpired] = await db.select().from(attachments).where(eq(attachments.id, expired.id));
    const [storedFuture] = await db.select().from(attachments).where(eq(attachments.id, future.id));
    expect(result).toEqual({ expired: 1 });
    expect(storedExpired).toMatchObject({ fileName: "[expired]", status: "expired" });
    expect(storedExpired.deletedAt).toBeInstanceOf(Date);
    expect(storedFuture.status).toBe("clean");
    expect(dependencies.s3Send).toHaveBeenCalledTimes(1);
  });

  it("keeps the row retryable and emits a metric when S3 deletion fails", async () => {
    const attachment = await seedAttachment({ expiresAt: new Date(Date.now() - 60_000), status: "rejected" });
    dependencies.s3Send.mockRejectedValue(new Error("s3 unavailable"));

    await expect(purgeAttachments()).rejects.toThrow("s3 unavailable");

    const [stored] = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(stored.status).toBe("rejected");
    expect(dependencies.emitOperationalMetric).toHaveBeenCalledWith("AttachmentPurgeFailure");
  });
});
