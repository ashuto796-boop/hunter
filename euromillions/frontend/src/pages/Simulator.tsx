import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Histogram, Lines } from "@/components/charts";
import { ExportButtons, Field, JobProgress, KeyValue, Notice, NumberInput, PageHeader, Section, usePortfolios } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDateTime, fmtEuro, fmtInt, fmtNum, fmtPct, fmtSci } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { JobStart } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS = [1000, 10000, 100000, 1000000];
const TIER_LABELS = ["5+2", "5+1", "5+0", "4+2", "4+1", "3+2", "4+0", "2+2", "3+1", "3+0", "1+2", "2+1", "2+0"];

interface SimPortfolio {
  name: string; n_grids: number; draws: number; jackpots: number;
  tiers: { rank: number; label: string; wins: number; expected_wins: number; empirical_frequency: number; theoretical_probability: number; relative_gap: number; ci99_low: number; ci99_high: number; within_ci99: boolean }[];
  draws_with_any_win: number; p_any_win_empirical: number; p_any_win_ci99: [number, number]; expected_wins_per_draw: number;
  winning_grids_histogram: { winning_grids: number; draws: number }[]; total_cost: number; cost_per_draw: number;
  payout_assumptions: boolean; total_gross?: number; total_net?: number; mean_net_per_draw?: number; return_rate?: number;
  p_net_positive?: number; net_histogram?: { from: number; to: number; count: number }[]; cumulative_net?: { draw: number; net: number }[];
}
interface SimResult { seed: number; n_draws: number; portfolios: SimPortfolio[]; elapsed_s: number; notes: string[] }
interface SimRow { id: number; status: string; seed: number; n_draws: number; created_at: string; duration_s: number | null; params: { portfolios: { name: string; n_grids: number }[] } }

