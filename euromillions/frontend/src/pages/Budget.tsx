import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Euro, Ticket, Wallet } from "lucide-react";
import { useState } from "react";
import { Lines } from "@/components/charts";
import { ErrorBox, Field, KeyValue, Loading, Notice, NumberInput, PageHeader, PortfolioPicker, ProbabilityBox, Section, StatCard } from "@/components/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtCompactEuro, fmtEuro, fmtInt, fmtNum, fmtPct, oneIn } from "@/lib/format";
import type { Prob } from "@/lib/types";

interface BudgetResult {
  n_grids: number; n_grids_basis: string; ticket_price: number; cost_per_draw: number; draws: number; total_cost: number; annual_cost: number; monthly_cost: number;
  p_jackpot_per_draw: Prob; p_jackpot_horizon: number; years_for_50pct_jackpot: number | null;
  secondary: { expected_wins_per_draw: number; expected_wins_horizon: number; p_any_win_per_draw?: number; p_any_win_horizon?: number; p_any_win_per_draw_bounds?: [number, number]; p_any_win_horizon_bounds?: [number, number]; method: string };
  scenarios: { n_grids: number; cost_per_draw: number; total_cost: number; annual_cost: number; p_jackpot_horizon: number; years_for_50pct: number | null }[];
  curve: { n_grids: number; total_cost: number; p_jackpot_horizon: number }[];
  hypotheses: string[]; warning: string; expected_loss?: number; price_source?: string; portfolio_note?: string;
}

type Mode = "grids" | "draw" | "week" | "month" | "portfolio";

