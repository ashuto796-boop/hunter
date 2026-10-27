import { useSyncExternalStore } from "react";

// Hash routes, so the phone's back button works and GitHub Pages needs no rewrite rules
export type Route =
  | { name: "home" }
  | { name: "survey" }
  | { name: "ideas" }
  | { name: "idea"; id: string; tab: IdeaTab }
  | { name: "explore" }
  | { name: "settings" };

export type IdeaTab = "idee" | "prompt" | "plan";

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case "sondage":
      return { name: "survey" };
    case "idees":
      return { name: "ideas" };
    case "idee":
      if (parts[1]) {
        const tab = parts[2] === "prompt" || parts[2] === "plan" ? parts[2] : "idee";
        return { name: "idea", id: parts[1], tab };
      }
      return { name: "ideas" };
    case "explorer":
      return { name: "explore" };
    case "reglages":
      return { name: "settings" };
    default:
      return { name: "home" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "survey":
      return "#/sondage";
    case "ideas":
      return "#/idees";
    case "idea":
      return `#/idee/${encodeURIComponent(route.id)}${route.tab === "idee" ? "" : `/${route.tab}`}`;
    case "explore":
      return "#/explorer";
    case "settings":
      return "#/reglages";
  }
}

export function go(route: Route, replace = false) {
  const h = href(route);
  if (replace) history.replaceState(null, "", h);
  else if (location.hash !== h) location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parse(hash);
}
