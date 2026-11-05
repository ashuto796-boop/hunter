import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, BarChart3, Dices, FlaskConical, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { GridBalls } from "@/components/GridBalls";
import { Notice, useDrawSummary } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmtDate, fmtInt } from "@/lib/format";
import type { Prob, TierRow } from "@/lib/types";

const FEATURES = [
  { to: "/tableau-de-bord", icon: <BarChart3 />, title: "Statistiques rigoureuses", text: "Fréquences, retards, paires, sommes, tests du khi-deux corrigés pour comparaisons multiples." },
  { to: "/generateur", icon: <Dices />, title: "Générateur de grilles", text: "Six stratégies, tirage cryptographique, contraintes personnalisées, unicité garantie." },
  { to: "/optimiseur", icon: <Sparkles />, title: "Optimisation de portefeuilles", text: "Recuit simulé, tabou, génétique, CP-SAT : diversité et couverture mesurables." },
  { to: "/simulateur", icon: <Activity />, title: "Monte-Carlo & calcul exact", text: "Jusqu'à 5 millions de tirages simulés et énumération exacte des 139 838 160 tirages." },
  { to: "/budget", icon: <Wallet />, title: "Budget & jackpot", text: "Coûts, espérances sous hypothèses explicites, partage du jackpot, sensibilité." },
  { to: "/audit", icon: <ShieldCheck />, title: "Audit mathématique", text: "Vérification automatique des probabilités, de l'uniformité et des simulations." },
];

export default function Home() {
  const { data: summary } = useDrawSummary();
  const { data: probs } = useQuery({
    queryKey: ["probabilities"],
    queryFn: () => api.get<{ total_combinations: number; jackpot: Prob; any_prize: Prob; tiers: TierRow[] }>("/math/probabilities"),
  });
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-indigo-950/80 via-night-800 to-violet-950/60 p-6 sm:p-10">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -bottom-24 right-40 h-60 w-60 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
            <FlaskConical className="size-3.5" /> Analyse statistique transparente — sans promesse de gain
          </div>
          <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">
            EuroMillions <span className="gold-text">Quantum Analytics</span>
          </h1>
          <p className="text-base text-muted-foreground sm:text-lg">
            Analysez l'historique, générez et optimisez des portefeuilles de grilles selon des critères mesurables, et comprenez
            exactement ce que vous jouez.
          </p>
          <GridBalls numbers={[7, 14, 23, 38, 45]} stars={[3, 11]} />
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="gold" size="lg"><Link to="/generateur">Générer des grilles <ArrowRight /></Link></Button>
            <Button asChild variant="outline" size="lg"><Link to="/tableau-de-bord">Voir les statistiques</Link></Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold">La règle fondamentale</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Une grille comporte 5 numéros parmi 50 et 2 étoiles parmi 12, soit
              <span className="mx-1 font-semibold text-foreground num">C(50,5) × C(12,2) = {fmtInt(probs?.total_combinations ?? 139838160)}</span>
              combinaisons. Pour un tirage équitable, <strong className="text-foreground">chaque grille valide a exactement la même probabilité</strong> de
              remporter le jackpot : {probs?.jackpot.one_in ?? "1 chance sur 139 838 160"} ({probs?.jackpot.scientific ?? "7,15 × 10⁻⁹"}).
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Les scores de ce logiciel mesurent la <em>diversification</em>, la <em>couverture</em> ou des <em>motifs</em> de grilles —
              jamais une probabilité de sortie. Les statistiques historiques sont descriptives.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold">Vos données</h2>
            {summary && summary.count > 0 ? (
              <div className="space-y-1 text-sm">
                <div className="font-display text-3xl font-semibold num">{fmtInt(summary.count)}</div>
                <div className="text-muted-foreground">tirages du {fmtDate(summary.first_date)} au {fmtDate(summary.last_date)}</div>
                {summary.is_demo && <Notice variant="warning">Jeu de démonstration fictif.</Notice>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun historique importé pour le moment.</p>
            )}
            <Button asChild variant="outline" size="sm"><Link to="/historique">Gérer l'historique</Link></Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="group">
            <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-violet-500/50">
              <CardContent className="space-y-2 p-5">
                <div className="w-fit rounded-lg bg-violet-500/15 p-2 text-violet-300 [&_svg]:size-5">{f.icon}</div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.text}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {probs && (
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-3 text-lg font-semibold">Probabilités exactes par rang (une grille)</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {probs.tiers.map((t) => (
                <div key={t.rank} className="rounded-lg border bg-background/40 p-2.5 text-center">
                  <div className="text-[11px] text-muted-foreground">Rang {t.rank}</div>
                  <div className="font-display font-semibold">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground num">{t.probability.one_in.replace("1 chance sur ", "1/").replace("≈ ", "")}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Probabilité de gagner au moins un rang avec une grille : {probs.any_prize.one_in}.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
