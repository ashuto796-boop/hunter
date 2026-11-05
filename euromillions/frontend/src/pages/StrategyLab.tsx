import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Play, Plus, Save, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GroupedBars } from "@/components/charts";
import { Field, JobProgress, Notice, NumberInput, PageHeader, Section } from "@/components/common";
import { ConstraintsForm, DEFAULT_WEIGHTS, WeightsForm, WEIGHT_LABELS, cleanConstraints, type Constraints, type Weights } from "@/components/forms";
import { GridList } from "@/components/GridList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtNum, fmtPct } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { GridLite, JobStart } from "@/lib/types";

type Scores = Record<"diversity" | "pair_coverage" | "triple_coverage" | "star_score" | "star_pair_coverage" | "star_balance" | "popularity" | "overlap_rate", number>;
interface Evaluation { objective: number; scores: Scores; max_common_numbers_observed: number; duplicates: number; grids: GridLite[]; seed: number; iterations: number; elapsed_s: number }
interface Config { name: string; weights: Weights; constraints: Constraints; max_common: number | null }
interface CompareRes { seed: number; results: (Evaluation & { name: string })[]; best_by_criterion: Record<string, string>; note: string }
interface TuneRes { target_label: string; seed: number; trials: { trial: number; weights: Weights; value: number; feasible: boolean; diversity: number; pair_coverage: number; triple_coverage: number; star_score: number }[]; best: { weights: Weights; value: number; grids: GridLite[] } | null; note: string }

const SCORE_LABELS: [keyof Scores, string][] = [
  ["diversity", "Diversité"], ["pair_coverage", "Paires"], ["triple_coverage", "Triplets"], ["star_score", "Étoiles"], ["popularity", "Motifs"], ["overlap_rate", "Recouvrement"],
];

