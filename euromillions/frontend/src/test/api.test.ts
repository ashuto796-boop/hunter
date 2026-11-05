import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, qs } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("client API", () => {
  it("construit les paramètres de requête en ignorant les valeurs vides", () => {
    expect(qs({ a: 1, b: null, c: undefined, d: "", e: "x" })).toBe("?a=1&e=x");
    expect(qs()).toBe("");
  });
  it("remonte le message d'erreur français du serveur", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "Grille invalide." }), { status: 400 }));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 400, message: "Grille invalide." });
  });
  it("signale un serveur injoignable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    const err = (await api.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/injoignable/);
  });
  it("envoie du JSON et lit la réponse", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(api.post("/grids/generate", { count: 1 })).resolves.toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/grids/generate");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ count: 1 });
  });
});
