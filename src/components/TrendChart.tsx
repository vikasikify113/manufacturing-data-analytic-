import React, { useState } from 'react';
import type { TrendBucket } from '../types/analytics.ts';

interface TrendChartProps {
  data: TrendBucket[];
  selectedMachineId: string;
  height?: number;
}

const MACHINE_SERIES_COLORS: Record<string, string> = {
  M1: '#0284C7',
  M2: '#0D9488',
  M3: '#D97706',
  M4: '#4F46E5',
  M5: '#059669',
  M6: '#DC2626',
};

export const TrendChart: React.FC<TrendChartProps> = ({
  data,
  selectedMachineId,
  height = 280,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#64748B]"
        style={{ height }}
      >
        No time-series buckets available yet. Stream or inject sensor data to plot efficiency trends.
      </div>
    );
  }

  const width = 820;
  const padLeft = 48;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const yMin = 60;
  const yMax = 100;

  const xPos = (idx: number) =>
    data.length === 1 ? padLeft + innerW / 2 : padLeft + (idx / (data.length - 1)) * innerW;

  const yPos = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return padTop + ((yMax - clamped) / (yMax - yMin)) * innerH;
  };

  const activeMachines =
    selectedMachineId !== 'All'
      ? [selectedMachineId]
      : ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].filter((id) =>
          data.some((d) => d.byMachine[id] !== undefined)
        );

  const buildPath = (points: Array<{ x: number; y: number }>) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const fleetPoints = data.map((d, i) => ({
    x: xPos(i),
    y: yPos(d.avgEfficiency),
  }));

  const thresholdY = yPos(90);
  const hoveredBucket = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible select-none"
        role="img"
        aria-label="Manufacturing machine efficiency trend chart"
      >
        {/* Y-axis horizontal gridlines */}
        {[60, 70, 80, 90, 100].map((tick) => {
          const y = yPos(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke={tick === 90 ? '#CBD5E1' : '#E2E8F0'}
                strokeDasharray={tick === 90 ? '4 4' : undefined}
                strokeWidth={1}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-[#64748B] font-mono text-[11px] tabular-nums"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Optimal threshold callout */}
        <text
          x={width - padRight}
          y={thresholdY - 6}
          textAnchor="end"
          className="fill-[#475569] text-[10px] font-medium"
        >
          90% Optimal Target
        </text>

        {/* Per-machine trend lines */}
        {activeMachines.map((mId) => {
          const pts = data
            .map((d, i) => {
              const v = d.byMachine[mId];
              return v !== undefined ? { x: xPos(i), y: yPos(v), v } : null;
            })
            .filter((p): p is { x: number; y: number; v: number } => p !== null);

          if (pts.length === 0) return null;
          const color = MACHINE_SERIES_COLORS[mId] || '#0284C7';
          const isFocused = selectedMachineId === mId;

          return (
            <g key={mId}>
              <path
                d={buildPath(pts)}
                fill="none"
                stroke={color}
                strokeWidth={isFocused || activeMachines.length === 1 ? 2.5 : 1.5}
                strokeOpacity={selectedMachineId === 'All' ? 0.72 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, idx) => (
                <circle
                  key={idx}
                  cx={p.x}
                  cy={p.y}
                  r={hoverIdx === idx ? 4 : isFocused ? 2.5 : 0}
                  fill={color}
                />
              ))}
            </g>
          );
        })}

        {/* Fleet Average Line when viewing All */}
        {selectedMachineId === 'All' && (
          <path
            d={buildPath(fleetPoints)}
            fill="none"
            stroke="#0F172A"
            strokeWidth={2.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* X-axis labels */}
        {data.map((d, i) => {
          const step = Math.max(1, Math.ceil(data.length / 7));
          if (i % step !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={d.bucketLabel + i}
              x={xPos(i)}
              y={height - 10}
              textAnchor="middle"
              className="fill-[#64748B] font-mono text-[11px] tabular-nums"
            >
              {d.bucketLabel}
            </text>
          );
        })}

        {/* Hover vertical hairline & interactive hit zones */}
        {hoverIdx !== null && (
          <line
            x1={xPos(hoverIdx)}
            x2={xPos(hoverIdx)}
            y1={padTop}
            y2={height - padBottom}
            stroke="#94A3B8"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {data.map((_, i) => {
          const x = xPos(i);
          const colW = data.length === 1 ? innerW : innerW / (data.length - 1);
          return (
            <rect
              key={i}
              x={Math.max(padLeft, x - colW / 2)}
              y={padTop}
              width={colW}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          );
        })}
      </svg>

      {/* Legend & Active Hover Readout */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[#E2E8F0] pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          {selectedMachineId === 'All' && (
            <span className="flex items-center gap-1.5 font-medium text-[#0F172A]">
              <span className="inline-block h-0.5 w-4 bg-[#0F172A]" />
              Fleet Average
            </span>
          )}
          {activeMachines.map((mId) => (
            <span key={mId} className="flex items-center gap-1.5 text-[#475569] font-mono tabular-nums">
              <span
                className="inline-block h-2 w-2 rounded-xs"
                style={{ backgroundColor: MACHINE_SERIES_COLORS[mId] || '#0284C7' }}
              />
              {mId}
            </span>
          ))}
        </div>

        {hoveredBucket ? (
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-[#0F172A] tabular-nums">
            <span className="text-[#64748B]">{hoveredBucket.bucketLabel} UTC</span>
            <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
            <span>Fleet {hoveredBucket.avgEfficiency}%</span>
            <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
            <span>{hoveredBucket.eventCount} events</span>
          </div>
        ) : (
          <span className="text-[#64748B]">Hover across chart intervals to inspect exact readings</span>
        )}
      </div>
    </div>
  );
};
