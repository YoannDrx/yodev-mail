CREATE TYPE "public"."api_key_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."billing_plan" AS ENUM('sandbox', 'starter', 'pro', 'agency');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('inactive', 'trialing', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'dispatching', 'sending', 'paused', 'sent', 'canceled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('granted', 'withdrawn', 'objected', 'imported');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('marketing', 'tracking', 'legal_basis');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'unsubscribed', 'suppressed', 'anonymized');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'soft_bounced', 'hard_bounced', 'complained', 'suppressed', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."message_stream" AS ENUM('transactional', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'complaint', 'unsubscribe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('sandbox', 'pending_review', 'approved', 'paused', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"decision" "review_decision" DEFAULT 'pending' NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"reviewed_by" varchar(64),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"mode" "api_key_mode" DEFAULT 'test' NOT NULL,
	"prefix" varchar(24) NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" varchar(64) NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"message_id" uuid,
	"eligibility_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_campaign_id_contact_id_pk" PRIMARY KEY("campaign_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid,
	"template_id" uuid,
	"list_id" uuid,
	"segment_id" uuid,
	"name" varchar(180) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"from_name" varchar(140) NOT NULL,
	"from_email" varchar(320) NOT NULL,
	"reply_to" varchar(320),
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"tracking_opens" boolean DEFAULT false NOT NULL,
	"tracking_clicks" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone,
	"dispatch_claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"bounced_count" integer DEFAULT 0 NOT NULL,
	"complaint_count" integer DEFAULT 0 NOT NULL,
	"unsubscribe_count" integer DEFAULT 0 NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"action" "consent_action" NOT NULL,
	"source" text,
	"consent_text" text,
	"ip_address" varchar(64),
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_list_members" (
	"list_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_list_members_list_id_contact_id_pk" PRIMARY KEY("list_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(140) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"first_name" varchar(120),
	"last_name" varchar(120),
	"company" varchar(180),
	"locale" varchar(8) DEFAULT 'fr' NOT NULL,
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"tracking_consent" boolean DEFAULT false NOT NULL,
	"legal_basis" varchar(64),
	"consent_source" text,
	"consented_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(253) NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"ses_identity_arn" text,
	"mail_from_domain" varchar(253),
	"dkim_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"mail_from_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"dmarc_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"dkim_tokens" text[] DEFAULT '{}' NOT NULL,
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"external_event_id" varchar(180) NOT NULL,
	"type" varchar(48) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"error_code" varchar(120),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"contact_id" uuid,
	"domain_id" uuid NOT NULL,
	"stream" "message_stream" NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"from_email" varchar(320) NOT NULL,
	"from_name" varchar(140),
	"to_email" varchar(320) NOT NULL,
	"to_name" varchar(140),
	"reply_to" varchar(320),
	"subject" varchar(255) NOT NULL,
	"html" text NOT NULL,
	"plain_text" text NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tracking_opens" boolean DEFAULT false NOT NULL,
	"tracking_clicks" boolean DEFAULT false NOT NULL,
	"idempotency_key" varchar(128),
	"request_hash" varchar(64),
	"ses_message_id" varchar(160),
	"sending_claimed_at" timestamp with time zone,
	"content_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(140) NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ses_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid,
	"resource_type" varchar(40) NOT NULL,
	"resource_name" varchar(128) NOT NULL,
	"resource_arn" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" varchar(64) PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stripe_customer_id" varchar(64),
	"stripe_subscription_id" varchar(64),
	"stripe_price_id" varchar(64),
	"plan" "billing_plan" DEFAULT 'sandbox' NOT NULL,
	"status" "billing_status" DEFAULT 'inactive' NOT NULL,
	"current_period_starts_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"normalized_email" varchar(320),
	"email_hash" varchar(64) NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source_message_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"html" text NOT NULL,
	"plain_text" text NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"preheader" varchar(255),
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"accepted_emails" bigint DEFAULT 0 NOT NULL,
	"stripe_reported_emails" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status_code" integer,
	"delivered_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"signing_secret_hash" varchar(64) NOT NULL,
	"signing_secret_encrypted" text NOT NULL,
	"event_types" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"company_name" varchar(180),
	"company_address" text,
	"default_from_name" varchar(140),
	"default_reply_to" varchar(320),
	"timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL,
	"locale" varchar(8) DEFAULT 'fr' NOT NULL,
	"abuse_policy_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_organization_id" varchar(64) NOT NULL,
	"owner_user_id" varchar(64) NOT NULL,
	"name" varchar(140) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"status" "workspace_status" DEFAULT 'sandbox' NOT NULL,
	"plan" "billing_plan" DEFAULT 'sandbox' NOT NULL,
	"ses_tenant_name" varchar(64),
	"website_url" text,
	"use_case" text,
	"expected_monthly_volume" integer DEFAULT 0 NOT NULL,
	"daily_limit" integer DEFAULT 200 NOT NULL,
	"warmup_stage" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_reviews" ADD CONSTRAINT "admin_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ses_resources" ADD CONSTRAINT "ses_resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ses_resources" ADD CONSTRAINT "ses_resources_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_email_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."email_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_reviews_decision_idx" ON "admin_reviews" USING btree ("decision","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id","revoked_at");--> statement-breakpoint
CREATE INDEX "audit_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "campaign_recipients_message_idx" ON "campaign_recipients" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_idx" ON "campaigns" USING btree ("workspace_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "consent_workspace_contact_idx" ON "consent_events" USING btree ("workspace_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "list_members_contact_idx" ON "contact_list_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_workspace_name_idx" ON "contact_lists" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_workspace_email_idx" ON "contacts" USING btree ("workspace_id","normalized_email");--> statement-breakpoint
CREATE INDEX "contacts_workspace_status_idx" ON "contacts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "contacts_workspace_consent_idx" ON "contacts" USING btree ("workspace_id","marketing_consent");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_workspace_name_idx" ON "domains" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "domains_workspace_status_idx" ON "domains" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_external_idx" ON "email_events" USING btree ("external_event_id");--> statement-breakpoint
CREATE INDEX "email_events_workspace_message_idx" ON "email_events" USING btree ("workspace_id","message_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_workspace_key_idx" ON "idempotency_keys" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "import_jobs_workspace_status_idx" ON "import_jobs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "message_attempt_unique_idx" ON "message_attempts" USING btree ("message_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_workspace_idempotency_idx" ON "messages" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_ses_id_idx" ON "messages" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_status_idx" ON "messages" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_workspace_name_idx" ON "segments" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ses_resource_workspace_name_idx" ON "ses_resources" USING btree ("workspace_id","resource_type","resource_name");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_workspace_idx" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_workspace_hash_idx" ON "suppressions" USING btree ("workspace_id","email_hash");--> statement-breakpoint
CREATE INDEX "suppressions_workspace_reason_idx" ON "suppressions" USING btree ("workspace_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_idx" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "templates_workspace_idx" ON "templates" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_workspace_month_idx" ON "usage_months" USING btree ("workspace_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_event_idx" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_retry_idx" ON "webhook_deliveries" USING btree ("delivered_at","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_workspace_idx" ON "webhook_endpoints" USING btree ("workspace_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_clerk_org_idx" ON "workspaces" USING btree ("clerk_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "workspaces_status_idx" ON "workspaces" USING btree ("status");