import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Database,
  HardDrive,
  Pause,
  Play,
  Send,
  Settings2,
  Trash2,
  Zap,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext.tsx';
import type { FlumeRuntimeStats, HdfsPartition } from '../types/analytics.ts';

interface FlumeTabProps {
  runtime: FlumeRuntimeStats | null;
  partitions: HdfsPartition[];
  onControl: (
    action: 'start' | 'pause' | 'burst' | 'anomaly' | 'configure',
    payload?: Record<string, unknown>
  ) => Promise<void>;
  onIngestRaw: (rawLogs: string) => Promise<{ ok?: boolean; parsed?: number; flushed?: number; error?: string }>;
  onClearWarehouse: () => Promise<void>;
  onResetWarehouse: () => Promise<void>;
}

const SAMPLE_RAW_LOGS = `machineId=M1 efficiency=94.2 temp=61.8 vibration=1.65 rpm=3190 kw=18.2
machineId=M3 efficiency=83.7 temp=78.4 vibration=3.20 rpm=1410 kw=29.8
{"machineId":"M6","efficiency":76.5,"temperatureC":89.2,"vibrationMmS":4.1,"rpm":1085,"powerKw":33.1}`;

export const FlumeTab: React.FC<FlumeTabProps> = ({
  runtime,
  partitions,
  onControl,
  onIngestRaw,
  onClearWarehouse,
  onResetWarehouse,
}) => {
  const { user, preferences, savePreferences } = useFirebase();
  const [channelCapacity, setChannelCapacity] = useState(1000);
  const [batchSize, setBatchSize] = useState(6);
  const [streamIntervalMs, setStreamIntervalMs] = useState(3000);
  const [hdfsPath, setHdfsPath] = useState('hdfs://localhost:9000/user/manufacturing/data/');
  const [sourceCommand, setSourceCommand] = useState('tail -F /var/log/manufacturing/sensors.log');
  const [savingConfig, setSavingConfig] = useState(false);

  const [rawLogs, setRawLogs] = useState(SAMPLE_RAW_LOGS);
  const [ingestFeedback, setIngestFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!runtime) return;
    setChannelCapacity(runtime.config.channelCapacity);
    setBatchSize(runtime.config.batchSize);
    setStreamIntervalMs(runtime.config.streamIntervalMs);
    setHdfsPath(runtime.config.hdfsPath);
    setSourceCommand(runtime.config.sourceCommand);
  }, [
    runtime?.config.channelCapacity,
    runtime?.config.batchSize,
    runtime?.config.streamIntervalMs,
    runtime?.config.hdfsPath,
    runtime?.config.sourceCommand,
  ]);

  if (!runtime) {
    return (
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-8 text-sm text-[#64748B]">
        Loading Apache Flume runtime topology...
      </div>
    );
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await onControl('configure', {
        channelCapacity,
        batchSize,
        streamIntervalMs,
        hdfsPath,
        sourceCommand,
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngestFeedback(null);
    setIngesting(true);
    try {
      const res = await onIngestRaw(rawLogs);
      if (res.error) {
        setIngestFeedback({ type: 'err', msg: res.error });
      } else {
        setIngestFeedback({
          type: 'ok',
          msg: `Parsed ${res.parsed ?? 0} record(s) through MemoryChannel and flushed ${res.flushed ?? 0} to HDFS sink.`,
        });
      }
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Topology Header & Action Controls */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">
              Apache Flume Ingestion Pipeline
            </h1>
            <p className="mt-1 text-sm text-[#475569]">
              Live Source → MemoryChannel → HDFS Sink topology with configurable buffering and manual log injection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => onControl(runtime.config.running ? 'pause' : 'start')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 ${
                runtime.config.running
                  ? 'bg-[#D97706] hover:bg-[#B45309]'
                  : 'bg-[#16A34A] hover:bg-[#15803D]'
              }`}
            >
              {runtime.config.running ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  Pause Agent
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Start Agent
                </>
              )}
            </button>
            <button
              onClick={() => onControl('burst')}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0284C7] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] whitespace-nowrap shrink-0"
            >
              <Zap className="h-3.5 w-3.5" />
              Inject Burst (18)
            </button>
            <button
              onClick={() => onControl('anomaly')}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-medium text-[#DC2626] transition-colors hover:bg-[#FEE2E2] whitespace-nowrap shrink-0"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Simulate Anomaly
            </button>
          </div>
        </div>

        {/* 3-Stage Visual Pipeline Diagram */}
        <div className="mt-6 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-11">
          {/* Stage 1: Source */}
          <div className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 lg:col-span-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0F172A]">1. ExecSource (sensorSource)</span>
                <span
                  className={`text-xs font-medium ${
                    runtime.config.running ? 'text-[#16A34A]' : 'text-[#64748B]'
                  }`}
                >
                  {runtime.config.running ? 'Tailing' : 'Idle'}
                </span>
              </div>
              <p className="mt-2 font-mono text-xs text-[#475569] break-all">
                {runtime.config.sourceCommand}
              </p>
            </div>
            <div className="mt-4 border-t border-[#E2E8F0] pt-2 font-mono text-xs text-[#64748B] tabular-nums">
              Rate: {runtime.eventsPerSecond} events/sec
            </div>
          </div>

          <div className="hidden items-center justify-center lg:flex lg:col-span-1">
            <ArrowRight className="h-5 w-5 text-[#94A3B8]" />
          </div>

          {/* Stage 2: Channel */}
          <div className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 lg:col-span-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0F172A]">2. MemoryChannel (memChannel)</span>
                <span className="font-mono text-xs text-[#0284C7] tabular-nums">
                  {runtime.channelUtilizationPct}% used
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                <div
                  className={`h-full transition-all duration-200 ${
                    runtime.channelUtilizationPct > 80
                      ? 'bg-[#DC2626]'
                      : runtime.channelUtilizationPct > 50
                      ? 'bg-[#D97706]'
                      : 'bg-[#0284C7]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, runtime.channelUtilizationPct))}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-xs text-[#475569] tabular-nums">
                Buffer: {runtime.channelBuffered} / {runtime.config.channelCapacity} capacity
              </p>
            </div>
            <div className="mt-4 border-t border-[#E2E8F0] pt-2 font-mono text-xs text-[#64748B] tabular-nums">
              Dropped: {runtime.droppedEvents} · TxCap: {runtime.config.transactionCapacity}
            </div>
          </div>

          <div className="hidden items-center justify-center lg:flex lg:col-span-1">
            <ArrowRight className="h-5 w-5 text-[#94A3B8]" />
          </div>

          {/* Stage 3: HDFS Sink */}
          <div className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 lg:col-span-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0F172A]">3. HDFSSink (hdfsSink)</span>
                <span className="font-mono text-xs text-[#475569]">{runtime.config.hdfsFileType}</span>
              </div>
              <p className="mt-2 font-mono text-xs text-[#475569] break-all">
                {runtime.config.hdfsPath}
              </p>
            </div>
            <div className="mt-4 border-t border-[#E2E8F0] pt-2 font-mono text-xs text-[#64748B] tabular-nums">
              Committed: {runtime.totalIngested.toLocaleString()} total
            </div>
          </div>
        </div>
      </section>

      {/* Configuration & Custom Sensor Log Ingestion */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Agent Configurator */}
        <form onSubmit={handleSaveConfig} className="rounded-lg border border-[#E2E8F0] bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-[#0284C7]" />
            <h2 className="text-base font-semibold text-[#0F172A]">
              Flume Agent Tuning
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cap-input" className="block text-xs font-medium text-[#475569]">
                memChannel.capacity
              </label>
              <input
                id="cap-input"
                type="number"
                min={50}
                max={10000}
                value={channelCapacity}
                onChange={(e) => setChannelCapacity(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="batch-input" className="block text-xs font-medium text-[#475569]">
                hdfsSink.batchSize (events/tick)
              </label>
              <input
                id="batch-input"
                type="number"
                min={1}
                max={50}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="interval-input" className="block text-xs font-medium text-[#475569]">
                Stream Interval (ms)
              </label>
              <input
                id="interval-input"
                type="number"
                min={1000}
                max={15000}
                step={500}
                value={streamIntervalMs}
                onChange={(e) => setStreamIntervalMs(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="hdfs-input" className="block text-xs font-medium text-[#475569]">
                hdfsSink.hdfs.path
              </label>
              <input
                id="hdfs-input"
                type="text"
                value={hdfsPath}
                onChange={(e) => setHdfsPath(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="cmd-input" className="block text-xs font-medium text-[#475569]">
                sensorSource.command
              </label>
              <input
                id="cmd-input"
                type="text"
                value={sourceCommand}
                onChange={(e) => setSourceCommand(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onResetWarehouse}
                className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
              >
                Reset Seed Data
              </button>
              <button
                type="button"
                onClick={onClearWarehouse}
                className="inline-flex items-center gap-1 rounded-md border border-[#FECACA] bg-white px-3 py-1.5 text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Warehouse
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user && (
                <button
                  type="button"
                  onClick={async () => {
                    await savePreferences({
                      defaultLine: preferences?.defaultLine ?? 'All',
                      alertThreshold: preferences?.alertThreshold ?? 90,
                      preferredChannelCapacity: channelCapacity,
                      preferredBatchSize: batchSize,
                    });
                    setPresetMsg('Preset saved to Firestore');
                    setTimeout(() => setPresetMsg(null), 3000);
                  }}
                  className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F1F5F9]"
                >
                  Save Preset to Cloud
                </button>
              )}
              {user && preferences && (
                <button
                  type="button"
                  onClick={async () => {
                    setChannelCapacity(preferences.preferredChannelCapacity);
                    setBatchSize(preferences.preferredBatchSize);
                    await onControl('configure', {
                      channelCapacity: preferences.preferredChannelCapacity,
                      batchSize: preferences.preferredBatchSize,
                    });
                    setPresetMsg('Loaded Firestore preset');
                    setTimeout(() => setPresetMsg(null), 3000);
                  }}
                  className="rounded-md border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2 text-xs font-medium text-[#0284C7] transition-colors hover:bg-[#E0F2FE]"
                >
                  Load Saved Preset
                </button>
              )}
              <button
                type="submit"
                disabled={savingConfig}
                className="rounded-md bg-[#0284C7] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] disabled:opacity-60"
              >
                {savingConfig ? 'Applying...' : 'Apply Flume Config'}
              </button>
            </div>
          </div>
          {presetMsg && (
            <p className="mt-2 text-right text-xs font-medium text-[#16A34A]">{presetMsg}</p>
          )}
        </form>

        {/* Custom Raw Log Ingestion */}
        <form onSubmit={handleIngestSubmit} className="rounded-lg border border-[#E2E8F0] bg-white p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-[#0284C7]" />
              <h2 className="text-base font-semibold text-[#0F172A]">
                Custom Sensor Log Ingestion
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setRawLogs(SAMPLE_RAW_LOGS)}
              className="text-xs font-medium text-[#0284C7] hover:underline"
            >
              Load Sample Lines
            </button>
          </div>
          <p className="mb-3 text-xs text-[#64748B]">
            Submit key-value log lines or JSON sensor payloads directly into the Flume ExecSource parser to test real-time trend updates.
          </p>

          <textarea
            rows={6}
            value={rawLogs}
            onChange={(e) => setRawLogs(e.target.value)}
            aria-label="Raw manufacturing sensor log lines"
            className="w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-mono text-xs text-[#0F172A] focus:border-[#0284C7] focus:outline-none"
          />

          {ingestFeedback && (
            <p
              className={`mt-2 text-xs font-medium ${
                ingestFeedback.type === 'ok' ? 'text-[#16A34A]' : 'text-[#DC2626]'
              }`}
            >
              {ingestFeedback.msg}
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={ingesting}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1E293B] disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" />
              {ingesting ? 'Ingesting...' : 'Ingest via Flume Pipeline'}
            </button>
          </div>
        </form>
      </section>

      {/* Live Tail Stream + HDFS Partitions */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-6">
          <h2 className="text-base font-semibold text-[#0F172A]">
            Live Tail Feed (/var/log/manufacturing/sensors.log)
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Most recent raw log events captured by ExecSource before channel serialization
          </p>
          <div className="mt-4 max-h-72 overflow-y-auto rounded-md border border-[#E2E8F0] bg-[#0F172A] p-3 font-mono text-[11px] leading-relaxed text-[#E2E8F0]">
            {runtime.recentLogLines.length === 0 ? (
              <p className="text-[#94A3B8]">Waiting for next Flume source cycle or burst injection...</p>
            ) : (
              runtime.recentLogLines.map((line, i) => (
                <div key={i} className="truncate py-0.5">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                HDFS Sink Partitions
              </h2>
              <p className="mt-1 text-xs text-[#64748B]">
                Simulated Hadoop HDFS DataStream blocks backed by SQLite metadata
              </p>
            </div>
            <HardDrive className="h-4 w-4 text-[#64748B]" />
          </div>

          <div className="mt-4 max-h-72 overflow-y-auto">
            {partitions.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[#E2E8F0] py-10 text-xs text-[#64748B]">
                <Database className="mb-2 h-5 w-5" />
                No HDFS partition files written yet.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[#64748B]">
                    <th className="py-2 pr-2 font-medium">Partition Path</th>
                    <th className="py-2 px-2 text-right font-medium">Records</th>
                    <th className="py-2 pl-2 text-right font-medium">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {partitions.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-2 font-mono text-[#0F172A]">
                        {p.partitionPath}/{p.fileName}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-[#475569] tabular-nums">
                        {p.recordCount.toLocaleString()}
                      </td>
                      <td className="py-2 pl-2 text-right font-mono text-[#64748B] tabular-nums">
                        {(p.sizeBytes / 1024).toFixed(1)} KB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
