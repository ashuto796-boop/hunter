import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Save, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GroupedBars, Heatmap, Histogram, Lines } from "@/components/charts";
import { Field, JobProgress, KeyValue, Notice, NumberInput, PageHeader, Section } from "@/components/common";
import { ConstraintsForm, DEFAULT_WEIGHTS, WeightsForm, cleanConstraints, type Constraints, type Weights } from "@/components/forms";
import { GridList } from "@/components/GridList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtEuro, fmtNum, fmtPct } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { GridLite, JobStart, PortfolioMetrics, Prob } from "@/lib/types";

const METHODS: Record<string, string> = {
  greedy: "Glouton",
  local_search: "Recherche locale",
  simulated_annealing: "Recuit simulé",
  tabu: "Tabou",
  genetic: "Génétique",
  cp_sat: "CP-SAT",
};

interface OptResult {
  method: string; method_label: string; grids: GridLite[]; objective: number; metrics: PortfolioMetrics; diversity: number;
  pair_coverage: number; triple_coverage: number; duplicates: number; iterations: number; elapsed_s: number; seed: number;
  params: Record<string, unknown>; history: { iteration: number; elapsed_s: number; current: number; best: number }[];
  status: string; notes: string[]; error?: string;
}

interface Candidate {
  name: string; strategy: string; grids: GridLite[]; diversity: number; pair_coverage: number; triple_coverage: number; star_score: number;
  star_usage: number[]; popularity: number; duplicates: number; max_common_numbers_observed: number; objective_common: number;
  cost: number; p_jackpot: Prob; generation_time_s: number; seed: number | null;
}

