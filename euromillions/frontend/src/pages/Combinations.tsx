import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { useState } from "react";
import { Heatmap, Lines, ObservedVsTheory } from "@/components/charts";
import { Ball, StarBall } from "@/components/GridBalls";
import {
  ExportButtons, FiltersBar, filtersQuery, KeyValue, Loading, Notice, PageHeader, PredictionWarning, RequireData, Section, TestResult,
} from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Query } from "@/lib/api";
import { fmtDate, fmtInt, fmtNum, fmtPct, fmtPValue } from "@/lib/format";
import type { FeatureDistribution, Filters } from "@/lib/types";

interface PairRow { a: number; b: number; count: number; expected: number; p_value: number; q_value_bh: number; significant_bh: boolean }
interface TripleRow { values: number[]; count: number; expected: number; p_value: number; q_value_bh: number; significant_bh: boolean }

function useStat<T>(path: string, q: Query) {
  return useQuery({ queryKey: [path, q], queryFn: () => api.get<T>(path, q) });
}

function Dist({ d, xLabel }: { d?: FeatureDistribution; xLabel?: string }) {
  if (!d) return <Loading />;
  const total = d.distribution.reduce((a, r) => a + r.observed, 0) || 1;
  return (
    <div className="space-y-3">
      <ObservedVsTheory data={d.distribution.map((r) => ({ value: r.value, observed_pct: r.observed_pct ?? r.observed / total, theoretical_pct: r.theoretical_pct }))} xLabel={xLabel} />
      <KeyValue items={[["Moyenne observée", fmtNum(d.observed_mean, 3)], ["Moyenne théorique", fmtNum(d.theoretical_mean, 3)], ["Écart-type observé", fmtNum(d.observed_sd, 3)], ["Écart-type théorique", fmtNum(d.theoretical_sd, 3)]]} />
      <TestResult test={d.test} />
    </div>
  );
}

