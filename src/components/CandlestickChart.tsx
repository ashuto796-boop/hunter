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
        textColor: "#9ca3af",
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#4ade80",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#dc2626",
      wickUpColor: "#4ade80",
      wickDownColor: "#ef4444",
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

  return <div ref={containerRef} className="w-full h-full" />;
};