export default function Optimizer() {
  const qc = useQueryClient();
  const [n, setN] = useState(10);
  const [budget, setBudget] = useState<number | null>(null);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [constraints, setConstraints] = useState<Constraints>({});
  const [maxCommon, setMaxCommon] = useState<number | null>(2);
  const [timeLimit, setTimeLimit] = useState(4);
  const [level, setLevel] = useState<"rapide" | "standard" | "approfondi">("standard");
  const [methods, setMethods] = useState<string[]>(["greedy", "local_search", "simulated_annealing", "tabu", "genetic"]);
  const [cmp, setCmp] = useState<{ results: OptResult[]; seed: number; best_method_for_objective: string; note: string } | null>(null);
  const [cands, setCands] = useState<{ candidates: Candidate[]; note: string } | null>(null);
  const [picked, setPicked] = useState<{ name: string; grids: GridLite[]; metrics?: PortfolioMetrics } | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ ticket_price: number }>("/settings") });
  const price = settings.data?.ticket_price ?? 2.5;
  const effN = budget ? Math.min(n, Math.floor(budget / price)) : n;
  const levelTime = { rapide: 1, standard: timeLimit, approfondi: timeLimit * 3 }[level];

  const base = () => ({
    n_grids: n, weights, constraints: cleanConstraints(constraints), max_common: maxCommon, time_limit_s: levelTime,
    budget: budget ?? undefined, ticket_price: price,
  });
  const cmpJob = useJob<NonNullable<typeof cmp>>((r) => { setCmp(r); toast.success("Comparaison des méthodes terminée"); });
  const candJob = useJob<NonNullable<typeof cands>>((r) => { setCands(r); toast.success("Portefeuilles candidats générés"); });

  const save = async () => {
    if (!picked) return;
    try {
      await api.post("/portfolios", { name: picked.name, strategy_code: "F", params: { weights, constraints: cleanConstraints(constraints), max_common: maxCommon }, grids: picked.grids });
      toast.success("Portefeuille enregistré");
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const ok = cmp?.results.filter((r) => r.status !== "error") ?? [];
  const convergence = (() => {
    if (!ok.length) return [];
    const pts = new Map<number, Record<string, number>>();
    for (const r of ok) for (const h of r.history) {
      const t = Math.round(h.elapsed_s * 20) / 20;
      const row = pts.get(t) ?? { t };
      row[r.method] = Math.max(row[r.method] ?? -Infinity, h.best);
      pts.set(t, row);
    }
    const rows = [...pts.values()].sort((a, b) => a.t - b.t);
    const last: Record<string, number> = {};
    return rows.map((row) => { for (const r of ok) { if (row[r.method] !== undefined) last[r.method] = row[r.method]; else if (last[r.method] !== undefined) row[r.method] = last[r.method]; } return row; });
  })();

  return (
    <>
      <PageHeader title="Optimiseur de portefeuilles" subtitle="Maximise une fonction objectif documentée (diversité, couverture, recouvrement, étoiles, motifs). Ce n'est pas un score de probabilité de sortie." icon={<Sparkles />} />
      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Portefeuille">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre de grilles"><NumberInput value={n} min={1} max={10000} onChange={(v) => setN(Math.max(1, Math.round(v ?? 1)))} /></Field>
              <Field label="Budget max (€)" hint={budget ? `→ ${effN} grille(s) à ${fmtEuro(price)}` : "facultatif"}><NumberInput allowEmpty value={budget} min={0} onChange={setBudget} /></Field>
              <Field label="Numéros communs max"><NumberInput allowEmpty value={maxCommon} min={0} max={4} onChange={setMaxCommon} /></Field>
              <Field label="Temps max / méthode (s)"><NumberInput value={timeLimit} min={0.5} max={60} step={0.5} onChange={(v) => setTimeLimit(v ?? 4)} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(["rapide", "standard", "approfondi"] as const).map((l) => (
                <Button key={l} size="sm" variant={level === l ? "default" : "outline"} onClick={() => setLevel(l)}>Niveau {l}</Button>
              ))}
            </div>
          </Section>
          <Section title="Pondérations (objectif de couverture et de diversité)"><WeightsForm value={weights} onChange={setWeights} /></Section>
          <Section title="Contraintes"><ConstraintsForm value={constraints} onChange={setConstraints} /></Section>
        </div>
        <div className="space-y-5">
          <Tabs defaultValue="methods">
            <TabsList>
              <TabsTrigger value="methods">Comparer les méthodes</TabsTrigger>
              <TabsTrigger value="candidates">Portefeuilles candidats</TabsTrigger>
            </TabsList>
            <TabsContent value="methods" className="space-y-5">
              <Section title="Méthodes d'optimisation" description="Même graine, même objectif, même budget de temps pour chaque méthode.">
                <div className="flex flex-wrap gap-3">
                  {Object.entries(METHODS).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={methods.includes(k)} onCheckedChange={(c) => setMethods((m) => (c ? [...m, k] : m.filter((x) => x !== k)))} /> {v}
                    </label>
                  ))}
                </div>
                <Button className="mt-4" onClick={() => cmpJob.start(() => api.post<JobStart>("/portfolios/compare-methods", { ...base(), methods }))} disabled={cmpJob.running || !methods.length}>
                  <Play /> Lancer ({methods.length} méthode{methods.length > 1 ? "s" : ""}, ≈ {fmtNum(levelTime * methods.length, 0)} s)
                </Button>
              </Section>
              <JobProgress job={cmpJob.job} error={cmpJob.error} onCancel={cmpJob.cancel} />
              {cmp && (
                <>
                  <Section title="Résultats" description={cmp.note}>
                    <Table>
                      <TableHeader><TableRow><TableHead>Méthode</TableHead><TableHead className="text-right">Objectif</TableHead><TableHead className="text-right">Diversité</TableHead><TableHead className="text-right">Paires</TableHead><TableHead className="text-right">Triplets</TableHead><TableHead className="text-right">Doublons</TableHead><TableHead className="text-right">Itérations</TableHead><TableHead className="text-right">Temps</TableHead><TableHead /></TableRow></TableHeader>
                      <TableBody>
                        {cmp.results.map((r) => r.status === "error" ? (
                          <TableRow key={r.method}><TableCell>{r.method_label}</TableCell><TableCell colSpan={8} className="text-xs text-red-300">{r.error}</TableCell></TableRow>
                        ) : (
                          <TableRow key={r.method}>
                            <TableCell>{r.method_label} {r.method === cmp.best_method_for_objective && <Badge variant="gold">meilleur objectif</Badge>} {r.status === "fallback" && <Badge variant="destructive">repli</Badge>}</TableCell>
                            <TableCell className="text-right">{fmtNum(r.objective, 4)}</TableCell>
                            <TableCell className="text-right">{fmtNum(r.diversity, 3)}</TableCell>
                            <TableCell className="text-right">{fmtPct(r.pair_coverage, 1)}</TableCell>
                            <TableCell className="text-right">{fmtPct(r.triple_coverage, 1)}</TableCell>
                            <TableCell className="text-right">{r.duplicates}</TableCell>
                            <TableCell className="text-right">{r.iterations.toLocaleString("fr-FR")}</TableCell>
                            <TableCell className="text-right">{fmtNum(r.elapsed_s, 2)} s</TableCell>
                            <TableCell><Button size="sm" variant="outline" onClick={() => setPicked({ name: `Optimisé — ${r.method_label}`, grids: r.grids, metrics: r.metrics })}>Choisir</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {ok.flatMap((r) => r.notes).map((t) => <p key={t} className="mt-2 text-xs text-muted-foreground">{t}</p>)}
                    <p className="mt-2 text-xs text-muted-foreground">Graine commune : {cmp.seed}</p>
                  </Section>
                  <Section title="Convergence des optimiseurs" description="Meilleure valeur de la fonction objectif au fil du temps (s).">
                    <Lines data={convergence} xKey="t" xFormatter={(v) => `${fmtNum(Number(v), 2)} s`} series={ok.map((r) => ({ key: r.method, label: r.method_label }))} yFormatter={(v) => fmtNum(v, 3)} yDomain={["auto", "auto"]} />
                  </Section>
                </>
              )}
            </TabsContent>
            <TabsContent value="candidates" className="space-y-5">
              <Section title="Générer des portefeuilles candidats" description="Aléatoire (référence), diversification, couverture et multi-objectifs, évalués avec vos pondérations.">
                <Button onClick={() => candJob.start(() => api.post<JobStart>("/portfolios/candidates", { ...base(), method: "simulated_annealing" }))} disabled={candJob.running}><Play /> Générer les candidats</Button>
              </Section>
              <JobProgress job={candJob.job} error={candJob.error} onCancel={candJob.cancel} />
              {cands && (
                <>
                  <Section title="Comparaison des candidats" description={cands.note}>
                    <Table>
                      <TableHeader><TableRow><TableHead>Candidat</TableHead><TableHead className="text-right">Objectif</TableHead><TableHead className="text-right">Diversité</TableHead><TableHead className="text-right">Paires</TableHead><TableHead className="text-right">Triplets</TableHead><TableHead className="text-right">Étoiles</TableHead><TableHead className="text-right">Coût</TableHead><TableHead className="text-right">P(jackpot)</TableHead><TableHead className="text-right">Temps</TableHead><TableHead /></TableRow></TableHeader>
                      <TableBody>{cands.candidates.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell>{c.name}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.objective_common, 4)}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.diversity, 3)}</TableCell>
                          <TableCell className="text-right">{fmtPct(c.pair_coverage, 1)}</TableCell>
                          <TableCell className="text-right">{fmtPct(c.triple_coverage, 1)}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.star_score, 3)}</TableCell>
                          <TableCell className="text-right">{fmtEuro(c.cost)}</TableCell>
                          <TableCell className="text-right text-xs">{c.p_jackpot.one_in.replace("1 chance sur ", "1/")}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.generation_time_s, 2)} s</TableCell>
                          <TableCell><Button size="sm" variant="outline" onClick={() => setPicked({ name: c.name, grids: c.grids })}>Choisir</Button></TableCell>
                        </TableRow>))}</TableBody>
                    </Table>
                    <Notice>La probabilité de jackpot est identique pour tous les candidats de même taille : seule la structure (diversité, couverture) change.</Notice>
                  </Section>
                  <Section title="Comparaison des scores" description="Chaque score est dans [0, 1] ; plus haut = plus diversifié ou couvrant.">
                    <GroupedBars categories={cands.candidates.map((c, i) => ({ key: `c${i}`, label: c.name }))}
                      data={[["Diversité", "diversity"], ["Paires", "pair_coverage"], ["Triplets", "triple_coverage"], ["Étoiles", "star_score"]].map(([label, k]) => ({
                        metric: label, ...Object.fromEntries(cands.candidates.map((c, i) => [`c${i}`, c[k as keyof Candidate] as number])),
                      }))} yFormatter={(v) => fmtNum(v, 2)} />
                  </Section>
                  <Section title="Répartition des étoiles par candidat">
                    <div className="grid gap-4 md:grid-cols-2">
                      {cands.candidates.map((c) => (
                        <div key={c.name}>
                          <div className="mb-1 text-xs text-muted-foreground">{c.name}</div>
                          <Histogram data={c.star_usage.map((u, i) => ({ etoile: i + 1, usage: u }))} xKey="etoile" yKey="usage" yLabel="Utilisations" height={160} />
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              )}
            </TabsContent>
          </Tabs>
          {picked && (
            <Section title={`Sélection : ${picked.name}`} actions={<Button onClick={save}><Save /> Sauvegarder</Button>}>
              {picked.metrics && (
                <div className="mb-4 space-y-4">
                  <KeyValue items={[["Diversité", fmtNum(picked.metrics.diversity, 4)], ["Couverture des paires", fmtPct(picked.metrics.pair_coverage, 1)], ["Couverture des triplets", fmtPct(picked.metrics.triple_coverage, 1)], ["Numéros communs max", picked.metrics.max_common_numbers_observed]]} />
                  {picked.metrics.similarity_matrix && <Heatmap matrix={picked.metrics.similarity_matrix} valueLabel="Similarité" formatter={(v) => fmtNum(v, 2)} />}
                  <Histogram data={picked.metrics.number_usage.map((u, i) => ({ numero: i + 1, usage: u }))} xKey="numero" yKey="usage" yLabel="Utilisations" height={180} />
                </div>
              )}
              <GridList grids={picked.grids.map((g, i) => ({ id: i + 1, ...g }))} />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
