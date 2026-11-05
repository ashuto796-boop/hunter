import { Field, NumberInput } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { fmtNum } from "@/lib/format";

export interface Weights {
  diversity: number;
  pairs: number;
  triples: number;
  stars: number;
  popularity: number;
  overlap: number;
}

export const DEFAULT_WEIGHTS: Weights = { diversity: 0.35, pairs: 0.25, triples: 0.1, stars: 0.15, popularity: 0.1, overlap: 0.05 };

export const WEIGHT_LABELS: Record<keyof Weights, { label: string; hint: string }> = {
  diversity: { label: "Diversité", hint: "1 − similarité moyenne entre grilles" },
  pairs: { label: "Couverture des paires", hint: "paires distinctes / maximum atteignable" },
  triples: { label: "Couverture des triplets", hint: "triplets distincts / maximum atteignable" },
  stars: { label: "Répartition des étoiles", hint: "couverture des paires d'étoiles + équilibre" },
  popularity: { label: "Pénalité motifs populaires", hint: "indice heuristique, pas une popularité mesurée" },
  overlap: { label: "Pénalité de recouvrement", hint: "couples dépassant le recouvrement maximal" },
};

export function WeightsForm({ value, onChange }: { value: Weights; onChange: (w: Weights) => void }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
      {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
        <div key={k} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <span>{WEIGHT_LABELS[k].label}</span>
            <span className="num text-muted-foreground">{fmtNum(value[k], 2)}</span>
          </div>
          <Slider value={[value[k]]} min={0} max={1} step={0.05} onValueChange={([v]) => onChange({ ...value, [k]: v })} aria-label={WEIGHT_LABELS[k].label} />
          <p className="text-[11px] text-muted-foreground">{WEIGHT_LABELS[k].hint}</p>
        </div>
      ))}
    </div>
  );
}

export interface Constraints {
  sum_min?: number | null;
  sum_max?: number | null;
  even_min?: number | null;
  even_max?: number | null;
  max_consecutive_pairs?: number | null;
  max_per_decade?: number | null;
  exclude_numbers?: number[];
  exclude_stars?: number[];
  max_popularity?: number | null;
}

function parseList(s: string, max: number): number[] {
  return Array.from(new Set(s.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max)));
}

export function cleanConstraints(c: Constraints): Constraints {
  const out: Constraints = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function ConstraintsForm({ value, onChange }: { value: Constraints; onChange: (c: Constraints) => void }) {
  const set = (k: keyof Constraints, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Field label="Somme min"><NumberInput allowEmpty value={value.sum_min} min={15} max={240} onChange={(v) => set("sum_min", v)} placeholder="15" /></Field>
      <Field label="Somme max"><NumberInput allowEmpty value={value.sum_max} min={15} max={240} onChange={(v) => set("sum_max", v)} placeholder="240" /></Field>
      <Field label="Pairs min"><NumberInput allowEmpty value={value.even_min} min={0} max={5} onChange={(v) => set("even_min", v)} placeholder="0" /></Field>
      <Field label="Pairs max"><NumberInput allowEmpty value={value.even_max} min={0} max={5} onChange={(v) => set("even_max", v)} placeholder="5" /></Field>
      <Field label="Consécutifs max"><NumberInput allowEmpty value={value.max_consecutive_pairs} min={0} max={4} onChange={(v) => set("max_consecutive_pairs", v)} placeholder="4" /></Field>
      <Field label="Max par dizaine"><NumberInput allowEmpty value={value.max_per_decade} min={1} max={5} onChange={(v) => set("max_per_decade", v)} placeholder="5" /></Field>
      <Field label="Numéros exclus">
        <Input defaultValue={(value.exclude_numbers ?? []).join(" ")} placeholder="ex. 7 13" onBlur={(e) => set("exclude_numbers", parseList(e.target.value, 50))} />
      </Field>
      <Field label="Étoiles exclues">
        <Input defaultValue={(value.exclude_stars ?? []).join(" ")} placeholder="ex. 12" onBlur={(e) => set("exclude_stars", parseList(e.target.value, 12))} />
      </Field>
    </div>
  );
}
