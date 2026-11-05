import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GridBalls } from "@/components/GridBalls";
import { Field, Notice, PageHeader, PortfolioPicker, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtEuro } from "@/lib/format";
import type { Draw } from "@/lib/types";

interface CheckLine { numbers: number[]; stars: number[]; matched_numbers: number[]; matched_stars: number[]; n_matched_numbers: number; n_matched_stars: number; rank: number | null; prize: number | null; prize_known: boolean }
interface CheckResult {
  draw: { numbers: number[]; stars: number[]; era: string; date: string | null; draw_id: number | null };
  lines: CheckLine[];
  summary: { grids: number; winning_grids: number; by_rank: Record<string, number>; total_known_prizes: number; wins_with_unknown_amount: number; prize_table_available: boolean };
  note: string;
}

export default function Verification() {
  const qc = useQueryClient();
  const [source, setSource] = useState<"db" | "manual">("db");
  const [drawId, setDrawId] = useState<string>("");
  const [mDate, setMDate] = useState("");
  const [mNums, setMNums] = useState("");
  const [mStars, setMStars] = useState("");
  const [pid, setPid] = useState<number | null>(null);
  const [res, setRes] = useState<CheckResult | null>(null);
  const draws = useQuery({ queryKey: ["draws-latest"], queryFn: () => api.get<{ items: Draw[] }>("/draws", { page: 1, page_size: 100 }) });
  const history = useQuery({ queryKey: ["checks"], queryFn: () => api.get<{ id: number; draw_date: string | null; numbers: number[]; stars: number[]; portfolio_name: string | null; summary: CheckResult["summary"]; checked_at: string }[]>("/results/history") });

  const check = async () => {
    try {
      const body: Record<string, unknown> = { portfolio_id: pid, save: true };
      if (source === "db") body.draw_id = Number(drawId);
      else {
        body.numbers = mNums.split(/[\s,;]+/).filter(Boolean).map(Number);
        body.stars = mStars.split(/[\s,;]+/).filter(Boolean).map(Number);
        body.draw_date = mDate || null;
      }
      const r = await api.post<CheckResult>("/results/check", body);
      setRes(r);
      qc.invalidateQueries({ queryKey: ["checks"] });
      toast.success(`${r.summary.winning_grids} grille(s) gagnante(s) sur ${r.summary.grids}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Vérification des résultats" subtitle="Comparez vos grilles enregistrées à un tirage officiel. Les montants proviennent uniquement du barème importé." icon={<CheckCircle2 />} />
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Section title="Tirage et grilles">
          <div className="space-y-3">
            <Tabs value={source} onValueChange={(v) => setSource(v as "db" | "manual")}>
              <TabsList className="w-full"><TabsTrigger value="db" className="flex-1">Tirage importé</TabsTrigger><TabsTrigger value="manual" className="flex-1">Saisie du tirage</TabsTrigger></TabsList>
              <TabsContent value="db">
                <Field label="Tirage">
                  <Select value={drawId} onValueChange={setDrawId}>
                    <SelectTrigger><SelectValue placeholder="Choisir un tirage" /></SelectTrigger>
                    <SelectContent>{draws.data?.items.map((d) => <SelectItem key={d.id} value={String(d.id)}>{fmtDate(d.draw_date)} — {d.numbers.join(" ")} ★ {d.stars.join(" ")}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </TabsContent>
              <TabsContent value="manual" className="space-y-3">
                <Field label="Date"><Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></Field>
                <Field label="5 numéros"><Input value={mNums} onChange={(e) => setMNums(e.target.value)} placeholder="3 15 22 38 47" /></Field>
                <Field label="2 étoiles"><Input value={mStars} onChange={(e) => setMStars(e.target.value)} placeholder="2 9" /></Field>
              </TabsContent>
            </Tabs>
            <Field label="Portefeuille à vérifier"><PortfolioPicker value={pid} onChange={setPid} /></Field>
            <Button className="w-full" onClick={check} disabled={!pid || (source === "db" && !drawId)}><Search /> Vérifier</Button>
          </div>
        </Section>
        <div className="space-y-5">
          {res ? (
            <>
              <Section title={`Tirage ${res.draw.date ? `du ${fmtDate(res.draw.date)}` : "saisi"}`}>
                <GridBalls numbers={res.draw.numbers} stars={res.draw.stars} />
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant={res.summary.winning_grids ? "success" : "secondary"}>{res.summary.winning_grids} grille(s) gagnante(s) / {res.summary.grids}</Badge>
                  {Object.entries(res.summary.by_rank).map(([r, n]) => <Badge key={r} variant="gold">Rang {r} : {n}</Badge>)}
                  {res.summary.prize_table_available && <Badge variant="outline">Gains connus : {fmtEuro(res.summary.total_known_prizes)}</Badge>}
                </div>
                {!res.summary.prize_table_available && <div className="mt-3"><Notice>Barème non disponible pour ce tirage : les rangs sont indiqués sans montant (aucun gain n'est inventé).</Notice></div>}
              </Section>
              <Section title="Détail par grille">
                <Table>
                  <TableHeader><TableRow><TableHead>Grille</TableHead><TableHead className="text-right">Bons numéros</TableHead><TableHead className="text-right">Bonnes étoiles</TableHead><TableHead>Rang</TableHead><TableHead className="text-right">Gain</TableHead></TableRow></TableHeader>
                  <TableBody>{[...res.lines].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((l, i) => (
                    <TableRow key={i}>
                      <TableCell><GridBalls numbers={l.numbers} stars={l.stars} small hitNumbers={l.matched_numbers} hitStars={l.matched_stars} /></TableCell>
                      <TableCell className="text-right">{l.n_matched_numbers}</TableCell>
                      <TableCell className="text-right">{l.n_matched_stars}</TableCell>
                      <TableCell>{l.rank ? <Badge variant="gold">Rang {l.rank}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{l.rank ? (l.prize_known ? fmtEuro(l.prize) : "barème non disponible") : "—"}</TableCell>
                    </TableRow>))}</TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">{res.note}</p>
              </Section>
            </>
          ) : <Notice>Choisissez un tirage et un portefeuille. Les bons numéros sont mis en évidence en violet, les bonnes étoiles en doré lumineux.</Notice>}
          <Section title="Historique des vérifications">
            <Table>
              <TableHeader><TableRow><TableHead>Date de vérification</TableHead><TableHead>Tirage</TableHead><TableHead>Portefeuille</TableHead><TableHead className="text-right">Gagnantes</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{history.data?.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{fmtDateTime(h.checked_at)}</TableCell>
                  <TableCell><div className="text-xs text-muted-foreground">{fmtDate(h.draw_date)}</div><GridBalls numbers={h.numbers} stars={h.stars} small /></TableCell>
                  <TableCell>{h.portfolio_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{h.summary.winning_grids} / {h.summary.grids}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" aria-label="Supprimer" onClick={async () => { await api.del(`/results/history/${h.id}`); qc.invalidateQueries({ queryKey: ["checks"] }); }}><Trash2 /></Button></TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </Section>
        </div>
      </div>
    </>
  );
}
