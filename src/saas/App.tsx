import { useEffect } from "react";
import { Explore } from "./pages/Explore";
import { Home } from "./pages/Home";
import { IdeaPage } from "./pages/IdeaPage";
import { Ideas } from "./pages/Ideas";
import { Settings } from "./pages/Settings";
import { Survey } from "./pages/Survey";
import { go, Route, useRoute } from "./router";
import { useApp, useFlash } from "./store";
import { IconBulb, IconCompass, IconHome, IconSettings, Logo } from "./ui/Icons";

const NAV: { route: Route; label: string; Icon: typeof IconHome }[] = [
  { route: { name: "home" }, label: "Accueil", Icon: IconHome },
  { route: { name: "ideas" }, label: "Mes idées", Icon: IconBulb },
  { route: { name: "explore" }, label: "Explorer", Icon: IconCompass },
  { route: { name: "settings" }, label: "Réglages", Icon: IconSettings },
];

function isActive(nav: Route, current: Route) {
  return nav.name === current.name || (nav.name === "ideas" && current.name === "idea");
}

export default function App() {
  const route = useRoute();
  const hasProject = useApp((s) => s.projects.length > 0);

  useEffect(() => {
    if (route.name !== "ideas") useFlash.setState({ notice: null });
  }, [route.name]);

  const survey = route.name === "survey";

  return (
    <div className={`app ${survey ? "is-survey" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="Tremplin, accueil">
          <span className="brand-mark">
            <Logo />
          </span>
          <span className="brand-name">Tremplin</span>
        </a>
        {!survey && (
          <nav className="topnav" aria-label="Navigation">
            {NAV.map(({ route: r, label }) => (
              <button key={r.name} className={isActive(r, route) ? "on" : undefined} aria-current={isActive(r, route) ? "page" : undefined} onClick={() => go(r)}>
                {label}
              </button>
            ))}
          </nav>
        )}
        {!survey && !hasProject && (
          <button className="btn btn-primary btn-sm topbar-cta" onClick={() => go({ name: "survey" })}>
            Commencer
          </button>
        )}
      </header>

      {route.name === "home" && <Home />}
      {route.name === "survey" && <Survey />}
      {route.name === "ideas" && <Ideas />}
      {route.name === "idea" && <IdeaPage id={route.id} tab={route.tab} />}
      {route.name === "explore" && <Explore />}
      {route.name === "settings" && <Settings />}

      {!survey && (
        <footer className="footer">
          <span>Tremplin · idées de SaaS, prompts Claude et plans de lancement.</span>
          <span>Les tendances citées sont à vérifier avant de te lancer ; ce n'est pas un conseil juridique ou financier.</span>
        </footer>
      )}

      {!survey && (
        <nav className="tabbar" aria-label="Navigation">
          {NAV.map(({ route: r, label, Icon }) => (
            <button key={r.name} className={`tab ${isActive(r, route) ? "active" : ""}`} aria-current={isActive(r, route) ? "page" : undefined} onClick={() => go(r)}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
