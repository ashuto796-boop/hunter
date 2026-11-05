import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Heatmap } from "@/components/charts";
import { ExportButtons, Field, JobProgress, KeyValue, Loading, Notice, PageHeader, ProbabilityBox, Section, usePortfolios } from "@/components/common";
import { GridList } from "@/components/GridList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDateTime, fmtEuro, fmtNum, fmtPct, fmtSmall } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { JobStart, PortfolioDetail, Prob } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ExactResult {
  n_grids: number; method: string; elapsed_s: number; note: string; p_any_win: Prob; p_any_win_if_independent: Prob;
  expected_winning_grids: number;
  tiers: { rank: number; label: string; p_at_least_one: Prob; expected_wins: number; p_best_rank: Prob; p_if_independent: Prob }[];
  winning_grids_distribution: { winning_grids: number; probability: Prob }[];
}

function Detail({ id }: { id: number }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["portfolio", id], queryFn: () => api.get<PortfolioDetail>(`/portfolios/${id}`) });
  const [name, setName] = useState<string | null>(null);
  const [newGrid, setNewGrid] = useState("");
  const [exact, setExact] = useState<ExactResult | null>(null);
  const job = useJob<ExactResult>((r) => { setExact(r); qc.invalidateQueries({ queryKey: ["portfolio", id] }); });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["portfolio", id] }); qc.invalidateQueries({ queryKey: ["portfolios"] }); };
  if (d.isLoading) return <Loading />;
  if (!d.data) return null;
  const p = d.data;
  const m = p.metrics;
  const addGrid = async () => {
    const parts = newGrid.split(/[\s,;|★*]+/).filter(Boolean).map(Number);
    if (parts.length !== 7) return toast.error("Saisissez 5 numéros puis 2 étoiles, ex. « 3 15 22 38 47 2 9 ».");
    try {
      await api.post(`/portfolios/${id}/grids`, { numbers: parts.slice(0, 5), stars: parts.slice(5) });
      setNewGrid("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-5">
      <Section title={p.name} description={`${p.n_grids} grille(s) · stratégie ${p.strategy_code} · créé le ${fmtDateTime(p.created_at)}${p.seed !== null ? ` · graine ${p.seed}` : ""}`}
        actions={<ExportButtons path={`/portfolios/${id}/export`} filename={`portefeuille_${id}`} />}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input value={name ?? p.name} onChange={(e) => setName(e.target.value)} />
          <Button variant="outline" onClick={async () => { await api.patch(`/portfolios/${id}`, { name: name ?? p.name }); toast.success("Renommé"); refresh(); }}><Pencil /> Renommer</Button>
        </div>
        {m && (
          <div className="grid gap-4 md:grid-cols-2">
            <ProbabilityBox p={m.probabilities.jackpot} label="Probabilité de jackpot (un tirage)" />
            <KeyValue items={[["Coût par tirage", fmtEuro(m.cost)], ["Diversité", fmtNum(m.diversity, 4)], ["Couverture des paires", fmtPct(m.pair_coverage, 1)], ["Couverture des triplets", fmtPct(m.triple_coverage, 1)], ["Répartition des étoiles", fmtNum(m.star_score, 3)], ["Numéros communs max", m.max_common_numbers_observed], ["Doublons", m.duplicates]]} />
          </div>
        )}
      </Section>
      <Section title="Analyse exacte des rangs secondaires" description="Énumère les 139 838 160 tirages possibles en tenant compte des dépendances entre grilles (≤ 100 grilles)."
        actions={<Button size="sm" onClick={() => job.start(() => api.post<JobStart>("/math/exact-portfolio", { portfolio_id: id }))} disabled={job.running || p.n_grids === 0 || p.n_grids > 100}><Calculator /> Calculer</Button>}>
        <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
        {!exact && p.exact && <p className="text-sm text-muted-foreground">Dernier calcul : P(au moins un gain) = <span className="num font-medium text-foreground">{fmtPct(p.exact.p_any_win, 3)}</span> ({fmtDateTime(p.exact.computed_at)}).</p>}
        {exact && (
          <div className="space-y-3">
            <KeyValue items={[["P(au moins un gain, tous rangs)", exact.p_any_win.percent], ["Si l'on supposait (à tort) l'indépendance", exact.p_any_win_if_independent.percent], ["Grilles gagnantes en moyenne / tirage", fmtNum(exact.expected_winning_grids, 4)], ["Temps de calcul", `${fmtNum(exact.elapsed_s, 2)} s`]]} />
            <Table>
              <TableHeader><TableRow><TableHead>Rang</TableHead><TableHead className="text-right">P(≥ 1 gain à ce rang)</TableHead><TableHead className="text-right">Si indépendance</TableHead><TableHead className="text-right">Gains espérés</TableHead><TableHead className="text-right">P(meilleur rang)</TableHead></TableRow></TableHeader>
              <TableBody>{exact.tiers.map((t) => (
                <TableRow key={t.rank}><TableCell>{t.rank} · {t.label}</TableCell><TableCell className="text-right text-xs">{t.p_at_least_one.one_in}</TableCell><TableCell className="text-right text-xs text-muted-foreground">{t.p_if_independent.one_in}</TableCell><TableCell className="text-right">{fmtSmall(t.expected_wins)}</TableCell><TableCell className="text-right text-xs">{t.p_best_rank.percent}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
            <div className="flex flex-wrap gap-2 text-xs">
              {exact.winning_grids_distribution.map((w) => <Badge key={w.winning_grids} variant="outline">{w.winning_grids} gagnante(s) : {w.probability.percent}</Badge>)}
            </div>
            <p className="text-xs text-muted-foreground">{exact.note}</p>
          </div>
        )}
      </Section>
      <Section title="Grilles">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <Input value={newGrid} onChange={(e) => setNewGrid(e.target.value)} placeholder="Ajouter : 3 15 22 38 47 ★ 2 9" />
          <Button variant="outline" onClick={addGrid}><Plus /> Ajouter</Button>
        </div>
        <GridList allowSave={false} grids={p.grids.map((g) => ({ ...g, saved: true }))}
          onDelete={async (g) => { await api.del(`/portfolios/${id}/grids/${g.id}`); refresh(); }} />
      </Section>
      {m?.similarity_matrix && m.similarity_matrix.length > 1 && (
        <Section title="Matrice de similarité"><Heatmap matrix={m.similarity_matrix} valueLabel="Similarité" formatter={(v) => fmtNum(v, 2)} /></Section>
      )}
    </div>
  );
}

export default function SavedGrids() {
  const qc = useQueryClient();
  const list = usePortfolios();
  const [sel, setSel] = useState<number | null>(null);
  const [manual, setManual] = useState("");
  const del = async (id: number) => {
    if (!confirm("Supprimer ce portefeuille et ses grilles ?")) return;
    await api.del(`/portfolios/${id}`);
    if (sel === id) setSel(null);
    qc.invalidateQueries({ queryKey: ["portfolios"] });
  };
  const saveManual = async () => {
    const parts = manual.split(/[\s,;|★*]+/).filter(Boolean).map(Number);
    if (parts.length !== 7) return toast.error("Saisissez 5 numéros puis 2 étoiles.");
    try {
      await api.post("/grids/save", { numbers: parts.slice(0, 5), stars: parts.slice(5), strategy_code: "manuelle" });
      toast.success("Grille enregistrée");
      setManual("");
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <PageHeader title="Mes grilles sauvegardées" subtitle="Portefeuilles et grilles individuelles enregistrés en base locale." icon={<Save />} />
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Portefeuilles">
            {list.isLoading ? <Loading /> : !list.data?.length ? (
              <Notice>Aucun portefeuille. <Link className="underline" to="/generateur">Générez des grilles</Link> puis sauvegardez-les.</Notice>
            ) : (
              <ul className="space-y-1.5">
                {list.data.map((p) => (
                  <li key={p.id} className={cn("flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm", sel === p.id && "border-violet-400 bg-violet-500/10")}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSel(p.id)}>
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.n_grids} grille(s) · {fmtDateTime(p.created_at)} {p.is_individual && "· individuelles"}</div>
                    </button>
                    <Button size="icon" variant="ghost" onClick={() => del(p.id)} aria-label="Supprimer"><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Enregistrer une grille jouée">
            <Field label="5 numéros puis 2 étoiles"><Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="7 14 23 38 45 3 11" /></Field>
            <Button className="mt-3 w-full" variant="outline" onClick={saveManual}><Save /> Enregistrer</Button>
          </Section>
        </div>
        <div>{sel ? <Detail key={sel} id={sel} /> : <Notice>Sélectionnez un portefeuille pour afficher ses grilles, ses métriques, son analyse exacte et ses exports.</Notice>}</div>
      </div>
    </>
  );
}
