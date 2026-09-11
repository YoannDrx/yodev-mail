import { SQSClient, SendMessageBatchCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { SSMClient } from "@aws-sdk/client-ssm";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { env } from "@/lib/env";
import { parseProvisioningJob } from "@/features/providers/provisioning-job";
import { parseEmailSendJob } from "@/features/sending/send-job";

function credentials() {
  if (!env.AWS_ROLE_ARN) return undefined;
  return awsCredentialsProvider({
    roleArn: env.AWS_ROLE_ARN,
    ...(env.AWS_OIDC_AUDIENCE ? { audience: env.AWS_OIDC_AUDIENCE } : {}),
    roleSessionName: "yodev-mail-vercel",
  });
}

export async function awsClients() {
  const shared = { region: env.AWS_REGION, credentials: credentials() };
  return {
    s3: new S3Client(shared),
    // SendEmail has no idempotency token. Retrying an uncertain response can duplicate mail.
    // Explicit rejections are retried by the worker, never by the SDK transport.
    ses: new SESv2Client({ ...shared, maxAttempts: 1 }),
    sqs: new SQSClient(shared),
    scheduler: new SchedulerClient(shared),
    ssm: new SSMClient(shared),
  };
}

export async function enqueueMessage(workspaceId: string, messageId: string) {
  const job = parseEmailSendJob({ workspaceId, messageId });
  if (!env.AWS_EMAIL_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  await sqs.send(new SendMessageCommand({ QueueUrl: env.AWS_EMAIL_QUEUE_URL, MessageBody: JSON.stringify(job) }));
  return { local: false as const };
}

export async function enqueueMessages(workspaceId: string, messageIds: string[]) {
  // Validate the complete batch before publishing its first record.
  const jobs = messageIds.map(messageId => parseEmailSendJob({ workspaceId, messageId }));
  if (!env.AWS_EMAIL_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  for (let start = 0; start < jobs.length; start += 10) {
    const result = await sqs.send(new SendMessageBatchCommand({ QueueUrl: env.AWS_EMAIL_QUEUE_URL, Entries: jobs.slice(start, start + 10).map((job, i) => ({ Id: `${start + i}`, MessageBody: JSON.stringify(job) })) }));
    // SQS may return HTTP 200 with individual failures. Do not report success.
    if (result.Failed?.length) throw new Error("email_enqueue_batch_failed");
  }
  return { local: false as const };
}

export async function enqueueProviderEvent(event: unknown) {
  if (!env.AWS_PROVIDER_EVENTS_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  await sqs.send(new SendMessageCommand({
    QueueUrl: env.AWS_PROVIDER_EVENTS_QUEUE_URL,
    MessageBody: JSON.stringify(event),
  }));
  return { local: false as const };
}

export async function enqueueProviderProvisioning(workspaceId: string, bindingId: string) {
  const job = parseProvisioningJob({ workspaceId, bindingId });
  if (!env.AWS_PROVIDER_PROVISIONING_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  await sqs.send(new SendMessageCommand({
    QueueUrl: env.AWS_PROVIDER_PROVISIONING_QUEUE_URL,
    MessageBody: JSON.stringify(job),
  }));
  return { local: false as const };
}
