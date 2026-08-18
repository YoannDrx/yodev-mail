import {
  bigint,
  boolean,
  check,
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
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const authUsers = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: varchar("role", { length: 32 }).default("user").notNull(),
    banned: boolean("banned").default(false).notNull(),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("auth_users_email_idx").on(table.email)],
);

export const authOrganizations = pgTable(
  "auth_organizations",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 140 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex("auth_organizations_slug_idx").on(table.slug)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .references(() => authUsers.id, { onDelete: "cascade" })
      .notNull(),
    activeOrganizationId: text("active_organization_id").references(
      () => authOrganizations.id,
      { onDelete: "set null" },
    ),
    impersonatedBy: text("impersonated_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("auth_sessions_token_idx").on(table.token),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiration_idx").on(table.expiresAt),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    userId: text("user_id")
      .references(() => authUsers.id, { onDelete: "cascade" })
      .notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_idx").on(table.providerId, table.accountId),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const authMembers = pgTable(
  "auth_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => authOrganizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => authUsers.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 32 }).default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("auth_members_organization_user_idx").on(table.organizationId, table.userId),
    index("auth_members_user_idx").on(table.userId),
  ],
);

export const authInvitations = pgTable(
  "auth_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => authOrganizations.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 32 }).default("member").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .references(() => authUsers.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auth_invitations_organization_idx").on(table.organizationId),
    index("auth_invitations_email_status_idx").on(table.email, table.status),
  ],
);

export const authPasskeys = pgTable(
  "auth_passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .references(() => authUsers.id, { onDelete: "cascade" })
      .notNull(),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").default(0).notNull(),
    deviceType: varchar("device_type", { length: 32 }).notNull(),
    backedUp: boolean("backed_up").default(false).notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    aaguid: text("aaguid"),
  },
  (table) => [
    uniqueIndex("auth_passkeys_credential_idx").on(table.credentialID),
    index("auth_passkeys_user_idx").on(table.userId),
  ],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").default(0).notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const workspaceStatusEnum = pgEnum("workspace_status", [
  "sandbox",
  "pending_review",
  "approved",
  "paused",
  "rejected",
]);
export const billingPlanEnum = pgEnum("billing_plan", ["sandbox", "starter", "pro", "agency", "beta"]);
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
  "simulated",
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
export const emailProviderEnum = pgEnum("email_provider", ["ses", "postmark"]);
export const providerAccountStatusEnum = pgEnum("provider_account_status", [
  "pending",
  "ready",
  "paused",
  "failed",
  "disabled",
]);
export const providerBindingStatusEnum = pgEnum("provider_binding_status", [
  "pending",
  "dns_pending",
  "verified",
  "failed",
  "disabled",
]);
export const contentPolicyEnum = pgEnum("content_policy", ["template_only", "hybrid"]);
export const transactionalProfileStatusEnum = pgEnum("transactional_profile_status", [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "disabled",
]);
export const templateReviewStatusEnum = pgEnum("template_review_status", [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "disabled",
]);
export const attachmentStatusEnum = pgEnum("attachment_status", [
  "pending_upload",
  "scanning",
  "clean",
  "rejected",
  "expired",
  "deleted",
]);
export const messageContentKindEnum = pgEnum("message_content_kind", ["template", "raw"]);
export const messageAttemptOutcomeEnum = pgEnum("message_attempt_outcome", [
  "accepted",
  "definitive_failure",
  "transient_failure",
  "ambiguous",
]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkOrganizationId: varchar("clerk_organization_id", { length: 64 }),
    ownerUserId: varchar("owner_user_id", { length: 64 }),
    authOrganizationId: text("auth_organization_id"),
    authOwnerUserId: text("auth_owner_user_id"),
    name: varchar("name", { length: 140 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    status: workspaceStatusEnum("status").default("sandbox").notNull(),
    plan: billingPlanEnum("plan").default("sandbox").notNull(),
    sesTenantName: varchar("ses_tenant_name", { length: 64 }),
    defaultProvider: emailProviderEnum("default_provider"),
    contentPolicy: contentPolicyEnum("content_policy").default("template_only").notNull(),
    websiteUrl: text("website_url"),
    useCase: text("use_case"),
    expectedMonthlyVolume: integer("expected_monthly_volume").default(0).notNull(),
    dailyLimit: integer("daily_limit").default(200).notNull(),
    warmupStage: integer("warmup_stage").default(0).notNull(),
    warmupAdvancedAt: timestamp("warmup_advanced_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: varchar("pause_reason", { length: 120 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspaces_clerk_org_idx").on(table.clerkOrganizationId),
    uniqueIndex("workspaces_auth_org_idx").on(table.authOrganizationId),
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
    pilotAccessExpiresAt: timestamp("pilot_access_expires_at", { withTimezone: true }),
    lastStripeEventCreatedAt: timestamp("last_stripe_event_created_at", { withTimezone: true }),
    lastStripeEventId: varchar("last_stripe_event_id", { length: 64 }),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
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

export const stripeUsageReportJobs = pgTable(
  "stripe_usage_report_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    messageId: uuid("message_id").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    stripeIdentifier: varchar("stripe_identifier", { length: 100 }).notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).notNull(),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).default("pending").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stripe_usage_report_identifier_idx").on(table.stripeIdentifier),
    uniqueIndex("stripe_usage_report_message_idx").on(table.messageId),
    index("stripe_usage_report_pending_idx").on(table.status, table.createdAt),
    index("stripe_usage_report_workspace_idx").on(table.workspaceId, table.createdAt),
    check(
      "stripe_usage_report_status_valid",
      sql`${table.status} in ('pending', 'processing', 'reported', 'failed', 'unknown', 'unreportable')`,
    ),
  ],
);

export const stripeCheckoutAttempts = pgTable(
  "stripe_checkout_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    subscriptionId: uuid("subscription_id")
      .references(() => subscriptions.id, { onDelete: "cascade" })
      .notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }),
    platformPriceId: varchar("platform_price_id", { length: 64 }).notNull(),
    usagePriceId: varchar("usage_price_id", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    stripeSessionId: varchar("stripe_session_id", { length: 180 }),
    status: varchar("status", { length: 24 }).default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stripe_checkout_idempotency_idx").on(table.idempotencyKey),
    uniqueIndex("stripe_checkout_session_idx").on(table.stripeSessionId),
    uniqueIndex("stripe_checkout_pending_workspace_idx")
      .on(table.workspaceId)
      .where(sql`${table.status} = 'pending'`),
    index("stripe_checkout_workspace_idx").on(table.workspaceId, table.createdAt),
    check(
      "stripe_checkout_status_valid",
      sql`${table.status} in ('pending', 'completed', 'expired')`,
    ),
  ],
);

