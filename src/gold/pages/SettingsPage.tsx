import { ReactNode, useState } from "react";
import { useGold } from "../store";
import { bot } from "../bot";
import { Settings } from "../engine/types";
import { THRESHOLDS } from "../engine/brain";
import { SOURCES } from "../data/feed";
import { askNotifications } from "../device";

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div style={{ minWidth: 0 }}>
        <div className="field-label">{label}</div>
        {help && <div className="field-help">{help}</div>}
      </div>
      {children}
    </div>
  );
}

function NumberInput({ value, min, max, step, onCommit }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  const commit = () => {
    const v = Math.min(max, Math.max(min, parseFloat(txt.replace(",", "."))));
    if (Number.isNaN(v)) setTxt(String(value));
    else {
      setTxt(String(v));
      if (v !== value) onCommit(v);
    }
  };
  return (
    <input
      className="input"
      inputMode="decimal"
      value={txt}
      step={step}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={String(v)} className={v === value ? "on" : ""} onClick={() => v !== value && onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function SettingsPage() {
  const s = useGold((x) => x.settings);
  const source = useGold((x) => x.source);
  const set = (p: Partial<Settings>) => bot.updateSettings(p);

  return (
    <div className="page">
      <section className="card">
        <div className="card-title">Style de l'IA</div>
        <Seg
          value={s.mode}
          options={[
            ["prudent", "Prudent"],
            ["equilibre", "Équilibré"],
            ["agressif", "Agressif"],
          ]}
          onChange={(mode) => set({ mode })}
        />
        <p className="note" style={{ marginTop: 10 }}>
          Seuil de confiance pour entrer : {THRESHOLDS[s.mode]}/100.{" "}
          {s.mode === "prudent" ? "Peu de trades, seulement les meilleures confluences." : s.mode === "equilibre" ? "Le réglage recommandé." : "Plus de trades, plus de bruit."}
        </p>
      </section>

      <section className="card">
        <div className="card-title">Gestion du risque</div>
        <Field label="Capital du compte démo" help="Appliqué au prochain reset du compte">
          <NumberInput value={s.capital} min={100} max={10_000_000} step={100} onCommit={(capital) => set({ capital })} />
        </Field>
        <Field label="Risque par trade (%)" help="Les pros risquent 0,5 à 1 %">
          <NumberInput value={s.riskPct} min={0.1} max={5} step={0.1} onCommit={(riskPct) => set({ riskPct })} />
        </Field>
        <Field label="Trades max / jour">
          <NumberInput value={s.maxTradesDay} min={1} max={20} step={1} onCommit={(maxTradesDay) => set({ maxTradesDay: Math.round(maxTradesDay) })} />
        </Field>
        <Field label="Perte max / jour (%)" help="L'IA s'arrête jusqu'au lendemain">
          <NumberInput value={s.maxDailyLossPct} min={0.5} max={20} step={0.5} onCommit={(maxDailyLossPct) => set({ maxDailyLossPct })} />
        </Field>
        <Field label="Spread simulé ($/oz)" help="Coût de ton courtier sur l'or">
          <NumberInput value={s.spread} min={0} max={3} step={0.05} onCommit={(spread) => set({ spread })} />
        </Field>
      </section>

      <section className="card">
        <div className="card-title">Marché</div>
        <Field label="Unité de temps" help="Change de trader : le journal repart">
          <Seg
            value={s.tf}
            options={[
              [5, "M5"],
              [15, "M15"],
            ]}
            onChange={(tf) => confirm("Changer d'unité de temps clôture la position et recharge l'IA. Continuer ?") && set({ tf })}
          />
        </Field>
        <div className="field" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div>
            <div className="field-label">Source des prix</div>
            <div className="field-help">Actuelle : {source ? SOURCES[source].label : "—"}</div>
          </div>
          <Seg
            value={s.source}
            options={[
              ["auto", "Auto"],
              ["xau", "XAU"],
              ["paxg", "PAXG"],
              ["sim", "Simulé"],
            ]}
            onChange={(src) => set({ source: src })}
          />
        </div>
      </section>

      <section className="card">
        <div className="card-title">Téléphone</div>
        <Field label="Garder l'écran allumé" help="Le navigateur met l'IA en pause quand l'écran s'éteint">
          <Toggle on={s.keepAwake} label="Garder l'écran allumé" onChange={(keepAwake) => set({ keepAwake })} />
        </Field>
        <Field label="Notifications" help="Entrées et sorties de trade">
          <Toggle
            on={s.notify}
            label="Notifications"
            onChange={async (notify) => {
              if (notify && !(await askNotifications())) alert("Notifications refusées par le navigateur. Sur iPhone, ajoute d'abord AURUM à l'écran d'accueil.");
              set({ notify });
            }}
          />
        </Field>
        <Field label="Sons">
          <Toggle on={s.sound} label="Sons" onChange={(sound) => set({ sound })} />
        </Field>
      </section>

      <section className="card">
        <div className="card-title">Compte</div>
        <button className="btn danger block" onClick={() => confirm(`Remettre le compte démo à ${s.capital} $ ? L'historique des trades sera effacé (l'expérience de l'IA est conservée).`) && bot.resetAccount()}>
          Réinitialiser le compte démo
        </button>
      </section>

      <section className="card">
        <div className="card-title">Comment ça marche</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          AURUM analyse l'or à chaque clôture de bougie avec 7 stratégies de pros (liquidité, tendance, Londres, squeeze, momentum, retour à la moyenne, divergence). Un cerveau central pèse leurs votes selon le régime du marché, la tendance H1/H4, la session et leurs résultats passés. Il ne trade que si la confiance dépasse le seuil, avec stop, prise de profit partielle à 1R, break-even et stop suiveur.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 10 }}>
          Quand tu rouvres l'app, l'IA rejoue les bougies manquées exactement comme un serveur 24h/24 l'aurait fait (trades marqués « rattrapage »).
        </p>
        <p className="note" style={{ marginTop: 10 }}>
          Mode démo uniquement : aucun ordre réel n'est envoyé à un courtier. Aucune IA ne peut garantir des gains.
        </p>
      </section>
    </div>
  );
}
