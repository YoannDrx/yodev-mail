CREATE TABLE "stripe_usage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stripe_customer_id" varchar(64) NOT NULL,
	"stripe_subscription_id" varchar(64) NOT NULL,
	"window_starts_at" timestamp with time zone NOT NULL,
	"event_timestamp" timestamp with time zone NOT NULL,
	"quantity" integer NOT NULL,
	"stripe_identifier" varchar(100) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"first_attempted_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_at" timestamp with time zone,
	"last_error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_usage_reports_quantity_positive" CHECK ("stripe_usage_reports"."quantity" > 0),
	CONSTRAINT "stripe_usage_reports_status_valid" CHECK ("stripe_usage_reports"."status" in ('pending', 'processing', 'reported', 'failed', 'unknown', 'unreportable'))
);
--> statement-breakpoint
ALTER TABLE "stripe_usage_report_jobs" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "daily_limit_overridden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_usage_reports" ADD CONSTRAINT "stripe_usage_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_usage_reports_identifier_idx" ON "stripe_usage_reports" USING btree ("stripe_identifier");--> statement-breakpoint
CREATE INDEX "stripe_usage_reports_due_idx" ON "stripe_usage_reports" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "stripe_usage_reports_workspace_idx" ON "stripe_usage_reports" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "stripe_usage_report_jobs" ADD CONSTRAINT "stripe_usage_report_jobs_report_id_stripe_usage_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."stripe_usage_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_global_created_idx" ON "audit_events" USING btree ("created_at") WHERE "audit_events"."workspace_id" is null;--> statement-breakpoint
CREATE INDEX "email_events_workspace_occurred_idx" ON "email_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idempotency_workspace_created_idx" ON "idempotency_keys" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "message_attempts_workspace_created_idx" ON "message_attempts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_workspace_created_idx" ON "messages" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_sending_claim_idx" ON "messages" USING btree ("sending_claimed_at") WHERE "messages"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "messages_queued_deadline_idx" ON "messages" USING btree ("send_deadline_at","queued_at") WHERE "messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "messages_content_expiry_idx" ON "messages" USING btree ("workspace_id","content_expires_at") WHERE "messages"."content_expires_at" is not null;--> statement-breakpoint
CREATE INDEX "messages_redaction_idx" ON "messages" USING btree ("workspace_id","queued_at") WHERE "messages"."to_email" <> 'redacted@yodev.invalid';--> statement-breakpoint
CREATE INDEX "stripe_events_created_idx" ON "stripe_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stripe_usage_report_report_idx" ON "stripe_usage_report_jobs" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "suppressions_redaction_idx" ON "suppressions" USING btree ("workspace_id","created_at") WHERE "suppressions"."normalized_email" is not null;