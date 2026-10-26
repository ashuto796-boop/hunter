import { useEffect, useRef } from "react";
import { ColorType, CrosshairMode, IChartApi, IPriceLine, ISeriesApi, LineStyle, SeriesMarker, Time, UTCTimestamp, createChart } from "lightweight-charts";
import { bot } from "../bot";
import { useGold } from "../store";

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const localTime = (t: number) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function Chart({ height = 300 }: { height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20 = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50 = useRef<ISeriesApi<"Line"> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const fitted = useRef(false);
  const candleVersion = useGold((s) => s.candleVersion);
  const tickVersion = useGold((s) => s.tickVersion);
  const position = useGold((s) => s.position);
  const trades = useGold((s) => s.trades);

  useEffect(() => {
    if (!ref.current) return;
    const c = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8f99",
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
      },
      grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter: (t: Time) => localTime(t as number) },
      localization: { timeFormatter: (t: Time) => localTime(t as number), priceFormatter: (p: number) => p.toFixed(2) },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: "rgba(232,194,106,0.4)" }, horzLine: { color: "rgba(232,194,106,0.4)" } },
      handleScale: { axisPressedMouseMove: false },
    });
    candles.current = c.addCandlestickSeries({
      upColor: "#2fd69b",
      downColor: "#ff5a6e",
      borderVisible: false,
      wickUpColor: "rgba(47,214,155,0.7)",
      wickDownColor: "rgba(255,90,110,0.7)",
    });
    ema20.current = c.addLineSeries({ color: "#e8c26a", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ema50.current = c.addLineSeries({ color: "rgba(122,167,255,0.7)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      fitted.current = false;
      lines.current = [];
    };
  }, []);

  // full redraw when a candle closes
  useEffect(() => {
    const m = bot.market;
    if (!m || !candles.current) return;
    const s = m.ltf;
    const from = Math.max(0, s.c.length - 600);
    candles.current.setData(s.c.slice(from).map((k) => ({ time: sec(k.t), open: k.o, high: k.h, low: k.l, close: k.c })));
    const line = (arr: number[]) =>
      arr
        .slice(from)
        .map((v, j) => ({ time: sec(s.c[from + j].t), value: v }))
        .filter((p) => !Number.isNaN(p.value));
    ema20.current!.setData(line(s.ema20));
    ema50.current!.setData(line(s.ema50));
    if (bot.forming) {
      const f = bot.forming;
      candles.current.update({ time: sec(f.t), open: f.o, high: f.h, low: f.l, close: f.c });
    }
    if (!fitted.current && chart.current) {
      const n = s.c.length - from;
      chart.current.timeScale().setVisibleLogicalRange({ from: n - 90, to: n + 3 });
      fitted.current = true;
    }
  }, [candleVersion]);

  // live candle
  useEffect(() => {
    const f = bot.forming;
    if (!f || !candles.current || !bot.market) return;
    const last = bot.market.ltf.c[bot.market.ltf.c.length - 1];
    if (f.t <= last.t) return;
    candles.current.update({ time: sec(f.t), open: f.o, high: f.h, low: f.l, close: f.c });
  }, [tickVersion]);

  // open position levels
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    for (const l of lines.current) s.removePriceLine(l);
    lines.current = [];
    if (!position) return;
    const add = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
      lines.current.push(s.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    add(position.entry, "#f3efe6", "Entrée", LineStyle.Solid);
    add(position.sl, "#ff5a6e", position.tp1Done ? "Stop (BE+)" : "Stop");
    if (!position.tp1Done) add(position.tp1, "#e8c26a", "TP1");
    add(position.tp2, "#2fd69b", "TP2");
  }, [position?.id, position?.sl, position?.tp1Done]);

  // trade markers
  useEffect(() => {
    const s = candles.current;
    const m = bot.market;
    if (!s || !m) return;
    const first = m.ltf.c[Math.max(0, m.ltf.c.length - 600)]?.t ?? 0;
    const tfMs = m.ltf.tf * 60000;
    const snap = (t: number) => sec(Math.floor(t / tfMs) * tfMs);
    const marks: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      if (t.closeTime < first) continue;
      marks.push({ time: snap(t.openTime), position: t.dir === 1 ? "belowBar" : "aboveBar", color: t.dir === 1 ? "#2fd69b" : "#ff5a6e", shape: t.dir === 1 ? "arrowUp" : "arrowDown", text: t.dir === 1 ? "A" : "V" });
      marks.push({ time: snap(t.closeTime - 1), position: t.dir === 1 ? "aboveBar" : "belowBar", color: t.pnl >= 0 ? "#e8c26a" : "#8a8f99", shape: "circle", text: `${t.r >= 0 ? "+" : ""}${t.r.toFixed(1)}R` });
    }
    if (position) marks.push({ time: snap(position.openTime), position: position.dir === 1 ? "belowBar" : "aboveBar", color: "#e8c26a", shape: position.dir === 1 ? "arrowUp" : "arrowDown", text: "EN COURS" });
    marks.sort((a, b) => (a.time as number) - (b.time as number));
    s.setMarkers(marks);
  }, [trades, position?.id, candleVersion]);

  return <div ref={ref} className="chart" style={{ height }} />;
}
