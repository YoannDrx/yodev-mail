import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const workspaceStatusEnum = pgEnum("workspace_status", [
  "sandbox",
  "pending_review",
  "approved",
  "paused",
  "rejected",
]);
export const billingPlanEnum = pgEnum("billing_plan", ["sandbox", "starter", "pro", "agency"]);
export const billingStatusEnum = pgEnum("billing_status", [
  "inactive",
  "trialing",
  "active",
  "past_due",
  "canceled",
]);
export const domainStatusEnum = pgEnum("domain_status", [
  "pending",
  "verified",
  "failed",
  "disabled",
]);
export const contactStatusEnum = pgEnum("contact_status", [
  "active",
  "unsubscribed",
  "suppressed",
  "anonymized",
]);
export const consentKindEnum = pgEnum("consent_kind", [
  "marketing",
  "tracking",
  "legal_basis",
]);
export const consentActionEnum = pgEnum("consent_action", [
  "granted",
  "withdrawn",
  "objected",
  "imported",
]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "dispatching",
  "sending",
  "paused",
  "sent",
  "canceled",
  "failed",
]);
export const messageStreamEnum = pgEnum("message_stream", ["transactional", "marketing"]);
export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "soft_bounced",
  "hard_bounced",
  "complained",
  "suppressed",
  "failed",
  "unknown",
]);
export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "hard_bounce",
  "complaint",
  "unsubscribe",
  "manual",
]);
export const apiKeyModeEnum = pgEnum("api_key_mode", ["test", "live"]);
export const reviewDecisionEnum = pgEnum("review_decision", ["pending", "approved", "rejected"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkOrganizationId: varchar("clerk_organization_id", { length: 64 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 140 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    status: workspaceStatusEnum("status").default("sandbox").notNull(),
    plan: billingPlanEnum("plan").default("sandbox").notNull(),
    sesTenantName: varchar("ses_tenant_name", { length: 64 }),
    websiteUrl: text("website_url"),
    useCase: text("use_case"),
    expectedMonthlyVolume: integer("expected_monthly_volume").default(0).notNull(),
    dailyLimit: integer("daily_limit").default(200).notNull(),
    warmupStage: integer("warmup_stage").default(0).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspaces_clerk_org_idx").on(table.clerkOrganizationId),
    uniqueIndex("workspaces_slug_idx").on(table.slug),
    index("workspaces_owner_idx").on(table.ownerUserId),
    index("workspaces_status_idx").on(table.status),
  ],
);

export const workspaceSettings = pgTable("workspace_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  companyName: varchar("company_name", { length: 180 }),
  companyAddress: text("company_address"),
  defaultFromName: varchar("default_from_name", { length: 140 }),
  defaultReplyTo: varchar("default_reply_to", { length: 320 }),
  timezone: varchar("timezone", { length: 64 }).default("Europe/Paris").notNull(),
  locale: varchar("locale", { length: 8 }).default("fr").notNull(),
  abusePolicyAcceptedAt: timestamp("abuse_policy_accepted_at", { withTimezone: true }),
  ...timestamps,
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
    stripePriceId: varchar("stripe_price_id", { length: 64 }),
    plan: billingPlanEnum("plan").default("sandbox").notNull(),
    status: billingStatusEnum("status").default("inactive").notNull(),
    currentPeriodStartsAt: timestamp("current_period_starts_at", { withTimezone: true }),
    currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("subscriptions_workspace_idx").on(table.workspaceId),
    uniqueIndex("subscriptions_customer_idx").on(table.stripeCustomerId),
    uniqueIndex("subscriptions_stripe_idx").on(table.stripeSubscriptionId),
  ],
);

export const usageMonths = pgTable(
  "usage_months",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    month: varchar("month", { length: 7 }).notNull(),
    acceptedEmails: bigint("accepted_emails", { mode: "number" }).default(0).notNull(),
    stripeReportedEmails: bigint("stripe_reported_emails", { mode: "number" }).default(0).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("usage_workspace_month_idx").on(table.workspaceId, table.month)],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 253 }).notNull(),
    status: domainStatusEnum("status").default("pending").notNull(),
    sesIdentityArn: text("ses_identity_arn"),
    mailFromDomain: varchar("mail_from_domain", { length: 253 }),
    dkimStatus: varchar("dkim_status", { length: 32 }).default("pending").notNull(),
    mailFromStatus: varchar("mail_from_status", { length: 32 }).default("pending").notNull(),
    dmarcStatus: varchar("dmarc_status", { length: 32 }).default("unknown").notNull(),
    dkimTokens: text("dkim_tokens").array().default([]).notNull(),
    dnsRecords: jsonb("dns_records").$type<Array<{ type: string; name: string; value: string }>>().default([]).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("domains_workspace_name_idx").on(table.workspaceId, table.name),
    index("domains_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const sesResources = pgTable(
  "ses_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    domainId: uuid("domain_id").references(() => domains.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 40 }).notNull(),
    resourceName: varchar("resource_name", { length: 128 }).notNull(),
    resourceArn: text("resource_arn"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("ses_resource_workspace_name_idx").on(table.workspaceId, table.resourceType, table.resourceName)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    normalizedEmail: varchar("normalized_email", { length: 320 }).notNull(),
    firstName: varchar("first_name", { length: 120 }),
    lastName: varchar("last_name", { length: 120 }),
    company: varchar("company", { length: 180 }),
    locale: varchar("locale", { length: 8 }).default("fr").notNull(),
    status: contactStatusEnum("status").default("active").notNull(),
    marketingConsent: boolean("marketing_consent").default(false).notNull(),
    trackingConsent: boolean("tracking_consent").default(false).notNull(),
    legalBasis: varchar("legal_basis", { length: 64 }),
    consentSource: text("consent_source"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    tags: text("tags").array().default([]).notNull(),
    customFields: jsonb("custom_fields").$type<Record<string, string | number | boolean | null>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contacts_workspace_email_idx").on(table.workspaceId, table.normalizedEmail),
    index("contacts_workspace_status_idx").on(table.workspaceId, table.status),
    index("contacts_workspace_consent_idx").on(table.workspaceId, table.marketingConsent),
  ],
);

export const contactLists = pgTable(
  "contact_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 140 }).notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [uniqueIndex("lists_workspace_name_idx").on(table.workspaceId, table.name)],
);

export const contactListMembers = pgTable(
  "contact_list_members",
  {
    listId: uuid("list_id").references(() => contactLists.id, { onDelete: "cascade" }).notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }).notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.listId, table.contactId] }), index("list_members_contact_idx").on(table.contactId)],
);

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 140 }).notNull(),
    filters: jsonb("filters").$type<{ operator: "and" | "or"; rules: Array<Record<string, unknown>> }>().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("segments_workspace_name_idx").on(table.workspaceId, table.name)],
);

