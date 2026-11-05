import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dices, Save, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Heatmap } from "@/components/charts";
import {
  ExportButtons, Field, JobProgress, KeyValue, Notice, NumberInput, PageHeader, ProbabilityBox, Section,
} from "@/components/common";
import { ConstraintsForm, DEFAULT_WEIGHTS, WeightsForm, cleanConstraints, type Constraints, type Weights } from "@/components/forms";
import { GridList, type ListGrid } from "@/components/GridList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { fmtNum, fmtPct, gridKey } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { GenerationResult, JobStart } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS = [1, 5, 10, 20, 50, 100, 500, 1000, 10000];

export const STRATEGY_INFO: Record<string, { name: string; text: string }> = {
  A: { name: "A — Aléatoire uniforme", text: "Référence : toutes les grilles valides ont la même probabilité d'être choisies." },
  B: { name: "B — Diversification", text: "Limite les numéros et étoiles communs entre grilles." },
  C: { name: "C — Couverture", text: "Maximise les paires, triplets et paires d'étoiles distincts." },
  D: { name: "D — Popularité estimée", text: "Écarte les motifs souvent joués (dates, suites…). La popularité réelle n'est pas connue." },
  E: { name: "E — Pondération historique (expérimental)", text: "Cette méthode ne possède aucun avantage prédictif démontré sur un tirage équitable." },
  F: { name: "F — Multi-objectifs", text: "Vos pondérations : diversité, couverture, recouvrement, étoiles, motifs." },
};

