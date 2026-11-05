import {
  Activity,
  BarChart3,
  Brain,
  Calculator,
  CheckCircle2,
  Coins,
  Dices,
  FlaskConical,
  Gem,
  GitCompare,
  History,
  Home,
  LayoutDashboard,
  Menu,
  Microscope,
  Network,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useDrawSummary } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

export const NAV: { group: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Vue d'ensemble",
    items: [
      { to: "/", label: "Accueil", icon: <Home /> },
      { to: "/tableau-de-bord", label: "Tableau de bord", icon: <LayoutDashboard /> },
      { to: "/historique", label: "Historique des tirages", icon: <History /> },
    ],
  },
  {
    group: "Statistiques",
    items: [
      { to: "/statistiques/numeros", label: "Statistiques des numéros", icon: <BarChart3 /> },
      { to: "/statistiques/etoiles", label: "Statistiques des étoiles", icon: <Star /> },
      { to: "/analyse", label: "Analyse des combinaisons", icon: <Network /> },
      { to: "/recherche", label: "Mode recherche", icon: <Microscope /> },
    ],
  },
  {
    group: "Grilles & portefeuilles",
    items: [
      { to: "/generateur", label: "Générateur de grilles", icon: <Dices /> },
      { to: "/optimiseur", label: "Optimiseur de portefeuilles", icon: <Sparkles /> },
      { to: "/strategies", label: "Laboratoire de stratégies", icon: <FlaskConical /> },
      { to: "/comparateur", label: "Comparateur", icon: <GitCompare /> },
      { to: "/mes-grilles", label: "Mes grilles sauvegardées", icon: <Save /> },
      { to: "/verification", label: "Vérification des résultats", icon: <CheckCircle2 /> },
    ],
  },
  {
    group: "Simulation & risques",
    items: [
      { to: "/simulateur", label: "Simulateur Monte-Carlo", icon: <Activity /> },
      { to: "/laboratoire-ia", label: "Laboratoire IA", icon: <Brain /> },
      { to: "/jackpot", label: "Analyse du jackpot", icon: <Coins /> },
      { to: "/budget", label: "Gestion du budget", icon: <Wallet /> },
    ],
  },
  {
    group: "Système",
    items: [
      { to: "/audit", label: "Audit mathématique", icon: <ShieldCheck /> },
      { to: "/parametres", label: "Paramètres", icon: <Settings /> },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div className="flex items-center gap-2.5 px-2">
        <div className="rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 p-2 shadow-lg shadow-violet-900/40">
          <Gem className="size-5 text-amber-200" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold">EuroMillions</div>
          <div className="font-display text-xs font-semibold gold-text">Quantum Analytics</div>
        </div>
      </div>
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.to === "/"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground [&_svg]:size-4",
                      isActive && "bg-gradient-to-r from-violet-600/30 to-transparent text-foreground shadow-inner [&_svg]:text-amber-300",
                    )
                  }
                >
                  {it.icon}
                  {it.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-100/80">
        Chaque grille a la même probabilité de gagner : <span className="font-semibold">1 sur 139 838 160</span>. Aucun score n'est une probabilité de sortie.
      </div>
    </nav>
  );
}

function DataStatus() {
  const { data } = useDrawSummary();
  if (!data) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {data.count > 0 ? (
        <Badge variant="secondary" className="font-normal">
          <Calculator className="size-3" /> {fmtInt(data.count)} tirages · {fmtDate(data.first_date)} → {fmtDate(data.last_date)}
        </Badge>
      ) : (
        <Badge variant="destructive">Aucun tirage importé</Badge>
      )}
      {data.is_demo && <Badge variant="gold">Données de démonstration FICTIVES</Badge>}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data } = useDrawSummary();
  const loc = useLocation();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-night-900/70 backdrop-blur lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r bg-night-900">
            <button className="absolute right-3 top-3 rounded p-1 text-muted-foreground" onClick={() => setOpen(false)} aria-label="Fermer le menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/75 px-4 py-2.5 backdrop-blur lg:px-8">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="size-5" />
          </button>
          <DataStatus />
        </header>
        {data?.is_demo && (
          <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-100 lg:px-8">
            Les tirages affichés sont <strong>fictifs</strong> (jeu de démonstration). Importez l'historique officiel pour des statistiques réelles.
          </div>
        )}
        <main key={loc.pathname} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        <footer className="border-t px-4 py-4 text-center text-[11px] text-muted-foreground lg:px-8">
          EuroMillions Quantum Analytics — outil d'analyse statistique. Jouer comporte des risques : endettement, isolement, dépendance.
          Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).
        </footer>
      </div>
    </div>
  );
}