function PairsTab({ q }: { q: Query }) {
  const pairs = useStat<{ most_frequent: PairRow[]; least_frequent: PairRow[]; expected: number; significant_count: number; multiple_testing: string; hypotheses: string }>("/statistics/pairs", { ...q, top: 15 });
  const triples = useStat<{ most_frequent: TripleRow[]; expected: number; never_seen: number; never_seen_expected: number; significant_count: number; multiple_testing: string }>("/statistics/triples", { ...q, top: 15 });
  const cooc = useStat<{ matrix: number[][]; expected_pair: number }>("/statistics/cooccurrence", q);
  const sp = useStat<{ items: (PairRow & { eligible_draws: number })[]; matrix: number[][]; hypotheses: string }>("/statistics/star-pairs", q);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Paires les plus fréquentes" description={pairs.data ? `Attendu par paire : ${fmtNum(pairs.data.expected, 2)} · ${pairs.data.significant_count} paire(s) significative(s) après correction.` : ""}
          actions={<ExportButtons path="/statistics/export" filename="paires" params={{ ...q, section: "pairs" }} formats={["csv", "xlsx"]} />}>
          {pairs.data && (
            <Table>
              <TableHeader><TableRow><TableHead>Paire</TableHead><TableHead className="text-right">Sorties</TableHead><TableHead className="text-right">p</TableHead><TableHead className="text-right">q (BH)</TableHead></TableRow></TableHeader>
              <TableBody>{pairs.data.most_frequent.map((p) => (
                <TableRow key={`${p.a}-${p.b}`}>
                  <TableCell><div className="flex gap-1"><Ball value={p.a} small /><Ball value={p.b} small /></div></TableCell>
                  <TableCell className="text-right">{p.count}</TableCell>
                  <TableCell className="text-right">{fmtPValue(p.p_value)}</TableCell>
                  <TableCell className="text-right">{fmtPValue(p.q_value_bh)} {p.significant_bh && <Badge variant="destructive">q&lt;0,05</Badge>}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          )}
          {pairs.data && <p className="mt-2 text-xs text-muted-foreground">{pairs.data.multiple_testing}</p>}
        </Section>
        <Section title="Triplets les plus fréquents" description={triples.data ? `Attendu par triplet : ${fmtNum(triples.data.expected, 3)} · jamais sortis : ${fmtInt(triples.data.never_seen)} (attendu ≈ ${fmtInt(Math.round(triples.data.never_seen_expected))}).` : ""}>
          {triples.data && (
            <Table>
              <TableHeader><TableRow><TableHead>Triplet</TableHead><TableHead className="text-right">Sorties</TableHead><TableHead className="text-right">q (BH)</TableHead></TableRow></TableHeader>
              <TableBody>{triples.data.most_frequent.map((t) => (
                <TableRow key={t.values.join("-")}>
                  <TableCell><div className="flex gap-1">{t.values.map((v) => <Ball key={v} value={v} small />)}</div></TableCell>
                  <TableCell className="text-right">{t.count}</TableCell>
                  <TableCell className="text-right">{fmtPValue(t.q_value_bh)} {t.significant_bh && <Badge variant="destructive">q&lt;0,05</Badge>}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          )}
          {triples.data && <p className="mt-2 text-xs text-muted-foreground">{triples.data.multiple_testing}</p>}
        </Section>
      </div>
      <Section title="Carte thermique des cooccurrences" description={cooc.data ? `Nombre de tirages où deux numéros sont sortis ensemble. Attendu par paire : ${fmtNum(cooc.data.expected_pair, 2)}.` : ""}>
        {cooc.data ? <Heatmap matrix={cooc.data.matrix} valueLabel="Cooccurrences" formatter={(v) => fmtInt(v)} /> : <Loading />}
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Associations d'étoiles" description={sp.data?.hypotheses}>
          {sp.data ? <Heatmap matrix={sp.data.matrix} valueLabel="Tirages" maxCell={30} formatter={(v) => fmtInt(v)} /> : <Loading />}
        </Section>
        <Section title="Paires d'étoiles les plus fréquentes">
          {sp.data && (
            <Table>
              <TableHeader><TableRow><TableHead>Paire</TableHead><TableHead className="text-right">Sorties</TableHead><TableHead className="text-right">Attendu</TableHead><TableHead className="text-right">q (BH)</TableHead></TableRow></TableHeader>
              <TableBody>{sp.data.items.slice(0, 10).map((p) => (
                <TableRow key={`${p.a}-${p.b}`}>
                  <TableCell><div className="flex gap-1"><StarBall value={p.a} small /><StarBall value={p.b} small /></div></TableCell>
                  <TableCell className="text-right">{p.count}</TableCell>
                  <TableCell className="text-right">{fmtNum(p.expected, 1)}</TableCell>
                  <TableCell className="text-right">{fmtPValue(p.q_value_bh)}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          )}
        </Section>
      </div>
      <PredictionWarning />
    </div>
  );
}

function StructureTab({ q }: { q: Query }) {
  const parity = useStat<FeatureDistribution & { description: string }>("/statistics/parity", q);
  const sums = useStat<FeatureDistribution & { binned: { label: string; observed: number; theoretical_pct: number }[]; description: string }>("/statistics/sums", q);
  const dec = useStat<{ buckets: { label: string; count: number; expected: number }[]; bucket_test: FeatureDistribution["test"]; distinct_decades: FeatureDistribution; max_per_decade: FeatureDistribution }>("/statistics/decades", q);
  const spacing = useStat<{ min_gap: FeatureDistribution; max_gap: FeatureDistribution; description: string }>("/statistics/spacing", q);
  const cons = useStat<FeatureDistribution & { description: string }>("/statistics/consecutive", q);
  const rep = useStat<{ numbers: FeatureDistribution | null; stars: FeatureDistribution | null }>("/statistics/repeats", q);
  const total = sums.data ? sums.data.binned.reduce((a, b) => a + b.observed, 0) : 0;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Parité" description={parity.data?.description}><Dist d={parity.data} xLabel="numéros pairs" /></Section>
      <Section title="Sommes" description={sums.data?.description}>
        {sums.data ? (
          <div className="space-y-3">
            <ObservedVsTheory data={sums.data.binned.map((b) => ({ value: b.label, observed_pct: total ? b.observed / total : 0, theoretical_pct: b.theoretical_pct }))} />
            <KeyValue items={[["Moyenne observée", fmtNum(sums.data.observed_mean, 2)], ["Moyenne théorique", fmtNum(sums.data.theoretical_mean, 2)]]} />
            <TestResult test={sums.data.test} />
          </div>
        ) : <Loading />}
      </Section>
      <Section title="Dizaines" description="Répartition des numéros dans 1–10, 11–20, 21–30, 31–40, 41–50.">
        {dec.data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-5 gap-2 text-center">
              {dec.data.buckets.map((b) => (
                <div key={b.label} className="rounded-lg border bg-background/40 p-2">
                  <div className="text-[11px] text-muted-foreground">{b.label}</div>
                  <div className="font-semibold num">{fmtInt(b.count)}</div>
                  <div className="text-[10px] text-muted-foreground num">att. {fmtInt(b.expected)}</div>
                </div>
              ))}
            </div>
            <TestResult test={dec.data.bucket_test} />
            <div className="text-sm font-medium">Nombre de dizaines distinctes par tirage</div>
            <Dist d={dec.data.distinct_decades} />
          </div>
        ) : <Loading />}
      </Section>
      <Section title="Écarts entre numéros triés" description={spacing.data?.description}>
        {spacing.data ? (
          <div className="space-y-3">
            <div className="text-sm font-medium">Plus petit écart</div>
            <Dist d={spacing.data.min_gap} />
          </div>
        ) : <Loading />}
      </Section>
      <Section title="Numéros consécutifs" description={cons.data?.description}><Dist d={cons.data} xLabel="paires consécutives" /></Section>
      <Section title="Répétitions entre tirages successifs" description="Nombre de numéros communs avec le tirage précédent (loi hypergéométrique sous H0).">
        {rep.data?.numbers ? <Dist d={rep.data.numbers} xLabel="numéros communs" /> : <Loading />}
      </Section>
    </div>
  );
}

function EntropyTab({ q }: { q: Query }) {
  const e = useStat<{
    normalized_entropy: number; entropy: number; max_entropy: number; gini: number; top10_share: number; top10_share_expected: number;
    simulation: { n_sim: number; seed: number; mean: number; p5: number; p95: number; p_value_low: number };
    rolling: { date: string; normalized_entropy: number }[]; rolling_window: number; hypotheses: string;
  }>("/statistics/entropy", q);
  if (!e.data) return <Loading />;
  const d = e.data;
  return (
    <div className="space-y-5">
      <Section title="Indicateurs de diversité et de concentration" description={d.hypotheses}>
        <KeyValue items={[
          ["Entropie normalisée", fmtNum(d.normalized_entropy, 5)],
          ["Entropie (nats)", `${fmtNum(d.entropy, 4)} / max ${fmtNum(d.max_entropy, 4)}`],
          ["Coefficient de Gini", fmtNum(d.gini, 4)],
          ["Part des 10 numéros les plus fréquents", `${fmtPct(d.top10_share, 2)} (attendu ${fmtPct(d.top10_share_expected, 0)})`],
          ["Entropie simulée sous H0 (moyenne)", fmtNum(d.simulation.mean, 4)],
          ["Intervalle 5 %–95 % sous H0", `${fmtNum(d.simulation.p5, 4)} – ${fmtNum(d.simulation.p95, 4)}`],
          ["p (entropie aussi basse)", fmtPValue(d.simulation.p_value_low)],
          ["Simulations / graine", `${d.simulation.n_sim} / ${d.simulation.seed}`],
        ]} />
      </Section>
      {d.rolling.length > 0 && (
        <Section title={`Entropie glissante (${d.rolling_window} tirages)`}>
          <Lines data={d.rolling} xKey="date" xFormatter={(v) => fmtDate(String(v))} series={[{ key: "normalized_entropy", label: "Entropie normalisée" }]} yFormatter={(v) => fmtNum(v, 4)} yDomain={["auto", "auto"]} />
        </Section>
      )}
    </div>
  );
}

function Content() {
  const [f, setF] = useState<Filters>({});
  const q = filtersQuery(f);
  return (
    <div className="space-y-5">
      <FiltersBar value={f} onChange={setF} />
      <Notice>Toutes les comparaisons se font avec des distributions théoriques <strong>exactes</strong> (énumération des 2 118 760 combinaisons de numéros) ou simulées avec graine enregistrée.</Notice>
      <Tabs defaultValue="pairs">
        <TabsList>
          <TabsTrigger value="pairs">Paires & triplets</TabsTrigger>
          <TabsTrigger value="structure">Structure des tirages</TabsTrigger>
          <TabsTrigger value="entropy">Entropie</TabsTrigger>
        </TabsList>
        <TabsContent value="pairs"><PairsTab q={q} /></TabsContent>
        <TabsContent value="structure"><StructureTab q={q} /></TabsContent>
        <TabsContent value="entropy"><EntropyTab q={q} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function Combinations() {
  return (
    <>
      <PageHeader title="Analyse des combinaisons" subtitle="Paires, triplets, cooccurrences, parité, sommes, dizaines, écarts, consécutifs, répétitions et entropie." icon={<Network />} />
      <RequireData><Content /></RequireData>
    </>
  );
}
