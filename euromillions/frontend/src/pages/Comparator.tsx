import { GitCompare, Play } from "lucide-react";
import { useState } from "react";
import { Histogram } from "@/components/charts";
import { Field, JobProgress, Notice, NumberInput, PageHeader, PortfolioPicker, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtEuro, fmtNum, fmtPct, oneIn } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { JobStart } from "@/lib/types";

interface Side {
  id: number; name: string;
  simulation: { winning_grids_histogram: { winning_grids: number; draws: number }[]; draws: number; tiers: { rank: number; label: string; draws_with_at_least_one: number }[] };
  metrics: { star_usage: number[] };
}
interface CompareRes { a: Side; b: Side; criteria: { criterion: string; a: number | null; b: number | null; better_if: string; dominant: string }[]; seed: number; n_draws: number; note: string }

function fmtCrit(label: string, v: number | null): string {
  if (v === null) return "—";
  if (label.startsWith("Probabilité de jackpot")) return oneIn(v);
  if (label.startsWith("Budget")) return fmtEuro(v);
  if (label.startsWith("Nombre")) return String(v);
  if (label.startsWith("P(")) return fmtPct(v, 3);
  if (label.startsWith("Couverture")) return fmtPct(v, 1);
  return fmtNum(v, 4);
}

export default function Comparator() {
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [nDraws, setNDraws] = useState(100000);
  const [exact, setExact] = useState(true);
  const [res, setRes] = useState<CompareRes | null>(null);
  const job = useJob<CompareRes>((r) => setRes(r));
  return (
    <>
      <PageHeader title="Comparateur de portefeuilles" subtitle="Comparaison critère par critère. Aucun « meilleur portefeuille » n'est désigné sans préciser l'objectif." icon={<GitCompare />} />
      <Section title="Sélection">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Portefeuille A"><PortfolioPicker value={a} onChange={setA} exclude={b ? [b] : []} /></Field>
          <Field label="Portefeuille B"><PortfolioPicker value={b} onChange={setB} exclude={a ? [a] : []} /></Field>
          <Field label="Tirages simulés"><NumberInput value={nDraws} min={1000} max={2000000} onChange={(v) => setNDraws(v ?? 100000)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><Switch checked={exact} onCheckedChange={setExact} /> Analyse exacte (≤ 100 grilles)</label>
        </div>
        <Button className="mt-4" disabled={!a || !b || job.running} onClick={() => job.start(() => api.post<JobStart>("/portfolios/compare", { portfolio_a: a, portfolio_b: b, n_draws: nDraws, exact }))}><Play /> Comparer</Button>
      </Section>
      <div className="mt-5 space-y-5">
        <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
        {res && (
          <>
            <Section title={`A : ${res.a.name}  ·  B : ${res.b.name}`} description={`${res.n_draws.toLocaleString("fr-FR")} tirages simulés communs · graine ${res.seed}`}>
              <Table>
                <TableHeader><TableRow><TableHead>Critère</TableHead><TableHead className="text-right">A</TableHead><TableHead className="text-right">B</TableHead><TableHead>Dominant</TableHead></TableRow></TableHeader>
                <TableBody>{res.criteria.map((c) => (
                  <TableRow key={c.criterion}>
                    <TableCell>{c.criterion} <span className="text-xs text-muted-foreground">{c.better_if === "higher" ? "(plus haut)" : c.better_if === "lower" ? "(plus bas)" : ""}</span></TableCell>
                    <TableCell className="text-right">{fmtCrit(c.criterion, c.a)}</TableCell>
                    <TableCell className="text-right">{fmtCrit(c.criterion, c.b)}</TableCell>
                    <TableCell>{c.dominant === "A" || c.dominant === "B" ? <Badge variant="gold">{c.dominant}</Badge> : <span className="text-xs text-muted-foreground">{c.dominant}</span>}</TableCell>
                  </TableRow>))}</TableBody>
              </Table>
              <div className="mt-3"><Notice>{res.note}</Notice></div>
            </Section>
            <div className="grid gap-5 lg:grid-cols-2">
              {[res.a, res.b].map((s, i) => (
                <Section key={s.id} title={`${i === 0 ? "A" : "B"} — gains simulés`} description="Part des tirages selon le nombre de grilles gagnantes.">
                  <Histogram data={s.simulation.winning_grids_histogram.map((h) => ({ k: h.winning_grids, part: h.draws / s.simulation.draws }))} xKey="k" yKey="part" yLabel="Part des tirages" height={200} />
                  <div className="mt-3 text-xs text-muted-foreground">Répartition des étoiles : {s.metrics.star_usage.map((u, j) => `${j + 1}:${u}`).join(" · ")}</div>
                </Section>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
