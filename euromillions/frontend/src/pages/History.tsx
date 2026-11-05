import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, FileUp, Globe, History as HistoryIcon, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { GridBalls } from "@/components/GridBalls";
import { ErrorBox, Field, Loading, Notice, PageHeader, Section, useDrawSummary } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtEuro, fmtInt } from "@/lib/format";
import type { Draw } from "@/lib/types";

interface ImportResult {
  total_rows: number;
  inserted: number;
  replaced: number;
  duplicates_skipped: number;
  rejected: number;
  issues: { line: number; level: string; message: string }[];
  issues_truncated: boolean;
  is_demo: boolean;
}

interface Source {
  id: number; name: string; kind: string; location: string | null; sha256: string | null; is_demo: boolean;
  imported_at: string; rows_inserted: number; rows_rejected: number; rows_duplicated: number;
}

const ERA_LABEL: Record<string, string> = { E2004: "9 étoiles", E2011: "11 étoiles", E2016: "12 étoiles" };

function ImportReport({ r }: { r: ImportResult }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="success">{r.inserted} insérés</Badge>
        {r.replaced > 0 && <Badge variant="gold">{r.replaced} remplacés</Badge>}
        <Badge variant="secondary">{r.duplicates_skipped} doublons ignorés</Badge>
        <Badge variant={r.rejected ? "destructive" : "secondary"}>{r.rejected} rejetés</Badge>
        <Badge variant="outline">{r.total_rows} lignes lues</Badge>
      </div>
      {r.issues.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border bg-background/40 p-2 text-xs">
          {r.issues.map((i, k) => (
            <div key={k} className={i.level === "error" ? "text-red-300" : "text-amber-200"}>Ligne {i.line} : {i.message}</div>
          ))}
          {r.issues_truncated && <div className="text-muted-foreground">… liste tronquée</div>}
        </div>
      )}
    </div>
  );
}

