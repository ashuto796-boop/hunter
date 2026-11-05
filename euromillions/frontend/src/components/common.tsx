import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, Info, Loader2, ShieldAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, download, type Query } from "@/lib/api";
import { fmtPct } from "@/lib/format";
import type { DrawSummary, Filters, Job, PortfolioSummary, Prob } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-1 rounded-xl border bg-card p-2.5 text-violet-300 [&_svg]:size-5">{icon}</div>}
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ children, variant = "default", title }: { children: ReactNode; variant?: "default" | "warning" | "destructive" | "success"; title?: string }) {
  const Icon = variant === "warning" ? AlertTriangle : variant === "destructive" ? ShieldAlert : Info;
  return (
    <Alert variant={variant}>
      <Icon />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function PredictionWarning({ text }: { text?: string }) {
  return (
    <Notice variant="warning" title="Analyse descriptive, pas prédictive">
      {text ??
        "Ces classements décrivent le passé. Ils ne permettent pas de conclure qu'un numéro a davantage ou moins de chances de sortir au prochain tirage."}
    </Notice>
  );
}

export function StatCard({ label, value, hint, icon, accent }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; accent?: "gold" | "violet" }) {
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className={cn("mt-1 truncate font-display text-2xl font-semibold num", accent === "gold" && "gold-text")}>{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && <div className={cn("rounded-lg p-2 [&_svg]:size-5", accent === "gold" ? "bg-amber-400/10 text-amber-300" : "bg-violet-500/15 text-violet-300")}>{icon}</div>}
      </CardContent>
    </Card>
  );
}

export function Section({ title, description, children, actions, className }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <Card className={cn("animate-fade-in", className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1 basis-60">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step, placeholder, allowEmpty }: {
  value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; placeholder?: string; allowEmpty?: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(allowEmpty ? null : (min ?? 0));
        const v = Number(raw);
        if (!Number.isNaN(v)) onChange(v);
      }}
    />
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice variant="destructive" title="Erreur">{(error as Error).message ?? String(error)}</Notice>;
}

export function useDrawSummary() {
  return useQuery({ queryKey: ["draws-summary"], queryFn: () => api.get<DrawSummary>("/draws/summary") });
}

/** Affiche un appel à importer des données si l'historique est vide. */
export function RequireData({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useDrawSummary();
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data || data.count === 0)
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Database className="size-10 text-violet-300" />
          <h2 className="text-lg font-semibold">Aucun tirage importé</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Importez l'historique officiel (CSV, Excel ou URL autorisée) ou chargez le jeu de démonstration fictif depuis la page Historique.
          </p>
          <Button asChild>
            <Link to="/historique">Importer des tirages</Link>
          </Button>
        </CardContent>
      </Card>
    );
  return <>{children}</>;
}

const WINDOWS: { label: string; value: string }[] = [
  { label: "Tout l'historique", value: "all" },
  { label: "20 derniers tirages", value: "20" },
  { label: "50 derniers tirages", value: "50" },
  { label: "100 derniers tirages", value: "100" },
  { label: "500 derniers tirages", value: "500" },
];

