import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/pages/Home";

afterEach(() => vi.restoreAllMocks());

const prob = { numerator: 1, denominator: 139838160, fraction: "1 / 139 838 160", percent: "7,15112e-7 %", scientific: "7,15112E-9", one_in: "1 chance sur 139 838 160", value: 7.15e-9 };

describe("page d'accueil", () => {
  it("rappelle que toutes les grilles sont équiprobables et n'affiche aucun score prédictif", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/math/probabilities")) {
        return new Response(JSON.stringify({ total_combinations: 139838160, jackpot: prob, any_prize: { ...prob, one_in: "1 chance sur ≈ 13" }, tiers: [] }));
      }
      return new Response(JSON.stringify({ count: 0, first_date: null, last_date: null, eras: {}, is_demo: false, last_refresh: null, draws_with_prizes: 0, demo_warning: null }));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><Home /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/chaque grille valide a exactement la même probabilité/i)).toBeInTheDocument();
    expect(screen.getByText(/jamais une probabilité de sortie/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 chance sur 139 838 160/)).toBeInTheDocument();
  });
});
