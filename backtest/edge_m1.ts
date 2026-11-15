// What 1-minute gold actually does: the facts a home-made scalping strategy can be built on.
// Every figure is shown for 2022-2024 and 2025-2026 separately: an effect that does not hold in
// both periods is not one to build on. Moves are in dollars per ounce and compared with the
// spread paid on a round trip.
//
//   npx tsx backtest/edge_m1.ts --data xau_m1_4y.json
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const file = args[args.indexOf("--data") + 1];
const raw = JSON.parse(readFileSync(file, "utf8")) as number[][];
const N = raw.length;
const T = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), S = new Float64Array(N);
raw.forEach((r, i) => ((T[i] = r[0]), (O[i] = r[1]), (H[i] = r[2]), (L[i] = r[3]), (C[i] = r[4]), (S[i] = Math.max(0, r[5]))));
const SPLIT = Date.UTC(2025, 0, 1) / 1000;
const lastSunday = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay());
};
const nthSunday = (y: number, m: number, n: number) => Date.UTC(y, m, 1 + ((7 - new Date(Date.UTC(y, m, 1)).getUTCDay()) % 7) + 7 * (n - 1));
const uk = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday(y, 2) + 3600e3 && ms < lastSunday(y, 9) + 3600e3 ? 1 : 0;
};
const us = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return ms >= nthSunday(y, 2, 2) + 7 * 3600e3 && ms < nthSunday(y, 10, 1) + 6 * 3600e3 ? -4 : -5;
};
const LON = new Int16Array(N), NY = new Int16Array(N), DAY = new Int32Array(N);
for (let i = 0; i < N; i++) {
  const ms = T[i] * 1000;
  const lon = new Date(ms + uk(ms) * 3600e3), ny = new Date(ms + us(ms) * 3600e3);
  LON[i] = lon.getUTCHours() * 60 + lon.getUTCMinutes();
  NY[i] = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  DAY[i] = Math.floor((ms + us(ms) * 3600e3 + 7 * 3600e3) / 864e5);
}
// index of the minute `h` minutes later (same session, no gap), or -1
const ahead = (i: number, h: number) => {
  const j = i + h;
  if (j >= N || T[j] - T[i] !== h * 60) return -1;
  return j;
};
const atr60 = new Float64Array(N);
for (let i = 1; i < N; i++) atr60[i] = atr60[i - 1] + (Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) - atr60[i - 1]) / 60;

type Acc = { n: number; sum: number; sq: number; win: number };
const acc = (): Acc => ({ n: 0, sum: 0, sq: 0, win: 0 });
const add = (a: Acc, x: number) => ((a.n++, (a.sum += x), (a.sq += x * x)), x > 0 && a.win++);
const show = (a: Acc) => {
  if (!a.n) return "     —";
  const m = a.sum / a.n;
  const se = Math.sqrt(Math.max(0, a.sq / a.n - m * m) / a.n);
  return `${String(a.n).padStart(6)} ${(m >= 0 ? "+" : "") + m.toFixed(3)} $ (t ${(m / (se || 1)).toFixed(1)}) ${((a.win / a.n) * 100).toFixed(0)}%`;
};
const both = (title: string, f: (period: 0 | 1) => Acc) => console.log(`${title.padEnd(62)} 2022-24 ${show(f(0))} | 2025-26 ${show(f(1))}`);

// 1. When does gold move enough? Typical 15-minute range against the spread, by London hour
console.log("== 1. Mouvement sur 15 min et écart, par heure de Londres (2025-26)");
for (let h = 0; h < 24; h++) {
  let mv = 0, sp = 0, n = 0;
  for (let i = 0; i < N; i += 15) {
    if (T[i] < SPLIT || Math.floor(LON[i] / 60) !== h) continue;
    const j = ahead(i, 15);
    if (j < 0) continue;
    let hi = -Infinity, lo = Infinity;
    for (let k = i; k <= j; k++) (hi = Math.max(hi, H[k])), (lo = Math.min(lo, L[k]));
    mv += hi - lo;
    sp += S[i];
    n++;
  }
  if (n > 50) console.log(`${String(h).padStart(2)} h  amplitude 15 min ${(mv / n).toFixed(2)} $ · écart ${(sp / n).toFixed(2)} $ · rapport ${(mv / sp).toFixed(1)}`);
}

