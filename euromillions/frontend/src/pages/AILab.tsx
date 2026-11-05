import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Play } from "lucide-react";
import { useState } from "react";
import { Field, JobProgress, Notice, NumberInput, PageHeader, RequireData, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNum, fmtPct, fmtPValue } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { JobStart } from "@/lib/types";

const MODELS: Record<string, string> = {
  logistic: "Régression logistique",
  random_forest: "Forêt aléatoire",
  gradient_boosting: "Gradient boosting",
  mlp: "Réseau de neurones",
  ewma: "Moyenne mobile exponentielle",
  hot: "Règle « chauds »",
  overdue: "Règle « en retard »",
  random: "Hasard (référence)",
};

interface MLResultRow {
  model: string; label: string; status: string; error?: string; m1_mean_hits: number; m1_ci95: [number, number]; m1_p_value_one_sided: number;
  m1_p_bonferroni?: number; m3_auc: number; m3_ci95: [number, number]; m2_logloss_delta: number | null; m2_ci95: [number, number] | null;
  beats_random?: boolean; elapsed_s: number;
}
interface MLResult {
  seed: number; protocol: { target: string; features: string[]; train_draws: number; test_draws: number; train_period: [string, string]; test_period: [string, string]; metrics: Record<string, string>; success_criterion: string; bootstrap: number };
  results: MLResultRow[]; any_model_beats_random: boolean; conclusion: string; elapsed_s: number;
}

function Content() {
  const qc = useQueryClient();
  const [models, setModels] = useState(Object.keys(MODELS));
  const [ratio, setRatio] = useState(0.7);
  const [seed, setSeed] = useState<number | null>(42);
  const [boot, setBoot] = useState(500);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [res, setRes] = useState<MLResult | null>(null);
  const exps = useQuery({ queryKey: ["ml-exps"], queryFn: () => api.get<{ id: number; seed: number; created_at: string; summary: { any_model_beats_random: boolean; conclusion: string } }[]>("/ml/experiments") });
  const job = useJob<MLResult>((r) => { setRes(r); qc.invalidateQueries({ queryKey: ["ml-exps"] }); });
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-5">
        <Section title="Protocole (fixé avant l'expérience)">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(MODELS).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={models.includes(k)} disabled={k === "random"} onCheckedChange={(c) => setModels((m) => (c ? [...m, k] : m.filter((x) => x !== k)))} /> {v}
                </label>
              ))}
            </div>
            <Field label={`Part d'entraînement (chronologique) : ${fmtPct(ratio, 0)}`}><Slider value={[ratio]} min={0.3} max={0.9} step={0.05} onValueChange={([v]) => setRatio(v)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Graine"><NumberInput allowEmpty value={seed} min={0} onChange={setSeed} /></Field>
              <Field label="Bootstrap"><NumberInput value={boot} min={100} max={5000} onChange={(v) => setBoot(v ?? 500)} /></Field>
              <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Button className="w-full" onClick={() => job.start(() => api.post<JobStart>("/ml/run", { models, train_ratio: ratio, seed, n_bootstrap: boot, date_from: from || null, date_to: to || null }))} disabled={job.running}>
              <Play /> Lancer l'expérience
            </Button>
          </div>
        </Section>
        <Section title="Expériences enregistrées">
          <ul className="space-y-1.5 text-xs">
            {exps.data?.map((e) => (
              <li key={e.id} className="rounded-lg border p-2">
                #{e.id} · {fmtDateTime(e.created_at)} · graine {e.seed}{" "}
                {e.summary.any_model_beats_random ? <Badge variant="gold">écart à confirmer</Badge> : <Badge variant="secondary">aucun avantage</Badge>}
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <div className="space-y-5">
        <Notice variant="warning" title="Exigences méthodologiques">
          Séparation chronologique, aucune fuite de données futures, métriques définies à l'avance, comparaison à une référence aléatoire,
          intervalles de confiance, graine enregistrée, et publication de <strong>tous</strong> les résultats — y compris les échecs.
          Le machine learning n'est jamais présenté comme capable de prédire un tirage indépendant sans preuve robuste.
        </Notice>
        <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
        {res && (
          <>
            <Notice variant={res.any_model_beats_random ? "warning" : "success"} title="Conclusion">{res.conclusion}</Notice>
            <Section title="Résultats hors échantillon" description={`Entraînement : ${fmtDate(res.protocol.train_period[0])} → ${fmtDate(res.protocol.train_period[1])} (${res.protocol.train_draws} tirages) · Test : ${fmtDate(res.protocol.test_period[0])} → ${fmtDate(res.protocol.test_period[1])} (${res.protocol.test_draws} tirages) · graine ${res.seed}`}>
              <Table>
                <TableHeader><TableRow><TableHead>Modèle</TableHead><TableHead className="text-right">M1 bons n°</TableHead><TableHead className="text-right">IC 95 %</TableHead><TableHead className="text-right">p (Bonf.)</TableHead><TableHead className="text-right">M3 AUC</TableHead><TableHead className="text-right">IC 95 %</TableHead><TableHead className="text-right">M2 Δ log-loss</TableHead><TableHead>Verdict</TableHead></TableRow></TableHeader>
                <TableBody>
                  {res.results.map((r) => r.status !== "ok" ? (
                    <TableRow key={r.model}><TableCell>{r.label}</TableCell><TableCell colSpan={7} className="text-xs text-red-300">Échec publié : {r.error}</TableCell></TableRow>
                  ) : (
                    <TableRow key={r.model}>
                      <TableCell>{r.label}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.m1_mean_hits, 3)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtNum(r.m1_ci95[0], 3)} – {fmtNum(r.m1_ci95[1], 3)}</TableCell>
                      <TableCell className="text-right">{r.model === "random" ? "—" : fmtPValue(r.m1_p_bonferroni)}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.m3_auc, 3)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtNum(r.m3_ci95[0], 3)} – {fmtNum(r.m3_ci95[1], 3)}</TableCell>
                      <TableCell className="text-right">{r.m2_logloss_delta === null ? "—" : fmtNum(r.m2_logloss_delta, 5)}</TableCell>
                      <TableCell>{r.model === "random" ? <Badge variant="outline">référence</Badge> : r.beats_random ? <Badge variant="gold">écart à confirmer</Badge> : <Badge variant="secondary">pas mieux que le hasard</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <p><strong>Cible :</strong> {res.protocol.target}</p>
                {Object.entries(res.protocol.metrics).map(([k, v]) => <p key={k}><strong>{k} :</strong> {v}</p>)}
                <p><strong>Critère de succès :</strong> {res.protocol.success_criterion}</p>
                <p><strong>Variables :</strong> {res.protocol.features.join(", ")}.</p>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

export default function AILab() {
  return (
    <>
      <PageHeader title="Laboratoire IA" subtitle="Expériences de machine learning évaluées hors échantillon contre un générateur aléatoire uniforme." icon={<Brain />} />
      <RequireData><Content /></RequireData>
    </>
  );
}
