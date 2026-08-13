import { SQSClient, SendMessageBatchCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { SSMClient } from "@aws-sdk/client-ssm";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { env } from "@/lib/env";

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
    ses: new SESv2Client(shared),
    sqs: new SQSClient(shared),
    scheduler: new SchedulerClient(shared),
    ssm: new SSMClient(shared),
  };
}

export async function enqueueMessage(messageId: string) {
  if (!env.AWS_EMAIL_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  await sqs.send(new SendMessageCommand({ QueueUrl: env.AWS_EMAIL_QUEUE_URL, MessageBody: JSON.stringify({ messageId }) }));
  return { local: false as const };
}

export async function enqueueMessages(messageIds: string[]) {
  if (!env.AWS_EMAIL_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  for (let start = 0; start < messageIds.length; start += 10) {
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: env.AWS_EMAIL_QUEUE_URL, Entries: messageIds.slice(start, start + 10).map((messageId, i) => ({ Id: `${start + i}`, MessageBody: JSON.stringify({ messageId }) })) }));
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

export async function enqueueProviderProvisioning(bindingId: string) {
  if (!env.AWS_PROVIDER_PROVISIONING_QUEUE_URL) return { local: true as const };
  const { sqs } = await awsClients();
  await sqs.send(new SendMessageCommand({
    QueueUrl: env.AWS_PROVIDER_PROVISIONING_QUEUE_URL,
    MessageBody: JSON.stringify({ bindingId }),
  }));
  return { local: false as const };
}
