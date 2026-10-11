-- Fail safe: the product never shipped marketing features, so these tables
-- must be empty. If any row exists, abort the whole migration (drizzle runs it
-- in a transaction) instead of destroying data. Investigate before retrying.
DO $$
DECLARE
  retired text;
  found boolean;
BEGIN
  FOREACH retired IN ARRAY ARRAY['contacts', 'contact_lists', 'contact_list_members', 'segments', 'consent_events', 'campaigns', 'campaign_recipients', 'import_jobs']
  LOOP
    IF to_regclass(format('public.%I', retired)) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', retired) INTO found;
      IF found THEN
        RAISE EXCEPTION 'Refusing to drop retired marketing table %: it contains rows', retired;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.messages WHERE campaign_id IS NOT NULL OR contact_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing to drop retired marketing tables: messages still reference them';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_campaign_id_campaigns_id_fk";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_contact_id_contacts_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "messages_campaign_idx";--> statement-breakpoint
-- No CASCADE: an unexpected dependency must abort the migration.
DROP TABLE IF EXISTS "campaign_recipients";--> statement-breakpoint
DROP TABLE IF EXISTS "campaigns";--> statement-breakpoint
DROP TABLE IF EXISTS "consent_events";--> statement-breakpoint
DROP TABLE IF EXISTS "contact_list_members";--> statement-breakpoint
DROP TABLE IF EXISTS "import_jobs";--> statement-breakpoint
DROP TABLE IF EXISTS "segments";--> statement-breakpoint
DROP TABLE IF EXISTS "contact_lists";--> statement-breakpoint
DROP TABLE IF EXISTS "contacts";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."campaign_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."consent_action";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."consent_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."contact_status";
