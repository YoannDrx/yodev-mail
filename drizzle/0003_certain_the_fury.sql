CREATE TYPE "public"."attachment_status" AS ENUM('pending_upload', 'scanning', 'clean', 'rejected', 'expired', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."content_policy" AS ENUM('template_only', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."email_provider" AS ENUM('ses', 'postmark');--> statement-breakpoint
CREATE TYPE "public"."message_attempt_outcome" AS ENUM('accepted', 'definitive_failure', 'transient_failure', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."message_content_kind" AS ENUM('template', 'raw');--> statement-breakpoint
CREATE TYPE "public"."provider_account_status" AS ENUM('pending', 'ready', 'paused', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."provider_binding_status" AS ENUM('pending', 'dns_pending', 'verified', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."template_review_status" AS ENUM('draft', 'pending_review', 'approved', 'rejected', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."transactional_profile_status" AS ENUM('draft', 'pending_review', 'approved', 'rejected', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'simulated' BEFORE 'queued';--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid,
	"file_name" varchar(180) NOT NULL,
	"declared_content_type" varchar(120) NOT NULL,
	"detected_content_type" varchar(120),
	"size_bytes" integer NOT NULL,
	"expected_sha256" varchar(64) NOT NULL,
	"verified_sha256" varchar(64),
	"storage_key" text NOT NULL,
	"status" "attachment_status" DEFAULT 'pending_upload' NOT NULL,
	"scan_result" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_provider_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"provider" "email_provider" NOT NULL,
	"status" "provider_binding_status" DEFAULT 'pending' NOT NULL,
	"external_domain_id" text,
	"mail_from_domain" varchar(253),
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dkim_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"return_path_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"dmarc_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactional_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"trigger_description" text NOT NULL,
	"recipient_relationship" text NOT NULL,
	"expected_monthly_volume" integer DEFAULT 0 NOT NULL,
	"content_example" text NOT NULL,
	"status" "transactional_profile_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" varchar(64),
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "email_provider" NOT NULL,
	"status" "provider_account_status" DEFAULT 'pending' NOT NULL,
	"external_account_id" varchar(180),
	"credential_parameter_name" text,
	"reputation_policy" varchar(32),
	"paused_at" timestamp with time zone,
	"pause_reason" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "email_events_external_idx";--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "active_provider" "email_provider";--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "provider" "email_provider";--> statement-breakpoint
ALTER TABLE "message_attempts" ADD COLUMN "provider" "email_provider";--> statement-breakpoint
ALTER TABLE "message_attempts" ADD COLUMN "outcome" "message_attempt_outcome";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "transactional_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider" "email_provider";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_message_id" varchar(180);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "content_kind" "message_content_kind";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "send_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ambiguous_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppressions" ADD COLUMN "provider" "email_provider";--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "transactional_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "review_status" "template_review_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "content_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "approved_by" varchar(64);--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_provider" "email_provider";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "content_policy" "content_policy" DEFAULT 'template_only' NOT NULL;--> statement-breakpoint
UPDATE "workspaces" SET "status" = 'pending_review', "approved_at" = NULL, "default_provider" = NULL, "content_policy" = 'template_only', "daily_limit" = 50, "updated_at" = now();--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_provider_bindings" ADD CONSTRAINT "domain_provider_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_provider_bindings" ADD CONSTRAINT "domain_provider_bindings_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactional_profiles" ADD CONSTRAINT "transactional_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_accounts" ADD CONSTRAINT "workspace_provider_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_idx" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_workspace_status_idx" ON "attachments" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "attachments_expiration_idx" ON "attachments" USING btree ("expires_at","status");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_provider_bindings_domain_provider_idx" ON "domain_provider_bindings" USING btree ("domain_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_provider_bindings_active_idx" ON "domain_provider_bindings" USING btree ("domain_id") WHERE "domain_provider_bindings"."is_active" = true;--> statement-breakpoint
CREATE INDEX "domain_provider_bindings_workspace_status_idx" ON "domain_provider_bindings" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_profiles_workspace_key_idx" ON "transactional_profiles" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "transactional_profiles_workspace_status_idx" ON "transactional_profiles" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_accounts_workspace_provider_idx" ON "workspace_provider_accounts" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "workspace_provider_accounts_status_idx" ON "workspace_provider_accounts" USING btree ("provider","status");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_transactional_profile_id_transactional_profiles_id_fk" FOREIGN KEY ("transactional_profile_id") REFERENCES "public"."transactional_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_transactional_profile_id_transactional_profiles_id_fk" FOREIGN KEY ("transactional_profile_id") REFERENCES "public"."transactional_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_provider_external_idx" ON "email_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_id_idx" ON "messages" USING btree ("provider","provider_message_id");
