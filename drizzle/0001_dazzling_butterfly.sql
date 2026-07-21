CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"kind" varchar(40) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"day" varchar(10) NOT NULL,
	"accepted_emails" integer DEFAULT 0 NOT NULL,
	"delivered_emails" integer DEFAULT 0 NOT NULL,
	"hard_bounces" integer DEFAULT 0 NOT NULL,
	"complaints" integer DEFAULT 0 NOT NULL,
	"suppressed_emails" integer DEFAULT 0 NOT NULL,
	"failed_emails" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"stripe_reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "exclusion_reason" varchar(100);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "accepted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "suppressed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_check_error" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "list_id" uuid;--> statement-breakpoint
ALTER TABLE "message_attempts" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "source" varchar(32) DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "send_mode" "api_key_mode" DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "queued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "warmup_advanced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "pause_reason" varchar(120);--> statement-breakpoint
UPDATE "campaign_recipients" AS recipient
SET "workspace_id" = campaign."workspace_id"
FROM "campaigns" AS campaign
WHERE recipient."campaign_id" = campaign."id";--> statement-breakpoint
UPDATE "contact_list_members" AS member
SET "workspace_id" = list."workspace_id"
FROM "contact_lists" AS list
WHERE member."list_id" = list."id";--> statement-breakpoint
UPDATE "message_attempts" AS attempt
SET "workspace_id" = message."workspace_id"
FROM "messages" AS message
WHERE attempt."message_id" = message."id";--> statement-breakpoint
UPDATE "template_versions" AS version
SET "workspace_id" = template."workspace_id"
FROM "templates" AS template
WHERE version."template_id" = template."id";--> statement-breakpoint
UPDATE "webhook_deliveries" AS delivery
SET "workspace_id" = endpoint."workspace_id"
FROM "webhook_endpoints" AS endpoint
WHERE delivery."endpoint_id" = endpoint."id";--> statement-breakpoint
ALTER TABLE "campaign_recipients" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_list_members" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_attempts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_kind_aggregate_idx" ON "outbox_jobs" USING btree ("kind","aggregate_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_workspace_day_idx" ON "usage_days" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "usage_day_idx" ON "usage_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "usage_ledger_workspace_accepted_idx" ON "usage_ledger" USING btree ("workspace_id","accepted_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_stripe_idx" ON "usage_ledger" USING btree ("stripe_reported_at","accepted_at");--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
