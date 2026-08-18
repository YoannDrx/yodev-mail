CREATE TABLE "client_provisioning_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invitation_id" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending_email' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"email_sent_at" timestamp with time zone,
	"last_error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_provisioning_status_valid" CHECK ("client_provisioning_runs"."status" in ('pending_email', 'sending_email', 'invitation_sent', 'email_failed', 'accepted'))
);
--> statement-breakpoint
CREATE TABLE "stripe_checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"stripe_customer_id" varchar(64),
	"platform_price_id" varchar(64) NOT NULL,
	"usage_price_id" varchar(64) NOT NULL,
	"idempotency_key" varchar(120) NOT NULL,
	"stripe_session_id" varchar(180),
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_checkout_status_valid" CHECK ("stripe_checkout_attempts"."status" in ('pending', 'completed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "stripe_usage_report_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"stripe_identifier" varchar(100) NOT NULL,
	"stripe_customer_id" varchar(64) NOT NULL,
	"stripe_subscription_id" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_usage_report_status_valid" CHECK ("stripe_usage_report_jobs"."status" in ('pending', 'processing', 'reported', 'failed', 'unknown', 'unreportable'))
);
--> statement-breakpoint
ALTER TABLE "stripe_events" ALTER COLUMN "processed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stripe_events" ALTER COLUMN "processed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "clerk_organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "stripe_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "livemode" boolean;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "object_type" varchar(64);--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "object_id" varchar(180);--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "customer_id" varchar(64);--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "subscription_id" varchar(64);--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "status" varchar(24) DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "last_error_code" varchar(120);--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_stripe_event_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_stripe_event_id" varchar(64);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_provisioning_runs" ADD CONSTRAINT "client_provisioning_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_provisioning_runs" ADD CONSTRAINT "client_provisioning_runs_invitation_id_auth_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."auth_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempts" ADD CONSTRAINT "stripe_checkout_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempts" ADD CONSTRAINT "stripe_checkout_attempts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_usage_report_jobs" ADD CONSTRAINT "stripe_usage_report_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_provisioning_workspace_idx" ON "client_provisioning_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_provisioning_invitation_idx" ON "client_provisioning_runs" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "client_provisioning_status_idx" ON "client_provisioning_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_idempotency_idx" ON "stripe_checkout_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_session_idx" ON "stripe_checkout_attempts" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_pending_workspace_idx" ON "stripe_checkout_attempts" USING btree ("workspace_id") WHERE "stripe_checkout_attempts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "stripe_checkout_workspace_idx" ON "stripe_checkout_attempts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_usage_report_identifier_idx" ON "stripe_usage_report_jobs" USING btree ("stripe_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_usage_report_message_idx" ON "stripe_usage_report_jobs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "stripe_usage_report_pending_idx" ON "stripe_usage_report_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "stripe_usage_report_workspace_idx" ON "stripe_usage_report_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_reviews_workspace_idx" ON "admin_reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_idx" ON "domains" USING btree ("name");