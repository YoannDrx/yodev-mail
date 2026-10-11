ALTER TABLE "workspaces" ADD COLUMN "purge_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outbox_workspace_updated_idx" ON "outbox_jobs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "workspaces_purge_requested_idx" ON "workspaces" USING btree ("purge_requested_at") WHERE "workspaces"."purge_requested_at" is not null;