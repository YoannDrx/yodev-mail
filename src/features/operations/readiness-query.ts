// $1 is always the explicit workspace ID; no global business-data aggregates.
export const workspaceReadinessSql = `
  with accepted as (
    select id from messages
    where workspace_id = $1 and send_mode = 'live' and provider_accepted_at is not null
  ), ledger as (
    select message_id from usage_ledger where workspace_id = $1
  )
  select
    (select count(*) from accepted) as provider_accepted,
    (select count(*) from ledger) as ledger_rows,
    (select count(*) from accepted full join ledger on accepted.id = ledger.message_id
      where accepted.id is null or ledger.message_id is null) as ledger_mismatches,
    (select coalesce(sum(reserved_emails), 0) from usage_days where workspace_id = $1) as reserved_emails,
    (select count(*) from messages where workspace_id = $1 and status in ('sending', 'unknown')) as ambiguous_messages,
    (select count(*) from outbox_jobs where workspace_id = $1 and status <> 'delivered') as pending_outbox,
    (select count(*) from webhook_deliveries where workspace_id = $1 and delivered_at is null and terminal_at is null) as pending_webhooks,
    (select count(*) from workspaces where id = $1 and deleted_at is null and status = 'approved') as approved_workspaces,
    (select count(*) from workspace_provider_accounts where workspace_id = $1 and (status <> 'ready' or paused_at is not null)) as unready_providers,
    (select count(*) from domain_provider_bindings where workspace_id = $1 and is_active = true and status = 'verified') as active_verified_bindings
`;
