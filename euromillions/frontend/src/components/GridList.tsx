import { Copy, GitCompare, RefreshCw, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { GridBalls } from "@/components/GridBalls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { fmtDateTime, fmtNum, gridText } from "@/lib/format";

export interface ListGrid {
  id: number;
  numbers: number[];
  stars: number[];
  strategy?: string;
  generated_at?: string | null;
  created_at?: string | null;
  diversity_score?: number | null;
  pattern_score?: number;
  saved?: boolean;
  label?: string | null;
}

interface Props {
  grids: ListGrid[];
  onDelete?: (g: ListGrid) => void;
  onRegenerate?: (g: ListGrid) => void;
  onSaved?: (g: ListGrid) => void;
  allowSave?: boolean;
  pageSize?: number;
}

export function GridList({ grids, onDelete, onRegenerate, onSaved, allowSave = true, pageSize = 50 }: Props) {
  const [selected, setSelected] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [compareOpen, setCompareOpen] = useState(false);
  const pages = Math.max(1, Math.ceil(grids.length / pageSize));
  const visible = grids.slice(page * pageSize, (page + 1) * pageSize);
  const sel = useMemo(() => grids.filter((g) => selected.includes(g.id)), [grids, selected]);

  const copy = async (g: ListGrid) => {
    try {
      await navigator.clipboard.writeText(gridText(g.numbers, g.stars));
      toast.success("Grille copiée");
    } catch {
      toast.error("Copie impossible dans ce navigateur");
    }
  };
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(grids.map((g) => gridText(g.numbers, g.stars)).join("\n"));
      toast.success(`${grids.length} grilles copiées`);
    } catch {
      toast.error("Copie impossible dans ce navigateur");
    }
  };
  const save = async (g: ListGrid) => {
    try {
      await api.post("/grids/save", { numbers: g.numbers, stars: g.stars, strategy_code: g.strategy ?? "A", diversity_score: g.diversity_score ?? null });
      toast.success("Grille enregistrée dans « Mes grilles individuelles »");
      onSaved?.(g);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button size="sm" variant="outline" onClick={copyAll}><Copy /> Tout copier</Button>
        <Button size="sm" variant="outline" disabled={sel.length < 2} onClick={() => setCompareOpen(true)}>
          <GitCompare /> Comparer la sélection ({sel.length})
        </Button>
        {pages > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</Button>
            <span className="num text-muted-foreground">Page {page + 1} / {pages}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Suivant</Button>
          </div>
        )}
      </div>
      <ul className="divide-y divide-border/60 rounded-xl border bg-background/30">
        {visible.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 p-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex items-center gap-3 overflow-x-auto">
              <Checkbox checked={selected.includes(g.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, g.id] : s.filter((x) => x !== g.id)))} aria-label="Sélectionner" />
              <span className="w-10 text-xs text-muted-foreground num">#{g.id}</span>
              <GridBalls numbers={g.numbers} stars={g.stars} small className="flex-nowrap" />
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-7 2xl:pl-0">
              {g.strategy && <Badge variant="secondary">Stratégie {g.strategy}</Badge>}
              {g.diversity_score != null && <Badge variant="outline" title="1 − similarité moyenne avec les autres grilles">Diversité {fmtNum(g.diversity_score, 3)}</Badge>}
              {g.pattern_score != null && g.pattern_score > 0 && <Badge variant="gold" title="Indice heuristique de motif (pas une probabilité)">Motif {fmtNum(g.pattern_score, 2)}</Badge>}
              {g.saved && <Badge variant="success">Enregistrée</Badge>}
              <span className="hidden text-[11px] text-muted-foreground xl:inline">{fmtDateTime(g.generated_at ?? g.created_at ?? null)}</span>
              <Button size="icon" variant="ghost" onClick={() => copy(g)} title="Copier" aria-label="Copier"><Copy /></Button>
              {allowSave && !g.saved && <Button size="icon" variant="ghost" onClick={() => save(g)} title="Sauvegarder" aria-label="Sauvegarder"><Save /></Button>}
              {onRegenerate && <Button size="icon" variant="ghost" onClick={() => onRegenerate(g)} title="Regénérer" aria-label="Regénérer"><RefreshCw /></Button>}
              {onDelete && <Button size="icon" variant="ghost" onClick={() => onDelete(g)} title="Supprimer" aria-label="Supprimer"><Trash2 /></Button>}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Comparaison des grilles sélectionnées</DialogTitle>
            <DialogDescription>Numéros et étoiles communs entre chaque couple de grilles.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {sel.flatMap((a, i) => sel.slice(i + 1).map((b) => {
              const cn = a.numbers.filter((x) => b.numbers.includes(x));
              const cs = a.stars.filter((x) => b.stars.includes(x));
              return (
                <div key={`${a.id}-${b.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="num">#{a.id} ↔ #{b.id}</span>
                  <span className="text-muted-foreground">{cn.length} numéro(s) commun(s){cn.length ? ` : ${cn.join(", ")}` : ""} · {cs.length} étoile(s){cs.length ? ` : ${cs.join(", ")}` : ""}</span>
                </div>
              );
            }))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