export const usageDays = pgTable(
  "usage_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    acceptedEmails: integer("accepted_emails").default(0).notNull(),
    reservedEmails: integer("reserved_emails").default(0).notNull(),
    deliveredEmails: integer("delivered_emails").default(0).notNull(),
    hardBounces: integer("hard_bounces").default(0).notNull(),
    complaints: integer("complaints").default(0).notNull(),
    suppressedEmails: integer("suppressed_emails").default(0).notNull(),
    failedEmails: integer("failed_emails").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("usage_workspace_day_idx").on(table.workspaceId, table.day),
    index("usage_day_idx").on(table.day),
  ],
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
    activeProvider: emailProviderEnum("active_provider"),
    sesIdentityArn: text("ses_identity_arn"),
    mailFromDomain: varchar("mail_from_domain", { length: 253 }),
    dkimStatus: varchar("dkim_status", { length: 32 }).default("pending").notNull(),
    mailFromStatus: varchar("mail_from_status", { length: 32 }).default("pending").notNull(),
    dmarcStatus: varchar("dmarc_status", { length: 32 }).default("unknown").notNull(),
    dkimTokens: text("dkim_tokens").array().default([]).notNull(),
    dnsRecords: jsonb("dns_records").$type<Array<{ type: string; name: string; value: string }>>().default([]).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckError: text("last_check_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("domains_name_idx").on(table.name),
    uniqueIndex("domains_workspace_name_idx").on(table.workspaceId, table.name),
    index("domains_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const workspaceProviderAccounts = pgTable(
  "workspace_provider_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    provider: emailProviderEnum("provider").notNull(),
    status: providerAccountStatusEnum("status").default("pending").notNull(),
    externalAccountId: varchar("external_account_id", { length: 180 }),
    credentialParameterName: text("credential_parameter_name"),
    reputationPolicy: varchar("reputation_policy", { length: 32 }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: varchar("pause_reason", { length: 160 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_provider_accounts_workspace_provider_idx").on(table.workspaceId, table.provider),
    index("workspace_provider_accounts_status_idx").on(table.provider, table.status),
  ],
);

export const domainProviderBindings = pgTable(
  "domain_provider_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    domainId: uuid("domain_id").references(() => domains.id, { onDelete: "cascade" }).notNull(),
    provider: emailProviderEnum("provider").notNull(),
    status: providerBindingStatusEnum("status").default("pending").notNull(),
    externalDomainId: text("external_domain_id"),
    mailFromDomain: varchar("mail_from_domain", { length: 253 }),
    dnsRecords: jsonb("dns_records")
      .$type<Array<{ type: string; name: string; value: string }>>()
      .default([])
      .notNull(),
    dkimStatus: varchar("dkim_status", { length: 32 }).default("pending").notNull(),
    returnPathStatus: varchar("return_path_status", { length: 32 }).default("pending").notNull(),
    dmarcStatus: varchar("dmarc_status", { length: 32 }).default("unknown").notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckError: text("last_check_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("domain_provider_bindings_domain_provider_idx").on(table.domainId, table.provider),
    uniqueIndex("domain_provider_bindings_active_idx")
      .on(table.domainId)
      .where(sql`${table.isActive} = true`),
    index("domain_provider_bindings_workspace_status_idx").on(table.workspaceId, table.status),
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
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
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
    provider: emailProviderEnum("provider"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("suppressions_workspace_hash_idx").on(table.workspaceId, table.emailHash),
    index("suppressions_workspace_reason_idx").on(table.workspaceId, table.reason),
  ],
);

export const transactionalProfiles = pgTable(
  "transactional_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    key: varchar("key", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    triggerDescription: text("trigger_description").notNull(),
    recipientRelationship: text("recipient_relationship").notNull(),
    expectedMonthlyVolume: integer("expected_monthly_volume").default(0).notNull(),
    contentExample: text("content_example").notNull(),
    status: transactionalProfileStatusEnum("status").default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: varchar("approved_by", { length: 64 }),
    rejectionReason: text("rejection_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("transactional_profiles_workspace_key_idx").on(table.workspaceId, table.key),
    index("transactional_profiles_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    transactionalProfileId: uuid("transactional_profile_id").references(() => transactionalProfiles.id, {
      onDelete: "restrict",
    }),
    name: varchar("name", { length: 160 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    preheader: varchar("preheader", { length: 255 }),
    currentVersion: integer("current_version").default(1).notNull(),
    reviewStatus: templateReviewStatusEnum("review_status").default("draft").notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: varchar("approved_by", { length: 64 }),
    rejectionReason: text("rejection_reason"),
    ...timestamps,
  },
  (table) => [index("templates_workspace_idx").on(table.workspaceId, table.updatedAt)],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
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
    acceptedCount: integer("accepted_count").default(0).notNull(),
    suppressedCount: integer("suppressed_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [index("campaigns_workspace_status_idx").on(table.workspaceId, table.status, table.scheduledAt)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }).notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }).notNull(),
    messageId: uuid("message_id"),
    eligibilitySnapshot: jsonb("eligibility_snapshot").$type<Record<string, unknown>>().default({}).notNull(),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    exclusionReason: varchar("exclusion_reason", { length: 100 }),
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
    transactionalProfileId: uuid("transactional_profile_id").references(() => transactionalProfiles.id, {
      onDelete: "restrict",
    }),
    provider: emailProviderEnum("provider"),
    providerMessageId: varchar("provider_message_id", { length: 180 }),
    contentKind: messageContentKindEnum("content_kind"),
    stream: messageStreamEnum("stream").notNull(),
    source: varchar("source", { length: 32 }).default("api").notNull(),
    sendMode: apiKeyModeEnum("send_mode").default("live").notNull(),
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
    queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    providerAcceptedAt: timestamp("provider_accepted_at", { withTimezone: true }),
    sendDeadlineAt: timestamp("send_deadline_at", { withTimezone: true }),
    ambiguousAt: timestamp("ambiguous_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("messages_workspace_idempotency_idx").on(table.workspaceId, table.idempotencyKey),
    uniqueIndex("messages_ses_id_idx").on(table.sesMessageId),
    uniqueIndex("messages_provider_id_idx").on(table.provider, table.providerMessageId),
    index("messages_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
    index("messages_campaign_idx").on(table.campaignId, table.status),
  ],
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    stripeReportedAt: timestamp("stripe_reported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("usage_ledger_workspace_accepted_idx").on(table.workspaceId, table.acceptedAt),
    index("usage_ledger_stripe_idx").on(table.stripeReportedAt, table.acceptedAt),
  ],
);

export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    status: varchar("status", { length: 24 }).default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("outbox_kind_aggregate_idx").on(table.kind, table.aggregateId),
    index("outbox_pending_idx").on(table.status, table.availableAt),
  ],
);

export const messageAttempts = pgTable(
  "message_attempts",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
    attempt: integer("attempt").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    provider: emailProviderEnum("provider"),
    outcome: messageAttemptOutcomeEnum("outcome"),
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
    provider: emailProviderEnum("provider"),
    type: varchar("type", { length: 48 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_events_provider_external_idx").on(table.provider, table.externalEventId),
    index("email_events_workspace_message_idx").on(table.workspaceId, table.messageId, table.occurredAt),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    fileName: varchar("file_name", { length: 180 }).notNull(),
    declaredContentType: varchar("declared_content_type", { length: 120 }).notNull(),
    detectedContentType: varchar("detected_content_type", { length: 120 }),
    sizeBytes: integer("size_bytes").notNull(),
    expectedSha256: varchar("expected_sha256", { length: 64 }).notNull(),
    verifiedSha256: varchar("verified_sha256", { length: 64 }),
    storageKey: text("storage_key").notNull(),
    status: attachmentStatusEnum("status").default("pending_upload").notNull(),
    scanResult: varchar("scan_result", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("attachments_storage_key_idx").on(table.storageKey),
    index("attachments_workspace_status_idx").on(table.workspaceId, table.status),
    index("attachments_expiration_idx").on(table.expiresAt, table.status),
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

export const apiRateLimits = pgTable(
  "api_rate_limits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    mode: apiKeyModeEnum("mode").notNull(),
    minute: timestamp("minute", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").default(1).notNull(),
  },
  (table) => [uniqueIndex("api_rate_limits_workspace_mode_minute_idx").on(table.workspaceId, table.mode, table.minute)],
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
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id").references(() => webhookEndpoints.id, { onDelete: "cascade" }).notNull(),
    eventId: uuid("event_id").references(() => emailEvents.id, { onDelete: "cascade" }).notNull(),
    attempt: integer("attempt").default(0).notNull(),
    statusCode: integer("status_code"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
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
    listId: uuid("list_id").references(() => contactLists.id, { onDelete: "set null" }),
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
  stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
  livemode: boolean("livemode"),
  objectType: varchar("object_type", { length: 64 }),
  objectId: varchar("object_id", { length: 180 }),
  customerId: varchar("customer_id", { length: 64 }),
  subscriptionId: varchar("subscription_id", { length: 64 }),
  status: varchar("status", { length: 24 }).default("received").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastErrorCode: varchar("last_error_code", { length: 120 }),
  ...timestamps,
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
  (table) => [
    uniqueIndex("admin_reviews_workspace_idx").on(table.workspaceId),
    index("admin_reviews_decision_idx").on(table.decision, table.createdAt),
  ],
);

export const clientProvisioningRuns = pgTable(
  "client_provisioning_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    invitationId: text("invitation_id")
      .references(() => authInvitations.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 32 }).default("pending_email").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("client_provisioning_workspace_idx").on(table.workspaceId),
    uniqueIndex("client_provisioning_invitation_idx").on(table.invitationId),
    index("client_provisioning_status_idx").on(table.status, table.createdAt),
    check(
      "client_provisioning_status_valid",
      sql`${table.status} in ('pending_email', 'sending_email', 'invitation_sent', 'email_failed', 'accepted')`,
    ),
  ],
);