export default function Budget() {
  const [mode, setMode] = useState<Mode>("week");
  const [amount, setAmount] = useState<number | null>(10);
  const [grids, setGrids] = useState<number | null>(2);
  const [pid, setPid] = useState<number | null>(null);
  const [weeks, setWeeks] = useState<number | null>(52);
  const [dpw, setDpw] = useState("2");
  const [price, setPrice] = useState<number | null>(null);
  const [ret, setRet] = useState<number | null>(null);
  const params = {
    n_grids: mode === "grids" ? grids : undefined,
    budget_per_draw: mode === "draw" ? amount : undefined,
    budget_weekly: mode === "week" ? amount : undefined,
    budget_monthly: mode === "month" ? amount : undefined,
    portfolio_id: mode === "portfolio" ? pid : undefined,
    duration_weeks: weeks ?? 52,
    draws_per_week: dpw,
    ticket_price: price ?? undefined,
    assumed_return_rate: ret !== null ? ret / 100 : undefined,
  };
  const enabled = mode !== "portfolio" || pid !== null;
  const q = useQuery({ queryKey: ["budget", params], queryFn: () => api.get<BudgetResult>("/budget/probabilities", params), enabled });
  const r = q.data;
  return (
    <>
      <PageHeader title="Gestion du budget" subtitle="Coût, grilles finançables et probabilités sur la durée. Acheter plus de grilles n'est jamais une stratégie d'investissement." icon={<Wallet />} />
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Section title="Votre budget">
          <div className="space-y-3">
            <Field label="Je raisonne en">
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grids">Nombre de grilles par tirage</SelectItem>
                  <SelectItem value="draw">Budget par tirage</SelectItem>
                  <SelectItem value="week">Budget hebdomadaire</SelectItem>
                  <SelectItem value="month">Budget mensuel</SelectItem>
                  <SelectItem value="portfolio">Portefeuille enregistré (calcul exact)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {mode === "grids" && <Field label="Grilles par tirage"><NumberInput value={grids} min={0} onChange={setGrids} /></Field>}
            {["draw", "week", "month"].includes(mode) && <Field label="Montant (€)"><NumberInput value={amount} min={0} onChange={setAmount} /></Field>}
            {mode === "portfolio" && <Field label="Portefeuille"><PortfolioPicker value={pid} onChange={setPid} /></Field>}
            <Field label="Durée de participation (semaines)"><NumberInput value={weeks} min={1} max={4160} onChange={setWeeks} /></Field>
            <Field label="Tirages par semaine">
              <Select value={dpw} onValueChange={setDpw}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1 (mardi ou vendredi)</SelectItem><SelectItem value="2">2 (mardi et vendredi)</SelectItem></SelectContent></Select>
            </Field>
            <Field label="Prix d'une grille (€)" hint={r?.price_source}><NumberInput allowEmpty value={price} min={0.1} step={0.1} placeholder={r ? String(r.ticket_price) : "2.5"} onChange={setPrice} /></Field>
            <Field label="Taux de retour moyen supposé (%)" hint="Facultatif : part moyenne des mises redistribuée, à vérifier dans le règlement en vigueur."><NumberInput allowEmpty value={ret} min={0} max={100} onChange={setRet} /></Field>
          </div>
        </Section>
        <div className="space-y-5">
          <Notice variant="warning" title="Risque de perte">{r?.warning ?? "Les jeux d'argent comportent un risque de perte."}</Notice>
          {q.isLoading && enabled && <Loading />}
          <ErrorBox error={q.error} />
          {r?.portfolio_note && <Notice>{r.portfolio_note}</Notice>}
          {r && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Grilles finançables / tirage" value={fmtInt(r.n_grids)} hint={r.n_grids_basis} icon={<Ticket />} />
                <StatCard label="Coût total" value={fmtEuro(r.total_cost, 0)} hint={`${fmtInt(r.draws)} tirages`} icon={<Euro />} />
                <StatCard label="Dépense annuelle estimée" value={fmtEuro(r.annual_cost, 0)} hint={`${fmtEuro(r.monthly_cost, 0)} / mois`} icon={<CalendarClock />} />
                <StatCard label="P(jackpot) sur la durée" value={fmtPct(r.p_jackpot_horizon, 5)} hint={oneIn(r.p_jackpot_horizon)} accent="gold" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ProbabilityBox p={r.p_jackpot_per_draw} label="Probabilité de jackpot par tirage" />
                <Section title="Gains secondaires" description={r.secondary.method}>
                  <KeyValue items={[
                    ["Gains espérés par tirage", fmtNum(r.secondary.expected_wins_per_draw, 3)],
                    ["Gains espérés sur la durée", fmtNum(r.secondary.expected_wins_horizon, 1)],
                    ...(r.secondary.p_any_win_per_draw !== undefined
                      ? [["P(≥ 1 gain) par tirage (exact)", fmtPct(r.secondary.p_any_win_per_draw, 2)] as [string, string]]
                      : r.secondary.p_any_win_per_draw_bounds ? [["P(≥ 1 gain) par tirage", `${fmtPct(r.secondary.p_any_win_per_draw_bounds[0], 2)} à ${fmtPct(r.secondary.p_any_win_per_draw_bounds[1], 2)}`] as [string, string]] : []),
                    ...(r.expected_loss !== undefined ? [["Perte espérée (hypothèse de retour)", fmtEuro(r.expected_loss, 0)] as [string, string]] : []),
                    ["Années pour 50 % de chance de jackpot", r.years_for_50pct_jackpot ? fmtInt(r.years_for_50pct_jackpot) : "—"],
                  ]} />
                </Section>
              </div>
              <Section title="Courbe coût / probabilité" description={`Probabilité de jackpot sur ${weeks} semaines en fonction du coût total (de 1 à 10 000 grilles par tirage).`}>
                <Lines data={r.curve} xKey="total_cost" xFormatter={(v) => fmtCompactEuro(Number(v))} series={[{ key: "p_jackpot_horizon", label: "P(jackpot) sur la durée" }]} yFormatter={(v) => fmtPct(v, 3)} />
              </Section>
              <Section title="Scénarios">
                <Table>
                  <TableHeader><TableRow><TableHead className="text-right">Grilles / tirage</TableHead><TableHead className="text-right">Coût / tirage</TableHead><TableHead className="text-right">Coût sur la durée</TableHead><TableHead className="text-right">Coût annuel</TableHead><TableHead className="text-right">P(jackpot) durée</TableHead><TableHead className="text-right">Années pour 50 %</TableHead></TableRow></TableHeader>
                  <TableBody>{r.scenarios.map((s) => (
                    <TableRow key={s.n_grids}>
                      <TableCell className="text-right">{fmtInt(s.n_grids)}</TableCell>
                      <TableCell className="text-right">{fmtEuro(s.cost_per_draw)}</TableCell>
                      <TableCell className="text-right">{fmtEuro(s.total_cost, 0)}</TableCell>
                      <TableCell className="text-right">{fmtEuro(s.annual_cost, 0)}</TableCell>
                      <TableCell className="text-right">{fmtPct(s.p_jackpot_horizon, 4)}</TableCell>
                      <TableCell className="text-right">{s.years_for_50pct ? fmtInt(s.years_for_50pct) : "—"}</TableCell>
                    </TableRow>))}</TableBody>
                </Table>
              </Section>
              <Section title="Hypothèses"><ul className="space-y-1 text-sm text-muted-foreground">{r.hypotheses.map((h) => <li key={h}>• {h}</li>)}</ul></Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