function ManualDraw({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState("");
  const [nums, setNums] = useState("");
  const [stars, setStars] = useState("");
  const [jackpot, setJackpot] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    try {
      await api.post("/draws", {
        draw_date: date,
        numbers: nums.split(/[\s,;]+/).filter(Boolean).map(Number),
        stars: stars.split(/[\s,;]+/).filter(Boolean).map(Number),
        jackpot_eur: jackpot ? Number(jackpot) : null,
      });
      toast.success("Tirage ajouté");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <Field label="Date du tirage"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="5 numéros" hint="séparés par des espaces"><Input value={nums} onChange={(e) => setNums(e.target.value)} placeholder="3 15 22 38 47" /></Field>
      <Field label="2 étoiles"><Input value={stars} onChange={(e) => setStars(e.target.value)} placeholder="2 9" /></Field>
      <Field label="Jackpot annoncé (€, facultatif)"><Input type="number" value={jackpot} onChange={(e) => setJackpot(e.target.value)} /></Field>
      {err && <ErrorBox error={{ message: err }} />}
      <Button onClick={submit} disabled={!date}>Enregistrer le tirage</Button>
    </div>
  );
}

export default function History() {
  const qc = useQueryClient();
  const summary = useDrawSummary();
  const [page, setPage] = useState(1);
  const [overwrite, setOverwrite] = useState(false);
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<ImportResult | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const draws = useQuery({ queryKey: ["draws", page], queryFn: () => api.get<{ items: Draw[]; total: number; pages: number }>("/draws", { page, page_size: 25 }) });
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api.get<Source[]>("/draws/sources") });
  const refresh = () => {
    qc.invalidateQueries();
  };
  const onResult = (r: ImportResult) => {
    setReport(r);
    toast.success(`Import terminé : ${r.inserted} tirage(s) ajouté(s)`);
    refresh();
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("overwrite", String(overwrite));
      return api.upload<ImportResult>("/draws/import/file", fd);
    },
    onSuccess: onResult,
    onError: (e) => toast.error((e as Error).message),
  });
  const fromUrl = useMutation({
    mutationFn: () => api.post<ImportResult>("/draws/import/url", { url, overwrite }),
    onSuccess: onResult,
    onError: (e) => toast.error((e as Error).message),
  });
  const demo = useMutation({ mutationFn: () => api.post<ImportResult>("/draws/import/demo"), onSuccess: onResult, onError: (e) => toast.error((e as Error).message) });
  const purge = useMutation({
    mutationFn: () => api.del<{ deleted: number }>("/draws", { confirm: true }),
    onSuccess: (r) => { toast.success(`${r.deleted} tirages supprimés`); setReport(null); refresh(); },
  });
  const delOne = async (d: Draw) => {
    if (!confirm(`Supprimer le tirage du ${fmtDate(d.draw_date)} ?`)) return;
    await api.del(`/draws/${d.id}`);
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Historique des tirages"
        subtitle="Import, contrôle et gestion des tirages. Aucune donnée n'est inventée : chaque ligne invalide est rejetée avec son motif."
        icon={<HistoryIcon />}
        actions={
          <Dialog open={manualOpen} onOpenChange={setManualOpen}>
            <DialogTrigger asChild><Button variant="outline"><Plus /> Saisie manuelle</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Ajouter un tirage officiel</DialogTitle><DialogDescription>Les règles de l'époque (9, 11 ou 12 étoiles) sont vérifiées.</DialogDescription></DialogHeader>
              <ManualDraw onDone={() => { setManualOpen(false); refresh(); }} />
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Importer un fichier" description="CSV (séparateur ; , ou tabulation), Excel (.xlsx) ou archive ZIP FDJ. 10 Mo maximum.">
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xlsm,.zip" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            <Button className="w-full" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><FileUp /> {upload.isPending ? "Import en cours…" : "Choisir un fichier"}</Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={overwrite} onCheckedChange={setOverwrite} /> Remplacer les tirages en conflit</label>
            <p className="text-xs text-muted-foreground">Colonnes reconnues : format FDJ (date_de_tirage, boule_1…5, etoile_1…2, rapports par rang) ou générique (date, n1…n5, e1, e2).</p>
          </div>
        </Section>
        <Section title="Depuis une URL officielle" description="Seuls les hôtes autorisés (EM_ALLOWED_IMPORT_HOSTS) sont acceptés, en https.">
          <div className="space-y-3">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.fdj.fr/…/euromillions.zip" />
            <Button className="w-full" variant="secondary" onClick={() => fromUrl.mutate()} disabled={!url || fromUrl.isPending}><Globe /> {fromUrl.isPending ? "Téléchargement…" : "Actualiser depuis l'URL"}</Button>
            <p className="text-xs text-muted-foreground">Si la source est indisponible, un message clair s'affiche : importez alors le fichier manuellement.</p>
          </div>
        </Section>
        <Section title="Données" description={summary.data?.last_refresh ? `Dernière actualisation : ${fmtDateTime(summary.data.last_refresh)}` : "Jamais actualisé"}>
          <div className="space-y-3">
            <Button className="w-full" variant="outline" onClick={() => demo.mutate()} disabled={demo.isPending || (summary.data?.count ?? 0) > 0 && !summary.data?.is_demo}>
              <Database /> Charger la démonstration (FICTIVE)
            </Button>
            <Button className="w-full" variant="destructive" disabled={!summary.data?.count || purge.isPending}
              onClick={() => { if (confirm("Supprimer TOUT l'historique des tirages ?")) purge.mutate(); }}>
              <Trash2 /> Purger l'historique
            </Button>
            <Notice variant="warning">Les données de démonstration sont générées aléatoirement et clairement marquées : elles ne doivent pas être confondues avec des résultats officiels.</Notice>
          </div>
        </Section>
      </div>
      {report && <div className="mt-5"><Section title="Rapport d'import"><ImportReport r={report} /></Section></div>}
      <div className="mt-5">
        <Section title={`Tirages (${fmtInt(draws.data?.total ?? 0)})`} actions={
          <div className="flex items-center gap-2 text-xs">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
            <span className="num text-muted-foreground">{page} / {draws.data?.pages || 1}</span>
            <Button size="sm" variant="ghost" disabled={page >= (draws.data?.pages ?? 1)} onClick={() => setPage(page + 1)}>Suivant</Button>
          </div>
        }>
          {draws.isLoading ? <Loading /> : draws.error ? <ErrorBox error={draws.error} /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Tirage</TableHead><TableHead>Règles</TableHead><TableHead className="text-right">Jackpot</TableHead><TableHead>Barème</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {draws.data?.items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(d.draw_date)} <span className="text-xs text-muted-foreground">{d.weekday}</span></TableCell>
                    <TableCell><GridBalls numbers={d.numbers} stars={d.stars} small /></TableCell>
                    <TableCell><Badge variant="secondary">{ERA_LABEL[d.era_code]}</Badge></TableCell>
                    <TableCell className="text-right">{d.jackpot_eur ? fmtEuro(d.jackpot_eur, 0) : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.prizes.length ? `${d.prizes.length} rangs` : "non disponible"}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => delOne(d)} aria-label="Supprimer"><Trash2 /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
      <div className="mt-5">
        <Section title="Sources importées">
          <Table>
            <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Insérés</TableHead><TableHead className="text-right">Rejetés</TableHead><TableHead className="text-right">Doublons</TableHead><TableHead>Empreinte</TableHead></TableRow></TableHeader>
            <TableBody>
              {sources.data?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name} {s.is_demo && <Badge variant="gold">fictif</Badge>}</TableCell>
                  <TableCell>{s.kind}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(s.imported_at)}</TableCell>
                  <TableCell className="text-right">{s.rows_inserted}</TableCell>
                  <TableCell className="text-right">{s.rows_rejected}</TableCell>
                  <TableCell className="text-right">{s.rows_duplicated}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{s.sha256?.slice(0, 12) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      </div>
    </>
  );
}
