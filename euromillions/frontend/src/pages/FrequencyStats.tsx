import { useQuery } from "@tanstack/react-query";
import { BarChart3, Flame, Snowflake, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { FrequencyBars, Histogram, Lines } from "@/components/charts";
import { Ball, StarBall } from "@/components/GridBalls";
import {
  ErrorBox, ExportButtons, FiltersBar, filtersQuery, Loading, Notice, PageHeader, PredictionWarning, RequireData, Section, TestResult,
} from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtDate, fmtNum, fmtPct, fmtPValue } from "@/lib/format";
import type { Filters, FrequencyItem, Frequencies } from "@/lib/types";

type Kind = "numbers" | "stars";
type SortKey = "value" | "count" | "deviation" | "rank" | "current_gap" | "q_value_bh";

interface GapsData {
  items: { value: number; appearances: number; current_gap: number | null; mean_interval: number | null; max_interval: number | null; max_gap_including_current: number; eligible_draws: number }[];
  theoretical_mean_interval: number;
  interval_distribution: { interval: number; label: string; observed: number; observed_pct: number; theoretical_pct: number }[];
  assumptions: string;
  warning: string;
}

interface HotCold { window: number; hot: FrequencyItem[]; cold: FrequencyItem[]; warning: string }

function FreqTable({ items, kind }: { items: FrequencyItem[]; kind: Kind }) {
  const [sort, setSort] = useState<SortKey>("value");
  const [asc, setAsc] = useState(true);
  const rows = useMemo(() => {
    const r = [...items];
    r.sort((a, b) => {
      const va = (a[sort] ?? -1) as number, vb = (b[sort] ?? -1) as number;
      return asc ? va - vb : vb - va;
    });
    return r;
  }, [items, sort, asc]);
  const H = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <TableHead className={`cursor-pointer select-none ${right ? "text-right" : ""}`} onClick={() => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(k === "value" || k === "rank"); } }}>
      {children}{sort === k ? (asc ? " ▲" : " ▼") : ""}
    </TableHead>
  );
  return (
    <div className="max-h-[560px] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <H k="value">{kind === "numbers" ? "Numéro" : "Étoile"}</H>
            <H k="count" right>Sorties</H>
            <TableHead className="text-right">Fréq.</TableHead>
            <TableHead className="text-right">Attendu</TableHead>
            <H k="deviation" right>Écart</H>
            <TableHead className="text-right">z</TableHead>
            <H k="q_value_bh" right>q (BH)</H>
            <H k="rank" right>Rang</H>
            <TableHead className="text-right">Rang 20</TableHead>
            <TableHead className="text-right">Rang 50</TableHead>
            <TableHead className="text-right">Rang 100</TableHead>
            <TableHead className="text-right">Rang 500</TableHead>
            <H k="current_gap" right>Retard</H>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((i) => (
            <TableRow key={i.value}>
              <TableCell>{kind === "numbers" ? <Ball value={i.value} small /> : <StarBall value={i.value} small />}</TableCell>
              <TableCell className="text-right">{i.count}</TableCell>
              <TableCell className="text-right">{fmtPct(i.frequency, 2)}</TableCell>
              <TableCell className="text-right">{fmtNum(i.expected, 1)}</TableCell>
              <TableCell className="text-right">{i.deviation > 0 ? "+" : ""}{fmtNum(i.deviation, 1)}</TableCell>
              <TableCell className="text-right">{fmtNum(i.z_score, 2)}</TableCell>
              <TableCell className="text-right">{fmtPValue(i.q_value_bh)} {i.significant_bh && <Badge variant="destructive" className="ml-1">q&lt;0,05</Badge>}</TableCell>
              <TableCell className="text-right">{i.rank}</TableCell>
              {["20", "50", "100", "500"].map((w) => <TableCell key={w} className="text-right text-muted-foreground">{i.window_ranks[w] ?? "—"}</TableCell>)}
              <TableCell className="text-right">{i.current_gap ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HotColdBlock({ kind, q }: { kind: Kind; q: Record<string, unknown> }) {
  const [win, setWin] = useState("50");
  const hc = useQuery({ queryKey: ["hotcold", kind, win, q], queryFn: () => api.get<HotCold>("/statistics/hot-cold", { ...(q as object), kind, window: win, top: kind === "numbers" ? 10 : 4 }) });
  const B = kind === "numbers" ? Ball : StarBall;
  return (
    <Section title="Numéros chauds et froids" description="Classements descriptifs sur la fenêtre choisie."
      actions={
        <Select value={win} onValueChange={setWin}>
          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{["20", "50", "100", "500"].map((w) => <SelectItem key={w} value={w}>{w} derniers tirages</SelectItem>)}</SelectContent>
        </Select>
      }>
      {hc.data && (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Flame className="size-4 text-orange-400" /> Les plus fréquents</div>
            <div className="flex flex-wrap gap-2">{hc.data.hot.map((i) => <div key={i.value} className="flex flex-col items-center gap-1"><B value={i.value} /><span className="text-[11px] text-muted-foreground num">{i.count}×</span></div>)}</div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Snowflake className="size-4 text-sky-300" /> Les moins fréquents</div>
            <div className="flex flex-wrap gap-2">{hc.data.cold.map((i) => <div key={i.value} className="flex flex-col items-center gap-1"><B value={i.value} /><span className="text-[11px] text-muted-foreground num">{i.count}×</span></div>)}</div>
          </div>
          <PredictionWarning text={hc.data.warning} />
        </div>
      )}
    </Section>
  );
}

function HistoryCurve({ kind, q }: { kind: Kind; q: Record<string, unknown> }) {
  const [values, setValues] = useState(kind === "numbers" ? "7 23 44" : "2 11");
  const parsed = values.split(/[\s,;]+/).map(Number).filter((n) => n >= 1 && n <= (kind === "numbers" ? 50 : 12)).slice(0, 5);
  const h = useQuery({
    queryKey: ["history-curve", kind, parsed.join(","), q],
    queryFn: () => api.get<{ points: Record<string, number | string>[]; note: string }>("/statistics/history", { ...(q as object), kind, values: parsed.join(",") }),
    enabled: parsed.length > 0,
  });
  return (
    <Section title="Courbes historiques" description="Apparitions cumulées au fil des tirages (jusqu'à 5 valeurs) et cumul attendu sous H0."
      actions={<Input className="h-8 w-40" value={values} onChange={(e) => setValues(e.target.value)} aria-label="Valeurs suivies" />}>
      {h.data && (
        <Lines data={h.data.points} xKey="date" xFormatter={(v) => fmtDate(String(v))}
          series={[...parsed.map((v) => ({ key: String(v), label: `${kind === "numbers" ? "Numéro" : "Étoile"} ${v}` })), { key: "expected", label: "Attendu (par valeur)", neutral: true, dashed: true }]} />
      )}
      {h.data && <p className="mt-2 text-xs text-muted-foreground">{h.data.note}</p>}
    </Section>
  );
}

function Content({ kind }: { kind: Kind }) {
  const [f, setF] = useState<Filters>({});
  const q = filtersQuery(f);
  const freq = useQuery({ queryKey: ["freq", kind, q], queryFn: () => api.get<Frequencies>(`/statistics/${kind}`, q) });
  const gaps = useQuery({ queryKey: ["gaps", kind, q], queryFn: () => api.get<GapsData>("/statistics/gaps", { ...q, kind }) });
  if (freq.isLoading) return <Loading />;
  if (freq.error) return <ErrorBox error={freq.error} />;
  const d = freq.data!;
  const items = kind === "stars" ? d.items.filter((i) => (i.eligible_draws ?? 1) > 0) : d.items;
  return (
    <div className="space-y-5">
      <FiltersBar value={f} onChange={setF} />
      {kind === "stars" && d.exposure_note && <Notice>{d.exposure_note}</Notice>}
      <Tabs defaultValue="freq">
        <TabsList>
          <TabsTrigger value="freq">Fréquences</TabsTrigger>
          <TabsTrigger value="hot">Chauds / froids</TabsTrigger>
          <TabsTrigger value="gaps">Retards</TabsTrigger>
          <TabsTrigger value="curves">Courbes</TabsTrigger>
        </TabsList>
        <TabsContent value="freq" className="space-y-5">
          <Section title="Histogramme des fréquences" description={`${d.draws} tirages · ligne de référence : effectif attendu sous l'hypothèse de tirages équitables.`}
            actions={<ExportButtons path="/statistics/export" filename={`frequences_${kind}`} params={{ ...q, section: kind }} />}>
            <FrequencyBars data={items.map((i) => ({ value: i.value, count: i.count }))} expected={kind === "numbers" ? items[0]?.expected : undefined} />
            <div className="mt-3"><TestResult test={d.uniformity_test} /></div>
          </Section>
          <Section title="Tableau détaillé" description={d.multiple_testing ?? "p-valeurs de Poisson-binomiale exactes ; correction de Benjamini-Hochberg."}>
            <FreqTable items={items} kind={kind} />
          </Section>
          <PredictionWarning text={d.warning} />
        </TabsContent>
        <TabsContent value="hot"><HotColdBlock kind={kind} q={q} /></TabsContent>
        <TabsContent value="gaps" className="space-y-5">
          {gaps.data && (
            <>
              <Section title="Distribution des intervalles d'apparition" description={gaps.data.assumptions}>
                <Histogram data={gaps.data.interval_distribution.map((r) => ({ label: r.label, "Observé": r.observed_pct, "Théorique": r.theoretical_pct }))}
                  xKey="label" yKey="Observé" yLabel="Part observée" />
                <p className="mt-2 text-xs text-muted-foreground">Intervalle moyen théorique : {fmtNum(gaps.data.theoretical_mean_interval, 1)} tirages.</p>
              </Section>
              <Section title="Retards par valeur">
                <div className="max-h-[480px] overflow-y-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Valeur</TableHead><TableHead className="text-right">Retard actuel</TableHead><TableHead className="text-right">Intervalle moyen</TableHead><TableHead className="text-right">Intervalle max</TableHead><TableHead className="text-right">Sorties</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {[...gaps.data.items].sort((a, b) => (b.current_gap ?? 0) - (a.current_gap ?? 0)).filter((i) => i.eligible_draws > 0).map((i) => (
                        <TableRow key={i.value}>
                          <TableCell>{kind === "numbers" ? <Ball value={i.value} small /> : <StarBall value={i.value} small />}</TableCell>
                          <TableCell className="text-right">{i.current_gap ?? "jamais sorti"}</TableCell>
                          <TableCell className="text-right">{fmtNum(i.mean_interval, 1)}</TableCell>
                          <TableCell className="text-right">{i.max_interval ?? "—"}</TableCell>
                          <TableCell className="text-right">{i.appearances}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Section>
              <Notice variant="warning" title="Le retard ne rend pas un numéro « dû »">{gaps.data.warning}</Notice>
            </>
          )}
        </TabsContent>
        <TabsContent value="curves"><HistoryCurve kind={kind} q={q} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function FrequencyStats({ kind }: { kind: Kind }) {
  return (
    <>
      <PageHeader
        key={kind}
        title={kind === "numbers" ? "Statistiques des numéros" : "Statistiques des étoiles"}
        subtitle={kind === "numbers" ? "Fréquences, écarts à la théorie, classements par fenêtre, retards et courbes cumulées des 50 numéros."
          : "Analyse des étoiles avec prise en compte des changements de règles (9, 11 puis 12 étoiles)."}
        icon={kind === "numbers" ? <BarChart3 /> : <Star />}
      />
      <RequireData><Content key={kind} kind={kind} /></RequireData>
    </>
  );
}
