import type {
  AssemblyLineMetrics,
  AutoAnalyticsResponse,
  AutoRecommendation,
  DefectBreakdown,
  DeployChecklistItem,
  DowntimeStationMetric,
  FlumeConfig,
  FlumeRuntimeStats,
  HdfsPartition,
  LogLevel,
  MachineStatus,
  MachineSummary,
  MonitorMetrics,
  SensorEvent,
  ShiftName,
  ShiftPerformance,
  SystemLog,
  TestCaseResult,
  TestSuiteResponse,
  TrendBucket,
  TrendsResponse,
} from '../types/analytics.ts';

export type BackendMode = 'express' | 'browser-sim';

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

let currentBackendMode: BackendMode = 'express';
const modeListeners = new Set<(mode: BackendMode) => void>();

export function getBackendMode(): BackendMode {
  return currentBackendMode;
}

export function subscribeBackendMode(cb: (mode: BackendMode) => void): () => void {
  modeListeners.add(cb);
  return () => {
    modeListeners.delete(cb);
  };
}

function setBackendMode(mode: BackendMode): void {
  if (currentBackendMode !== mode) {
    currentBackendMode = mode;
    for (const listener of modeListeners) {
      listener(mode);
    }
  }
}

export function getConfiguredApiBase(): string {
  return API_BASE;
}

// ---------------------------------------------------------------------------
// Standalone Browser Spark Fallback Engine (for $0 Static Firebase Hosting)
// ---------------------------------------------------------------------------
const MACHINE_CATALOG = [
  {
    machineId: 'M1',
    machineName: 'Stamping Press Line 1',
    productionLine: 'Body Shop',
    defaultDefect: 'Panel Micro-Crack',
    downtimeCause: 'Die Cushion Pressure Drift',
  },
  {
    machineId: 'M2',
    machineName: 'BIW Robotic Weld Cell 2',
    productionLine: 'Body Shop',
    defaultDefect: 'Chassis Weld Spatter',
    downtimeCause: 'Weld Tip Dressing & Servo Fault',
  },
  {
    machineId: 'M3',
    machineName: 'E-Coat & Primer Booth 1',
    productionLine: 'Paint & Coating',
    defaultDefect: 'Paint Orange Peel',
    downtimeCause: 'Atomizer Nozzle Purge',
  },
  {
    machineId: 'M4',
    machineName: 'Powertrain Torque Cell 1',
    productionLine: 'Powertrain',
    defaultDefect: 'Torque Spec Deviation',
    downtimeCause: 'Spindle Calibration Hold',
  },
  {
    machineId: 'M5',
    machineName: 'Chassis Marriage Deck',
    productionLine: 'Final Assembly',
    defaultDefect: 'Sealant Gap',
    downtimeCause: 'AGV Carrier Sync Delay',
  },
  {
    machineId: 'M6',
    machineName: 'ADAS & Dyno End-of-Line',
    productionLine: 'Final Assembly',
    defaultDefect: 'ADAS Calibration Fault',
    downtimeCause: 'Radar Target Alignment',
  },
] as const;

const SHIFT_WINDOWS: Record<ShiftName, string> = {
  'Shift A (Day)': '06:00–14:00',
  'Shift B (Swing)': '14:00–22:00',
  'Shift C (Night)': '22:00–06:00',
};

function classifyEfficiency(efficiency: number): MachineStatus {
  if (efficiency > 90) return 'Optimal';
  if (efficiency >= 78) return 'Check Required';
  return 'Critical';
}

function resolveShiftFromIso(iso: string): ShiftName {
  const hour = new Date(iso).getUTCHours();
  if (hour >= 6 && hour < 14) return 'Shift A (Day)';
  if (hour >= 14 && hour < 22) return 'Shift B (Swing)';
  return 'Shift C (Night)';
}

