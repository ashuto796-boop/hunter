// Phone integrations: keep the screen awake while the autopilot runs, push notifications, sounds.
let wakeLock: { release(): Promise<void> } | null = null;

export async function keepAwake(on: boolean) {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
  try {
    if (on && !wakeLock && nav.wakeLock && document.visibilityState === "visible") {
      wakeLock = await nav.wakeLock.request("screen");
      (wakeLock as unknown as EventTarget).addEventListener?.("release", () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

let swReg: ServiceWorkerRegistration | null = null;

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch {
    swReg = null;
  }
}

export async function askNotifications(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export function notify(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, icon: "./icon-192.png", badge: "./icon-192.png", tag: "aurum" };
  try {
    if (swReg) swReg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch {
    /* some mobile browsers only allow notifications from an installed app */
  }
}

let audio: AudioContext | null = null;

export function beep(kind: "open" | "win" | "loss") {
  try {
    audio ??= new AudioContext();
    const notes = kind === "open" ? [660, 880] : kind === "win" ? [523, 659, 784] : [392, 311];
    notes.forEach((f, k) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t0 = audio!.currentTime + k * 0.13;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g).connect(audio!.destination);
      o.start(t0);
      o.stop(t0 + 0.13);
    });
  } catch {
    /* audio unavailable */
  }
}

export function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