export const consentEvents = pgTable(
  "consent_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }).notNull(),
    kind: consentKindEnum("kind").notNull(),
    action: consentActionEnum("action").notNull(),
    source: text("source"),
    consentText: text("consent_text"),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("consent_workspace_contact_idx").on(table.workspaceId, table.contactId, table.createdAt)],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    normalizedEmail: varchar("normalized_email", { length: 320 }),
    emailHash: varchar("email_hash", { length: 64 }).notNull(),
    reason: suppressionReasonEnum("reason").notNull(),
    sourceMessageId: uuid("source_message_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("suppressions_workspace_hash_idx").on(table.workspaceId, table.emailHash),
    index("suppressions_workspace_reason_idx").on(table.workspaceId, table.reason),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    preheader: varchar("preheader", { length: 255 }),
    currentVersion: integer("current_version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [index("templates_workspace_idx").on(table.workspaceId, table.updatedAt)],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "cascade" }).notNull(),
    version: integer("version").notNull(),
    document: jsonb("document").$type<{ version: 1; blocks: Array<Record<string, unknown>> }>().notNull(),
    html: text("html").notNull(),
    plainText: text("plain_text").notNull(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("template_version_idx").on(table.templateId, table.version)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    domainId: uuid("domain_id").references(() => domains.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    listId: uuid("list_id").references(() => contactLists.id, { onDelete: "set null" }),
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    name: varchar("name", { length: 180 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    fromName: varchar("from_name", { length: 140 }).notNull(),
    fromEmail: varchar("from_email", { length: 320 }).notNull(),
    replyTo: varchar("reply_to", { length: 320 }),
    status: campaignStatusEnum("status").default("draft").notNull(),
    trackingOpens: boolean("tracking_opens").default(false).notNull(),
    trackingClicks: boolean("tracking_clicks").default(false).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    dispatchClaimedAt: timestamp("dispatch_claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    recipientCount: integer("recipient_count").default(0).notNull(),
    deliveredCount: integer("delivered_count").default(0).notNull(),
    bouncedCount: integer("bounced_count").default(0).notNull(),
    complaintCount: integer("complaint_count").default(0).notNull(),
    unsubscribeCount: integer("unsubscribe_count").default(0).notNull(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [index("campaigns_workspace_status_idx").on(table.workspaceId, table.status, table.scheduledAt)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }).notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }).notNull(),
    messageId: uuid("message_id"),
    eligibilitySnapshot: jsonb("eligibility_snapshot").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.contactId] }), index("campaign_recipients_message_idx").on(table.messageId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    domainId: uuid("domain_id").references(() => domains.id, { onDelete: "restrict" }).notNull(),
    stream: messageStreamEnum("stream").notNull(),
    status: messageStatusEnum("status").default("queued").notNull(),
    fromEmail: varchar("from_email", { length: 320 }).notNull(),
    fromName: varchar("from_name", { length: 140 }),
    toEmail: varchar("to_email", { length: 320 }).notNull(),
    toName: varchar("to_name", { length: 140 }),
    replyTo: varchar("reply_to", { length: 320 }),
    subject: varchar("subject", { length: 255 }).notNull(),
    html: text("html").notNull(),
    plainText: text("plain_text").notNull(),
    tags: jsonb("tags").$type<Record<string, string>>().default({}).notNull(),
    trackingOpens: boolean("tracking_opens").default(false).notNull(),
    trackingClicks: boolean("tracking_clicks").default(false).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    requestHash: varchar("request_hash", { length: 64 }),
    sesMessageId: varchar("ses_message_id", { length: 160 }),
    sendingClaimedAt: timestamp("sending_claimed_at", { withTimezone: true }),
    contentExpiresAt: timestamp("content_expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("messages_workspace_idempotency_idx").on(table.workspaceId, table.idempotencyKey),
    uniqueIndex("messages_ses_id_idx").on(table.sesMessageId),
    index("messages_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    index("messages_campaign_idx").on(table.campaignId, table.status),
  ],
);

export const messageAttempts = pgTable(
  "message_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
    attempt: integer("attempt").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("message_attempt_unique_idx").on(table.messageId, table.attempt)],
);

export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
    externalEventId: varchar("external_event_id", { length: 180 }).notNull(),
    type: varchar("type", { length: 48 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_events_external_idx").on(table.externalEventId),
    index("email_events_workspace_message_idx").on(table.workspaceId, table.messageId, table.occurredAt),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    mode: apiKeyModeEnum("mode").default("test").notNull(),
    prefix: varchar("prefix", { length: 24 }).notNull(),
    secretHash: varchar("secret_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().default([]).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("api_keys_hash_idx").on(table.secretHash), index("api_keys_workspace_idx").on(table.workspaceId, table.revokedAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response").$type<{ ids: string[] }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("idempotency_workspace_key_idx").on(table.workspaceId, table.key)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    signingSecretHash: varchar("signing_secret_hash", { length: 64 }).notNull(),
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    eventTypes: text("event_types").array().default([]).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    ...timestamps,
  },
  (table) => [index("webhook_endpoints_workspace_idx").on(table.workspaceId, table.enabled)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id").references(() => webhookEndpoints.id, { onDelete: "cascade" }).notNull(),
    eventId: uuid("event_id").references(() => emailEvents.id, { onDelete: "cascade" }).notNull(),
    attempt: integer("attempt").default(0).notNull(),
    statusCode: integer("status_code"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [uniqueIndex("webhook_delivery_event_idx").on(table.endpointId, table.eventId), index("webhook_delivery_retry_idx").on(table.deliveredAt, table.nextAttemptAt)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    objectKey: text("object_key").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>().default({}).notNull(),
    processedRows: integer("processed_rows").default(0).notNull(),
    importedRows: integer("imported_rows").default(0).notNull(),
    rejectedRows: integer("rejected_rows").default(0).notNull(),
    errorSummary: jsonb("error_summary").$type<Array<Record<string, unknown>>>().default([]).notNull(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("import_jobs_workspace_status_idx").on(table.workspaceId, table.status)],
);

export const stripeEvents = pgTable("stripe_events", {
  eventId: varchar("event_id", { length: 64 }).primaryKey(),
  type: varchar("type", { length: 100 }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: varchar("actor_user_id", { length: 64 }).notNull(),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 128 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_workspace_created_idx").on(table.workspaceId, table.createdAt)],
);

export const adminReviews = pgTable(
  "admin_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    decision: reviewDecisionEnum("decision").default("pending").notNull(),
    riskScore: integer("risk_score").default(0).notNull(),
    notes: text("notes"),
    reviewedBy: varchar("reviewed_by", { length: 64 }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("admin_reviews_decision_idx").on(table.decision, table.createdAt)],
);
