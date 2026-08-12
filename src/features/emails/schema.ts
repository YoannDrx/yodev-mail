import { z } from "zod";

const mailbox = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(140).optional(),
}).strict();

const variables = z.record(
  z.string().max(80),
  z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]),
).refine((value) => Object.keys(value).length <= 50, { message: "Un maximum de 50 variables est autorisé." });

const templateContent = z.object({
  templateId: z.string().uuid(),
  variables: variables.default({}),
}).strict();

const rawContent = z.object({
  subject: z.string().trim().min(1).max(255),
  html: z.string().max(512_000),
  text: z.string().max(512_000),
}).strict().refine(
  (value) => Buffer.byteLength(value.html, "utf8") + Buffer.byteLength(value.text, "utf8") <= 512_000,
  { message: "Le contenu HTML et texte ne peut pas dépasser 512 Ko." },
);

export const sendEmailSchema = z.object({
  from: mailbox,
  to: mailbox,
  replyTo: z.string().email().optional(),
  category: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,79}$/),
  content: z.union([templateContent, rawContent]),
  attachments: z.array(z.object({ id: z.string().uuid() }).strict()).max(5).default([]),
  metadata: z.object({
    referenceId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  }).strict().default({}),
}).strict();

export const attachmentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "text/csv",
    "application/json",
    "text/calendar",
  ]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().superRefine((value, context) => {
  const extensions: Record<typeof value.contentType, string[]> = {
    "application/pdf": [".pdf"],
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/webp": [".webp"],
    "text/plain": [".txt"],
    "text/csv": [".csv"],
    "application/json": [".json"],
    "text/calendar": [".ics"],
  };
  if (!extensions[value.contentType].some((extension) => value.fileName.toLowerCase().endsWith(extension))) {
    context.addIssue({ code: "custom", path: ["fileName"], message: "L’extension ne correspond pas au type MIME déclaré." });
  }
});

export function isRawContent(content: z.infer<typeof sendEmailSchema>["content"]): content is z.infer<typeof rawContent> {
  return "html" in content;
}

export function combinedContentSize(html: string, text: string) {
  return Buffer.byteLength(html, "utf8") + Buffer.byteLength(text, "utf8");
}

export function estimatedMimeSize(contentBytes: number, attachmentBytes: number, attachmentCount: number) {
  return contentBytes + Math.ceil(attachmentBytes / 3) * 4 + attachmentCount * 2_048 + 16_384;
}
