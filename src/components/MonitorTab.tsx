import React, { useState } from 'react';
import { Activity, Download, Search, Trash2 } from 'lucide-react';
import { downloadTextFile } from '../lib/codeArtifacts.ts';
import type { LogLevel, MonitorMetrics, SystemLog } from '../types/analytics.ts';

interface MonitorTabProps {
  metrics: MonitorMetrics | null;
  logs: SystemLog[];
  onRefreshLogs: (filters: { level: string; service: string; search: string }) => void;
  onClearLogs: () => Promise<void>;
}

function MiniSparkline({
  values,
  color,
  unit,
}: {
  values: number[];
  color: string;
  unit: string;
}) {
  if (values.length < 2) {
    return <div className="h-20 rounded bg-[#F8FAFC]" />;
  }
  const w = 280;
  const h = 76;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.5, max - min);

  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 12) + 6;
      const y = h - 10 - ((v - min) / span) * (h - 20);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full">
        <path d={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between font-mono text-[11px] text-[#64748B] tabular-nums">
        <span>Min {min}{unit}</span>
        <span>Peak {max}{unit}</span>
      </div>
    </div>
  );
}

export const MonitorTab: React.FC<MonitorTabProps> = ({
  metrics,
  logs,
  onRefreshLogs,
  onClearLogs,
}) => {
  const [levelFilter, setLevelFilter] = useState<'ALL' | LogLevel>('ALL');
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const handleFilterChange = (nextLevel: 'ALL' | LogLevel, nextService: string, nextSearch: string) => {
    setLevelFilter(nextLevel);
    setServiceFilter(nextService);
    setSearch(nextSearch);
    onRefreshLogs({ level: nextLevel, service: nextService, search: nextSearch });
  };

  const handleExportLogs = () => {
    const csvHeader = 'id,timestamp,service,level,message\n';
    const csvRows = logs
      .map((l) => `${l.id},"${l.timestamp}","${l.service}","${l.level}","${l.message.replace(/"/g, '""')}"`)
      .join('\n');
    downloadTextFile('manufacturing-system-logs.csv', csvHeader + csvRows);
  };

  return (
    <div className="space-y-6">
      {/* Prometheus / Grafana Style Metrics */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">
              System Telemetry &amp; Centralized Log Stream
            </h1>
            <p className="mt-1 text-sm text-[#475569]">
              Prometheus-aligned microservice health, Apache Flume throughput gauges, and searchable ELK-style pipeline logs.
            </p>
          </div>
          {metrics && (
            <div className="flex items-center gap-3 font-mono text-xs text-[#475569] tabular-nums">
              <span>Uptime {metrics.uptimeSeconds}s</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span>RSS {metrics.memoryRssMb} MB</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span>Error Rate {metrics.errorRatePct}%</span>
            </div>
          )}
        </div>

        {metrics && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#64748B]">Flume Throughput</span>
                <span className="font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                  {metrics.flumeEventsPerSec} ev/s
                </span>
              </div>
              <div className="mt-3">
                <MiniSparkline
                  values={metrics.throughputHistory.map((p) => p.eventsPerSec)}
                  color="#0284C7"
                  unit=" ev/s"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#64748B]">Microservice Flush Latency</span>
                <span className="font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                  {metrics.apiLatencyMs} ms
                </span>
              </div>
              <div className="mt-3">
                <MiniSparkline
                  values={metrics.throughputHistory.map((p) => p.latencyMs)}
                  color="#0D9488"
                  unit=" ms"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#64748B]">MemoryChannel Saturation</span>
                <span className="font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                  {metrics.channelDepth} / {metrics.channelCapacity}
                </span>
              </div>
              <div className="mt-3">
                <MiniSparkline
                  values={metrics.throughputHistory.map((p) => p.channelPct)}
                  color="#D97706"
                  unit="%"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Centralized ELK-Style Log Explorer */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#E2E8F0] px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-md bg-[#F1F5F9] p-1">
              {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => handleFilterChange(lvl, serviceFilter, search)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    levelFilter === lvl
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>

            <select
              aria-label="Filter logs by service"
              value={serviceFilter}
              onChange={(e) => handleFilterChange(levelFilter, e.target.value, search)}
              className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs font-medium text-[#0F172A] focus:outline-none"
            >
              <option value="ALL">All Services</option>
              <option value="flume-agent">flume-agent</option>
              <option value="express-processor">express-processor</option>
              <option value="hdfs-sink">hdfs-sink</option>
              <option value="api-gateway">api-gateway</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
              <input
                type="text"
                value={search}
                onChange={(e) => handleFilterChange(levelFilter, serviceFilter, e.target.value)}
                placeholder="Search logs..."
                className="w-52 rounded-md border border-[#E2E8F0] bg-white py-1.5 pl-8 pr-3 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0284C7] focus:outline-none"
              />
            </div>

            <button
              onClick={handleExportLogs}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={onClearLogs}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-white px-3 py-1.5 text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2] whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Logs
            </button>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-xs text-[#64748B]">
              <Activity className="mb-2 h-5 w-5" />
              No log entries match the current filter.
            </div>
          ) : (
            <table className="w-full border-collapse text-left font-mono text-xs">
              <thead className="sticky top-0 bg-[#F8FAFC] text-[#64748B]">
                <tr className="border-b border-[#E2E8F0]">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Level</th>
                  <th className="px-4 py-2.5 font-medium">Service</th>
                  <th className="px-4 py-2.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#F8FAFC]">
                    <td className="whitespace-nowrap px-4 py-2 text-[#64748B] tabular-nums">
                      {log.timestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-semibold">
                      <span
                        className={
                          log.level === 'ERROR'
                            ? 'text-[#DC2626]'
                            : log.level === 'WARN'
                            ? 'text-[#D97706]'
                            : 'text-[#16A34A]'
                        }
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-[#0284C7]">
                      {log.service}
                    </td>
                    <td className="px-4 py-2 font-sans text-[#0F172A]">
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
};
