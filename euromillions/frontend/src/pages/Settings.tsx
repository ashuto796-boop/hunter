import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorBox, Field, KeyValue, Loading, Notice, NumberInput, PageHeader, Section } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, getApiKey, setApiKey } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";

interface SettingsData {
  ticket_price: number; ticket_price_source: string; currency: string; draws_per_week: number; default_seed: number | null;
  show_demo_banner: boolean; official_source_url: string; last_refresh: string | null;
  limits: { max_grids_per_request: number; max_simulation_draws: number; max_simulation_work: number; exact_portfolio_max_grids: number; max_upload_mb: number; allowed_import_hosts: string[]; api_key_required: boolean };
}

export default function Settings() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsData>("/settings") });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<{ status: string; version: string; database: string; draws: number }>("/health") });
  const [form, setForm] = useState<Partial<SettingsData>>({});
  const [key, setKey] = useState(getApiKey());
  useEffect(() => { if (s.data) setForm(s.data); }, [s.data]);
  const save = useMutation({
    mutationFn: () => api.put<SettingsData>("/settings", {
      ticket_price: form.ticket_price, ticket_price_source: form.ticket_price_source, draws_per_week: form.draws_per_week,
      default_seed: form.default_seed ?? null, official_source_url: form.official_source_url ?? "",
    }),
    onSuccess: () => { toast.success("Paramètres enregistrés"); qc.invalidateQueries(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorBox error={s.error} />;
  const l = s.data!.limits;
  return (
    <>
      <PageHeader title="Paramètres" subtitle="Prix, règles configurables, sécurité et limites de calcul." icon={<SettingsIcon />} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Jeu" description="Valeurs configurables et sourcées : vérifiez-les auprès de votre opérateur.">
          <div className="space-y-3">
            <Field label="Prix d'une grille (€)"><NumberInput value={form.ticket_price ?? null} min={0.1} max={100} step={0.1} onChange={(v) => setForm({ ...form, ticket_price: v ?? 2.5 })} /></Field>
            <Field label="Source du prix"><Textarea value={form.ticket_price_source ?? ""} onChange={(e) => setForm({ ...form, ticket_price_source: e.target.value })} /></Field>
            <Field label="Tirages par semaine"><NumberInput value={form.draws_per_week ?? 2} min={1} max={2} onChange={(v) => setForm({ ...form, draws_per_week: v ?? 2 })} /></Field>
            <Field label="URL officielle par défaut"><Input value={form.official_source_url ?? ""} onChange={(e) => setForm({ ...form, official_source_url: e.target.value })} placeholder="https://www.fdj.fr/…" /></Field>
            <Field label="Graine par défaut (analyses)"><NumberInput allowEmpty value={form.default_seed ?? null} min={0} onChange={(v) => setForm({ ...form, default_seed: v })} /></Field>
            <Button onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button>
          </div>
        </Section>
        <div className="space-y-5">
          <Section title="Accès à l'API" description={l.api_key_required ? "Le serveur exige une clé (EM_API_KEY)." : "Aucune clé exigée par le serveur (usage local)."}>
            <div className="flex gap-2">
              <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Clé d'API (stockée dans ce navigateur)" />
              <Button variant="outline" onClick={() => { setApiKey(key); toast.success("Clé mémorisée"); qc.invalidateQueries(); }}><KeyRound /> Valider</Button>
            </div>
          </Section>
          <Section title="Système">
            <KeyValue items={[
              ["État de l'API", health.data?.status === "ok" ? "opérationnelle" : "—"],
              ["Version", health.data?.version ?? "—"],
              ["Base de données", health.data?.database ?? "—"],
              ["Tirages en base", fmtInt(health.data?.draws)],
              ["Dernière actualisation", fmtDateTime(s.data!.last_refresh)],
            ]} />
          </Section>
          <Section title="Limites de calcul et d'import" description="Configurables via les variables d'environnement EM_*.">
            <KeyValue items={[
              ["Grilles par requête", fmtInt(l.max_grids_per_request)],
              ["Tirages simulés max", fmtInt(l.max_simulation_draws)],
              ["Travail de simulation max", fmtInt(l.max_simulation_work)],
              ["Analyse exacte max", `${l.exact_portfolio_max_grids} grilles`],
              ["Taille d'import max", `${l.max_upload_mb} Mo`],
              ["Hôtes d'import autorisés", l.allowed_import_hosts.join(", ") || "aucun"],
            ]} />
          </Section>
          <Notice>L'application fonctionne sans compte de jeu et n'automatise aucune mise réelle.</Notice>
        </div>
      </div>
    </>
  );
}
