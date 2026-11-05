import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Play, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { ExportButtons, JobProgress, Notice, PageHeader, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useJob } from "@/lib/jobs";
import type { JobStart } from "@/lib/types";

interface Check { code: string; name: string; passed: boolean; status: string; details: Record<string, unknown>; duration_s: number }
interface AuditRes { generated_at: string; checks: Check[]; passed: number; total: number; compliant: boolean; elapsed_s: number; summary: string }

function DetailValue({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span>—</span>;
  if (typeof v === "object") return <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-2 text-[11px]">{JSON.stringify(v, null, 2)}</pre>;
  return <span className="num">{String(v)}</span>;
}

export default function Audit() {
  const qc = useQueryClient();
  const [res, setRes] = useState<AuditRes | null>(null);
  const reports = useQuery({ queryKey: ["audit-reports"], queryFn: () => api.get<{ id: number; created_at: string; passed: number; total: number; compliant: boolean }[]>("/audit/reports") });
  const job = useJob<AuditRes>((r) => { setRes(r); qc.invalidateQueries({ queryKey: ["audit-reports"] }); });
  const load = async (id: number) => setRes(await api.get<AuditRes>(`/audit/reports/${id}`));
  return (
    <>
      <PageHeader title="Audit mathématique" subtitle="Vérification automatique des propriétés essentielles : combinaisons, probabilités, rangs, uniformité, contraintes, doublons, calcul exact et simulations."
        icon={<ShieldCheck />} actions={<Button variant="gold" onClick={() => job.start(() => api.post<JobStart>("/audit/run"))} disabled={job.running}><Play /> Lancer l'audit</Button>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
          {res ? (
            <>
              <Notice variant={res.compliant ? "success" : "destructive"} title={res.compliant ? "Conforme" : "Non conforme"}>
                {res.summary} {res.passed}/{res.total} vérifications réussies en {fmtNum(res.elapsed_s, 1)} s ({fmtDateTime(res.generated_at)}).
              </Notice>
              {res.checks.map((c) => (
                <Section key={c.code} title={c.name} description={`${fmtNum(c.duration_s, 2)} s`}
                  actions={c.passed ? <Badge variant="success"><CheckCircle2 className="size-3" /> conforme</Badge> : <Badge variant="destructive"><XCircle className="size-3" /> {c.status === "error" ? "erreur" : "échec"}</Badge>}>
                  <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                    {Object.entries(c.details).map(([k, v]) => (
                      <div key={k} className="rounded-lg border bg-background/30 p-2">
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd><DetailValue v={v} /></dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              ))}
            </>
          ) : <Notice>L'audit génère notamment 120 000 grilles avec le générateur de production et simule 400 000 tirages : comptez de quelques secondes à une minute selon la machine.</Notice>}
        </div>
        <Section title="Rapports enregistrés">
          <ul className="space-y-2 text-sm">
            {reports.data?.map((r) => (
              <li key={r.id} className="space-y-2 rounded-lg border p-2.5">
                <button className="w-full text-left" onClick={() => load(r.id)}>
                  <div className="flex items-center justify-between"><span>#{r.id}</span>{r.compliant ? <Badge variant="success">{r.passed}/{r.total}</Badge> : <Badge variant="destructive">{r.passed}/{r.total}</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(r.created_at)}</div>
                </button>
                <ExportButtons path={`/audit/reports/${r.id}/export`} filename={`audit_${r.id}`} formats={["pdf", "json"]} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