export default function Generator() {
  const qc = useQueryClient();
  const [count, setCount] = useState(10);
  const [strategy, setStrategy] = useState("A");
  const [useSeed, setUseSeed] = useState(false);
  const [seed, setSeed] = useState<number | null>(2026);
  const [constraints, setConstraints] = useState<Constraints>({});
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [method, setMethod] = useState("simulated_annealing");
  const [timeLimit, setTimeLimit] = useState(3);
  const [maxCommon, setMaxCommon] = useState(2);
  const [popThreshold, setPopThreshold] = useState(0.15);
  const [histMode, setHistMode] = useState("hot");
  const [histStrength, setHistStrength] = useState(1);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [grids, setGrids] = useState<ListGrid[]>([]);
  const [saveName, setSaveName] = useState("");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ ticket_price: number }>("/settings") });
  const price = settings.data?.ticket_price ?? 2.5;

  const job = useJob<GenerationResult>((r) => {
    setResult(r);
    setGrids(r.grids.map((g) => ({ ...g })));
    toast.success(`${r.count} grille(s) générée(s)`);
  });

  const body = (n = count) => ({
    count: n,
    strategy,
    seed: useSeed ? seed : null,
    constraints: cleanConstraints(constraints),
    weights: strategy === "F" ? weights : null,
    method,
    time_limit_s: timeLimit,
    max_common: maxCommon,
    popularity_threshold: popThreshold,
    historical_mode: histMode,
    historical_strength: histStrength,
  });

  const generate = () => job.start(() => api.post<JobStart | { result: GenerationResult }>("/grids/generate", body()));

  const regenerate = async (g: ListGrid) => {
    try {
      const keys = new Set(grids.map((x) => gridKey(x.numbers, x.stars)));
      for (let k = 0; k < 20; k++) {
        const r = await api.post<{ result: GenerationResult }>("/grids/generate", { count: 1, strategy: "A", constraints: cleanConstraints(constraints) });
        const ng = r.result.grids[0];
        if (!keys.has(gridKey(ng.numbers, ng.stars))) {
          setGrids((gs) => gs.map((x) => (x.id === g.id ? { ...x, numbers: ng.numbers, stars: ng.stars, strategy: "A", saved: false, diversity_score: null, pattern_score: ng.pattern_score } : x)));
          toast.success(`Grille #${g.id} regénérée (tirage uniforme)`);
          return;
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const savePortfolio = async () => {
    if (!grids.length) return;
    try {
      await api.post("/portfolios", {
        name: saveName || `Portefeuille ${STRATEGY_INFO[strategy].name.split(" — ")[1]} (${grids.length} grilles)`,
        strategy_code: strategy,
        seed: result?.seed ?? null,
        params: { strategy, constraints: cleanConstraints(constraints), weights: strategy === "F" ? weights : undefined },
        grids: grids.map((g) => ({ numbers: g.numbers, stars: g.stars })),
      });
      toast.success("Portefeuille enregistré");
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const m = result?.metrics;
  const optimized = ["B", "C", "F"].includes(strategy);
  return (
    <>
      <PageHeader title="Générateur de grilles" subtitle="Grilles conformes (5 numéros distincts parmi 50, 2 étoiles parmi 12), sans doublon, validées côté serveur." icon={<Dices />} />
      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Paramètres">
            <div className="space-y-4">
              <Field label="Nombre de grilles">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p} onClick={() => setCount(p)}
                      className={cn("rounded-md border px-2.5 py-1 text-xs num transition-colors", count === p ? "border-violet-400 bg-violet-500/20" : "hover:bg-accent")}>
                      {p.toLocaleString("fr-FR")}
                    </button>
                  ))}
                </div>
                <NumberInput value={count} min={1} max={10000} onChange={(v) => setCount(Math.max(1, Math.min(10000, Math.round(v ?? 1))))} />
              </Field>
              <Field label="Stratégie">
                <Select value={strategy} onValueChange={setStrategy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STRATEGY_INFO).map(([k, v]) => <SelectItem key={k} value={k}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
                <p className={cn("text-xs", strategy === "E" ? "font-medium text-amber-200" : "text-muted-foreground")}>{STRATEGY_INFO[strategy].text}</p>
              </Field>
              {optimized && (
                <div className="grid grid-cols-2 gap-3">
                  {strategy === "F" && (
                    <Field label="Algorithme" className="col-span-2">
                      <Select value={method} onValueChange={setMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simulated_annealing">Recuit simulé</SelectItem>
                          <SelectItem value="tabu">Recherche tabou</SelectItem>
                          <SelectItem value="genetic">Algorithme génétique</SelectItem>
                          <SelectItem value="local_search">Recherche locale</SelectItem>
                          <SelectItem value="greedy">Glouton</SelectItem>
                          <SelectItem value="cp_sat">OR-Tools CP-SAT (≤ 30 grilles)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field label="Temps max (s)"><NumberInput value={timeLimit} min={0.5} max={120} step={0.5} onChange={(v) => setTimeLimit(v ?? 3)} /></Field>
                  <Field label="Numéros communs max"><NumberInput value={maxCommon} min={0} max={4} onChange={(v) => setMaxCommon(v ?? 2)} /></Field>
                </div>
              )}
              {strategy === "D" && (
                <Field label={`Seuil d'indice de motif : ${fmtNum(popThreshold, 2)}`} hint="0 = exclure toute grille présentant un motif identifié.">
                  <Slider value={[popThreshold]} min={0} max={1} step={0.05} onValueChange={([v]) => setPopThreshold(v)} />
                </Field>
              )}
              {strategy === "E" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mode">
                    <Select value={histMode} onValueChange={setHistMode}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="hot">Favoriser les fréquents</SelectItem><SelectItem value="cold">Favoriser les rares</SelectItem></SelectContent>
                    </Select>
                  </Field>
                  <Field label={`Intensité ${fmtNum(histStrength, 1)}`}><Slider value={[histStrength]} min={0} max={3} step={0.1} onValueChange={([v]) => setHistStrength(v)} /></Field>
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm">Mode reproductible</div>
                  <div className="text-xs text-muted-foreground">{useSeed ? "Graine fixe (analyses rejouables)" : "secrets.SystemRandom (non prédictible)"}</div>
                </div>
                <Switch checked={useSeed} onCheckedChange={setUseSeed} />
              </div>
              {useSeed && <Field label="Graine"><NumberInput value={seed} min={0} onChange={setSeed} /></Field>}
            </div>
          </Section>
          {strategy === "F" && <Section title="Pondérations de la fonction objectif"><WeightsForm value={weights} onChange={setWeights} /></Section>}
          <Section title="Contraintes personnalisées" description="Appliquées strictement à chaque grille."><ConstraintsForm value={constraints} onChange={setConstraints} /></Section>
          <Button size="lg" variant="gold" className="w-full" onClick={generate} disabled={job.running}><Sparkles /> Générer {count.toLocaleString("fr-FR")} grille{count > 1 ? "s" : ""}</Button>
        </div>
        <div className="space-y-5">
          <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
          {!result && !job.running && <Notice>Choisissez une stratégie puis lancez la génération. Rappel : aucune stratégie ne modifie la probabilité de gain d'une grille.</Notice>}
          {result && m && (
            <>
              {result.warnings.map((w) => <Notice key={w} variant="warning">{w}</Notice>)}
              <div className="grid gap-4 md:grid-cols-2">
                <ProbabilityBox p={m.probabilities.jackpot} label={`Probabilité de jackpot avec ces ${m.distinct_grids} grilles (un tirage)`} />
                <div className="rounded-xl border bg-background/40 p-4">
                  <KeyValue items={[
                    ["Coût", `${fmtNum(grids.length * price, 2)} €`],
                    ["Diversité", fmtNum(m.diversity, 4)],
                    ["Couverture des paires", fmtPct(m.pair_coverage, 1)],
                    ["Couverture des triplets", fmtPct(m.triple_coverage, 1)],
                    ["Répartition des étoiles", fmtNum(m.star_score, 3)],
                    ["Numéros communs max", m.max_common_numbers_observed],
                    ["Doublons", m.duplicates],
                    ["Temps de calcul", `${fmtNum(result.elapsed_s, 3)} s`],
                  ]} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{result.fairness_note} Générateur : {result.rng}{result.seed !== null ? ` · graine ${result.seed}` : ""}.</p>
              <Section title={`${grids.length} grille${grids.length > 1 ? "s" : ""} — ${result.strategy_name}`}
                actions={<ExportButtons path="/grids/export" filename="grilles" body={{ grids, name: saveName || "Grilles générées", params: { stratégie: strategy, graine: result.seed } }} />}>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                  <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Nom du portefeuille (facultatif)" />
                  <Button onClick={savePortfolio}><Save /> Sauvegarder le portefeuille</Button>
                </div>
                <GridList grids={grids}
                  onDelete={(g) => setGrids((gs) => gs.filter((x) => x.id !== g.id))}
                  onRegenerate={regenerate}
                  onSaved={(g) => setGrids((gs) => gs.map((x) => (x.id === g.id ? { ...x, saved: true } : x)))} />
              </Section>
              {m.similarity_matrix && m.similarity_matrix.length > 1 && (
                <Section title="Matrice de similarité entre grilles" description="(numéros communs + étoiles communes) / 7 pour chaque couple de grilles.">
                  <Heatmap matrix={m.similarity_matrix} valueLabel="Similarité" formatter={(v) => fmtNum(v, 2)} />
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
