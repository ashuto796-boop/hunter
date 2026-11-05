import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, Coins } from "lucide-react";
import { useEffect, useState } from "react";
import { Lines } from "@/components/charts";
import { ErrorBox, Field, KeyValue, Notice, NumberInput, PageHeader, ProbabilityBox, Section, StatCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtCompactEuro, fmtEuro, fmtNum, fmtPct, fmtSci } from "@/lib/format";
import type { Prob } from "@/lib/types";

interface JackpotResult {
  p_jackpot: Prob; gross_if_sole_winner: number; lambda: number; lambda_basis: string; p_no_other_winner: number; expected_share_if_win: number;
  share_factor: number; cost: number; ev_jackpot: number; ev_secondary: number; ev_total: number; ev_net: number; return_per_euro: number;
  break_even_jackpot: number | null; secondary: { rank: number; label: string; assumed_payout: number | null; probability: number; expected_value: number | null }[];
  sensitivity: { lambda: number; share_factor: number; values: { jackpot: number; ev_net: number; return_per_euro: number }[] }[];
  hypotheses: string[]; warning: string;
}

export default function Jackpot() {
  const [jackpot, setJackpot] = useState<number | null>(130_000_000);
  const [n, setN] = useState<number | null>(1);
  const [otherTickets, setOtherTickets] = useState<number | null>(null);
  const [lambda, setLambda] = useState<number | null>(null);
  const [mult, setMult] = useState<number | null>(1);
  const [useHist, setUseHist] = useState(false);
  const [payouts, setPayouts] = useState<Record<number, number | null>>({});
  const hist = useQuery({ queryKey: ["hist-payouts"], queryFn: () => api.get<{ available: boolean; details: { rank: number; mean_prize: number; observations: number }[]; note: string }>("/jackpot/historical-payouts") });
  const m = useMutation({
    mutationFn: () => api.post<JackpotResult>("/jackpot/analysis", {
      jackpot: jackpot ?? 130_000_000, n_grids: n ?? 1, other_tickets: otherTickets, expected_other_winners: lambda,
      popularity_multiplier: mult ?? 1, use_historical_payouts: useHist,
      secondary_payouts: Object.fromEntries(Object.entries(payouts).filter(([, v]) => v !== null && v !== undefined)),
    }),
  });
  useEffect(() => { m.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = m.data;
  const sens = r ? r.sensitivity[0].values.map((v, i) => ({ jackpot: v.jackpot, ...Object.fromEntries(r.sensitivity.map((s) => [`l${s.lambda}`, s.values[i].return_per_euro])) })) : [];
  return (
    <>
      <PageHeader title="Analyse du jackpot" subtitle="Espérance de gain sous hypothèses explicites : jackpot, partage, autres rangs, coût des mises." icon={<Coins />} />
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Section title="Hypothèses">
          <div className="space-y-3">
            <Field label="Montant du jackpot (€)"><NumberInput value={jackpot} min={1} onChange={setJackpot} /></Field>
            <Field label="Nombre de grilles distinctes"><NumberInput value={n} min={1} onChange={setN} /></Field>
            <Field label="Grilles jouées par les autres participants" hint="Estimation (facultative) servant au calcul du partage."><NumberInput allowEmpty value={otherTickets} min={0} onChange={setOtherTickets} /></Field>
            <Field label="ou nombre moyen d'autres gagnants λ" hint="Prioritaire sur l'estimation ci-dessus."><NumberInput allowEmpty value={lambda} min={0} step={0.1} onChange={setLambda} /></Field>
            <Field label="Multiplicateur de popularité de vos grilles" hint="1 = combinaison « moyenne ». Sans données fiables, laissez 1."><NumberInput value={mult} min={0.01} step={0.1} onChange={setMult} /></Field>
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>Gains moyens de l'historique importé<span className="block text-xs text-muted-foreground">{hist.data?.available ? `${hist.data.details.length} rangs disponibles` : "aucun barème importé"}</span></span>
              <Switch checked={useHist} disabled={!hist.data?.available} onCheckedChange={setUseHist} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[13, 12, 11, 10, 9, 8].map((rank) => (
                <Field key={rank} label={`Gain rang ${rank}`}><NumberInput allowEmpty value={payouts[rank] ?? null} min={0} onChange={(v) => setPayouts({ ...payouts, [rank]: v })} /></Field>
              ))}
            </div>
            <Button className="w-full" onClick={() => m.mutate()} disabled={m.isPending}><Calculator /> Calculer</Button>
          </div>
        </Section>
        <div className="space-y-5">
          <ErrorBox error={m.error} />
          {r && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Espérance — jackpot" value={fmtEuro(r.ev_jackpot, 4)} hint={`part espérée si gain : ${fmtCompactEuro(r.expected_share_if_win)}`} accent="gold" />
                <StatCard label="Espérance — autres rangs" value={fmtEuro(r.ev_secondary, 4)} hint="selon les gains supposés" />
                <StatCard label="Coût des grilles" value={fmtEuro(r.cost)} />
                <StatCard label="Espérance nette" value={fmtEuro(r.ev_net, 4)} hint={`${fmtNum(r.return_per_euro, 3)} € rendus par euro misé`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ProbabilityBox p={r.p_jackpot} label="Probabilité de remporter le jackpot (un tirage)" />
                <Section title="Partage du jackpot">
                  <KeyValue items={[
                    ["Gain brut si seul gagnant", fmtEuro(r.gross_if_sole_winner, 0)],
                    ["λ (autres gagnants attendus)", fmtNum(r.lambda, 4)],
                    ["Base de λ", r.lambda_basis],
                    ["P(aucun autre gagnant)", fmtPct(r.p_no_other_winner, 2)],
                    ["Facteur de partage E[1/(1+K)]", fmtNum(r.share_factor, 4)],
                    ["Jackpot d'équilibre (λ actuel)", r.break_even_jackpot ? fmtCompactEuro(r.break_even_jackpot) : "—"],
                  ]} />
                </Section>
              </div>
              <Section title="Sensibilité aux hypothèses" description="Euros rendus en espérance par euro misé, selon le jackpot (axe horizontal) et le nombre moyen d'autres gagnants λ (une courbe par λ).">
                <Lines data={sens} xKey="jackpot" xFormatter={(v) => fmtCompactEuro(Number(v))}
                  series={r.sensitivity.slice(0, 5).map((s) => ({ key: `l${s.lambda}`, label: `λ = ${fmtNum(s.lambda, 2)}` }))} yFormatter={(v) => fmtNum(v, 2)} />
                <Table className="mt-4">
                  <TableHeader><TableRow><TableHead>λ</TableHead>{r.sensitivity[0].values.map((v) => <TableHead key={v.jackpot} className="text-right">{fmtCompactEuro(v.jackpot)}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{r.sensitivity.map((s) => (
                    <TableRow key={s.lambda}><TableCell>{fmtNum(s.lambda, 2)}</TableCell>{s.values.map((v) => <TableCell key={v.jackpot} className="text-right">{fmtEuro(v.ev_net, 3)}</TableCell>)}</TableRow>
                  ))}</TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">Valeurs : espérance nette (€) pour vos {n} grille(s).</p>
              </Section>
              <Section title="Autres rangs">
                <Table>
                  <TableHeader><TableRow><TableHead>Rang</TableHead><TableHead className="text-right">Probabilité</TableHead><TableHead className="text-right">Gain supposé</TableHead><TableHead className="text-right">Espérance</TableHead></TableRow></TableHeader>
                  <TableBody>{r.secondary.map((s) => (
                    <TableRow key={s.rank}><TableCell>{s.rank} · {s.label}</TableCell><TableCell className="text-right">{fmtSci(s.probability)}</TableCell><TableCell className="text-right">{s.assumed_payout !== null ? fmtEuro(s.assumed_payout) : "non renseigné"}</TableCell><TableCell className="text-right">{s.expected_value !== null ? fmtEuro(s.expected_value, 4) : "—"}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              </Section>
              <Section title="Hypothèses et limites">
                <ul className="space-y-1 text-sm text-muted-foreground">{r.hypotheses.map((h) => <li key={h}>• {h}</li>)}</ul>
              </Section>
              <Notice variant="warning">{r.warning}</Notice>
            </>
          )}
        </div>
      </div>
    </>
  );
}
