CREATE TABLE "api_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mode" "api_key_mode" NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_rate_limits" ADD CONSTRAINT "api_rate_limits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_rate_limits_workspace_mode_minute_idx" ON "api_rate_limits" USING btree ("workspace_id","mode","minute");