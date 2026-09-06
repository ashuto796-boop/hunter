import React, { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";
import { CandleData } from "../types/index";

interface CandlestickChartProps {
  data: CandleData[];
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#030712" },
        textColor: "#b0b0b0",
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 13,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        autoScale: true,
        scaleMargins: { top: 0.2, bottom: 0.2 },
      },
    });

    // Enhanced grid
    chart.applyOptions({
      grid: {
        horzLines: { color: "rgba(58, 58, 58, 0.4)", style: 1, visible: true },
        vertLines: { color: "rgba(58, 58, 58, 0.4)", style: 1, visible: true },
      },
    });

    // Create candlestick series with LARGE candles
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#4ade80",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#dc2626",
      wickUpColor: "#4ade80",
      wickDownColor: "#ef4444",
      openTickMark: true,
      closeTickMark: true,
    });

    candlestickSeries.setData(
      data.map((d) => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
    );

    chart.timeScale().fitContent();

    // Add crosshair with large font
    chart.subscribeCrosshairMove((param) => {
      // Native crosshair from lightweight-charts
    });

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data]);

  return <div ref={containerRef} className="w-full h-full bg-dark-950" />;
};
