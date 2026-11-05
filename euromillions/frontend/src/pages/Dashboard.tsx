import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Hash, LayoutDashboard, Sigma, Star } from "lucide-react";
import { useState } from "react";
import { FrequencyBars, ObservedVsTheory } from "@/components/charts";
import { GridBalls } from "@/components/GridBalls";
import {
  ErrorBox, FiltersBar, filtersQuery, Loading, PageHeader, PredictionWarning, RequireData, Section, StatCard,
} from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDate, fmtInt, fmtNum, fmtPValue } from "@/lib/format";
import type { FeatureDistribution, Filters, Frequencies } from "@/lib/types";

interface Overview {
  draws: number;
  first_date: string;
  last_date: string;
  last_draw: { date: string; numbers: number[]; stars: number[] };
  eras: { code: string; label: string; draws: number }[];
  most_drawn_number: number;
  least_drawn_number: number;
  mean_sum: number;
  theoretical_mean_sum: number;
  tests: { tests: { code: string; name: string; statistic: number | null; df: number; p_value: number | null; q_value_bh: number; p_bonferroni: number; reject_h0_5pct_bh: boolean }[]; interpretation: string } | null;
}

function Content() {
  const [f, setF] = useState<Filters>({});
  const q = filtersQuery(f);
  const ov = useQuery({ queryKey: ["overview", q], queryFn: () => api.get<Overview>("/statistics", q) });
  const nums = useQuery({ queryKey: ["freq-numbers", q], queryFn: () => api.get<Frequencies>("/statistics/numbers", q) });
  const sums = useQuery({ queryKey: ["sums", q], queryFn: () => api.get<FeatureDistribution & { binned: { label: string; observed: number; theoretical_pct: number }[] }>("/statistics/sums", q) });
  const parity = useQuery({ queryKey: ["parity", q], queryFn: () => api.get<FeatureDistribution>("/statistics/parity", q) });
  if (ov.isLoading) return <Loading />;
  if (ov.error) return <ErrorBox error={ov.error} />;
  const o = ov.data!;
  if (!o.draws) return <><FiltersBar value={f} onChange={setF} /><p className="text-sm text-muted-foreground">Aucun tirage sur cette période.</p></>;
  const total = sums.data ? sums.data.binned.reduce((a, b) => a + b.observed, 0) : 0;
  return (
    <div className="space-y-5">
      <FiltersBar value={f} onChange={setF} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tirages analysés" value={fmtInt(o.draws)} hint={`${fmtDate(o.first_date)} → ${fmtDate(o.last_date)}`} icon={<CalendarDays />} />
        <StatCard label="Numéro le plus sorti" value={o.most_drawn_number} hint="descriptif, sans valeur prédictive" icon={<Hash />} />
        <StatCard label="Somme moyenne" value={fmtNum(o.mean_sum, 1)} hint={`théorique : ${fmtNum(o.theoretical_mean_sum, 1)}`} icon={<Sigma />} />
        <StatCard label="Époques couvertes" value={o.eras.length} hint={o.eras.map((e) => `${e.code} (${e.draws})`).join(" · ")} icon={<Star />} accent="gold" />
      </div>
      <Section title="Dernier tirage de la période" description={fmtDate(o.last_draw.date)}>
        <GridBalls numbers={o.last_draw.numbers} stars={o.last_draw.stars} />
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Apparitions de chaque numéro" description="Barres : effectif observé · ligne : effectif attendu sous l'hypothèse de tirages équitables.">
          {nums.data && <FrequencyBars data={nums.data.items.map((i) => ({ value: i.value, count: i.count }))} expected={nums.data.items[0]?.expected} />}
        </Section>
        <Section title="Distribution des sommes" description={`Somme des 5 numéros (classes de 10), comparée à la distribution exacte. ${sums.data ? `Moyenne observée ${fmtNum(sums.data.observed_mean, 1)} / théorique ${fmtNum(sums.data.theoretical_mean, 1)}.` : ""}`}>
          {sums.data && (
            <ObservedVsTheory data={sums.data.binned.map((b) => ({ value: b.label, observed_pct: total ? b.observed / total : 0, theoretical_pct: b.theoretical_pct }))} />
          )}
        </Section>
        <Section title="Nombre de numéros pairs" description="Distribution observée contre loi hypergéométrique exacte.">
          {parity.data && <ObservedVsTheory data={parity.data.distribution.map((d) => ({ value: d.value, observed_pct: d.observed_pct ?? 0, theoretical_pct: d.theoretical_pct }))} />}
        </Section>
        <Section title="Tests globaux" description="p-valeurs corrigées pour comparaisons multiples (Benjamini-Hochberg et Bonferroni).">
          {o.tests && (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Test</TableHead><TableHead className="text-right">p</TableHead><TableHead className="text-right">q (BH)</TableHead><TableHead>H0</TableHead></TableRow></TableHeader>
                <TableBody>
                  {o.tests.tests.map((t) => (
                    <TableRow key={t.code}>
                      <TableCell className="text-xs">{t.name}</TableCell>
                      <TableCell className="text-right num">{fmtPValue(t.p_value)}</TableCell>
                      <TableCell className="text-right num">{fmtPValue(t.q_value_bh)}</TableCell>
                      <TableCell>{t.reject_h0_5pct_bh ? <Badge variant="destructive">rejetée</Badge> : <Badge variant="success">compatible</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">{o.tests.interpretation}</p>
            </>
          )}
        </Section>
      </div>
      <PredictionWarning />
    </div>
  );
}

export default function Dashboard() {
  return (
    <>
      <PageHeader title="Tableau de bord" subtitle="Vue synthétique de l'historique importé et des principaux tests de conformité." icon={<LayoutDashboard />} />
      <RequireData><Content /></RequireData>
    </>
  );
}