export default function StrategyLab() {
  const qc = useQueryClient();
  const [n, setN] = useState(10);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [constraints, setConstraints] = useState<Constraints>({});
  const [maxCommon, setMaxCommon] = useState<number | null>(2);
  const [live, setLive] = useState<Evaluation | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [cmp, setCmp] = useState<CompareRes | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("pair_coverage");
  const [trials, setTrials] = useState(12);
  const [minDiv, setMinDiv] = useState<number | null>(null);
  const [tune, setTune] = useState<TuneRes | null>(null);
  const saved = useQuery({ queryKey: ["strategies"], queryFn: () => api.get<{ id: number; name: string; description: string | null; params: { weights?: Weights; constraints?: Constraints; max_common?: number | null; n_grids?: number } }[]>("/strategies") });
  const cmpJob = useJob<CompareRes>((r) => setCmp(r));
  const tuneJob = useJob<TuneRes>((r) => setTune(r));
  const seq = useRef(0);

  // Évaluation « en direct » (anti-rebond) : recuit simulé court, même graine.
  useEffect(() => {
    const id = ++seq.current;
    const t = window.setTimeout(async () => {
      setLiveBusy(true);
      try {
        const r = await api.post<Evaluation>("/strategy-lab/evaluate", { n_grids: n, weights, constraints: cleanConstraints(constraints), max_common: maxCommon, time_limit_s: 0.8, seed: 7 });
        if (id === seq.current) { setLive(r); setLiveErr(null); }
      } catch (e) {
        if (id === seq.current) setLiveErr((e as Error).message);
      } finally {
        if (id === seq.current) setLiveBusy(false);
      }
    }, 650);
    return () => window.clearTimeout(t);
  }, [n, weights, constraints, maxCommon]);

  const addConfig = () => {
    if (configs.length >= 5) return toast.error("Au plus 5 stratégies comparées.");
    setConfigs([...configs, { name: name || `Stratégie ${configs.length + 1}`, weights, constraints: cleanConstraints(constraints), max_common: maxCommon }]);
  };
  const saveConfig = async () => {
    try {
      await api.post("/strategies", { name: name || `Stratégie ${new Date().toLocaleString("fr-FR")}`, code: "F", params: { weights, constraints: cleanConstraints(constraints), max_common: maxCommon, n_grids: n } });
      toast.success("Configuration enregistrée");
      qc.invalidateQueries({ queryKey: ["strategies"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Laboratoire de stratégies" subtitle="Ajustez les pondérations et observez en direct leur effet sur les scores du portefeuille. Les scores sont structurels : aucun n'est une probabilité de gain." icon={<FlaskConical />} />
      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Configuration">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grilles (2 à 100)"><NumberInput value={n} min={2} max={100} onChange={(v) => setN(Math.max(2, Math.min(100, Math.round(v ?? 10))))} /></Field>
              <Field label="Numéros communs max"><NumberInput allowEmpty value={maxCommon} min={0} max={4} onChange={setMaxCommon} /></Field>
            </div>
            <div className="mt-4"><WeightsForm value={weights} onChange={setWeights} /></div>
          </Section>
          <Section title="Contraintes personnalisées"><ConstraintsForm value={constraints} onChange={setConstraints} /></Section>
          <Section title="Enregistrer / comparer">
            <div className="space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la stratégie" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="flex-1" onClick={addConfig}><Plus /> Ajouter à la comparaison</Button>
                <Button variant="outline" className="flex-1" onClick={saveConfig}><Save /> Enregistrer</Button>
              </div>
            </div>
            {!!saved.data?.length && (
              <ul className="mt-3 space-y-1.5 text-sm">
                {saved.data.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                    <button className="text-left hover:underline" onClick={() => {
                      if (s.params.weights) setWeights({ ...DEFAULT_WEIGHTS, ...s.params.weights });
                      setConstraints(s.params.constraints ?? {});
                      setMaxCommon(s.params.max_common ?? 2);
                      if (s.params.n_grids) setN(s.params.n_grids);
                      setName(s.name);
                    }}>{s.name}</button>
                    <Button size="icon" variant="ghost" aria-label="Supprimer" onClick={async () => { await api.del(`/strategies/${s.id}`); qc.invalidateQueries({ queryKey: ["strategies"] }); }}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-5">
          <Tabs defaultValue="live">
            <TabsList>
              <TabsTrigger value="live">Effet en direct</TabsTrigger>
              <TabsTrigger value="compare">Comparer ({configs.length}/5)</TabsTrigger>
              <TabsTrigger value="tune">Recherche automatique</TabsTrigger>
            </TabsList>
            <TabsContent value="live" className="space-y-5">
              <Section title="Scores du portefeuille obtenu" description="Recuit simulé de 0,8 s avec graine fixe : seules vos pondérations changent."
                actions={liveBusy ? <Loader2 className="size-4 animate-spin text-violet-300" /> : undefined}>
                {liveErr && <Notice variant="destructive">{liveErr}</Notice>}
                {live && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {SCORE_LABELS.map(([k, l]) => (
                        <div key={k} className="rounded-lg border bg-background/40 p-3">
                          <div className="text-xs text-muted-foreground">{l}</div>
                          <div className="mt-1 font-display text-xl font-semibold num">{k === "pair_coverage" || k === "triple_coverage" ? fmtPct(live.scores[k], 1) : fmtNum(live.scores[k], 3)}</div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full bg-gradient-to-r from-violet-500 to-amber-400 transition-all" style={{ width: `${Math.max(0, Math.min(1, live.scores[k])) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="gold">Objectif {fmtNum(live.objective, 4)}</Badge>
                      <Badge variant="outline">Numéros communs max {live.max_common_numbers_observed}</Badge>
                      <Badge variant="outline">{live.iterations.toLocaleString("fr-FR")} itérations</Badge>
                    </div>
                    <GridList grids={live.grids.map((g, i) => ({ id: i + 1, ...g, strategy: "F" }))} pageSize={20} />
                  </div>
                )}
              </Section>
            </TabsContent>
            <TabsContent value="compare" className="space-y-5">
              <Section title="Stratégies à comparer" description="Même graine et même durée pour chacune.">
                <ul className="space-y-1.5 text-sm">
                  {configs.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                      <span>{c.name} <span className="text-xs text-muted-foreground">{(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => `${WEIGHT_LABELS[k].label.split(" ")[0]} ${fmtNum(c.weights[k], 2)}`).join(" · ")}</span></span>
                      <Button size="icon" variant="ghost" onClick={() => setConfigs(configs.filter((_, j) => j !== i))} aria-label="Retirer"><X /></Button>
                    </li>
                  ))}
                  {!configs.length && <p className="text-xs text-muted-foreground">Ajoutez la configuration courante avec « Ajouter à la comparaison ».</p>}
                </ul>
                <Button className="mt-3" disabled={!configs.length || cmpJob.running} onClick={() => cmpJob.start(() => api.post<JobStart>("/strategy-lab/compare", { configs, n_grids: n, time_limit_s: 2 }))}><Play /> Comparer</Button>
              </Section>
              <JobProgress job={cmpJob.job} error={cmpJob.error} onCancel={cmpJob.cancel} />
              {cmp && (
                <Section title="Résultats" description={cmp.note}>
                  <GroupedBars categories={cmp.results.map((r, i) => ({ key: `s${i}`, label: r.name }))}
                    data={SCORE_LABELS.slice(0, 4).map(([k, l]) => ({ metric: l, ...Object.fromEntries(cmp.results.map((r, i) => [`s${i}`, r.scores[k]])) }))} yFormatter={(v) => fmtNum(v, 2)} />
                  <Table className="mt-4">
                    <TableHeader><TableRow><TableHead>Critère</TableHead><TableHead>Stratégie dominante</TableHead></TableRow></TableHeader>
                    <TableBody>{Object.entries(cmp.best_by_criterion).map(([k, v]) => (
                      <TableRow key={k}><TableCell>{({ pair_coverage: "Couverture des paires", triple_coverage: "Couverture des triplets", diversity: "Diversité", star_score: "Répartition des étoiles", star_pair_coverage: "Paires d'étoiles", popularity_lowest: "Indice de motif le plus bas" } as Record<string, string>)[k] ?? k}</TableCell><TableCell>{v}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </Section>
              )}
            </TabsContent>
            <TabsContent value="tune" className="space-y-5">
              <Section title="Recherche automatique des paramètres" description="Recherche aléatoire sur les pondérations et les températures du recuit simulé pour maximiser une métrique de couverture. Aucun tirage historique n'est utilisé.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Métrique cible">
                    <Select value={target} onValueChange={setTarget}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pair_coverage">Couverture des paires</SelectItem>
                        <SelectItem value="triple_coverage">Couverture des triplets</SelectItem>
                        <SelectItem value="diversity">Diversité</SelectItem>
                        <SelectItem value="star_score">Répartition des étoiles</SelectItem>
                        <SelectItem value="star_pair_coverage">Couverture des paires d'étoiles</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Essais"><NumberInput value={trials} min={2} max={60} onChange={(v) => setTrials(v ?? 12)} /></Field>
                  <Field label="Diversité minimale"><NumberInput allowEmpty value={minDiv} min={0} max={1} step={0.05} onChange={setMinDiv} /></Field>
                </div>
                <Button className="mt-3" disabled={tuneJob.running} onClick={() => tuneJob.start(() => api.post<JobStart>("/strategy-lab/auto-tune", { target, n_grids: n, trials, time_per_trial_s: 1, min_diversity: minDiv, constraints: cleanConstraints(constraints), max_common: maxCommon }))}><Wand2 /> Lancer la recherche</Button>
              </Section>
              <JobProgress job={tuneJob.job} error={tuneJob.error} onCancel={tuneJob.cancel} />
              {tune && (
                <Section title={`Essais — ${tune.target_label}`} description={tune.note}
                  actions={tune.best ? <Button size="sm" onClick={() => { setWeights(tune.best!.weights); toast.success("Meilleures pondérations appliquées"); }}>Appliquer le meilleur</Button> : undefined}>
                  <Table>
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead className="text-right">Valeur</TableHead><TableHead className="text-right">Diversité</TableHead><TableHead className="text-right">Paires</TableHead><TableHead className="text-right">Triplets</TableHead><TableHead>Admissible</TableHead></TableRow></TableHeader>
                    <TableBody>{[...tune.trials].sort((a, b) => b.value - a.value).map((t) => (
                      <TableRow key={t.trial}><TableCell>{t.trial}</TableCell><TableCell className="text-right">{fmtNum(t.value, 4)}</TableCell><TableCell className="text-right">{fmtNum(t.diversity, 3)}</TableCell><TableCell className="text-right">{fmtPct(t.pair_coverage, 1)}</TableCell><TableCell className="text-right">{fmtPct(t.triple_coverage, 1)}</TableCell><TableCell>{t.feasible ? <Badge variant="success">oui</Badge> : <Badge variant="secondary">non</Badge>}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </Section>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
