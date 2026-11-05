import { describe, expect, it } from "vitest";
import { fmtInt, fmtPct, fmtPValue, fmtSci, gridKey, gridText, oneIn } from "@/lib/format";

const nbsp = (s: string) => s.replace(/[  ]/g, " ");

describe("formatage", () => {
  it("formate les entiers à la française", () => {
    expect(nbsp(fmtInt(139838160))).toBe("139 838 160");
    expect(fmtInt(null)).toBe("—");
  });
  it("formate les probabilités", () => {
    expect(nbsp(fmtPct(0.5))).toBe("50 %");
    expect(fmtSci(1 / 139838160)).toBe("7,15 × 10^-9");
    expect(nbsp(oneIn(1 / 139838160))).toBe("1 chance sur ≈ 139 838 160");
    expect(oneIn(0)).toBe("aucune chance");
    expect(oneIn(1 / 2)).toBe("1 chance sur 2");
    expect(fmtPValue(0.00001)).toBe("< 0,0001");
  });
  it("trie les grilles pour l'affichage et les clés", () => {
    expect(gridText([50, 3, 17, 1, 22], [9, 2])).toBe("01 03 17 22 50 ★ 02 09");
    expect(gridKey([5, 4, 3, 2, 1], [2, 1])).toBe(gridKey([1, 2, 3, 4, 5], [1, 2]));
  });
});
