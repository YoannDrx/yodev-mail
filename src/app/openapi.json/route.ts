import { NextResponse } from "next/server";

const mailbox={type:"object",additionalProperties:false,required:["email"],properties:{email:{type:"string",format:"email"},name:{type:"string",maxLength:140}}};
const errorResponses={"401":{description:"Clé invalide ou scope absent"},"403":{description:"Workspace, domaine, profil ou contenu non autorisé"},"429":{description:"Quota journalier ou limite de débit atteinte"},"422":{description:"Requête invalide"}};

export async function GET(){return NextResponse.json({
  openapi:"3.1.0",
  info:{title:"Mail by Yodev API",version:"1.0.0",description:"API exclusivement transactionnelle : un événement applicatif et un destinataire par requête."},
  servers:[{url:"https://api.mail.yodev.fr"}],
  paths:{
    "/v1/emails":{post:{summary:"Valider ou envoyer un email transactionnel",security:[{bearerAuth:[]}],parameters:[{name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",maxLength:128}}],requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/SendEmail"}}}},responses:{"202":{description:"Message simulé ou mis en file",content:{"application/json":{schema:{$ref:"#/components/schemas/Accepted"}}}},"409":{description:"Conflit d’idempotence ou pièce jointe indisponible"},...errorResponses}}},
    "/v1/attachments":{post:{summary:"Créer un upload temporaire contrôlé",security:[{bearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/AttachmentUpload"}}}},responses:{"201":{description:"URL présignée créée"},...errorResponses}}},
    "/v1/emails/{id}":{get:{summary:"Lire le statut normalisé d’un email",security:[{bearerAuth:[]}],parameters:[{name:"id",in:"path",required:true,schema:{type:"string",format:"uuid"}}],responses:{"200":{description:"Statut sans identifiant fournisseur ni contenu",content:{"application/json":{schema:{$ref:"#/components/schemas/EmailStatus"}}}},"404":{description:"Message absent"},"401":errorResponses["401"],"429":errorResponses["429"]}}},
  },
  components:{
    securitySchemes:{bearerAuth:{type:"http",scheme:"bearer",bearerFormat:"ym_test_… ou ym_live_…"}},
    schemas:{
      SendEmail:{type:"object",additionalProperties:false,required:["from","to","category","content"],properties:{from:mailbox,to:mailbox,replyTo:{type:"string",format:"email"},category:{type:"string",pattern:"^[a-z][a-z0-9_]{1,79}$"},content:{oneOf:[{type:"object",additionalProperties:false,required:["templateId"],properties:{templateId:{type:"string",format:"uuid"},variables:{type:"object",additionalProperties:{type:["string","number","boolean","null"]}}}},{type:"object",additionalProperties:false,required:["subject","html","text"],properties:{subject:{type:"string",maxLength:255},html:{type:"string"},text:{type:"string"}}}]},attachments:{type:"array",maxItems:5,items:{type:"object",additionalProperties:false,required:["id"],properties:{id:{type:"string",format:"uuid"}}}},metadata:{type:"object",additionalProperties:false,properties:{referenceId:{type:"string",maxLength:128}}}}},
      AttachmentUpload:{type:"object",additionalProperties:false,required:["fileName","contentType","sizeBytes","sha256"],properties:{fileName:{type:"string",maxLength:180},contentType:{enum:["application/pdf","image/png","image/jpeg","image/webp","text/plain","text/csv","application/json","text/calendar"]},sizeBytes:{type:"integer",maximum:5242880},sha256:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}}},
      Accepted:{type:"object",required:["data"],properties:{data:{type:"object",required:["id","status"],properties:{id:{type:"string",format:"uuid"},status:{enum:["queued","simulated"]}}}}},
      EmailStatus:{type:"object",required:["data"],properties:{data:{type:"object",required:["id","status","category","queuedAt","createdAt"],properties:{id:{type:"string",format:"uuid"},status:{enum:["simulated","queued","sending","sent","delivered","soft_bounced","hard_bounced","complained","suppressed","failed","unknown"]},category:{type:"string"},queuedAt:{type:"string",format:"date-time"},acceptedAt:{type:["string","null"],format:"date-time"},deliveredAt:{type:["string","null"],format:"date-time"},failedAt:{type:["string","null"],format:"date-time"},ambiguousAt:{type:["string","null"],format:"date-time"},errorCode:{type:["string","null"]},createdAt:{type:"string",format:"date-time"}}}}},
    },
  },
})}
