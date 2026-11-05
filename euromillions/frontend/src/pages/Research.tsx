import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Microscope, Play, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Histogram } from "@/components/charts";
import { ExportButtons, Field, JobProgress, KeyValue, Notice, NumberInput, PageHeader, RequireData, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNum, fmtPValue } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { JobStart } from "@/lib/types";

interface Hyp { title: string; metric: string; alternative: string; params: Record<string, number> }
interface ResearchRes {
  hypothesis: string; title: string; metric: string; alternative: string; params: Record<string, number>; seed: number; n_sim: number; alpha: number; units: number;
  period: [string, string]; observed: number; null_mean: number; null_sd: number; null_interval_95: [number, number]; observed_ci95: [number, number];
  p_value: number; reject_h0: boolean; null_histogram: { from: number; to: number; count: number }[]; interpretation: string; null_model: string;
}
interface ExpRow { id: number; hypothesis_code: string; mode: string; title: string; seed: number; period_start: string; period_end: string; created_at: string; summary: { p_value: number; reject_h0: boolean; observed: number } }

function Content() {
  const qc = useQueryClient();
  const hyps = useQuery({ queryKey: ["hypotheses"], queryFn: () => api.get<{ hypotheses: Record<string, Hyp> }>("/research/hypotheses") });
  const exps = useQuery({ queryKey: ["research-exps"], queryFn: () => api.get<ExpRow[]>("/research/experiments") });
  const [code, setCode] = useState("hot_next");
  const [mode, setMode] = useState<"exploratory" | "confirmatory">("exploratory");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [nSim, setNSim] = useState(2000);
  const [seed, setSeed] = useState<number | null>(null);
  const [alpha, setAlpha] = useState(0.05);
  const [params, setParams] = useState<Record<string, number>>({});
  const [res, setRes] = useState<ResearchRes | null>(null);
  const job = useJob<ResearchRes>((r) => { setRes(r); qc.invalidateQueries({ queryKey: ["research-exps"] }); });
  const repro = useJob<{ identical: boolean; original: Record<string, unknown>; reproduced: Record<string, unknown> }>((r) =>
    r.identical ? toast.success("Expérience reproduite à l'identique") : toast.error("Résultat différent : l'historique de la période a changé"));
  const h = hyps.data?.hypotheses[code];
  const run = () => job.start(() => api.post<JobStart>("/research/experiments", {
    hypothesis: code, mode, date_from: from || null, date_to: to || null, n_sim: nSim, seed, alpha, params: { ...(h?.params ?? {}), ...params },
  }));
  return (
    <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-5">
        <Section title="Définir l'expérience">
          <div className="space-y-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList className="w-full"><TabsTrigger className="flex-1" value="exploratory">Exploratoire</TabsTrigger><TabsTrigger className="flex-1" value="confirmatory">Confirmatoire</TabsTrigger></TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">{mode === "exploratory"
              ? "Exploration libre pour formuler des hypothèses ; ses p-valeurs ne constituent pas des preuves."
              : "Test unique d'une hypothèse précise, sur une période qui n'a servi à aucune exploration de cette hypothèse (vérifié par le serveur)."}</p>
            <Field label="Hypothèse">
              <Select value={code} onValueChange={(v) => { setCode(v); setParams({}); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(hyps.data?.hypotheses ?? {}).map(([k, v]) => <SelectItem key={k} value={k}>{v.title}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {h && <p className="text-xs text-muted-foreground">Métrique : {h.metric} · test {h.alternative === "greater" ? "unilatéral" : "bilatéral"}</p>}
            {h && Object.entries(h.params).map(([k, v]) => (
              <Field key={k} label={k === "k" ? "Nombre de numéros sélectionnés (k)" : k === "window" ? "Fenêtre (tirages)" : k}>
                <NumberInput value={params[k] ?? v} min={1} onChange={(x) => setParams({ ...params, [k]: x ?? v })} />
              </Field>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label="Simulations H0"><NumberInput value={nSim} min={100} max={20000} onChange={(v) => setNSim(v ?? 2000)} /></Field>
              <Field label="Seuil α"><NumberInput value={alpha} min={0.001} max={0.49} step={0.01} onChange={(v) => setAlpha(v ?? 0.05)} /></Field>
              <Field label="Graine" className="col-span-2" hint="Vide = graine aléatoire, enregistrée avec l'expérience."><NumberInput allowEmpty value={seed} min={0} onChange={setSeed} /></Field>
            </div>
            <Button className="w-full" onClick={run} disabled={job.running}><Play /> Lancer</Button>
          </div>
        </Section>
      </div>
      <div className="space-y-5">
        <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
        {res && (
          <Section title={res.title} description={`${fmtDate(res.period[0])} → ${fmtDate(res.period[1])} · ${res.units} unités · ${res.n_sim} simulations · graine ${res.seed}`}>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge variant={res.reject_h0 ? "destructive" : "success"}>{res.reject_h0 ? "H0 rejetée au seuil choisi" : "Compatible avec H0"}</Badge>
              <Badge variant="outline">p = {fmtPValue(res.p_value)}</Badge>
              <Badge variant={mode === "confirmatory" ? "gold" : "secondary"}>{mode === "confirmatory" ? "confirmatoire" : "exploratoire"}</Badge>
            </div>
            <KeyValue items={[
              ["Valeur observée", fmtNum(res.observed, 4)],
              ["Moyenne sous H0", fmtNum(res.null_mean, 4)],
              ["Intervalle 95 % sous H0", `${fmtNum(res.null_interval_95[0], 4)} – ${fmtNum(res.null_interval_95[1], 4)}`],
              ["IC 95 % de l'observation (approx.)", `${fmtNum(res.observed_ci95[0], 4)} – ${fmtNum(res.observed_ci95[1], 4)}`],
            ]} />
            <div className="mt-4">
              <div className="mb-1 text-xs text-muted-foreground">Distribution de la métrique sous H0 (modèle aléatoire)</div>
              <Histogram data={res.null_histogram.map((b) => ({ classe: fmtNum((b.from + b.to) / 2, 3), n: b.count }))} xKey="classe" yKey="n" yLabel="Simulations" height={200} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{res.interpretation}</p>
            <p className="mt-1 text-xs text-muted-foreground">{res.null_model}</p>
          </Section>
        )}
        <JobProgress job={repro.job} error={repro.error} />
        <Section title="Expériences enregistrées" description="Chaque expérience est reproductible grâce à sa graine.">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Hypothèse</TableHead><TableHead>Mode</TableHead><TableHead>Période</TableHead><TableHead className="text-right">p</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{exps.data?.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.id}</TableCell>
                <TableCell className="text-xs">{e.title}<div className="text-muted-foreground">{fmtDateTime(e.created_at)} · graine {e.seed}</div></TableCell>
                <TableCell><Badge variant={e.mode === "confirmatory" ? "gold" : "secondary"}>{e.mode === "confirmatory" ? "confirmatoire" : "exploratoire"}</Badge></TableCell>
                <TableCell className="whitespace-nowrap text-xs">{fmtDate(e.period_start)} → {fmtDate(e.period_end)}</TableCell>
                <TableCell className="text-right">{fmtPValue(e.summary.p_value)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" title="Reproduire" aria-label="Reproduire" onClick={() => repro.start(() => api.post<JobStart>(`/research/experiments/${e.id}/reproduce`))}><RotateCcw /></Button>
                    <ExportButtons path={`/research/experiments/${e.id}/export`} filename={`experience_${e.id}`} formats={["pdf"]} />
                    <Button size="icon" variant="ghost" aria-label="Supprimer" onClick={async () => { await api.del(`/research/experiments/${e.id}`); qc.invalidateQueries({ queryKey: ["research-exps"] }); }}><Trash2 /></Button>
                  </div>
                </TableCell>
              </TableRow>))}</TableBody>
          </Table>
        </Section>
        <Notice variant="warning">Multiplier les explorations produit mécaniquement des p-valeurs faibles. Seul un test confirmatoire sur des tirages nouveaux peut appuyer une hypothèse — et, pour des tirages équitables, aucune ne devrait résister.</Notice>
      </div>
    </div>
  );
}

export default function Research() {
  return (
    <>
      <PageHeader title="Mode recherche" subtitle="Hypothèses testées contre un modèle aléatoire, avec graine enregistrée et séparation exploratoire / confirmatoire." icon={<Microscope />} />
      <RequireData><Content /></RequireData>
    </>
  );
}