// 2. Does a move continue or turn back? After a strong move over `p` minutes, the next `h` minutes
// in the same direction, spread paid
console.log("\n== 2. Après un fort mouvement (au-delà de k × ATR), la suite dans le même sens, écart payé");
for (const sess of ["Londres", "New York", "Asie"] as const)
  for (const p of [5, 15, 30])
    for (const k of [2, 4])
      for (const h of [5, 15, 30]) {
        both(`${sess} · mouvement ${p} min > ${k} ATR → suite ${h} min`, (per) => {
          const a = acc();
          for (let i = p; i < N; i++) {
            if (per === 0 ? T[i] >= SPLIT : T[i] < SPLIT) continue;
            const inS = sess === "Londres" ? LON[i] >= 7 * 60 && LON[i] < 12 * 60 : sess === "New York" ? NY[i] >= 8 * 60 && NY[i] < 12 * 60 : LON[i] >= 0 && LON[i] < 6 * 60;
            if (!inS || T[i] - T[i - p] !== p * 60) continue;
            const mv = C[i] - C[i - p];
            if (Math.abs(mv) < k * atr60[i]) continue;
            const j = ahead(i, h);
            if (j < 0) continue;
            add(a, Math.sign(mv) * (C[j] - C[i]) - S[i]);
            i += h; // independent samples
          }
          return a;
        });
      }

// 3. Session levels: first break of the Asian range during London, held or failed
console.log("\n== 3. Première sortie du range asiatique pendant Londres (07:00-11:00)");
for (const h of [15, 30, 60])
  for (const kind of ["suivre la cassure", "cassure ratée (retour dans le range en 3 min) : jouer le retour"] as const)
    both(`${kind} · ${h} min`, (per) => {
      const a = acc();
      let day = -1, hi = -Infinity, lo = Infinity, done = false;
      for (let i = 0; i < N; i++) {
        if (DAY[i] !== day) (day = DAY[i]), (hi = -Infinity), (lo = Infinity), (done = false);
        if (LON[i] < 7 * 60 || LON[i] >= 22 * 60) {
          hi = Math.max(hi, H[i]);
          lo = Math.min(lo, L[i]);
          continue;
        }
        if (done || LON[i] > 11 * 60 || !Number.isFinite(hi)) continue;
        const dir = C[i] > hi ? 1 : C[i] < lo ? -1 : 0;
        if (!dir) continue;
        done = true;
        if (per === 0 ? T[i] >= SPLIT : T[i] < SPLIT) continue;
        if (kind === "suivre la cassure") {
          const j = ahead(i, h);
          if (j >= 0) add(a, dir * (C[j] - C[i]) - S[i]);
        } else {
          const back = [1, 2, 3].map((d) => ahead(i, d)).find((j) => j >= 0 && (dir === 1 ? C[j] < hi : C[j] > lo));
          if (back === undefined) continue;
          const j = ahead(back, h);
          if (j >= 0) add(a, -dir * (C[j] - C[back]) - S[back]);
        }
      }
      return a;
    });

// 4. New York open (09:30): does the first move set the tone?
console.log("\n== 4. Ouverture de New York : le sens des premières minutes continue-t-il ?");
for (const first of [5, 15, 30])
  for (const h of [15, 30, 60, 120])
    both(`sens des ${first} premières min → ${h} min suivantes`, (per) => {
      const a = acc();
      let day = -1, start = -1, done = false;
      for (let i = 0; i < N; i++) {
        if (DAY[i] !== day) (day = DAY[i]), (start = -1), (done = false);
        if (NY[i] === 9 * 60 + 30) start = i;
        if (done || start < 0 || NY[i] !== 9 * 60 + 30 + first) continue;
        done = true;
        if (per === 0 ? T[i] >= SPLIT : T[i] < SPLIT) continue;
        const dir = Math.sign(C[i] - O[start]);
        const j = ahead(i, h);
        if (dir && j >= 0) add(a, dir * (C[j] - C[i]) - S[i]);
      }
      return a;
    });

// 5. News minute (08:30 New York): the reaction, then?
console.log("\n== 5. Annonces de 8 h 30 (New York) : la réaction de la première minute, puis ?");
for (const h of [5, 15, 30, 60])
  for (const minMove of [2, 5])
    both(`réaction > ${minMove} $ en 1 min → suivre ${h} min`, (per) => {
      const a = acc();
      for (let i = 1; i < N; i++) {
        if (NY[i] !== 8 * 60 + 31 || (per === 0 ? T[i] >= SPLIT : T[i] < SPLIT)) continue;
        const mv = C[i] - O[i - 1];
        if (Math.abs(mv) < minMove) continue;
        const j = ahead(i, h);
        if (j >= 0) add(a, Math.sign(mv) * (C[j] - C[i]) - S[i]);
      }
      return a;
    });

// 6. Day of the week and hour: is there a drift worth riding?
console.log("\n== 6. Dérive moyenne sur 1 h selon l'heure de New York (achat, écart payé)");
for (let h = 0; h < 24; h++)
  both(`${String(h).padStart(2)} h New York, achat pendant 1 h`, (per) => {
    const a = acc();
    for (let i = 0; i < N; i++) {
      if (NY[i] !== h * 60 || (per === 0 ? T[i] >= SPLIT : T[i] < SPLIT)) continue;
      const j = ahead(i, 60);
      if (j >= 0) add(a, C[j] - C[i] - S[i]);
    }
    return a;
  });
