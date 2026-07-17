import * as path from "node:path";
import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { OpenIdConnectProvider, PolicyStatement, Role, ServicePrincipal, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { S3EventSource, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { BlockPublicAccess, Bucket, BucketEncryption, EventType } from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { CfnScheduleGroup } from "aws-cdk-lib/aws-scheduler";
import { Queue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export class VigieMailStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { environment: "dev" | "prod" }) {
    super(scope, id, props); const prod = props.environment === "prod"; const prefix = `vigiemail-${props.environment}`;
    const queue = (name:string, timeout=60) => { const dlq=new Queue(this,`${name}Dlq`,{queueName:`${prefix}-${name}-dlq`,retentionPeriod:Duration.days(14),encryption:undefined}); const main=new Queue(this,name,{queueName:`${prefix}-${name}`,visibilityTimeout:Duration.seconds(timeout),retentionPeriod:Duration.days(4),deadLetterQueue:{queue:dlq,maxReceiveCount:5}}); return {main,dlq}; };
    const campaign=queue("campaign-dispatch",300), email=queue("email-send",180), events=queue("ses-events",120), webhooks=queue("customer-webhooks",120);
    new CfnScheduleGroup(this,"ScheduleGroup",{name:prefix});
    const schedulerRole=new Role(this,"SchedulerRole",{assumedBy:new ServicePrincipal("scheduler.amazonaws.com"),roleName:`${prefix}-scheduler`});campaign.main.grantSendMessages(schedulerRole);
    const imports = new Bucket(this,"Imports",{bucketName:`${prefix}-imports-${this.account}`,encryption:BucketEncryption.S3_MANAGED,blockPublicAccess:BlockPublicAccess.BLOCK_ALL,enforceSSL:true,removalPolicy:prod?RemovalPolicy.RETAIN:RemovalPolicy.DESTROY,autoDeleteObjects:!prod,lifecycleRules:[{expiration:Duration.days(7)}]});
    const databaseSecret=Secret.fromSecretNameV2(this,"DatabaseSecret",`${prefix}/database`);
    const common={runtime:Runtime.NODEJS_22_X,timeout:Duration.seconds(60),memorySize:512,bundling:{sourceMap:true,minify:true},environment:{DATABASE_URL:databaseSecret.secretValueFromJson("DATABASE_URL").unsafeUnwrap(),UNSUBSCRIBE_SIGNING_SECRET:databaseSecret.secretValueFromJson("UNSUBSCRIBE_SIGNING_SECRET").unsafeUnwrap(),PUBLIC_LINKS_URL:prod?"https://links.vigie-mail.fr":"https://preview.vigie-mail.fr",AWS_REGION_NAME:this.region,NODE_OPTIONS:"--enable-source-maps"}};
    const worker=(name:string,entry:string,extra:Record<string,string>={})=>{const fn=new NodejsFunction(this,name,{...common,entry:path.join(process.cwd(),entry),handler:"handler",environment:{...common.environment,...extra},functionName:`${prefix}-${name.toLowerCase()}`});databaseSecret.grantRead(fn);return fn};
    const send=worker("SendEmail","src/workers/send-email.ts"); send.addEventSource(new SqsEventSource(email.main,{batchSize:10,reportBatchItemFailures:true})); email.main.grantConsumeMessages(send); send.addToRolePolicy(new PolicyStatement({actions:["ses:SendEmail"],resources:["*"]}));
    const dispatch=worker("CampaignDispatch","src/workers/campaign-dispatch.ts",{EMAIL_QUEUE_URL:email.main.queueUrl}); dispatch.addEventSource(new SqsEventSource(campaign.main,{batchSize:1,reportBatchItemFailures:true})); campaign.main.grantConsumeMessages(dispatch); email.main.grantSendMessages(dispatch);
    const ingest=worker("SesEvents","src/workers/ses-events.ts",{WEBHOOK_QUEUE_URL:webhooks.main.queueUrl}); ingest.addEventSource(new SqsEventSource(events.main,{batchSize:10,reportBatchItemFailures:true})); events.main.grantConsumeMessages(ingest); webhooks.main.grantSendMessages(ingest);
    const deliver=worker("CustomerWebhooks","src/workers/deliver-webhook.ts"); deliver.addEventSource(new SqsEventSource(webhooks.main,{batchSize:10,reportBatchItemFailures:true})); webhooks.main.grantConsumeMessages(deliver);
    const importer=worker("ImportContacts","src/workers/import-contacts.ts",{IMPORT_BUCKET:imports.bucketName}); importer.addEventSource(new S3EventSource(imports,{events:[EventType.OBJECT_CREATED]})); imports.grantRead(importer);
    new Rule(this,"SesEventRule",{eventPattern:{source:["aws.ses"]},targets:[new SqsQueue(events.main)]});
    const oidc=new OpenIdConnectProvider(this,"VercelOidc",{url:"https://oidc.vercel.com",clientIds:["sts.amazonaws.com"]});
    const team=String(this.node.tryGetContext("vercelTeam")??"yoanndrxs-projects");
    const vercelRole=new Role(this,"VercelRole",{roleName:`${prefix}-vercel`,assumedBy:new WebIdentityPrincipal(oidc.openIdConnectProviderArn,{StringEquals:{"oidc.vercel.com:aud":"sts.amazonaws.com"},StringLike:{"oidc.vercel.com:sub":`owner:${team}:project:vigie-mail:environment:${props.environment === "prod" ? "production" : "preview"}`}})});
    email.main.grantSendMessages(vercelRole); campaign.main.grantSendMessages(vercelRole); imports.grantReadWrite(vercelRole); vercelRole.addToPolicy(new PolicyStatement({actions:["ses:CreateTenant","ses:CreateEmailIdentity","ses:CreateConfigurationSet","ses:CreateTenantResourceAssociation","ses:PutEmailIdentityMailFromAttributes","ses:GetEmailIdentity","ses:GetTenant"],resources:["*"]}));
    new CfnBudget(this,"MonthlyBudget",{budget:{budgetName:`${prefix}-monthly`,budgetType:"COST",timeUnit:"MONTHLY",budgetLimit:{amount:prod?100:25,unit:"EUR"}}});
    for(const q of [campaign,email,events,webhooks]){new Alarm(this,`${q.main.node.id}AgeAlarm`,{metric:q.main.metricApproximateAgeOfOldestMessage(),threshold:300,evaluationPeriods:2});new Alarm(this,`${q.dlq.node.id}MessagesAlarm`,{metric:q.dlq.metricApproximateNumberOfMessagesVisible(),threshold:1,evaluationPeriods:1});new CfnOutput(this,`${q.main.node.id}Url`,{value:q.main.queueUrl})} new CfnOutput(this,"CampaignQueueArn",{value:campaign.main.queueArn});new CfnOutput(this,"SchedulerRoleArn",{value:schedulerRole.roleArn});new CfnOutput(this,"ScheduleGroupName",{value:prefix});new CfnOutput(this,"ImportsBucket",{value:imports.bucketName});new CfnOutput(this,"VercelRoleArn",{value:vercelRole.roleArn});
  }
}