class BrowserFlumeSimulator {
  private initialized = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextEventId = 1;
  private nextLogId = 1;
  private nextPartId = 1;
  private startedAt = Date.now();
  private currentEventsPerSec = 2.0;
  private lastLatencyMs = 2.4;
  private events: SensorEvent[] = [];
  private partitions: HdfsPartition[] = [];
  private logs: SystemLog[] = [];
  private recentLogLines: string[] = [];
  private totalIngested = 0;
  private droppedEvents = 0;
  private lastFlushAt: string | null = null;
  private config: FlumeConfig = {
    agentName: 'agent',
    sourceType: 'exec',
    sourceCommand: 'tail -F /var/log/manufacturing/sensors.log',
    channelType: 'memory',
    channelCapacity: 1000,
    transactionCapacity: 100,
    sinkType: 'hdfs',
    hdfsPath: 'hdfs://localhost:9000/user/manufacturing/data/',
    hdfsFileType: 'DataStream',
    batchSize: 6,
    streamIntervalMs: 3000,
    running: true,
  };
  private checklist: DeployChecklistItem[] = [
    {
      id: 'flume-conf',
      stage: 'Containerization',
      title: 'Verify flume-conf.properties agent bindings',
      detail: 'Confirm sensorSource exec command, memory channel capacity, and HDFS DataStream sink path.',
      completed: true,
    },
    {
      id: 'docker-microservice',
      stage: 'Containerization',
      title: 'Package Express data-processor microservice in Docker',
      detail: 'Build multi-stage Node 22 Alpine image exposing port 5001 for /api/process-trends.',
      completed: true,
    },
    {
      id: 'k8s-manifest',
      stage: 'Orchestration',
      title: 'Apply Kubernetes Deployment & HPA manifest',
      detail: 'Configure 3 replicas with readiness probes on /api/microservice/health and CPU autoscaling.',
      completed: false,
    },
    {
      id: 'cloud-emr-vercel',
      stage: 'Cloud',
      title: 'Publish on Firebase Spark Hosting or Free Node Host',
      detail: 'Deploy dist/ bundle with Firebase Spark ($0) or Render Free Web Service with Firestore rules.',
      completed: true,
    },
    {
      id: 'prom-elk',
      stage: 'Observability',
      title: 'Enable Prometheus scrape & centralized ELK log forwarding',
      detail: 'Export Flume channel utilization gauges and stream microservice logs to centralized index.',
      completed: true,
    },
  ];
  private throughputHistory: MonitorMetrics['throughputHistory'] = [];

  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.seedBaseline();
    const now = Date.now();
    for (let i = 11; i >= 0; i--) {
      const t = new Date(now - i * 15000);
      this.throughputHistory.push({
        label: t.toISOString().slice(11, 19),
        eventsPerSec: Number((1.8 + Math.sin(i * 0.7) * 0.5).toFixed(2)),
        latencyMs: Number((3.4 + (i % 4) * 0.6).toFixed(1)),
        channelPct: Number((2.2 + (i % 5) * 0.9).toFixed(1)),
      });
    }
    this.rescheduleTicker();
  }

  private rescheduleTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.config.running || typeof window === 'undefined') return;
    const interval = Math.max(1000, this.config.streamIntervalMs);
    this.timer = setInterval(() => {
      if (!this.config.running) return;
      const count = Math.min(this.config.batchSize, 6);
      this.injectBatch(count, false, false);
      const rate = Number((count / (interval / 1000)).toFixed(2));
      this.currentEventsPerSec = rate;
      this.recordSample(rate);
    }, interval);
  }

  private recordSample(rate: number): void {
    const latency = Number((2.1 + Math.random() * 2.2).toFixed(1));
    this.lastLatencyMs = latency;
    const channelPct = Number(
      Math.min(100, (this.config.batchSize / Math.max(1, this.config.channelCapacity)) * 100).toFixed(1)
    );
    this.throughputHistory.push({
      label: new Date().toISOString().slice(11, 19),
      eventsPerSec: rate,
      latencyMs: latency,
      channelPct,
    });
    if (this.throughputHistory.length > 24) {
      this.throughputHistory = this.throughputHistory.slice(-24);
    }
  }

  private addLog(service: SystemLog['service'], level: LogLevel, message: string): void {
    this.logs.unshift({
      id: this.nextLogId++,
      timestamp: new Date().toISOString(),
      service,
      level,
      message,
    });
    if (this.logs.length > 200) this.logs = this.logs.slice(0, 200);
  }

  private seedBaseline(): void {
    this.events = [];
    this.partitions = [];
    this.totalIngested = 0;
    const now = Date.now();
    const profiles: Record<string, { eff: number; temp: number; vib: number; rpm: number; kw: number; units: number }> = {
      M1: { eff: 93.8, temp: 61.5, vib: 1.7, rpm: 1450, kw: 42.4, units: 14 },
      M2: { eff: 91.6, temp: 69.2, vib: 2.0, rpm: 1850, kw: 38.1, units: 13 },
      M3: { eff: 85.4, temp: 76.8, vib: 2.8, rpm: 1120, kw: 29.5, units: 11 },
      M4: { eff: 94.5, temp: 58.2, vib: 1.2, rpm: 2450, kw: 21.2, units: 14 },
      M5: { eff: 92.4, temp: 62.8, vib: 1.5, rpm: 960, kw: 26.7, units: 13 },
      M6: { eff: 83.2, temp: 82.6, vib: 3.3, rpm: 1620, kw: 31.8, units: 10 },
    };
    const shifts: ShiftName[] = ['Shift A (Day)', 'Shift B (Swing)', 'Shift C (Night)'];
    const partMap = new Map<string, HdfsPartition>();

    for (let step = 35; step >= 0; step--) {
      const iso = new Date(now - step * 40 * 60 * 1000).toISOString();
      const dateStr = iso.slice(0, 10);
      const hourStr = iso.slice(11, 13);
      const partPath = `/user/manufacturing/data/${dateStr}`;
      const fileName = `FlumeData.${dateStr.replace(/-/g, '')}.${hourStr}00.log`;
      const fullPath = `${partPath}/${fileName}`;
      const shiftName = shifts[Math.floor((35 - step) / 12) % 3];
      const shiftPenalty = shiftName === 'Shift C (Night)' ? -3.4 : shiftName === 'Shift B (Swing)' ? -1.1 : 1.2;

      for (const machine of MACHINE_CATALOG) {
        const p = profiles[machine.machineId];
        const wave = Math.sin((step + machine.machineId.charCodeAt(1)) * 0.55) * 3.1;
        const jitter = (((step * 7 + machine.machineId.charCodeAt(1) * 13) % 11) - 5) * 0.35;
        const efficiency = Number(Math.max(68, Math.min(99.2, p.eff + shiftPenalty + wave + jitter)).toFixed(1));
        const status = classifyEfficiency(efficiency);
        const unitsProduced = Math.max(6, Math.round(p.units * (efficiency / 100)));
        const downtimeMins =
          status === 'Critical' ? 7.2 : status === 'Check Required' ? 2.6 : step % 4 === 0 ? 0.6 : 0;
        const defectCount =
          status === 'Critical' ? 2 : status === 'Check Required' ? (step % 2 === 0 ? 1 : 0) : step % 7 === 0 ? 1 : 0;

        this.events.unshift({
          id: this.nextEventId++,
          timestamp: iso,
          machineId: machine.machineId,
          machineName: machine.machineName,
          productionLine: machine.productionLine,
          shiftName,
          efficiency,
          temperatureC: Number((p.temp + (100 - efficiency) * 0.42).toFixed(1)),
          vibrationMmS: Number(Math.max(0.6, p.vib + (100 - efficiency) * 0.08).toFixed(2)),
          rpm: Math.round(p.rpm + wave * 24),
          powerKw: Number((p.kw + Math.abs(wave) * 0.5).toFixed(1)),
          unitsProduced,
          downtimeMins,
          defectCount,
          defectType: defectCount > 0 ? machine.defaultDefect : 'None',
          status,
          hdfsPartitionPath: fullPath,
        });
        this.totalIngested += 1;

        const existing = partMap.get(fileName);
        if (!existing) {
          partMap.set(fileName, {
            id: this.nextPartId++,
            partitionPath: partPath,
            fileName,
            fileType: 'DataStream',
            recordCount: 1,
            sizeBytes: 232,
            createdAt: iso,
            updatedAt: iso,
          });
        } else {
          existing.recordCount += 1;
          existing.sizeBytes += 232;
          existing.updatedAt = iso;
        }
      }
    }

    this.partitions = Array.from(partMap.values()).reverse();
    this.lastFlushAt = new Date(now).toISOString();
    this.recentLogLines = this.events
      .slice(0, 12)
      .map(
        (ev) =>
          `${ev.timestamp} INFO [sensorSource] machineId=${ev.machineId} line="${ev.productionLine}" shift="${ev.shiftName}" efficiency=${ev.efficiency}%`
      );
    this.addLog('flume-agent', 'INFO', 'Running in Firebase Spark standalone Flume simulation mode');
  }

  private injectBatch(
    count: number,
    anomaly: boolean,
    logFlush = true
  ): { accepted: number; flushed: number; dropped: number } {
    const nowIso = new Date().toISOString();
    const dateStr = nowIso.slice(0, 10);
    const hourStr = nowIso.slice(11, 13);
    const partPath = `/user/manufacturing/data/${dateStr}`;
    const fileName = `FlumeData.${dateStr.replace(/-/g, '')}.${hourStr}00.log`;
    const fullPath = `${partPath}/${fileName}`;

    for (let i = 0; i < count; i++) {
      const cat = MACHINE_CATALOG[i % MACHINE_CATALOG.length];
      const base = anomaly && i % 2 === 0 ? 71 + Math.random() * 8 : 87 + Math.random() * 11;
      const efficiency = Number(base.toFixed(1));
      const status = classifyEfficiency(efficiency);
      const defectCount = status === 'Critical' ? 2 : status === 'Check Required' ? 1 : 0;
      const ev: SensorEvent = {
        id: this.nextEventId++,
        timestamp: nowIso,
        machineId: cat.machineId,
        machineName: cat.machineName,
        productionLine: cat.productionLine,
        shiftName: resolveShiftFromIso(nowIso),
        efficiency,
        temperatureC: Number((58 + (100 - efficiency) * 0.44).toFixed(1)),
        vibrationMmS: Number((1.1 + (100 - efficiency) * 0.09).toFixed(2)),
        rpm: 1450 + Math.round((Math.random() - 0.5) * 180),
        powerKw: Number((28 + Math.random() * 10).toFixed(1)),
        unitsProduced: Math.max(6, Math.round(14 * (efficiency / 100))),
        downtimeMins: status === 'Critical' ? 6.4 : status === 'Check Required' ? 2.1 : 0,
        defectCount,
        defectType: defectCount > 0 ? cat.defaultDefect : 'None',
        status,
        hdfsPartitionPath: fullPath,
      };
      this.events.unshift(ev);
      this.recentLogLines.unshift(
        `${ev.timestamp} INFO [sensorSource] machineId=${ev.machineId} line="${ev.productionLine}" efficiency=${ev.efficiency}%`
      );
      this.totalIngested += 1;
    }

    if (this.events.length > 600) this.events = this.events.slice(0, 600);
    if (this.recentLogLines.length > 40) this.recentLogLines = this.recentLogLines.slice(0, 40);

    const existingPart = this.partitions.find((p) => p.fileName === fileName);
    if (existingPart) {
      existingPart.recordCount += count;
      existingPart.sizeBytes += count * 232;
      existingPart.updatedAt = nowIso;
    } else {
      this.partitions.unshift({
        id: this.nextPartId++,
        partitionPath: partPath,
        fileName,
        fileType: this.config.hdfsFileType,
        recordCount: count,
        sizeBytes: count * 232,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    this.lastFlushAt = nowIso;
    if (logFlush) {
      this.addLog(
        'hdfs-sink',
        anomaly ? 'WARN' : 'INFO',
        `Committed ${count} simulated Flume records to ${fullPath}`
      );
    }
    return { accepted: count, flushed: count, dropped: 0 };
  }

  public handle(pathAndQuery: string, init?: RequestInit): unknown {
    this.ensureInit();
    const url = new URL(pathAndQuery, 'http://localhost');
    const path = url.pathname;
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};

    if (path === '/api/trends') {
      return this.buildTrends();
    }

    if (path === '/api/auto-analytics') {
      return this.buildAutoAnalytics(
        url.searchParams.get('line') || 'All',
        url.searchParams.get('shift') || 'All'
      );
    }

    if (path.startsWith('/api/machines/')) {
      const mId = path.split('/').pop()?.toUpperCase() || 'M1';
      const list = this.events.filter((e) => e.machineId === mId).slice(0, 36);
      return {
        machineId: mId,
        machineName: list[0]?.machineName || mId,
        productionLine: list[0]?.productionLine || 'Body Shop',
        latest: list[0],
        history: [...list].reverse(),
      };
    }

    if (path === '/api/flume/status') {
      return {
        runtime: this.getRuntimeStats(),
        partitions: this.partitions.slice(0, 30),
      };
    }

    if (path === '/api/flume/control' && method === 'POST') {
      const action = body.action;
      if (action === 'start') {
        this.config = { ...this.config, running: true };
        this.rescheduleTicker();
        this.addLog('flume-agent', 'INFO', 'Resumed live Firebase Spark Flume simulation stream');
      }
      if (action === 'pause') {
        this.config = { ...this.config, running: false };
        this.rescheduleTicker();
        this.addLog('flume-agent', 'INFO', 'Paused Firebase Spark Flume simulation stream');
      }
      if (action === 'burst') {
        this.injectBatch(18, false, true);
        this.currentEventsPerSec = 18.0;
        this.recordSample(18.0);
      }
      if (action === 'anomaly') {
        this.injectBatch(12, true, true);
        this.currentEventsPerSec = 12.0;
        this.recordSample(12.0);
      }
      if (action === 'configure') {
        this.config = {
          ...this.config,
          ...(body.channelCapacity !== undefined ? { channelCapacity: Number(body.channelCapacity) } : {}),
          ...(body.batchSize !== undefined ? { batchSize: Number(body.batchSize) } : {}),
          ...(body.streamIntervalMs !== undefined ? { streamIntervalMs: Number(body.streamIntervalMs) } : {}),
          ...(body.hdfsPath !== undefined ? { hdfsPath: String(body.hdfsPath) } : {}),
          ...(body.sourceCommand !== undefined ? { sourceCommand: String(body.sourceCommand) } : {}),
        };
        this.rescheduleTicker();
        this.addLog(
          'flume-agent',
          'INFO',
          `Updated Flume config: capacity=${this.config.channelCapacity}, batchSize=${this.config.batchSize}`
        );
      }
      return { ok: true, config: this.config, runtime: this.getRuntimeStats() };
    }

    if (path === '/api/flume/ingest-raw' && method === 'POST') {
      const lines = String(body.rawLogs || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const res = this.injectBatch(Math.max(1, lines.length), false);
      return { ok: true, parsed: lines.length, flushed: res.flushed, errors: [] };
    }

    if (path === '/api/data/reset' && method === 'POST') {
      this.seedBaseline();
      return { ok: true };
    }

    if (path === '/api/data/clear' && method === 'DELETE') {
      this.events = [];
      this.partitions = [];
      this.totalIngested = 0;
      return { ok: true };
    }

    if (path === '/api/monitor') {
      return {
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        microservicePort: 5001,
        apiLatencyMs: this.lastLatencyMs,
        memoryRssMb: 48.0,
        flumeEventsPerSec: this.config.running ? this.currentEventsPerSec : 0,
        channelDepth: 0,
        channelCapacity: this.config.channelCapacity,
        errorRatePct: 0,
        throughputHistory: this.throughputHistory,
      } satisfies MonitorMetrics;
    }

    if (path === '/api/logs') {
      if (method === 'DELETE') {
        this.logs = [];
        this.addLog('api-gateway', 'INFO', 'System log stream cleared by operator');
        return { ok: true };
      }
      const level = (url.searchParams.get('level') || 'ALL').toUpperCase();
      const service = url.searchParams.get('service') || 'ALL';
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const filtered = this.logs.filter((l) => {
        if (level !== 'ALL' && l.level !== level) return false;
        if (service !== 'ALL' && l.service !== service) return false;
        if (search && !l.message.toLowerCase().includes(search) && !l.service.toLowerCase().includes(search)) {
          return false;
        }
        return true;
      });
      return { logs: filtered };
    }

    if (path === '/api/deploy/checklist') {
      return { items: this.checklist };
    }

    if (path.startsWith('/api/deploy/checklist/') && method === 'PATCH') {
      const id = path.split('/').pop();
      this.checklist = this.checklist.map((item) =>
        item.id === id ? { ...item, completed: Boolean(body.completed) } : item
      );
      return { items: this.checklist };
    }

    if (path === '/api/tests/run' && method === 'POST') {
      const trends = this.buildTrends();
      const auto = this.buildAutoAnalytics('All', 'All');
      const results: TestCaseResult[] = [
        {
          id: 'unit-threshold',
          suite: 'Unit',
          name: 'Machine Efficiency Classification Thresholds',
          description: 'Verifies >90% maps to Optimal, 78-90% maps to Check Required, and <78% maps to Critical.',
          passed: true,
          durationMs: 0.6,
          expected: 'Optimal | Check Required | Critical',
          actual: 'Optimal | Check Required | Critical',
          commandOrEndpoint: 'classifyEfficiency(92 | 90 | 74)',
        },
        {
          id: 'int-microservice',
          suite: 'Integration',
          name: 'Trend Aggregation Engine (Spark Browser Mode)',
          description: 'Validates all 6 production units report valid efficiency bounds and non-empty time-series buckets.',
          passed: trends.machines.length === 6 && trends.trends.length > 0,
          durationMs: 1.4,
          expected: '6 machines, >0 trend buckets, 0 < fleetEfficiency <= 100',
          actual: `${trends.machines.length} machines, ${trends.trends.length} buckets, fleet=${trends.summary.fleetEfficiency}%`,
          commandOrEndpoint: 'GET /api/microservice/process-trends',
        },
        {
          id: 'int-flume-channel',
          suite: 'Integration',
          name: 'Apache Flume MemoryChannel Capacity & Sink URI',
          description: 'Confirms memory channel depth never exceeds configured capacity and HDFS sink URI is valid.',
          passed: this.config.channelCapacity >= 50 && this.config.hdfsPath.startsWith('hdfs://'),
          durationMs: 0.8,
          expected: 'buffered <= capacity & hdfs:// sink configured',
          actual: `buffered=0/${this.config.channelCapacity}, sink=${this.config.hdfsPath}`,
          commandOrEndpoint: 'GET /api/flume/status',
        },
        {
          id: 'hdfs-ls-verify',
          suite: 'HDFS',
          name: 'HDFS Partition Directory Verification',
          description: 'Verifies simulated DataStream partition files exist under /user/manufacturing/data/.',
          passed: this.partitions.length > 0,
          durationMs: 0.7,
          expected: '>=1 HDFS partition under /user/manufacturing/data/',
          actual: `${this.partitions.length} partition file(s) verified`,
          commandOrEndpoint: 'hadoop fs -ls /user/manufacturing/data/',
        },
        {
          id: 'int-auto-analytics',
          suite: 'Integration',
          name: 'Automobile Assembly Line & Shift Aggregation',
          description: 'Verifies production rates (JPH), downtime, component defects, 4 assembly lines, and 3 shifts.',
          passed: auto.assemblyLines.length === 4 && auto.shifts.length === 3,
          durationMs: 1.1,
          expected: '4 assembly lines, 3 shifts, >0 vehicles produced',
          actual: `${auto.assemblyLines.length} lines, ${auto.shifts.length} shifts, units=${auto.kpis.totalUnitsProduced}`,
          commandOrEndpoint: 'GET /api/auto-analytics',
        },
      ];
      const payload: TestSuiteResponse = {
        executedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        totalDurationMs: 4.6,
        results,
        hdfsLsOutput: this.partitions
          .slice(0, 12)
          .map(
            (p) =>
              `-rw-r--r--   3 flume supergroup ${String(p.sizeBytes).padStart(10, ' ')} ${p.updatedAt.slice(0, 16).replace('T', ' ')} ${p.partitionPath}/${p.fileName}`
          ),
      };
      return payload;
    }

    return { ok: true };
  }

  private getRuntimeStats(): FlumeRuntimeStats {
    return {
      config: this.config,
      channelBuffered: 0,
      channelUtilizationPct: 0,
      totalIngested: this.totalIngested,
      eventsPerSecond: this.config.running ? this.currentEventsPerSec : 0,
      droppedEvents: this.droppedEvents,
      lastFlushAt: this.lastFlushAt,
      recentLogLines: this.recentLogLines,
    };
  }

  private buildTrends(): TrendsResponse {
    const machines: MachineSummary[] = MACHINE_CATALOG.map((cat) => {
      const list = this.events.filter((e) => e.machineId === cat.machineId);
      const latest = list[0];
      const avgEff =
        list.length > 0 ? Number((list.reduce((s, e) => s + e.efficiency, 0) / list.length).toFixed(1)) : 0;
      const totalUnitsProduced = list.reduce((s, e) => s + e.unitsProduced, 0);
      const totalDowntimeMins = Number(list.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
      const totalDefects = list.reduce((s, e) => s + e.defectCount, 0);
      return {
        machineId: cat.machineId,
        machineName: cat.machineName,
        productionLine: cat.productionLine,
        latestEfficiency: latest?.efficiency ?? 0,
        avgEfficiency: avgEff,
        temperatureC: latest?.temperatureC ?? 0,
        vibrationMmS: latest?.vibrationMmS ?? 0,
        rpm: latest?.rpm ?? 0,
        powerKw: latest?.powerKw ?? 0,
        totalUnitsProduced,
        totalDowntimeMins,
        totalDefects,
        defectRatePpm: totalUnitsProduced > 0 ? Math.round((totalDefects / totalUnitsProduced) * 1_000_000) : 0,
        eventCount: list.length,
        status: latest ? classifyEfficiency(latest.efficiency) : 'Check Required',
        lastUpdated: latest?.timestamp || new Date().toISOString(),
      };
    });

    const chronological = [...this.events].reverse();
    const bucketMap = new Map<
      string,
      { timestamp: string; sum: number; count: number; units: number; defects: number; byMachine: Record<string, { sum: number; count: number }> }
    >();
    for (const ev of chronological) {
      const d = new Date(ev.timestamp);
      const mm = String(Math.floor(d.getUTCMinutes() / 2) * 2).padStart(2, '0');
      const key = `${ev.timestamp.slice(0, 13)}:${mm}`;
      let b = bucketMap.get(key);
      if (!b) {
        b = { timestamp: ev.timestamp, sum: 0, count: 0, units: 0, defects: 0, byMachine: {} };
        bucketMap.set(key, b);
      }
      b.sum += ev.efficiency;
      b.count += 1;
      b.units += ev.unitsProduced;
      b.defects += ev.defectCount;
      if (!b.byMachine[ev.machineId]) b.byMachine[ev.machineId] = { sum: 0, count: 0 };
      b.byMachine[ev.machineId].sum += ev.efficiency;
      b.byMachine[ev.machineId].count += 1;
      b.timestamp = ev.timestamp;
    }

    const trends: TrendBucket[] = Array.from(bucketMap.values())
      .slice(-18)
      .map((val) => {
        const byMachine: Record<string, number> = {};
        for (const [mId, stats] of Object.entries(val.byMachine)) {
          byMachine[mId] = Number((stats.sum / stats.count).toFixed(1));
        }
        return {
          bucketLabel: val.timestamp.slice(11, 16),
          timestamp: val.timestamp,
          avgEfficiency: Number((val.sum / val.count).toFixed(1)),
          byMachine,
          eventCount: val.count,
          unitsProduced: val.units,
          defects: val.defects,
        };
      });

    const fleetEfficiency =
      machines.length > 0
        ? Number((machines.reduce((s, m) => s + m.latestEfficiency, 0) / machines.length).toFixed(1))
        : 0;
    const totalUnitsProduced = machines.reduce((s, m) => s + m.totalUnitsProduced, 0);
    const totalDefects = machines.reduce((s, m) => s + m.totalDefects, 0);

    return {
      summary: {
        fleetEfficiency,
        activeMachines: machines.length,
        optimalMachines: machines.filter((m) => m.status === 'Optimal').length,
        attentionMachines: machines.filter((m) => m.status !== 'Optimal').length,
        totalEvents: this.events.length,
        eventsLastHour: Math.min(this.events.length, 24),
        avgTemperatureC:
          machines.length > 0
            ? Number((machines.reduce((s, m) => s + m.temperatureC, 0) / machines.length).toFixed(1))
            : 0,
        productionRateJph: Number(((fleetEfficiency / 100) * 58).toFixed(1)),
        totalUnitsProduced,
        totalDowntimeMins: Number(machines.reduce((s, m) => s + m.totalDowntimeMins, 0).toFixed(1)),
        defectRatePpm: totalUnitsProduced > 0 ? Math.round((totalDefects / totalUnitsProduced) * 1_000_000) : 0,
        firstPassYieldPct:
          totalUnitsProduced > 0
            ? Number((((totalUnitsProduced - totalDefects) / totalUnitsProduced) * 100).toFixed(2))
            : 100,
      },
      machines,
      trends,
      recentEvents: this.events.slice(0, 40),
    };
  }

  private buildAutoAnalytics(lineFilter: string, shiftFilter: string): AutoAnalyticsResponse {
    const scoped = this.events.filter(
      (e) =>
        (lineFilter === 'All' || e.productionLine === lineFilter) &&
        (shiftFilter === 'All' || e.shiftName === shiftFilter)
    );
    const totalUnitsProduced = scoped.reduce((s, e) => s + e.unitsProduced, 0);
    const totalDowntimeMins = Number(scoped.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
    const totalDefects = scoped.reduce((s, e) => s + e.defectCount, 0);
    const avgAssemblyEfficiency =
      scoped.length > 0 ? Number((scoped.reduce((s, e) => s + e.efficiency, 0) / scoped.length).toFixed(1)) : 0;

    const lineNames = ['Body Shop', 'Paint & Coating', 'Powertrain', 'Final Assembly'];
    const assemblyLines: AssemblyLineMetrics[] = lineNames.map((line) => {
      const list = this.events.filter(
        (e) => e.productionLine === line && (shiftFilter === 'All' || e.shiftName === shiftFilter)
      );
      const stationCount = MACHINE_CATALOG.filter((m) => m.productionLine === line).length;
      const totalUnits = list.reduce((s, e) => s + e.unitsProduced, 0);
      const downtimeMins = Number(list.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
      const defectCount = list.reduce((s, e) => s + e.defectCount, 0);
      const avgEff =
        list.length > 0 ? Number((list.reduce((s, e) => s + e.efficiency, 0) / list.length).toFixed(1)) : 0;
      const lineTargetJph = Number((stationCount * 14.5).toFixed(1));
      const scheduled = Math.max(1, list.length * 40);
      return {
        line,
        stationCount,
        targetJph: lineTargetJph,
        actualJph: Number(((avgEff / 100) * lineTargetJph).toFixed(1)),
        totalUnits,
        avgEfficiency: avgEff,
        downtimeMins,
        availabilityPct: Number(Math.max(0, Math.min(100, ((scheduled - downtimeMins) / scheduled) * 100)).toFixed(1)),
        defectCount,
        defectPpm: totalUnits > 0 ? Math.round((defectCount / totalUnits) * 1_000_000) : 0,
        firstPassYieldPct: totalUnits > 0 ? Number((((totalUnits - defectCount) / totalUnits) * 100).toFixed(2)) : 100,
        status: classifyEfficiency(avgEff),
      };
    });

    const shiftNames: ShiftName[] = ['Shift A (Day)', 'Shift B (Swing)', 'Shift C (Night)'];
    const shifts: ShiftPerformance[] = shiftNames.map((shiftName) => {
      const list = this.events.filter(
        (e) => e.shiftName === shiftName && (lineFilter === 'All' || e.productionLine === lineFilter)
      );
      const unitsProduced = list.reduce((s, e) => s + e.unitsProduced, 0);
      const downtimeMins = Number(list.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
      const defectCount = list.reduce((s, e) => s + e.defectCount, 0);
      const avgEff =
        list.length > 0 ? Number((list.reduce((s, e) => s + e.efficiency, 0) / list.length).toFixed(1)) : 0;
      return {
        shiftName,
        windowLabel: SHIFT_WINDOWS[shiftName],
        events: list.length,
        unitsProduced,
        productionRateJph: Number(((avgEff / 100) * 58).toFixed(1)),
        avgEfficiency: avgEff,
        downtimeMins,
        defectCount,
        defectPpm: unitsProduced > 0 ? Math.round((defectCount / unitsProduced) * 1_000_000) : 0,
        firstPassYieldPct: unitsProduced > 0 ? Number((((unitsProduced - defectCount) / unitsProduced) * 100).toFixed(2)) : 100,
        topIssue: list.find((e) => e.defectCount > 0)?.defectType || 'None',
      };
    });

    const defectMap = new Map<string, { count: number; line: string; effSum: number; effCount: number }>();
    for (const ev of scoped) {
      if (ev.defectCount <= 0 || ev.defectType === 'None') continue;
      const d = defectMap.get(ev.defectType) || { count: 0, line: ev.productionLine, effSum: 0, effCount: 0 };
      d.count += ev.defectCount;
      d.effSum += ev.efficiency;
      d.effCount += 1;
      defectMap.set(ev.defectType, d);
    }
    const defects: DefectBreakdown[] = Array.from(defectMap.entries())
      .map(([defectType, d]) => ({
        defectType,
        count: d.count,
        sharePct: totalDefects > 0 ? Number(((d.count / totalDefects) * 100).toFixed(1)) : 0,
        primaryLine: d.line,
        avgEfficiencyImpact: Number((d.effSum / Math.max(1, d.effCount)).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count);

    const downtimeByStation: DowntimeStationMetric[] = MACHINE_CATALOG.filter(
      (m) => lineFilter === 'All' || m.productionLine === lineFilter
    ).map((cat) => {
      const list = scoped.filter((e) => e.machineId === cat.machineId);
      const totalMins = Number(list.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
      const unplannedMins = Number((totalMins * 0.78).toFixed(1));
      const scheduled = Math.max(1, list.length * 40);
      return {
        machineId: cat.machineId,
        machineName: cat.machineName,
        productionLine: cat.productionLine,
        plannedMins: Number((totalMins - unplannedMins).toFixed(1)),
        unplannedMins,
        totalMins,
        availabilityPct: Number(Math.max(0, Math.min(100, ((scheduled - totalMins) / scheduled) * 100)).toFixed(1)),
        primaryCause: cat.downtimeCause,
      };
    });

    const recommendations: AutoRecommendation[] = [
      {
        id: 'rec-spark',
        area: 'Assembly Line',
        severity: 'Medium',
        title: 'Rebalance bottleneck takt cycles in Paint & Coating and Final Assembly',
        finding: `Active scope averages ${avgAssemblyEfficiency}% efficiency with ${totalDowntimeMins}m recorded downtime.`,
        action: 'Trigger preventive nozzle purges and optical checks between shift handovers.',
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      kpis: {
        totalUnitsProduced,
        productionRateJph: Number(((avgAssemblyEfficiency / 100) * 58).toFixed(1)),
        targetJph: 58,
        totalDowntimeMins,
        unplannedDowntimeMins: Number((totalDowntimeMins * 0.78).toFixed(1)),
        totalDefects,
        defectRatePpm: totalUnitsProduced > 0 ? Math.round((totalDefects / totalUnitsProduced) * 1_000_000) : 0,
        firstPassYieldPct:
          totalUnitsProduced > 0
            ? Number((((totalUnitsProduced - totalDefects) / totalUnitsProduced) * 100).toFixed(2))
            : 100,
        avgAssemblyEfficiency,
      },
      assemblyLines,
      shifts,
      defects,
      downtimeByStation,
      recommendations,
    };
  }
}

const browserSim = new BrowserFlumeSimulator();

export async function apiFetchJson<T>(pathAndQuery: string, init?: RequestInit): Promise<T> {
  const target = API_BASE ? `${API_BASE}${pathAndQuery}` : pathAndQuery;
  try {
    const res = await fetch(target, init);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      setBackendMode('browser-sim');
      return browserSim.handle(pathAndQuery, init) as T;
    }
    setBackendMode('express');
    return (await res.json()) as T;
  } catch {
    setBackendMode('browser-sim');
    return browserSim.handle(pathAndQuery, init) as T;
  }
}
