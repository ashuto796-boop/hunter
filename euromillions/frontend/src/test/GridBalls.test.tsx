import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GridBalls } from "@/components/GridBalls";

describe("GridBalls", () => {
  it("affiche 5 boules en ordre croissant puis 2 étoiles", () => {
    render(<GridBalls numbers={[45, 7, 23, 14, 38]} stars={[11, 3]} />);
    const balls = screen.getAllByLabelText(/^numéro /).map((e) => Number(e.textContent));
    expect(balls).toEqual([7, 14, 23, 38, 45]);
    const stars = screen.getAllByLabelText(/^étoile /).map((e) => Number(e.textContent));
    expect(stars).toEqual([3, 11]);
  });
  it("met en évidence les bons numéros", () => {
    render(<GridBalls numbers={[1, 2, 3, 4, 5]} stars={[1, 2]} hitNumbers={[2]} hitStars={[1]} />);
    expect(screen.getByLabelText("numéro 2").className).toContain("ball-hit");
    expect(screen.getByLabelText("numéro 3").className).not.toContain("ball-hit");
    expect(screen.getByLabelText("étoile 1").className).toContain("star-hit");
  });
});
