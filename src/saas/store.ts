import { create } from "zustand";
import { createJSONStorage, persist, StateStorage } from "zustand/middleware";
import { CATALOG, findCatalogIdea } from "./data/catalog";
import { pickTop, scoreIdea } from "./engine/match";
import { Idea, Match, Profile, Project } from "./types";

// Private browsing, blocked site data or a full quota must not break the app
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* not persisted */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nothing to remove */
    }
  },
};

export interface AppState {
  // Survey answers so far: empty on the first run, the previous answers when the survey is redone
  draft: Partial<Profile>;
  step: number;
  projects: Project[];
  currentId: string | null;
  done: Record<string, boolean>;
  apiKey: string;
  useClaude: boolean;
}

const INITIAL: AppState = {
  draft: {},
  step: 0,
  projects: [],
  currentId: null,
  done: {},
  apiKey: "",
  useClaude: false,
};

export const useApp = create<AppState>()(
  persist(() => INITIAL, {
    name: "tremplin-v1",
    storage: createJSONStorage(() => safeStorage),
  })
);

// Transient messages shown once (not persisted)
export const useFlash = create<{ notice: string | null }>(() => ({ notice: null }));

export function currentProject(s: AppState = useApp.getState()): Project | null {
  return s.projects.find((p) => p.id === s.currentId) ?? s.projects[0] ?? null;
}

export function findIdea(id: string, s: AppState = useApp.getState()): Idea | null {
  const cur = currentProject(s);
  const inCur = cur?.matches.find((m) => m.idea.id === id);
  if (inCur) return inCur.idea;
  for (const p of s.projects) {
    const m = p.matches.find((x) => x.idea.id === id);
    if (m) return m.idea;
  }
  return findCatalogIdea(id) ?? null;
}

// The match shown on an idea page: the stored one when the idea belongs to the current project
// (Claude's reasons are kept), otherwise scored on the fly for the current profile.
export function matchFor(idea: Idea, s: AppState = useApp.getState()): Match | null {
  const cur = currentProject(s);
  if (!cur) return null;
  return cur.matches.find((m) => m.idea.id === idea.id) ?? scoreIdea(cur.profile, idea);
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createProject(profile: Profile, matches: Match[], source: Project["source"]): Project {
  const project: Project = { id: newId(), createdAt: Date.now(), profile, matches, chosenId: null, source };
  useApp.setState((s) => ({ projects: [project, ...s.projects], currentId: project.id, step: 0 }));
  return project;
}

export function catalogMatches(profile: Profile, exclude: Set<string> = new Set(), batch = 0): Match[] {
  return pickTop(profile, CATALOG, 3, exclude, batch);
}

export function appendMatches(projectId: string, matches: Match[]) {
  useApp.setState((s) => ({
    projects: s.projects.map((p) => (p.id === projectId ? { ...p, matches: [...p.matches, ...matches] } : p)),
  }));
}

export function chooseIdea(idea: Idea) {
  const s = useApp.getState();
  const cur = currentProject(s);
  if (!cur) return;
  const matches = cur.matches.some((m) => m.idea.id === idea.id)
    ? cur.matches
    : [...cur.matches, { ...scoreIdea(cur.profile, idea), batch: -1 }];
  useApp.setState({
    projects: s.projects.map((p) => (p.id === cur.id ? { ...p, matches, chosenId: idea.id } : p)),
  });
}

export function toggleTask(key: string) {
  useApp.setState((s) => {
    const done = { ...s.done };
    if (done[key]) delete done[key];
    else done[key] = true;
    return { done };
  });
}

export function deleteProject(id: string) {
  useApp.setState((s) => {
    const projects = s.projects.filter((p) => p.id !== id);
    return { projects, currentId: s.currentId === id ? projects[0]?.id ?? null : s.currentId };
  });
}

export function resetAll() {
  useApp.setState(INITIAL);
}
