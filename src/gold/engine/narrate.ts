// What the AI says about itself. Shared by the phone app and the 24/7 server so the
// "monologue" reads the same wherever the trader runs.
import { Decision, Position, Trade } from "./types";
import { MODULE_INFO } from "./modules";
import { REGIME_LABEL } from "./brain";
import { TrainingResult } from "./training";

export interface Thought {
  t: number;
  kind: "info" | "scan" | "entry" | "exit" | "warn" | "learn";
  text: string;
}

export const money = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} $`;
export const px = (x: number) => x.toFixed(2);
export const lots = (oz: number) => (oz / 100).toFixed(2);
export const sideFr = (d: number) => (d === 1 ? "ACHAT" : "VENTE");
const signedR = (r: number) => `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;

export const EXIT_LABEL: Record<Trade["reason"], string> = {
  SL: "Stop touché",
  TP2: "Objectif final atteint",
  BE: "Sortie à break-even",
  TRAIL: "Stop suiveur touché",
  TEMPS: "Trade sans élan, coupé",
  WEEKEND: "Fermeture avant le week-end",
  MANUEL: "Clôture manuelle",
};

export function scanText(d: Decision): string {
  const bias = `${d.bias >= 0 ? "haussier" : "baissier"} ${Math.abs(d.bias * 100).toFixed(0)} %`;
  return `${REGIME_LABEL[d.regime]} · biais H1/H4 ${bias} · ${d.verdict}`;
}

export function openText(p: Position): string {
  const why = p.reasons.slice(0, 2).join(" · ");
  return (
    `${p.replay ? "[rattrapage] " : ""}${sideFr(p.dir)} ${lots(p.oz0)} lot à ${px(p.entry)} — SL ${px(p.sl0)}, TP1 ${px(p.tp1)}, TP2 ${px(p.tp2)}. ` +
    `Module principal : ${MODULE_INFO[p.primary].name}. ${why}`
  );
}

export function closeText(tr: Trade): string {
  return `${tr.replay ? "[rattrapage] " : ""}${EXIT_LABEL[tr.reason]} : ${signedR(tr.r)} (${money(tr.pnl)}).`;
}

export function lossText(tr: Trade): string | null {
  return tr.r < -0.1 ? `Perte enregistrée : ${MODULE_INFO[tr.primary].name} perd un peu de poids dans mes décisions.` : null;
}

// Short notification title/body, for phone notifications and server push alike
export function openAlert(p: Position): [string, string] {
  return [`AURUM — ${sideFr(p.dir)} ${lots(p.oz0)} lot`, `Entrée ${px(p.entry)} · SL ${px(p.sl0)} · TP ${px(p.tp2)} · score ${p.score}`];
}

export function closeAlert(tr: Trade): [string, string] {
  return [`AURUM — ${EXIT_LABEL[tr.reason]}`, `${signedR(tr.r)} · ${money(tr.pnl)}`];
}

export function trainingTexts(r: TrainingResult): string[] {
  const s = r.stats;
  const out = [
    `Entraînement terminé : ${s.n} trades simulés en ${r.days.toFixed(0)} jours — ` +
      `réussite ${(s.winRate * 100).toFixed(0)} %, facteur de profit ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "∞"}, ` +
      `${s.sumR >= 0 ? "+" : ""}${s.sumR.toFixed(1)}R. Poids des modules ajustés.`,
  ];
  const cal = r.calibration;
  if (cal) {
    const row = cal.rows.find((x) => x.th === cal.chosen);
    out.push(
      `Calibration auto : seuil ${cal.chosen} retenu. Test sur la période récente jamais optimisée : ` +
        (row ? `${row.valN} trades, ${row.valR >= 0 ? "+" : ""}${row.valR.toFixed(1)}R.` : "pas de données.")
    );
  }
  return out;
}
