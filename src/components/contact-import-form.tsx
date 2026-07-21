"use client";

import { useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type ListOption = { id: string; name: string };

function csvHeader(line: string) {
  const separator = line.includes(";") ? ";" : ",";
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === separator && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += character;
  }
  values.push(current.trim());
  return values.filter(Boolean).slice(0, 100);
}

function guess(headers: string[], patterns: RegExp[]) {
  return headers.find((header) => patterns.some((pattern) => pattern.test(header.toLowerCase()))) ?? "";
}

export function ContactImportForm({ lists }: { lists: ListOption[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStatus("");
    if (!selected) return;
    if (selected.size > 10 * 1024 * 1024) {
      setStatus("Le fichier dépasse la limite de 10 Mo.");
      return;
    }
    const columns = csvHeader((await selected.slice(0, 32_768).text()).split(/\r?\n/, 1)[0] ?? "");
    setHeaders(columns);
    setMapping({
      email: guess(columns, [/^e-?mail$/, /^courriel$/, /^email_address$/]),
      firstName: guess(columns, [/^pr[eé]nom$/, /^first_?name$/]),
      lastName: guess(columns, [/^nom$/, /^last_?name$/]),
      company: guess(columns, [/^soci[eé]t[eé]$/, /^company$/]),
      locale: guess(columns, [/^langue$/, /^locale$/, /^language$/]),
      tags: guess(columns, [/^tags?$/, /^labels?$/]),
    });
  }

  async function upload(formData: FormData) {
    if (!file || !mapping.email || file.size > 10 * 1024 * 1024) return;
    setPending(true);
    setStatus("Préparation de l’import…");
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          listId: formData.get("listId") || null,
          mapping,
        }),
      });
      const result = await response.json() as { error?: string; uploadUrl?: string };
      if (!response.ok || !result.uploadUrl) throw new Error(result.error ?? "Import impossible");
      setStatus("Transfert sécurisé vers AWS…");
      const uploaded = await fetch(result.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "text/csv" },
        body: file,
      });
      if (!uploaded.ok) throw new Error("Le transfert du fichier a échoué.");
      setStatus("Import lancé. Les compteurs seront mis à jour automatiquement.");
      setFile(null);
      setHeaders([]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={upload} className="grid gap-5 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="grid gap-2">
        <Label htmlFor="contacts-csv">Fichier CSV (10 Mo maximum)</Label>
        <input accept=".csv,text/csv" id="contacts-csv" onChange={selectFile} type="file" />
      </div>
      {headers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["email", "Email *"],
            ["firstName", "Prénom"],
            ["lastName", "Nom"],
            ["company", "Société"],
            ["locale", "Langue"],
            ["tags", "Tags"],
          ].map(([field, label]) => (
            <label className="grid gap-2 text-sm" key={field}>
              {label}
              <select
                className="h-9 rounded-md border bg-transparent px-3"
                onChange={(event) => setMapping((value) => ({ ...value, [field]: event.target.value }))}
                required={field === "email"}
                value={mapping[field] ?? ""}
              >
                <option value="">Ignorer</option>
                {headers.map((header) => <option key={header} value={header}>{header}</option>)}
              </select>
            </label>
          ))}
          <label className="grid gap-2 text-sm">
            Ajouter à la liste
            <select className="h-9 rounded-md border bg-transparent px-3" name="listId">
              <option value="">Aucune liste</option>
              {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Un import met à jour les champs descriptifs, mais n’accorde jamais de consentement marketing ou de suivi.</p>
      <Button className="w-fit" disabled={!file || !mapping.email || pending} type="submit"><Upload />Importer</Button>
      {status && <p aria-live="polite" className="text-sm text-muted-foreground">{status}</p>}
    </form>
  );
}
