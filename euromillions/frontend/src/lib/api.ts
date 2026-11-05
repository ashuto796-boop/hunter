/** Client HTTP de l'API FastAPI. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";
const KEY_STORAGE = "em_api_key";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(v: string): void {
  try {
    if (v) localStorage.setItem(KEY_STORAGE, v);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* stockage indisponible : la clé n'est pas mémorisée */
  }
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const k = getApiKey();
  if (k) h["X-API-Key"] = k;
  return h;
}

async function parseError(res: Response): Promise<ApiError> {
  let msg = `Erreur ${res.status}`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") msg = body.detail;
    else if (Array.isArray(body?.detail)) msg = body.detail.map((d: { msg?: string }) => d.msg).join(" ; ");
  } catch {
    /* corps non JSON */
  }
  if (res.status === 0 || res.status >= 502) msg = "Serveur injoignable : vérifiez que l'API est démarrée.";
  return new ApiError(res.status, msg);
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query): string {
  if (!params) return "";
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, params?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(params)}`, {
      method,
      headers: headers(!(body instanceof FormData)),
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable : vérifiez que l'API est démarrée.");
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: Query) => request<T>("GET", path, undefined, params),
  post: <T>(path: string, body?: unknown, params?: Query) => request<T>("POST", path, body ?? {}, params),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string, params?: Query) => request<T>("DELETE", path, undefined, params),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

/** Téléchargement d'un fichier exporté (GET ou POST). */
export async function download(path: string, filename: string, params?: Query, body?: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}${qs(params)}`, {
    method: body === undefined ? "GET" : "POST",
    headers: headers(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
