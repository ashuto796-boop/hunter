import { Settings } from "./types";

// Published by the GitHub Actions server (.github/workflows/aurum-server.yml) on the aurum-data branch
export const DEFAULT_SERVER_URL = "https://raw.githubusercontent.com/ashuto796-boop/hunter/aurum-data/state.json";

export const DEFAULT_SETTINGS: Settings = {
  capital: 10000,
  riskPct: 1,
  mode: "auto",
  tf: 15,
  spread: 0.3,
  maxTradesDay: 4,
  maxDailyLossPct: 3,
  source: "auto",
  trainDays: 60,
  keepAwake: true,
  notify: true,
  sound: true,
  server: true,
  serverUrl: DEFAULT_SERVER_URL,
};