export function FiltersBar({ value, onChange, showEra = true }: { value: Filters; onChange: (f: Filters) => void; showEra?: boolean }) {
  return (
    <div className="mb-5 grid grid-cols-1 gap-3 rounded-xl border bg-card/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Fenêtre">
        <Select value={value.last_n ? String(value.last_n) : "all"} onValueChange={(v) => onChange({ ...value, last_n: v === "all" ? null : Number(v) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Du">
        <Input type="date" value={value.date_from ?? ""} onChange={(e) => onChange({ ...value, date_from: e.target.value || null })} />
      </Field>
      <Field label="Au">
        <Input type="date" value={value.date_to ?? ""} onChange={(e) => onChange({ ...value, date_to: e.target.value || null })} />
      </Field>
      {showEra && (
        <Field label="Époque de règles">
          <Select value={value.era ?? "all"} onValueChange={(v) => onChange({ ...value, era: v === "all" ? null : v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="E2004">2004-2011 (9 étoiles)</SelectItem>
              <SelectItem value="E2011">2011-2016 (11 étoiles)</SelectItem>
              <SelectItem value="E2016">Depuis 2016 (12 étoiles)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}

export function filtersQuery(f: Filters): Query {
  return { last_n: f.last_n ?? undefined, date_from: f.date_from ?? undefined, date_to: f.date_to ?? undefined, era: f.era ?? undefined };
}

export function JobProgress({ job, error, onCancel }: { job: Job | null; error?: string | null; onCancel?: () => void }) {
  if (error) return <ErrorBox error={{ message: error }} />;
  if (!job || job.status === "done") return null;
  if (job.status === "cancelled") return <Notice>Calcul annulé.</Notice>;
  return (
    <div className="space-y-2 rounded-xl border bg-card/70 p-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-violet-300" />
          {job.message || (job.status === "queued" ? "En file d'attente…" : "Calcul en cours…")}
        </span>
        <span className="num font-medium">{fmtPct(job.progress, 0)}</span>
      </div>
      <Progress value={job.progress * 100} />
      {onCancel && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onCancel}><X /> Annuler</Button>
        </div>
      )}
    </div>
  );
}

export function ExportButtons({ path, filename, params, body, formats = ["csv", "xlsx", "json", "pdf"] }: {
  path: string; filename: string; params?: Query; body?: Record<string, unknown>; formats?: string[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (fmt: string) => {
    setBusy(fmt);
    try {
      if (body) await download(path, `${filename}.${fmt}`, undefined, { ...body, format: fmt });
      else await download(path, `${filename}.${fmt}`, { ...params, format: fmt });
      toast.success(`Export ${fmt.toUpperCase()} téléchargé`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {formats.map((f) => (
        <Button key={f} size="sm" variant="outline" onClick={() => run(f)} disabled={busy !== null}>
          {busy === f ? <Loader2 className="animate-spin" /> : <Download />} {f.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}

export function ProbabilityBox({ p, label }: { p: Prob; label: string }) {
  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold gold-text">{p.one_in}</div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="col-span-2"><dt className="text-muted-foreground">Fraction</dt><dd className="num break-words font-mono">{p.fraction ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Pourcentage</dt><dd className="num break-all font-mono">{p.percent}</dd></div>
        <div><dt className="text-muted-foreground">Scientifique</dt><dd className="num font-mono">{p.scientific}</dd></div>
      </dl>
    </div>
  );
}

export function usePortfolios() {
  return useQuery({ queryKey: ["portfolios"], queryFn: () => api.get<PortfolioSummary[]>("/portfolios") });
}

export function PortfolioPicker({ value, onChange, placeholder = "Choisir un portefeuille", exclude }: {
  value: number | null; onChange: (id: number | null) => void; placeholder?: string; exclude?: number[];
}) {
  const { data } = usePortfolios();
  const items = (data ?? []).filter((p) => !exclude?.includes(p.id));
  return (
    <Select value={value ? String(value) : ""} onValueChange={(v) => onChange(v ? Number(v) : null)}>
      <SelectTrigger><SelectValue placeholder={items.length ? placeholder : "Aucun portefeuille enregistré"} /></SelectTrigger>
      <SelectContent>
        {items.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>{p.name} — {p.n_grids} grille{p.n_grids > 1 ? "s" : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => {
        const short = typeof v === "number" || (typeof v === "string" && v.length <= 24);
        return (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("num text-right font-medium", short ? "whitespace-nowrap" : "min-w-0 [overflow-wrap:anywhere]")}>{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function TestResult({ test }: { test?: { statistic: number | null; df: number; p_value: number | null; name?: string; hypotheses?: string } | null }) {
  if (!test) return null;
  return (
    <div className="rounded-lg border bg-background/40 p-3 text-xs">
      <div className="font-medium">{test.name ?? "Test statistique"}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground num">
        <span>χ² = {test.statistic !== null ? test.statistic.toFixed(2).replace(".", ",") : "—"}</span>
        <span>ddl = {test.df}</span>
        <span>p = {test.p_value !== null ? (test.p_value < 0.0001 ? "< 0,0001" : test.p_value.toFixed(4).replace(".", ",")) : "—"}</span>
      </div>
      {test.hypotheses && <p className="mt-1 text-muted-foreground">{test.hypotheses}</p>}
    </div>
  );
}
