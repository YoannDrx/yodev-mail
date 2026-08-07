import { desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireDb } from "@/db";
import { templates } from "@/db/schema";
import { createTemplateAction } from "@/features/templates/actions";
import { requirePageWorkspace } from "@/lib/page-auth";

export default async function Page(){const context=await requirePageWorkspace();const rows=context?await requireDb().select().from(templates).where(eq(templates.workspaceId,context.workspace.id)).orderBy(desc(templates.updatedAt)):[];return <DashboardPage title="Templates" description="Modèles versionnés avec HTML compatible et texte brut."><form action={createTemplateAction} className="grid gap-4 rounded-2xl border bg-white p-6 shadow-sm"><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="name">Nom</Label><Input id="name" name="name" required /></div><div className="grid gap-2"><Label htmlFor="subject">Sujet</Label><Input id="subject" name="subject" required /></div></div><div className="grid gap-2"><Label htmlFor="body">Contenu texte</Label><Textarea className="min-h-40" id="body" name="body" placeholder="Bonjour {{firstName}},…" required /></div><Button className="w-fit" type="submit"><Plus />Créer le template</Button></form><div className="mt-6 grid gap-5 md:grid-cols-3">{rows.map((template)=><article className="overflow-hidden rounded-2xl border bg-white shadow-sm" key={template.id}><div className="grid h-32 place-items-center bg-violet-100"><div className="w-2/3 rounded-lg bg-white p-4 shadow"><div className="h-3 w-1/2 rounded bg-zinc-800"/><div className="mt-3 h-2 rounded bg-zinc-200"/><div className="mt-2 h-2 w-4/5 rounded bg-zinc-200"/></div></div><div className="p-5"><h2 className="font-semibold">{template.name}</h2><p className="mt-1 text-sm text-muted-foreground">{template.subject}</p><p className="mt-4 text-xs text-muted-foreground">Version {template.currentVersion}</p></div></article>)}{!rows.length&&<p className="text-sm text-muted-foreground">Aucun template.</p>}</div></DashboardPage>}
