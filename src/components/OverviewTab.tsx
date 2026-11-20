import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookmarkPlus,
  CheckCircle2,
  Database,
  Download,
  LogIn,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { useFirebase, type AllowedLine } from '../contexts/FirebaseContext.tsx';
import { apiFetchJson } from '../lib/apiClient.ts';
import type {
  FlumeRuntimeStats,
  HdfsPartition,
  MachineStatus,
  SensorEvent,
  TrendsResponse,
} from '../types/analytics.ts';
import { TrendChart } from './TrendChart.tsx';

interface OverviewTabProps {
  trendsData: TrendsResponse | null;
  flumeRuntime: FlumeRuntimeStats | null;
  partitions: HdfsPartition[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onInjectBurst: () => void;
  onSeedBaseline: () => void;
  onNavigateTab: (tab: 'auto' | 'flume' | 'code' | 'testing' | 'deploy' | 'monitor') => void;
}

function StatusLabel({ status }: { status: MachineStatus }) {
  if (status === 'Optimal') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A34A]">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Optimal
      </span>
    );
  }
  if (status === 'Check Required') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D97706]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Check Required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DC2626]">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Critical
    </span>
  );
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  trendsData,
  flumeRuntime,
  partitions,
  loading,
  error,
  onRetry,
  onRefresh,
  onInjectBurst,
  onSeedBaseline,
  onNavigateTab,
}) => {
  const {
    user,
    authBusy,
    preferences,
    savedSnapshots,
    signInWithGoogle,
    saveSnapshot,
    advanceSnapshotStatus,
    deleteSnapshot,
  } = useFirebase();

  const [lineFilter, setLineFilter] = useState<AllowedLine>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | MachineStatus>('All');
  const [selectedMachineId, setSelectedMachineId] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [snapTitle, setSnapTitle] = useState('');
  const [snapNotes, setSnapNotes] = useState('');
  const [savingSnap, setSavingSnap] = useState(false);
  const [machineDetail, setMachineDetail] = useState<{
    machineId: string;
    machineName: string;
    productionLine: string;
    latest: SensorEvent;
    history: SensorEvent[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (preferences?.defaultLine) {
      setLineFilter(preferences.defaultLine);
    }
  }, [preferences?.defaultLine]);

  useEffect(() => {
    if (selectedMachineId === 'All') {
      setMachineDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiFetchJson<{
      machineId: string;
      machineName: string;
      productionLine: string;
      latest: SensorEvent;
      history: SensorEvent[];
    }>(`/api/machines/${selectedMachineId}`)
      .then((payload) => {
        if (!cancelled && payload) setMachineDetail(payload);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMachineId, trendsData?.summary.totalEvents]);

  if (loading && !trendsData) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 animate-pulse rounded-lg border border-[#E2E8F0] bg-white p-5" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-lg border border-[#E2E8F0] bg-white p-6" />
        <div className="h-64 animate-pulse rounded-lg border border-[#E2E8F0] bg-white p-6" />
      </div>
    );
  }

  if (error && !trendsData) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-white p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-[#DC2626]" />
        <h2 className="text-base font-semibold text-[#0F172A]">Unable to load manufacturing telemetry</h2>
        <p className="mt-1 text-sm text-[#475569]">{error}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#0284C7] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0369A1]"
        >
          <RefreshCw className="h-4 w-4" />
          Retry Connection
        </button>
      </div>
    );
  }

  if (!trendsData || trendsData.summary.totalEvents === 0) {
    return (
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-10 text-center">
        <Database className="mx-auto mb-3 h-8 w-8 text-[#64748B]" />
        <h2 className="text-lg font-semibold text-[#0F172A]">Warehouse has no sensor events</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[#475569]">
          No manufacturing records are currently stored in the SQLite HDFS warehouse. Seed baseline sensor history or inject a live Apache Flume burst to begin trend analysis.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onSeedBaseline}
            className="rounded-md bg-[#0284C7] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0369A1]"
          >
            Seed Baseline Dataset
          </button>
          <button
            onClick={onInjectBurst}
            className="rounded-md border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-medium text-[#0F172A] transition-colors hover:bg-[#F1F5F9]"
          >
            Inject Live Flume Burst
          </button>
        </div>
      </div>
    );
  }

  const filteredMachines = trendsData.machines.filter((m) => {
    if (lineFilter !== 'All' && m.productionLine !== lineFilter) return false;
    if (statusFilter !== 'All' && m.status !== statusFilter) return false;
    if (
      searchQuery.trim() &&
      !m.machineId.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !m.machineName.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const filteredEvents = trendsData.recentEvents.filter((ev) => {
    if (lineFilter !== 'All' && ev.productionLine !== lineFilter) return false;
    if (statusFilter !== 'All' && ev.status !== statusFilter) return false;
    if (selectedMachineId !== 'All' && ev.machineId !== selectedMachineId) return false;
    if (
      searchQuery.trim() &&
      !ev.machineId.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !ev.machineName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !ev.hdfsPartitionPath.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const escapeCsvCell = (value: string | number): string => {
    const str = String(value ?? '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleDownloadCsv = () => {
    const machineIds =
      selectedMachineId !== 'All'
        ? [selectedMachineId]
        : filteredMachines.length > 0
        ? filteredMachines.map((m) => m.machineId)
        : trendsData.machines.map((m) => m.machineId);

    const headers = [
      'Bucket Label',
      'Timestamp',
      'Production Line Filter',
      'Fleet Avg Efficiency (%)',
      'Event Count',
      'Units Produced',
      'Defects',
      ...machineIds.map((id) => `${id} Efficiency (%)`),
    ];

    const rows = trendsData.trends.map((bucket) => [
      bucket.bucketLabel,
      bucket.timestamp,
      lineFilter,
      bucket.avgEfficiency,
      bucket.eventCount,
      bucket.unitsProduced,
      bucket.defects,
      ...machineIds.map((id) => (bucket.byMachine[id] !== undefined ? bucket.byMachine[id] : '')),
    ]);

    const csvContent = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `manufacturing-trends-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Domain Context & Multi-Tier Pipeline Summary */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <p className="text-xs font-medium text-[#0284C7]">
              Automobile Manufacturing · Apache Flume &amp; Big Data Trend Analysis
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0F172A]">
              Automotive Plant Analytics Console
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#475569]">
              Tracks real-time vehicle assembly throughput, machine downtime, component defects, and shift efficiency across Body Shop, Paint &amp; Coating, Powertrain, and Final Assembly stations via Apache Flume and Express.js microservices.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => onNavigateTab('auto')}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1E293B] whitespace-nowrap shrink-0"
            >
              Auto Production &amp; Shifts
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onNavigateTab('flume')}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F1F5F9] whitespace-nowrap shrink-0"
            >
              Flume Pipeline
              <ArrowUpRight className="h-3.5 w-3.5 text-[#64748B]" />
            </button>
            <button
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5 text-[#0284C7]" />
              Download Data
            </button>
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A] whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Primary KPI Strip (4 Columns) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-medium text-[#64748B]">Assembly-Line Efficiency</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {trendsData.summary.fleetEfficiency}%
            </span>
            <span className="text-xs font-medium text-[#475569]">Target &gt; 90%</span>
          </div>
          <p className="mt-2 text-xs text-[#64748B]">
            {trendsData.summary.optimalMachines} optimal · {trendsData.summary.attentionMachines} check required
          </p>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-medium text-[#64748B]">Production Rate &amp; FPY</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {trendsData.summary.productionRateJph} JPH
            </span>
            <span className="font-mono text-xs font-medium text-[#16A34A] tabular-nums">
              FPY {trendsData.summary.firstPassYieldPct}%
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-[#64748B] tabular-nums">
            {trendsData.summary.totalUnitsProduced.toLocaleString()} assemblies · {trendsData.summary.defectRatePpm.toLocaleString()} PPM
          </p>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-medium text-[#64748B]">Flume Ingestion Rate</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {flumeRuntime ? `${flumeRuntime.eventsPerSecond} ev/s` : '—'}
            </span>
            <span
              className={`text-xs font-medium ${
                flumeRuntime?.config.running ? 'text-[#16A34A]' : 'text-[#D97706]'
              }`}
            >
              {flumeRuntime?.config.running ? 'Streaming' : 'Paused'}
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-[#64748B] tabular-nums">
            {trendsData.summary.totalEvents.toLocaleString()} records · {partitions.length} HDFS files
          </p>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-medium text-[#64748B]">Downtime &amp; Thermal Load</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {trendsData.summary.totalDowntimeMins} min
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-xs text-[#475569] tabular-nums">
              <Thermometer className="h-3.5 w-3.5 text-[#64748B]" />
              {trendsData.summary.avgTemperatureC}°C
            </span>
          </div>
          <p className="mt-2 text-xs text-[#64748B]">
            Across {trendsData.summary.activeMachines} automotive plant stations
          </p>
        </div>
      </section>

      {/* Filter Toolbar */}
      <section className="flex flex-col gap-3 rounded-lg border border-[#E2E8F0] bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-[#F1F5F9] p-1">
            {(['All', 'Body Shop', 'Paint & Coating', 'Powertrain', 'Final Assembly'] as const).map((line) => (
              <button
                key={line}
                onClick={() => setLineFilter(line)}
                className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  lineFilter === line
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {line === 'All' ? 'All Lines' : line}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-md bg-[#F1F5F9] p-1">
            {(['All', 'Optimal', 'Check Required', 'Critical'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {st === 'All' ? 'All Statuses' : st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#64748B]" />
            <label htmlFor="machine-select" className="sr-only">
              Filter by machine
            </label>
            <select
              id="machine-select"
              value={selectedMachineId}
              onChange={(e) => setSelectedMachineId(e.target.value)}
              className="bg-transparent text-xs font-medium text-[#0F172A] focus:outline-none"
            >
              <option value="All">All Machines (M1–M6)</option>
              {trendsData.machines.map((m) => (
                <option key={m.machineId} value={m.machineId}>
                  {m.machineId} · {m.machineName}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search machine or HDFS path..."
              className="w-60 rounded-md border border-[#E2E8F0] bg-white py-1.5 pl-8 pr-3 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0284C7] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Main Chart + Selected Machine Telemetry Split */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                Machine Efficiency Trend Analysis
              </h2>
              <p className="text-xs text-[#64748B]">
                Aggregated by Express.js microservice ·{' '}
                {selectedMachineId === 'All'
                  ? 'All active machines'
                  : `Focused on ${selectedMachineId}`}
              </p>
            </div>
            {selectedMachineId !== 'All' && (
              <button
                onClick={() => setSelectedMachineId('All')}
                className="text-xs font-medium text-[#0284C7] hover:text-[#0369A1]"
              >
                Reset to Fleet View
              </button>
            )}
          </div>
          <TrendChart data={trendsData.trends} selectedMachineId={selectedMachineId} height={280} />
        </div>

        {/* Right Column: Machine Drilldown or Fleet Distribution */}
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-4">
          {selectedMachineId !== 'All' && machineDetail ? (
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-[#64748B]">
                      {machineDetail.machineId} · {machineDetail.productionLine}
                    </p>
                    <h3 className="mt-0.5 text-base font-semibold text-[#0F172A]">
                      {machineDetail.machineName}
                    </h3>
                  </div>
                  <StatusLabel status={machineDetail.latest.status} />
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[#E2E8F0] pt-4">
                  <div>
                    <dt className="text-xs text-[#64748B]">Efficiency</dt>
                    <dd className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                      {machineDetail.latest.efficiency}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Temperature</dt>
                    <dd className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                      {machineDetail.latest.temperatureC}°C
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Vibration</dt>
                    <dd className="mt-1 font-mono text-base font-medium text-[#0F172A] tabular-nums">
                      {machineDetail.latest.vibrationMmS} mm/s
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Spindle Speed</dt>
                    <dd className="mt-1 font-mono text-base font-medium text-[#0F172A] tabular-nums">
                      {machineDetail.latest.rpm} RPM
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Power Draw</dt>
                    <dd className="mt-1 font-mono text-base font-medium text-[#0F172A] tabular-nums">
                      {machineDetail.latest.powerKw} kW
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">History Points</dt>
                    <dd className="mt-1 font-mono text-base font-medium text-[#0F172A] tabular-nums">
                      {machineDetail.history.length}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mt-5 border-t border-[#E2E8F0] pt-4">
                <p className="text-xs text-[#64748B]">Latest HDFS Partition</p>
                <p className="mt-1 truncate font-mono text-xs text-[#0F172A]">
                  {machineDetail.latest.hdfsPartitionPath}
                </p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-[#64748B]">
              Loading unit telemetry...
            </div>
          ) : (
            <div className="flex h-full flex-col justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Production Unit Health Matrix
                </h2>
                <p className="mt-1 text-xs text-[#64748B]">
                  Select any unit below or in the machine grid to inspect vibration, thermal load, and HDFS sink path.
                </p>
                <div className="mt-4 divide-y divide-[#E2E8F0]">
                  {trendsData.machines.map((m) => (
                    <button
                      key={m.machineId}
                      onClick={() => setSelectedMachineId(m.machineId)}
                      className="flex w-full items-center justify-between py-2.5 text-left transition-colors hover:bg-[#F8FAFC]"
                    >
                      <div className="min-w-0 pr-3">
                        <p className="truncate text-sm font-medium text-[#0F172A]">
                          <span className="font-mono text-xs text-[#64748B]">{m.machineId}</span> · {m.machineName}
                        </p>
                        <p className="text-xs text-[#64748B]">
                          {m.productionLine} · {m.temperatureC}°C · {m.vibrationMmS} mm/s
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                          {m.latestEfficiency}%
                        </p>
                        <StatusLabel status={m.status} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Machine Performance Cards Grid (Clean Single Elevation) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#0F172A]">
            Machine Performance Overview
          </h2>
          <span className="text-xs text-[#64748B] tabular-nums">
            Showing {filteredMachines.length} of {trendsData.machines.length} units
          </span>
        </div>

        {filteredMachines.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#64748B]">
            No machines match the current filter criteria.{' '}
            <button
              onClick={() => {
                setLineFilter('All');
                setStatusFilter('All');
                setSearchQuery('');
                setSelectedMachineId('All');
              }}
              className="font-medium text-[#0284C7] hover:underline"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredMachines.map((m) => {
              const isSelected = selectedMachineId === m.machineId;
              return (
                <button
                  key={m.machineId}
                  onClick={() => setSelectedMachineId(isSelected ? 'All' : m.machineId)}
                  className={`rounded-lg border p-5 text-left transition-colors ${
                    isSelected
                      ? 'border-[#0284C7] bg-[#F0F9FF]/40'
                      : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs text-[#64748B]">
                        {m.machineId} · {m.productionLine}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-[#0F172A]">
                        {m.machineName}
                      </h3>
                    </div>
                    <StatusLabel status={m.status} />
                  </div>

                  <div className="mt-4 flex items-baseline justify-between border-t border-[#E2E8F0] pt-3">
                    <div>
                      <span className="text-xs text-[#64748B]">Current Efficiency</span>
                      <p className="font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                        {m.latestEfficiency}%
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs text-[#475569] tabular-nums">
                      <p>Avg {m.avgEfficiency}%</p>
                      <p className="text-[#64748B]">{m.temperatureC}°C · {m.rpm} RPM</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent HDFS-Partitioned Sensor Events Table */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              Ingested Sensor Event Stream
            </h2>
            <p className="text-xs text-[#64748B]">
              Persisted by Apache Flume HDFS Sink and indexed in SQLite warehouse
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#64748B]">
            <Activity className="h-3.5 w-3.5 text-[#0284C7]" />
            <span className="font-mono tabular-nums">{filteredEvents.length} rows displayed</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]">
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Machine</th>
                <th className="px-4 py-3 font-medium">Line</th>
                <th className="px-4 py-3 text-right font-medium">Efficiency</th>
                <th className="px-4 py-3 text-right font-medium">Temp</th>
                <th className="px-4 py-3 text-right font-medium">Vibration</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">HDFS Partition File</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filteredEvents.slice(0, 15).map((ev) => (
                <tr key={ev.id} className="hover:bg-[#F8FAFC]">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[#475569] tabular-nums">
                    {ev.timestamp.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-[#0F172A]">
                    <span className="font-mono text-[#64748B]">{ev.machineId}</span> · {ev.machineName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[#475569]">{ev.productionLine}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-medium text-[#0F172A] tabular-nums">
                    {ev.efficiency.toFixed(1)}%
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[#475569] tabular-nums">
                    {ev.temperatureC.toFixed(1)}°C
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[#475569] tabular-nums">
                    {ev.vibrationMmS.toFixed(2)} mm/s
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <StatusLabel status={ev.status} />
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5 font-mono text-[#64748B]">
                    {ev.hdfsPartitionPath}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Firestore Saved Operator Trend Snapshots */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              Saved Trend Snapshots &amp; Incident Notes
            </h2>
            <p className="mt-0.5 text-xs text-[#64748B]">
              Persisted per Google-authenticated operator in Cloud Firestore across sessions and devices
            </p>
          </div>
          {user && (
            <span className="font-mono text-xs text-[#16A34A] tabular-nums">
              {savedSnapshots.length} saved snapshot(s)
            </span>
          )}
        </div>

        {!user ? (
          <div className="mt-4 flex flex-col items-start justify-between gap-4 rounded-lg border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-5 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-[#0F172A]">
                Sign in to save plant efficiency snapshots and incident logs
              </p>
              <p className="mt-1 text-xs text-[#64748B]">
                Authenticate with Google to record fleet telemetry checkpoints, track issue resolution states, and store personal Flume presets.
              </p>
            </div>
            <button
              onClick={signInWithGoogle}
              disabled={authBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1E293B] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <LogIn className="h-3.5 w-3.5" />
              {authBusy ? 'Signing in...' : 'Sign in with Google'}
            </button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!snapTitle.trim()) return;
                setSavingSnap(true);
                try {
                  await saveSnapshot({
                    title: snapTitle,
                    notes: snapNotes,
                    machineId: selectedMachineId,
                    productionLine: lineFilter,
                    fleetEfficiency: trendsData.summary.fleetEfficiency,
                    optimalMachines: trendsData.summary.optimalMachines,
                    attentionMachines: trendsData.summary.attentionMachines,
                    totalEvents: trendsData.summary.totalEvents,
                  });
                  setSnapTitle('');
                  setSnapNotes('');
                } finally {
                  setSavingSnap(false);
                }
              }}
              className="space-y-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 lg:col-span-5"
            >
              <div>
                <label htmlFor="snap-title" className="block text-xs font-medium text-[#475569]">
                  Snapshot Title
                </label>
                <input
                  id="snap-title"
                  type="text"
                  required
                  maxLength={100}
                  value={snapTitle}
                  onChange={(e) => setSnapTitle(e.target.value)}
                  placeholder="e.g. Line A shift handover check"
                  className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="snap-notes" className="block text-xs font-medium text-[#475569]">
                  Operator Notes (optional)
                </label>
                <textarea
                  id="snap-notes"
                  rows={3}
                  maxLength={600}
                  value={snapNotes}
                  onChange={(e) => setSnapNotes(e.target.value)}
                  placeholder="Observation on vibration, temperature, or efficiency trend..."
                  className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                  {lineFilter} · {selectedMachineId} · {trendsData.summary.fleetEfficiency}%
                </span>
                <button
                  type="submit"
                  disabled={savingSnap}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#0284C7] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  {savingSnap ? 'Saving...' : 'Save Snapshot'}
                </button>
              </div>
            </form>

            <div className="lg:col-span-7">
              {savedSnapshots.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-8 text-center text-xs text-[#64748B]">
                  No snapshots saved yet. Capture the current plant efficiency state using the form on the left.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {savedSnapshots.map((snap) => (
                    <div key={snap.id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[#0F172A]">{snap.title}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-[#64748B] tabular-nums">
                            {new Date(snap.createdAtMs).toISOString().replace('T', ' ').slice(0, 16)} · {snap.productionLine} · {snap.machineId} · Fleet {snap.fleetEfficiency}%
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-xs font-medium ${
                              snap.status === 'resolved'
                                ? 'text-[#16A34A]'
                                : snap.status === 'reviewed'
                                ? 'text-[#0284C7]'
                                : 'text-[#D97706]'
                            }`}
                          >
                            {snap.status === 'resolved'
                              ? 'Resolved'
                              : snap.status === 'reviewed'
                              ? 'Reviewed'
                              : 'Open'}
                          </span>
                          {snap.status === 'open' && (
                            <button
                              onClick={() => advanceSnapshotStatus(snap.id, 'reviewed')}
                              className="rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-medium text-[#0F172A] hover:bg-[#F8FAFC]"
                            >
                              Mark Reviewed
                            </button>
                          )}
                          {snap.status !== 'resolved' && (
                            <button
                              onClick={() => advanceSnapshotStatus(snap.id, 'resolved')}
                              className="rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-medium text-[#16A34A] hover:bg-[#F8FAFC]"
                            >
                              Resolve
                            </button>
                          )}
                          <button
                            onClick={() => deleteSnapshot(snap.id)}
                            aria-label={`Delete snapshot ${snap.title}`}
                            className="rounded p-1 text-[#64748B] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {snap.notes && (
                        <p className="mt-2 text-xs text-[#475569]">{snap.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