export default function Simulator() {
  const qc = useQueryClient();
  const portfolios = usePortfolios();
  const [selected, setSelected] = useState<number[]>([]);
  const [baselines, setBaselines] = useState("10");
  const [nDraws, setNDraws] = useState(100000);
  const [seed, setSeed] = useState<number | null>(null);
  const [withPayouts, setWithPayouts] = useState(false);
  const [jackpot, setJackpot] = useState<number | null>(null);
  const [payouts, setPayouts] = useState<Record<number, number | null>>({});
  const [result, setResult] = useState<SimResult | null>(null);
  const [simId, setSimId] = useState<number | null>(null);
  const history = useQuery({ queryKey: ["simulations"], queryFn: () => api.get<SimRow[]>("/simulations") });
  const job = useJob<SimResult>((r) => { setResult(r); toast.success("Simulation terminée"); qc.invalidateQueries({ queryKey: ["simulations"] }); });

  const run = () =>
    job.start(async () => {
      const res = await api.post<JobStart>("/simulations/run", {
        portfolio_ids: selected,
        random_baselines: baselines.split(/[\s,;]+/).map(Number).filter((x) => x >= 1 && x <= 10000).slice(0, 5),
        n_draws: nDraws,
        seed,
        payouts: withPayouts ? Object.fromEntries(Object.entries(payouts).filter(([, v]) => v !== null && v !== undefined)) : {},
        jackpot: withPayouts ? jackpot : null,
      });
      setSimId(res.simulation_id ?? null);
      return res;
    });

  const load = async (id: number) => {
    const s = await api.get<{ results: SimResult | null; status: string }>(`/simulations/${id}`);
    if (s.results) { setResult(s.results); setSimId(id); }
    else toast.info(`Simulation ${s.status}`);
  };

  return (
    <>
      <PageHeader title="Simulateur Monte-Carlo" subtitle="Tirages simulés uniformément ; tous les portefeuilles sont évalués sur les mêmes tirages (nombres aléatoires communs). Une simulation n'augmente jamais les chances réelles." icon={<Activity />} />
      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Portefeuilles comparés">
            <div className="space-y-2">
              {(portfolios.data ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.includes(p.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                  {p.name} <span className="text-xs text-muted-foreground">({p.n_grids})</span>
                </label>
              ))}
              {!portfolios.data?.length && <p className="text-xs text-muted-foreground">Aucun portefeuille enregistré : utilisez des références aléatoires ou le générateur.</p>}
              <Field label="Références aléatoires (tailles)" hint="Portefeuilles uniformes de comparaison, ex. « 1 10 50 ».">
                <Input value={baselines} onChange={(e) => setBaselines(e.target.value)} />
              </Field>
            </div>
          </Section>
          <Section title="Paramètres">
            <div className="space-y-3">
              <Field label="Nombre de tirages simulés">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p} onClick={() => setNDraws(p)} className={cn("rounded-md border px-2.5 py-1 text-xs num", nDraws === p ? "border-violet-400 bg-violet-500/20" : "hover:bg-accent")}>{fmtInt(p)}</button>
                  ))}
                </div>
                <NumberInput value={nDraws} min={1} max={5000000} onChange={(v) => setNDraws(Math.max(1, Math.round(v ?? 1)))} />
              </Field>
              <Field label="Graine (facultative)" hint="Enregistrée pour rejouer la simulation à l'identique."><NumberInput allowEmpty value={seed} min={0} onChange={setSeed} /></Field>
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">Hypothèses de gains <Switch checked={withPayouts} onCheckedChange={setWithPayouts} /></label>
              {withPayouts && (
                <div className="space-y-2">
                  <Field label="Jackpot supposé (€)"><NumberInput allowEmpty value={jackpot} min={0} onChange={setJackpot} /></Field>
                  <div className="grid grid-cols-3 gap-2">
                    {TIER_LABELS.slice(1).map((l, i) => (
                      <Field key={l} label={`Rang ${i + 2} (${l})`}><NumberInput allowEmpty value={payouts[i + 2] ?? null} min={0} onChange={(v) => setPayouts({ ...payouts, [i + 2]: v })} /></Field>
                    ))}
                  </div>
                  <Notice variant="warning">Les gains réels varient à chaque tirage (mises, nombre de gagnants). Ces montants sont vos hypothèses.</Notice>
                </div>
              )}
              <Button className="w-full" variant="gold" size="lg" onClick={run} disabled={job.running}><Play /> Lancer la simulation</Button>
            </div>
          </Section>
          <Section title="Simulations enregistrées">
            <ul className="space-y-1.5 text-xs">
              {history.data?.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                  <button className="text-left hover:underline" onClick={() => load(s.id)}>
                    #{s.id} · {fmtInt(s.n_draws)} tirages · {s.params.portfolios.map((p) => p.name).join(", ").slice(0, 60)}
                    <div className="text-muted-foreground">{fmtDateTime(s.created_at)} · graine {s.seed}</div>
                  </button>
                  <div className="flex items-center gap-1">
                    <Badge variant={s.status === "done" ? "success" : "secondary"}>{s.status}</Badge>
                    <Button size="icon" variant="ghost" aria-label="Supprimer" onClick={async () => { await api.del(`/simulations/${s.id}`); qc.invalidateQueries({ queryKey: ["simulations"] }); }}><Trash2 /></Button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <div className="space-y-5">
          <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
          {result && (
            <>
              <Section title="Synthèse" description={`${fmtInt(result.n_draws)} tirages simulés · graine ${result.seed} · ${fmtNum(result.elapsed_s, 2)} s`}
                actions={simId ? <ExportButtons path={`/simulations/${simId}/export`} filename={`simulation_${simId}`} /> : undefined}>
                <Table>
                  <TableHeader><TableRow><TableHead>Portefeuille</TableHead><TableHead className="text-right">Grilles</TableHead><TableHead className="text-right">Jackpots</TableHead><TableHead className="text-right">P(≥ 1 gain) simulée</TableHead><TableHead className="text-right">IC 99 %</TableHead><TableHead className="text-right">Coût total</TableHead>{result.portfolios[0]?.payout_assumptions && <TableHead className="text-right">Net simulé</TableHead>}</TableRow></TableHeader>
                  <TableBody>{result.portfolios.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right">{p.n_grids}</TableCell>
                      <TableCell className="text-right">{p.jackpots}</TableCell>
                      <TableCell className="text-right">{fmtPct(p.p_any_win_empirical, 3)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtPct(p.p_any_win_ci99[0], 2)} – {fmtPct(p.p_any_win_ci99[1], 2)}</TableCell>
                      <TableCell className="text-right">{fmtEuro(p.total_cost, 0)}</TableCell>
                      {p.payout_assumptions && <TableCell className="text-right">{fmtEuro(p.total_net, 0)}</TableCell>}
                    </TableRow>))}</TableBody>
                </Table>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{result.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
              </Section>
              {result.portfolios.map((p) => (
                <Section key={p.name} title={`${p.name} — gains par rang`} description="Fréquence empirique (par grille et par tirage) comparée à la probabilité théorique exacte, avec intervalle de Wilson à 99 %.">
                  <Table>
                    <TableHeader><TableRow><TableHead>Rang</TableHead><TableHead className="text-right">Gains observés</TableHead><TableHead className="text-right">Gains attendus</TableHead><TableHead className="text-right">Fréq. empirique</TableHead><TableHead className="text-right">Théorique</TableHead><TableHead className="text-right">Écart relatif</TableHead><TableHead>IC 99 %</TableHead></TableRow></TableHeader>
                    <TableBody>{p.tiers.map((t) => (
                      <TableRow key={t.rank}>
                        <TableCell>{t.rank} · {t.label}</TableCell>
                        <TableCell className="text-right">{fmtInt(t.wins)}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.expected_wins, 1)}</TableCell>
                        <TableCell className="text-right">{fmtSci(t.empirical_frequency)}</TableCell>
                        <TableCell className="text-right">{fmtSci(t.theoretical_probability)}</TableCell>
                        <TableCell className="text-right">{t.wins || t.expected_wins > 1 ? fmtPct(t.relative_gap, 1) : "—"}</TableCell>
                        <TableCell>{t.within_ci99 ? <Badge variant="success">contient la théorie</Badge> : <Badge variant="destructive">hors IC</Badge>}</TableCell>
                      </TableRow>))}</TableBody>
                  </Table>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">Distribution du nombre de grilles gagnantes par tirage</div>
                      <Histogram data={p.winning_grids_histogram.map((h) => ({ k: h.winning_grids, part: h.draws / p.draws }))} xKey="k" yKey="part" yLabel="Part des tirages" height={180} />
                    </div>
                    {p.payout_assumptions && p.cumulative_net && (
                      <div>
                        <div className="mb-1 text-xs text-muted-foreground">Résultat net cumulé (€)</div>
                        <Lines data={p.cumulative_net} xKey="draw" series={[{ key: "net", label: "Net cumulé" }]} yFormatter={(v) => fmtEuro(v, 0)} height={180} />
                      </div>
                    )}
                  </div>
                  {p.payout_assumptions && (
                    <div className="mt-3 space-y-3">
                      <KeyValue items={[["Taux de retour simulé", fmtPct(p.return_rate ?? 0, 1)], ["Tirages à résultat net positif", fmtPct(p.p_net_positive ?? 0, 2)], ["Net moyen par tirage", fmtEuro(p.mean_net_per_draw)], ["Gains bruts simulés", fmtEuro(p.total_gross, 0)]]} />
                      {p.net_histogram && (
                        <>
                          <div className="text-xs text-muted-foreground">Distribution des gains nets simulés par tirage (€)</div>
                          <Histogram data={p.net_histogram.map((h) => ({ classe: `${fmtNum(h.from, 0)} à ${fmtNum(h.to, 0)}`, tirages: h.count }))} xKey="classe" yKey="tirages" yLabel="Tirages" height={180} />
                        </>
                      )}
                    </div>
                  )}
                </Section>
              ))}
            </>
          )}
          {!result && !job.running && <Notice>Sélectionnez des portefeuilles enregistrés et/ou des références aléatoires, puis lancez la simulation. Elle s'exécute en arrière-plan : l'interface reste utilisable.</Notice>}
        </div>
      </div>
    </>
  );
}
