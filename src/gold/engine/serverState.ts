// What the 24/7 server publishes after every run (state.json) and the phone app mirrors.
import { Decision, Settings, TraderState } from "./types";
import { TrainingResult } from "./training";
import { Thought } from "./narrate";
import { MediaState } from "./media";
import { LivePublic } from "./live";

export const SERVER_STATE_VERSION = 1;

export interface ServerState {
  version: number;
  host: string; // "github-actions", "vps", ...
  startedAt: number;
  updatedAt: number; // end of the last run
  runs: number;
  source: string; // price source id the account is denominated in ("paxg", "xau")
  settings: Settings;
  st: TraderState;
  lastProcessedT: number; // close time of the last candle the server traded
  lastRecap?: string; // trading day of the last daily recap push
  pushTag?: string; // fingerprint of the push channels already greeted (never the channel itself)
  media?: MediaState; // press review about gold
  note?: { day: string; at: number; text: string; model: string } | null; // evening log written by Claude
  live?: LivePublic; // real-money account at the broker, sealed with the owner's passphrase
  autoThreshold: number;
  trainedAt: number;
  training: TrainingResult | null;
  decision: Decision | null;
  thoughts: Thought[];
  price: number;
}

export function isServerState(x: unknown): x is ServerState {
  const s = x as ServerState;
  return !!s && s.version === SERVER_STATE_VERSION && typeof s.updatedAt === "number" && !!s.st && Array.isArray(s.thoughts);
}
