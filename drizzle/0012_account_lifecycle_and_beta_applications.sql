CREATE TABLE "beta_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" varchar(180) NOT NULL,
	"contact_name" varchar(140) NOT NULL,
	"work_email" varchar(320) NOT NULL,
	"website_url" text,
	"use_case" text NOT NULL,
	"expected_monthly_volume" integer NOT NULL,
	"locale" varchar(8) DEFAULT 'fr' NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"ip_hash" varchar(64),
	"status" varchar(24) DEFAULT 'new' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_applications_status_valid" CHECK ("beta_applications"."status" in ('new', 'reviewed')),
	CONSTRAINT "beta_applications_volume_valid" CHECK ("beta_applications"."expected_monthly_volume" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auth_invitations" DROP CONSTRAINT "auth_invitations_inviter_id_auth_users_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_domain_id_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_transactional_profile_id_transactional_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT "templates_transactional_profile_id_transactional_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_invitations" ALTER COLUMN "inviter_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "beta_applications_status_idx" ON "beta_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "beta_applications_ip_idx" ON "beta_applications" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "beta_applications_created_idx" ON "beta_applications" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "auth_invitations" ADD CONSTRAINT "auth_invitations_inviter_id_auth_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_transactional_profile_id_transactional_profiles_id_fk" FOREIGN KEY ("transactional_profile_id") REFERENCES "public"."transactional_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_transactional_profile_id_transactional_profiles_id_fk" FOREIGN KEY ("transactional_profile_id") REFERENCES "public"."transactional_profiles"("id") ON DELETE no action ON UPDATE no action;