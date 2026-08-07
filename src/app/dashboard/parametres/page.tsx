import { eq } from "drizzle-orm";
import { DashboardPage } from "@/components/dashboard-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireDb } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { updateSettingsAction } from "@/features/settings/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
export default async function Page(){const context=await requirePageWorkspace();const settings=context?await requireDb().select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId,context.workspace.id)).limit(1).then((rows)=>rows[0]):undefined;return <DashboardPage title="Paramètres" description="Identité commerciale et préférences du workspace."><form action={updateSettingsAction} className="grid gap-6"><section className="rounded-2xl border bg-white p-6"><h2 className="font-semibold">Identité de l’expéditeur</h2><div className="mt-5 grid gap-5 sm:grid-cols-2"><Field label="Raison sociale" name="companyName" value={settings?.companyName}/><Field label="Adresse postale" name="companyAddress" value={settings?.companyAddress}/><Field label="Nom expéditeur par défaut" name="defaultFromName" value={settings?.defaultFromName}/><Field label="Reply-To par défaut" name="defaultReplyTo" type="email" value={settings?.defaultReplyTo}/></div><Button className="mt-5" type="submit">Enregistrer</Button></section><section className="rounded-2xl border bg-white p-6"><h2 className="font-semibold">Confidentialité</h2><p className="mt-3 text-sm text-muted-foreground">Les pixels d’ouverture et le suivi des clics restent désactivés sauf consentement individuel explicite du destinataire.</p></section></form></DashboardPage>}
function Field({label,name,type="text",value}:{label:string;name:string;type?:string;value?:string|null}){return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input defaultValue={value??""} id={name} name={name} type={type}/></div>}
