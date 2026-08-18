import { execFileSync } from "node:child_process";
import { Pool } from "pg";

const OBSERVATION_HOURS = 72;
const QUEUE_PREFIX = "yodev-mail-prod";

type Health = {
  status?: string;
  database?: string;
  version?: string;
};

type Check = {
  name: string;
  passed: boolean;
  detail: string;
};

function verifiedConnectionString(value: string) {
  const url = new URL(value);
  if (["prefer", "require", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "")) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function awsJson<T>(args: string[]): T {
  const output = execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as T;
}

async function health(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return (await response.json()) as Health;
}

function recipientGroup(domain: string) {
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (["outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "msn.com"].includes(domain)) {
    return "microsoft";
  }
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return "apple";
  return "other";
}

async function main() {
  const baseline = process.argv.includes("--baseline");
  const canarySinceValue = option("canary-since");
  const expectedVersion = option("expected-version");
  if (!baseline && !canarySinceValue) {
    throw new Error("Use --baseline or provide --canary-since=<ISO-8601 timestamp>.");
  }

  const canarySince = canarySinceValue ? new Date(canarySinceValue) : new Date();
  if (Number.isNaN(canarySince.getTime())) throw new Error("--canary-since must be a valid ISO-8601 timestamp.");

  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");
  const region = process.env.AWS_REGION ?? "eu-west-3";
  const baseUrl = (option("base-url") ?? "https://mail.yodev.fr").replace(/\/$/, "");
  const apiUrl = (option("api-url") ?? "https://api.mail.yodev.fr").replace(/\/$/, "");
  const checks: Check[] = [];

  const [appHealth, apiHealth] = await Promise.all([
    health(`${baseUrl}/api/health`),
    health(`${apiUrl}/health`),
  ]);
  const healthPassed = [appHealth, apiHealth].every(
    (result) => result.status === "ok" && result.database === "ok" && (!expectedVersion || result.version === expectedVersion),
  );
  checks.push({
    name: "public_health",
    passed: healthPassed,
    detail: `app=${appHealth.status}/${appHealth.database}/${appHealth.version ?? "unknown"}, api=${apiHealth.status}/${apiHealth.database}/${apiHealth.version ?? "unknown"}`,
  });

  const pool = new Pool({ connectionString: verifiedConnectionString(connectionString), max: 1 });
  try {
    const [stateResult, canaryResult] = await Promise.all([
      pool.query<{
        provider_accepted: string;
        ledger_rows: string;
        reserved_emails: string;
        ambiguous_messages: string;
        pending_outbox: string;
        pending_webhooks: string;
        approved_workspaces: string;
        unready_providers: string;
        active_verified_bindings: string;
      }>(`
        select
          (select count(*) from messages where send_mode = 'live' and provider_accepted_at is not null) as provider_accepted,
          (select count(*) from usage_ledger) as ledger_rows,
          (select coalesce(sum(reserved_emails), 0) from usage_days) as reserved_emails,
          (select count(*) from messages where status in ('sending', 'unknown')) as ambiguous_messages,
          (select count(*) from outbox_jobs where status <> 'delivered') as pending_outbox,
          (select count(*) from webhook_deliveries where delivered_at is null and terminal_at is null) as pending_webhooks,
          (select count(*) from workspaces where deleted_at is null and status = 'approved') as approved_workspaces,
          (select count(*) from workspace_provider_accounts where status <> 'ready' or paused_at is not null) as unready_providers,
          (select count(*) from domain_provider_bindings where is_active = true and status = 'verified') as active_verified_bindings
      `),
      pool.query<{ recipient_domain: string; status: string; count: string }>(`
        select lower(split_part(to_email, '@', 2)) as recipient_domain, status, count(*) as count
        from messages
        where send_mode = 'live' and created_at >= $1
        group by 1, 2
        order by 1, 2
      `, [canarySince]),
    ]);
    const state = stateResult.rows[0];
    if (!state) throw new Error("Database invariant query returned no row.");
    const databasePassed =
      Number(state.provider_accepted) === Number(state.ledger_rows) &&
      Number(state.reserved_emails) === 0 &&
      Number(state.ambiguous_messages) === 0 &&
      Number(state.pending_outbox) === 0 &&
      Number(state.pending_webhooks) === 0 &&
      Number(state.approved_workspaces) > 0 &&
      Number(state.unready_providers) === 0 &&
      Number(state.active_verified_bindings) > 0;
    checks.push({
      name: "database_invariants",
      passed: databasePassed,
      detail: `accepted=${state.provider_accepted}, ledger=${state.ledger_rows}, reserved=${state.reserved_emails}, ambiguous=${state.ambiguous_messages}, outbox=${state.pending_outbox}, webhooks=${state.pending_webhooks}, approved=${state.approved_workspaces}, unready_providers=${state.unready_providers}, active_bindings=${state.active_verified_bindings}`,
    });

    if (!baseline) {
      const deliveredGroups = new Set<string>(
        canaryResult.rows
          .filter((row) => row.status === "delivered" && Number(row.count) > 0)
          .map((row) => recipientGroup(row.recipient_domain)),
      );
      const requiredGroups = ["gmail", "microsoft", "apple"];
      const missingGroups = requiredGroups.filter((group) => !deliveredGroups.has(group));
      checks.push({
        name: "controlled_canaries",
        passed: missingGroups.length === 0,
        detail: missingGroups.length ? `missing=${missingGroups.join(",")}` : "gmail,microsoft,apple delivered",
      });

      const elapsedHours = (Date.now() - canarySince.getTime()) / 3_600_000;
      checks.push({
        name: "observation_window",
        passed: elapsedHours >= OBSERVATION_HOURS,
        detail: `${Math.max(0, elapsedHours).toFixed(1)}h/${OBSERVATION_HOURS}h elapsed`,
      });
    }
  } finally {
    await pool.end();
  }

  const queues = awsJson<{ QueueUrls?: string[] }>([
    "sqs",
    "list-queues",
    "--region",
    region,
    "--queue-name-prefix",
    QUEUE_PREFIX,
  ]).QueueUrls ?? [];
  const queueStates = queues.map((queueUrl) => {
    const attributes = awsJson<{ Attributes?: Record<string, string> }>([
      "sqs",
      "get-queue-attributes",
      "--region",
      region,
      "--queue-url",
      queueUrl,
      "--attribute-names",
      "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible",
      "ApproximateNumberOfMessagesDelayed",
    ]).Attributes ?? {};
    return Object.values(attributes).reduce((total, value) => total + Number(value), 0);
  });
  const queuesPassed = queues.length === 8 && queueStates.every((count) => count === 0);
  checks.push({
    name: "aws_queues",
    passed: queuesPassed,
    detail: `queues=${queues.length}, non_empty=${queueStates.filter((count) => count !== 0).length}`,
  });

  const alarms = awsJson<{ MetricAlarms?: Array<{ AlarmName?: string; StateValue?: string }> }>([
    "cloudwatch",
    "describe-alarms",
    "--region",
    region,
  ]).MetricAlarms?.filter((alarm) => alarm.AlarmName?.includes("YodevMail")) ?? [];
  const alarmCount = alarms.filter((alarm) => alarm.StateValue === "ALARM").length;
  const unexpectedInsufficient = alarms.filter(
    (alarm) => alarm.StateValue === "INSUFFICIENT_DATA" && !alarm.AlarmName?.includes("Ses"),
  ).length;
  const alarmsPassed = alarms.length > 0 && alarmCount === 0 && unexpectedInsufficient === 0;
  checks.push({
    name: "aws_alarms",
    passed: alarmsPassed,
    detail: `alarms=${alarms.length}, active=${alarmCount}, unexpected_insufficient=${unexpectedInsufficient}`,
  });

  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  const passed = checks.every((check) => check.passed);
  console.log(`${baseline ? "BASELINE" : "INTERNAL_GO"}: ${passed ? "READY" : "NOT_READY"}`);
  if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown audit failure";
  console.error(`Internal GO audit failed: ${message}`);
  process.exitCode = 1;
});
