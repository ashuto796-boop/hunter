import { useEffect, useRef } from "react";
import { ColorType, Time, UTCTimestamp, createChart } from "lightweight-charts";

export function EquityChart({ points, height = 180 }: { points: { t: number; v: number }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || points.length < 2) return;
    const up = points[points.length - 1].v >= points[0].v;
    const c = createChart(ref.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8f99", fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, tickMarkFormatter: (t: Time) => new Date((t as number) * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) },
      handleScroll: false,
      handleScale: false,
      crosshair: { vertLine: { color: "rgba(232,194,106,0.3)" }, horzLine: { color: "rgba(232,194,106,0.3)" } },
      localization: { priceFormatter: (p: number) => `${p.toFixed(0)} $` },
    });
    const s = c.addAreaSeries({
      lineColor: up ? "#2fd69b" : "#ff5a6e",
      topColor: up ? "rgba(47,214,155,0.25)" : "rgba(255,90,110,0.25)",
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
      priceLineVisible: false,
    });
    // one point per second at most (lightweight-charts needs strictly increasing times)
    const data: { time: UTCTimestamp; value: number }[] = [];
    for (const p of points) {
      const time = Math.floor(p.t / 1000) as UTCTimestamp;
      if (data.length && time <= data[data.length - 1].time) data[data.length - 1].value = p.v;
      else data.push({ time, value: p.v });
    }
    s.setData(data);
    c.timeScale().fitContent();
    return () => c.remove();
  }, [points]);
  if (points.length < 2) return <div className="empty">Pas encore assez de trades pour tracer la courbe.</div>;
  return <div ref={ref} style={{ height, width: "100%" }} />;
}
