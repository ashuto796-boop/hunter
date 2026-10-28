import { ReactNode, useState } from "react";
import { dateTime } from "../ui/format";
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

const MODE_LABEL = { auto: "Auto", prudent: "Prudent", equilibre: "Équilibré", agressif: "Agressif" } as const;

// raw.githubusercontent.com/<owner>/<repo>/... -> github.com/<owner>/<repo>
function repoOf(url: string): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//.exec(url);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

function ServerSection() {
  const s = useGold((x) => x.settings);
  const remote = useGold((x) => x.remote);
  const note = useGold((x) => x.serverNote);
  const trader = useGold((x) => x.trader);
  const [url, setUrl] = useState(s.serverUrl);
  const repo = repoOf(s.serverUrl);
  return (
    <section className="card">
      <div className="card-title">
        <span>Serveur 24/7</span>
        {remote ? <span className="chip gold">connecté</span> : s.server && <span className="chip">hors ligne</span>}
      </div>
      <Field label="Suivre le serveur 24/7" help="L'IA trade sur GitHub toutes les 15 min, même téléphone éteint">
        <Toggle on={s.server} label="Suivre le serveur 24/7" onChange={(server) => bot.updateSettings({ server })} />
      </Field>
      {remote && (
        <p className="note" style={{ margin: "10px 0" }}>
          Dernier passage le {dateTime(remote.updatedAt)} · {remote.runs} passages depuis le {dateTime(remote.startedAt)}. Réglages du serveur : risque {trader.riskPct} %, mode{" "}
          {MODE_LABEL[trader.mode]}, M{trader.tf}, capital {trader.capital.toLocaleString("fr-FR")} $.
        </p>
      )}
      {!remote && note && <p className="note" style={{ margin: "10px 0" }}>{note}</p>}
      <p className="note" style={{ margin: "10px 0" }}>
        Carnet du soir écrit par Claude : ajoute ta clé API Anthropic dans les secrets du dépôt GitHub sous le nom ANTHROPIC_API_KEY. Une analyse par soir,
        quelques centimes par mois.
      </p>
      {repo && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <a className="btn block" href={`${repo}/edit/main/server/config.json`} target="_blank" rel="noreferrer">
            Modifier les réglages du serveur
          </a>
          <a className="btn block" href={`${repo}/actions/workflows/aurum-server.yml`} target="_blank" rel="noreferrer">
            Voir les passages du serveur
          </a>
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary className="field-help">Adresse du serveur (avancé)</summary>
        <input
          className="input"
          style={{ width: "100%", textAlign: "left", marginTop: 8, fontSize: 12 }}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url.trim() && url !== s.serverUrl && bot.updateSettings({ serverUrl: url.trim() })}
        />
      </details>
    </section>
  );
}

export function SettingsPage() {
  const s = useGold((x) => x.settings);
  const source = useGold((x) => x.source);
  const threshold = useGold((x) => x.threshold);
  const remote = useGold((x) => x.remote);
  const set = (p: Partial<Settings>) => bot.updateSettings(p);

  return (
    <div className="page">
      <ServerSection />
      {remote && (
        <div className="banner">
          <span>ℹ️</span>
          <span>Les réglages ci-dessous servent quand le téléphone trade lui-même. Le serveur suit son fichier de réglages sur GitHub (bouton ci-dessus).</span>
        </div>
      )}
      <section className="card">
        <div className="card-title">Style de l'IA</div>
        <Seg
          value={s.mode}
          options={[
            ["auto", "Auto"],
            ["prudent", "Prudent"],
            ["equilibre", "Équilibré"],
            ["agressif", "Agressif"],
          ]}
          onChange={(mode) => set({ mode })}
        />
        <p className="note" style={{ marginTop: 10 }}>
          {s.mode === "auto" ? (
            <>
              Seuil choisi par l'IA : {threshold}/100. Elle compare plusieurs seuils sur 70 % de l'historique puis vérifie son choix sur les 30 % restants (résultat dans le Labo).
            </>
          ) : (
            <>
              Seuil de confiance pour entrer : {THRESHOLDS[s.mode]}/100.{" "}
              {s.mode === "prudent" ? "Peu de trades, seulement les meilleures confluences." : s.mode === "equilibre" ? "Un bon compromis." : "Plus de trades, plus de bruit."}
            </>
          )}
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
              ["xau", "Binance"],
              ["bitget", "Bitget"],
              ["paxg", "PAXG"],
              ["sim", "Simu"],
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
        {remote ? (
          <p className="note">
            Le compte affiché est celui du serveur. Pour le remettre à zéro, supprime la branche « aurum-data » sur GitHub : le serveur repartira d'un compte neuf au passage suivant.
          </p>
        ) : (
          <button
            className="btn danger block"
            onClick={() => confirm(`Remettre le compte démo à ${s.capital} $ ? L'historique des trades sera effacé (l'expérience de l'IA est conservée).`) && bot.resetAccount()}
          >
            Réinitialiser le compte démo
          </button>
        )}
      </section>

      <section className="card">
        <div className="card-title">Comment ça marche</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          AURUM analyse l'or à chaque clôture de bougie avec 7 stratégies de pros (liquidité, tendance, Londres, squeeze, momentum, retour à la moyenne, divergence). Un cerveau central pèse leurs votes selon le régime du marché, la tendance H1/H4, la session et leurs résultats passés. Il ne trade que si la confiance dépasse le seuil, avec stop, prise de profit partielle à 1R, break-even et stop suiveur.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 10 }}>
          Elle tient aussi une mémoire : chaque signal, tradé ou non, est suivi jusqu'à son stop ou son objectif, et ces leçons ajustent la confiance qu'elle
          accorde à chaque spécialiste.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 10 }}>
          Avec le serveur 24/7, l'IA tourne sur GitHub toutes les 15 minutes même téléphone éteint ; l'app affiche son compte et ses décisions. Sans serveur, l'IA
          du téléphone rejoue les bougies manquées à la réouverture (trades marqués « rattrapage »).
        </p>
        <p className="note" style={{ marginTop: 10 }}>
          Mode démo uniquement : aucun ordre réel n'est envoyé à un courtier. Aucune IA ne peut garantir des gains.
        </p>
      </section>
    </div>
  );
}
