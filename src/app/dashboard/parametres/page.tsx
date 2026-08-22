import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { DashboardPage } from "@/components/dashboard-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireDb } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { updateSettingsAction } from "@/features/settings/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
export default async function Page(){const locale=await getLocale();const copy=localized(locale,{fr:{title:"Paramètres",description:"Identité commerciale et préférences du workspace.",identity:"Identité de l’expéditeur",company:"Raison sociale",address:"Adresse postale",from:"Nom expéditeur par défaut",reply:"Reply-To par défaut",save:"Enregistrer",privacy:"Confidentialité",privacyText:"Les pixels d’ouverture et le suivi des clics restent désactivés sauf consentement individuel explicite du destinataire."},en:{title:"Settings",description:"Business identity and workspace preferences.",identity:"Sender identity",company:"Legal business name",address:"Postal address",from:"Default sender name",reply:"Default Reply-To",save:"Save",privacy:"Privacy",privacyText:"Open pixels and click tracking remain disabled unless the recipient has given explicit individual consent."}});const context=await requirePageWorkspace();const settings=context?await requireDb().select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId,context.workspace.id)).limit(1).then((rows)=>rows[0]):undefined;return <DashboardPage title={copy.title} description={copy.description}><form action={updateSettingsAction} className="grid gap-6"><section className="rounded-2xl border bg-white p-6"><h2 className="font-semibold">{copy.identity}</h2><div className="mt-5 grid gap-5 sm:grid-cols-2"><Field label={copy.company} name="companyName" value={settings?.companyName}/><Field label={copy.address} name="companyAddress" value={settings?.companyAddress}/><Field label={copy.from} name="defaultFromName" value={settings?.defaultFromName}/><Field label={copy.reply} name="defaultReplyTo" type="email" value={settings?.defaultReplyTo}/></div><Button className="mt-5" type="submit">{copy.save}</Button></section><section className="rounded-2xl border bg-white p-6"><h2 className="font-semibold">{copy.privacy}</h2><p className="mt-3 text-sm text-muted-foreground">{copy.privacyText}</p></section></form></DashboardPage>}
function Field({label,name,type="text",value}:{label:string;name:string;type?:string;value?:string|null}){return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input defaultValue={value??""} id={name} name={name} type={type}/></div>}
