import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  LogIn,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useFirebase, type AllowedLine } from '../contexts/FirebaseContext.tsx';
import { apiFetchJson } from '../lib/apiClient.ts';
import type { AutoAnalyticsResponse, MachineStatus } from '../types/analytics.ts';

interface AutoOperationsTabProps {
  onSnapshotSaved?: (title: string) => void;
}

function LineStatusText({ status }: { status: MachineStatus }) {
  if (status === 'Optimal') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16A34A]">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Optimal
      </span>
    );
  }
  if (status === 'Check Required') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#D97706]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Check Required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[#DC2626]">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Critical
    </span>
  );
}

export const AutoOperationsTab: React.FC<AutoOperationsTabProps> = ({ onSnapshotSaved }) => {
  const { user, authBusy, signInWithGoogle, saveSnapshot } = useFirebase();

  const [lineFilter, setLineFilter] = useState<
    'All' | 'Body Shop' | 'Paint & Coating' | 'Powertrain' | 'Final Assembly'
  >('All');
  const [shiftFilter, setShiftFilter] = useState<
    'All' | 'Shift A (Day)' | 'Shift B (Swing)' | 'Shift C (Night)'
  >('All');

  const [data, setData] = useState<AutoAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingSnap, setSavingSnap] = useState(false);

  const fetchAutoAnalytics = useCallback(async () => {
    try {
      const params = new URLSearchParams({ line: lineFilter, shift: shiftFilter });
      const json = await apiFetchJson<AutoAnalyticsResponse>(`/api/auto-analytics?${params.toString()}`);
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch automobile analytics');
    } finally {
      setLoading(false);
    }
  }, [lineFilter, shiftFilter]);

  useEffect(() => {
    fetchAutoAnalytics();
    const timer = setInterval(fetchAutoAnalytics, 4000);
    return () => clearInterval(timer);
  }, [fetchAutoAnalytics]);

  const handleSaveAutomotiveSnapshot = async () => {
    if (!data) return;
    setSavingSnap(true);
    try {
      const title = `Auto Ops · ${lineFilter} · ${shiftFilter}`;
      const notes = `Rate ${data.kpis.productionRateJph}/${data.kpis.targetJph} JPH | Efficiency ${data.kpis.avgAssemblyEfficiency}% | Downtime ${data.kpis.totalDowntimeMins}m | Defects ${data.kpis.totalDefects} (${data.kpis.defectRatePpm} PPM) | FPY ${data.kpis.firstPassYieldPct}%`;
      await saveSnapshot({
        title,
        notes,
        machineId: 'All',
        productionLine: lineFilter as AllowedLine,
        fleetEfficiency: data.kpis.avgAssemblyEfficiency,
        optimalMachines: data.assemblyLines.filter((l) => l.status === 'Optimal').length,
        attentionMachines: data.assemblyLines.filter((l) => l.status !== 'Optimal').length,
        totalEvents: data.kpis.totalUnitsProduced,
      });
      onSnapshotSaved?.(title);
    } finally {
      setSavingSnap(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-lg border border-[#E2E8F0] bg-white p-6" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 animate-pulse rounded-lg border border-[#E2E8F0] bg-white p-5" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-lg border border-[#E2E8F0] bg-white p-6" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-white p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-[#DC2626]" />
        <h2 className="text-base font-semibold text-[#0F172A]">Unable to load automobile plant metrics</h2>
        <p className="mt-1 text-sm text-[#475569]">{error}</p>
        <button
          onClick={fetchAutoAnalytics}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#0284C7] px-4 py-2 text-xs font-medium text-white hover:bg-[#0369A1]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const maxDowntime = Math.max(1, ...data.downtimeByStation.map((s) => s.totalMins));

  return (
    <div className="space-y-6">
      {/* Header & Scope Controls */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <p className="text-xs font-medium text-[#0284C7]">
              Automobile Manufacturing · Multi-Shop Telemetry Analysis
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0F172A]">
              Production Rates, Downtime, Defects &amp; Shift Performance
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#475569]">
              End-to-end operational breakdown across Stamping, Body-in-White, Paint &amp; Coating, Powertrain, and Final Assembly stations fed continuously by Apache Flume into the Express.js analytics microservice.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {user ? (
              <button
                onClick={handleSaveAutomotiveSnapshot}
                disabled={savingSnap}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0284C7] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                {savingSnap ? 'Saving...' : 'Save Report to Firestore'}
              </button>
            ) : (
              <button
                onClick={signInWithGoogle}
                disabled={authBusy}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1E293B] disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in to Save Report
              </button>
            )}
            <button
              onClick={fetchAutoAnalytics}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-medium text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A] whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Assembly Line & Shift Segmented Filters */}
        <div className="mt-5 flex flex-col gap-3 border-t border-[#E2E8F0] pt-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-[#F1F5F9] p-1">
            {(['All', 'Body Shop', 'Paint & Coating', 'Powertrain', 'Final Assembly'] as const).map((line) => (
              <button
                key={line}
                onClick={() => setLineFilter(line)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  lineFilter === line
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {line === 'All' ? 'All Assembly Lines' : line}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-md bg-[#F1F5F9] p-1">
            {(['All', 'Shift A (Day)', 'Shift B (Swing)', 'Shift C (Night)'] as const).map((shift) => (
              <button
                key={shift}
                onClick={() => setShiftFilter(shift)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  shiftFilter === shift
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {shift === 'All' ? 'All Shifts (24h)' : shift}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Primary Automotive KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#64748B]">Production Rate (JPH)</p>
            <Gauge className="h-4 w-4 text-[#0284C7]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {data.kpis.productionRateJph} JPH
            </span>
            <span className="font-mono text-xs text-[#64748B] tabular-nums">
              Target {data.kpis.targetJph}
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-[#64748B] tabular-nums">
            {data.kpis.totalUnitsProduced.toLocaleString()} total assemblies produced
          </p>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#64748B]">Assembly-Line Efficiency</p>
            <Layers className="h-4 w-4 text-[#0284C7]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {data.kpis.avgAssemblyEfficiency}%
            </span>
            <span
              className={`text-xs font-medium ${
                data.kpis.avgAssemblyEfficiency > 90 ? 'text-[#16A34A]' : 'text-[#D97706]'
              }`}
            >
              {data.kpis.avgAssemblyEfficiency > 90 ? 'Optimal' : 'Check Required'}
            </span>
          </div>
          <p className="mt-2 text-xs text-[#64748B]">
            Mean OEE across active automotive shops
          </p>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#64748B]">Machine Downtime</p>
            <Clock className="h-4 w-4 text-[#D97706]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {data.kpis.totalDowntimeMins} min
            </span>
            <span className="font-mono text-xs text-[#DC2626] tabular-nums">
              {data.kpis.unplannedDowntimeMins}m unplanned
            </span>
          </div>
          <p className="mt-2 text-xs text-[#64748B]">
            Cumulative stop duration in selected window
          </p>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#64748B]">Component Defect Rate</p>
            <ShieldAlert className="h-4 w-4 text-[#DC2626]" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-[#0F172A] tabular-nums">
              {data.kpis.defectRatePpm.toLocaleString()} PPM
            </span>
            <span className="font-mono text-xs text-[#16A34A] tabular-nums">
              FPY {data.kpis.firstPassYieldPct}%
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-[#64748B] tabular-nums">
            {data.kpis.totalDefects} defective assemblies flagged
          </p>
        </div>
      </section>

      {/* Assembly-Line Efficiency & Production Rate Comparison */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              Assembly-Line Efficiency &amp; Throughput (JPH)
            </h2>
            <p className="text-xs text-[#64748B]">
              Line-by-line production rate vs target, machine availability, and defect yield
            </p>
          </div>
          <span className="font-mono text-xs text-[#64748B]">
            Shift scope: {shiftFilter}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.assemblyLines.map((line) => {
            const pctOfTarget = Math.min(100, Math.round((line.actualJph / Math.max(1, line.targetJph)) * 100));
            return (
              <div
                key={line.line}
                className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F172A]">{line.line}</h3>
                      <p className="text-xs text-[#64748B]">
                        {line.stationCount} station(s) · {line.totalUnits.toLocaleString()} units
                      </p>
                    </div>
                    <LineStatusText status={line.status} />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-[#64748B]">Production Rate</span>
                      <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                        {line.actualJph} / {line.targetJph} JPH
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                      <div
                        className={`h-full ${
                          line.avgEfficiency > 90
                            ? 'bg-[#16A34A]'
                            : line.avgEfficiency >= 85
                            ? 'bg-[#0284C7]'
                            : 'bg-[#D97706]'
                        }`}
                        style={{ width: `${pctOfTarget}%` }}
                      />
                    </div>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-[#E2E8F0] pt-3 font-mono text-xs tabular-nums">
                  <div>
                    <dt className="font-sans text-[11px] text-[#64748B]">Efficiency</dt>
                    <dd className="font-semibold text-[#0F172A]">{line.avgEfficiency}%</dd>
                  </div>
                  <div>
                    <dt className="font-sans text-[11px] text-[#64748B]">Availability</dt>
                    <dd className="font-semibold text-[#0F172A]">{line.availabilityPct}%</dd>
                  </div>
                  <div>
                    <dt className="font-sans text-[11px] text-[#64748B]">Downtime</dt>
                    <dd className="text-[#475569]">{line.downtimeMins} min</dd>
                  </div>
                  <div>
                    <dt className="font-sans text-[11px] text-[#64748B]">FPY / Defects</dt>
                    <dd className="text-[#475569]">
                      {line.firstPassYieldPct}% ({line.defectCount})
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      {/* Shift Performance Comparison Table */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              Shift Performance Comparison
            </h2>
            <p className="text-xs text-[#64748B]">
              24-hour operational comparison across Day, Swing, and Night assembly shifts
            </p>
          </div>
          <span className="font-mono text-xs text-[#64748B]">Line scope: {lineFilter}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]">
                <th className="px-4 py-3 font-medium">Shift</th>
                <th className="px-4 py-3 font-medium">Window</th>
                <th className="px-4 py-3 text-right font-medium">Units Produced</th>
                <th className="px-4 py-3 text-right font-medium">Rate (JPH)</th>
                <th className="px-4 py-3 text-right font-medium">Efficiency</th>
                <th className="px-4 py-3 text-right font-medium">Downtime</th>
                <th className="px-4 py-3 text-right font-medium">Defect Rate</th>
                <th className="px-4 py-3 text-right font-medium">First Pass Yield</th>
                <th className="px-4 py-3 font-medium">Primary Defect Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.shifts.map((s) => (
                <tr key={s.shiftName} className="hover:bg-[#F8FAFC]">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#0F172A]">
                    {s.shiftName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[#64748B] tabular-nums">
                    {s.windowLabel}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-[#0F172A] tabular-nums">
                    {s.unitsProduced.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[#0F172A] tabular-nums">
                    {s.productionRateJph}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    <span className={s.avgEfficiency > 90 ? 'text-[#16A34A]' : 'text-[#D97706]'}>
                      {s.avgEfficiency}%
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[#475569] tabular-nums">
                    {s.downtimeMins} min
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[#475569] tabular-nums">
                    {s.defectPpm.toLocaleString()} PPM ({s.defectCount})
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-[#0F172A] tabular-nums">
                    {s.firstPassYieldPct}%
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[#475569]">{s.topIssue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Machine Downtime & Component Defects Split */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Machine Downtime by Station */}
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                Machine Downtime &amp; Root Causes
              </h2>
              <p className="text-xs text-[#64748B]">
                Planned vs unplanned stop duration per assembly station
              </p>
            </div>
            <Wrench className="h-4 w-4 text-[#64748B]" />
          </div>

          <div className="space-y-4">
            {data.downtimeByStation.map((st) => {
              const plannedPct = Math.round((st.plannedMins / maxDowntime) * 100);
              const unplannedPct = Math.round((st.unplannedMins / maxDowntime) * 100);
              return (
                <div key={st.machineId} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-[#0F172A]">
                      <span className="font-mono text-[#64748B]">{st.machineId}</span> · {st.machineName}
                    </span>
                    <span className="font-mono text-[#475569] tabular-nums">
                      {st.totalMins}m total · {st.availabilityPct}% avail
                    </span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
                    <div
                      className="bg-[#D97706]"
                      style={{ width: `${Math.max(2, unplannedPct)}%` }}
                      title={`Unplanned: ${st.unplannedMins}m`}
                    />
                    <div
                      className="bg-[#94A3B8]"
                      style={{ width: `${plannedPct}%` }}
                      title={`Planned: ${st.plannedMins}m`}
                    />
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    {st.productionLine} · Primary cause: {st.primaryCause} · {st.unplannedMins}m unplanned
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Component Defects Breakdown */}
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                Component Defect Pareto Analysis
              </h2>
              <p className="text-xs text-[#64748B]">
                Ranked failure modes impacting First Pass Yield across automotive shops
              </p>
            </div>
            <span className="font-mono text-xs text-[#64748B] tabular-nums">
              {data.kpis.totalDefects} total defects
            </span>
          </div>

          {data.defects.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-8 text-center text-xs text-[#64748B]">
              Zero component defects recorded for the selected assembly line and shift filter.
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {data.defects.map((def) => (
                <div key={def.defectType} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#0F172A]">{def.defectType}</span>
                    <span className="font-mono font-medium text-[#0F172A] tabular-nums">
                      {def.count} units ({def.sharePct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
                    <div
                      className="h-full bg-[#DC2626]"
                      style={{ width: `${Math.max(4, def.sharePct)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#64748B]">
                    Primary shop: {def.primaryLine} · Mean station efficiency during defect: {def.avgEfficiencyImpact}%
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Actionable Engineering Recommendations */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-[#0F172A]">
            Automated Engineering Recommendations
          </h2>
          <p className="text-xs text-[#64748B]">
            Computed by the Express.js analytics microservice from live Flume sensor bottlenecks
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.recommendations.map((rec) => (
            <div
              key={rec.id}
              className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#0284C7]">{rec.area}</span>
                  <span
                    className={`text-xs font-semibold ${
                      rec.severity === 'High'
                        ? 'text-[#DC2626]'
                        : rec.severity === 'Medium'
                        ? 'text-[#D97706]'
                        : 'text-[#475569]'
                    }`}
                  >
                    {rec.severity} Priority
                  </span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-[#0F172A]">{rec.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#475569]">{rec.finding}</p>
              </div>
              <div className="mt-3 border-t border-[#E2E8F0] pt-2.5 text-xs text-[#0F172A]">
                <span className="font-semibold">Recommended Action: </span>
                {rec.action}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
