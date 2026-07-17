import { z } from "zod";

const recipient = z.object({ email: z.string().email(), name: z.string().max(140).optional() });
const content = z.object({ html: z.string().max(900_000), text: z.string().max(300_000) });
const template = z.object({ templateId: z.string().uuid(), variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) });

export const sendEmailSchema = z.object({
  from: z.object({ email: z.string().email(), name: z.string().max(140).optional() }),
  to: z.array(recipient).min(1).max(50),
  replyTo: z.string().email().optional(),
  subject: z.string().min(1).max(255),
  tags: z.record(z.string().max(64), z.string().max(256)).default({}),
  tracking: z.object({ opens: z.boolean().default(false), clicks: z.boolean().default(false) }).default({ opens: false, clicks: false }),
}).and(z.union([content.extend({ templateId: z.never().optional(), variables: z.never().optional() }), template.extend({ html: z.never().optional(), text: z.never().optional() })]));
