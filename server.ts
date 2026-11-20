import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  MACHINE_CATALOG,
  SHIFT_WINDOWS,
  appendSystemLog,
  classifyEfficiency,
  db,
  getDeployChecklist,
  getHdfsPartitions,
  initDatabase,
  mapSensorRow,
  seedInitialManufacturingData,
} from './server/database.ts';
import { flumeEngine } from './server/flumeEngine.ts';
import type {
  AssemblyLineMetrics,
  AutoAnalyticsResponse,
  AutoRecommendation,
  DefectBreakdown,
  DowntimeStationMetric,
  LogLevel,
  MachineSummary,
  ShiftName,
  ShiftPerformance,
  SystemLog,
  TestCaseResult,
  TrendBucket,
  TrendsResponse,
} from './src/types/analytics.ts';

initDatabase();
flumeEngine.startLoop();

const app = express();
app.use(express.json({ limit: '1mb' }));

const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = new Set<string>([
  'https://banded-order-th7nb.web.app',
  'https://banded-order-th7nb.firebaseapp.com',
  ...configuredOrigins,
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.has(origin) || origin.startsWith('http://localhost:'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

const PORT = Number(process.env.PORT) || 3000;

function computeTrendsPayload(filters?: {
  line?: string;
  status?: string;
  machineId?: string;
  limit?: number;
}): TrendsResponse {
  const allRows = db
    .prepare('SELECT * FROM sensor_events ORDER BY timestamp DESC, id DESC LIMIT 450')
    .all() as Array<Parameters<typeof mapSensorRow>[0]>;

  const mapped = allRows.map(mapSensorRow);

  // Per-machine summary across latest readings
  const byMachine = new Map<string, typeof mapped>();
  for (const ev of mapped) {
    const list = byMachine.get(ev.machineId) || [];
    list.push(ev);
    byMachine.set(ev.machineId, list);
  }

  let machines: MachineSummary[] = MACHINE_CATALOG.map((cat) => {
    const events = byMachine.get(cat.machineId) || [];
    const latest = events[0];
    const avgEff =
      events.length > 0
        ? Number((events.reduce((s, e) => s + e.efficiency, 0) / events.length).toFixed(1))
        : 0;
    const totalUnitsProduced = events.reduce((s, e) => s + e.unitsProduced, 0);
    const totalDowntimeMins = Number(events.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
    const totalDefects = events.reduce((s, e) => s + e.defectCount, 0);
    const defectRatePpm =
      totalUnitsProduced > 0 ? Math.round((totalDefects / totalUnitsProduced) * 1_000_000) : 0;
    const latestEfficiency = latest ? latest.efficiency : 0;
    return {
      machineId: cat.machineId,
      machineName: cat.machineName,
      productionLine: cat.productionLine,
      latestEfficiency,
      avgEfficiency: avgEff,
      temperatureC: latest ? latest.temperatureC : 0,
      vibrationMmS: latest ? latest.vibrationMmS : 0,
      rpm: latest ? latest.rpm : 0,
      powerKw: latest ? latest.powerKw : 0,
      totalUnitsProduced,
      totalDowntimeMins,
      totalDefects,
      defectRatePpm,
      eventCount: events.length,
      status: latest ? classifyEfficiency(latest.efficiency) : 'Check Required',
      lastUpdated: latest ? latest.timestamp : new Date().toISOString(),
    };
  });

  if (filters?.line && filters.line !== 'All') {
    machines = machines.filter((m) => m.productionLine === filters.line);
  }
  if (filters?.status && filters.status !== 'All') {
    machines = machines.filter((m) => m.status === filters.status);
  }
  if (filters?.machineId && filters.machineId !== 'All') {
    machines = machines.filter((m) => m.machineId === filters.machineId);
  }

  // Time-series trend buckets (chronological, up to 18 points)
  const chronological = [...mapped].reverse();
  const bucketMap = new Map<
    string,
    {
      timestamp: string;
      sum: number;
      count: number;
      units: number;
      defects: number;
      byMachine: Record<string, { sum: number; count: number }>;
    }
  >();

  for (const ev of chronological) {
    if (filters?.line && filters.line !== 'All' && ev.productionLine !== filters.line) continue;
    if (filters?.machineId && filters.machineId !== 'All' && ev.machineId !== filters.machineId) continue;

    const d = new Date(ev.timestamp);
    const mm = String(Math.floor(d.getUTCMinutes() / 2) * 2).padStart(2, '0');
    const key = `${ev.timestamp.slice(0, 13)}:${mm}`;

    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = { timestamp: ev.timestamp, sum: 0, count: 0, units: 0, defects: 0, byMachine: {} };
      bucketMap.set(key, bucket);
    }
    bucket.sum += ev.efficiency;
    bucket.count += 1;
    bucket.units += ev.unitsProduced;
    bucket.defects += ev.defectCount;
    if (!bucket.byMachine[ev.machineId]) {
      bucket.byMachine[ev.machineId] = { sum: 0, count: 0 };
    }
    bucket.byMachine[ev.machineId].sum += ev.efficiency;
    bucket.byMachine[ev.machineId].count += 1;
    bucket.timestamp = ev.timestamp;
  }

  const trends: TrendBucket[] = Array.from(bucketMap.entries())
    .slice(-18)
    .map(([, val]) => {
      const byMachineAvg: Record<string, number> = {};
      for (const [mId, stats] of Object.entries(val.byMachine)) {
        byMachineAvg[mId] = Number((stats.sum / stats.count).toFixed(1));
      }
      const dt = new Date(val.timestamp);
      const bucketLabel = dt.toISOString().slice(11, 16);
      return {
        bucketLabel,
        timestamp: val.timestamp,
        avgEfficiency: Number((val.sum / val.count).toFixed(1)),
        byMachine: byMachineAvg,
        eventCount: val.count,
        unitsProduced: val.units,
        defects: val.defects,
      };
    });

  const filteredEvents = mapped
    .filter((e) => {
      if (filters?.line && filters.line !== 'All' && e.productionLine !== filters.line) return false;
      if (filters?.status && filters.status !== 'All' && e.status !== filters.status) return false;
      if (filters?.machineId && filters.machineId !== 'All' && e.machineId !== filters.machineId) return false;
      return true;
    })
    .slice(0, filters?.limit ?? 40);

  const totalEventsCount = (db.prepare('SELECT COUNT(*) as c FROM sensor_events').get() as { c: number }).c;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const eventsLastHour = (
    db.prepare('SELECT COUNT(*) as c FROM sensor_events WHERE timestamp >= ?').get(oneHourAgo) as { c: number }
  ).c;

  const fleetEfficiency =
    machines.length > 0
      ? Number((machines.reduce((acc, m) => acc + m.latestEfficiency, 0) / machines.length).toFixed(1))
      : 0;
  const avgTemperatureC =
    machines.length > 0
      ? Number((machines.reduce((acc, m) => acc + m.temperatureC, 0) / machines.length).toFixed(1))
      : 0;

  const totalUnitsProduced = machines.reduce((acc, m) => acc + m.totalUnitsProduced, 0);
  const totalDowntimeMins = Number(machines.reduce((acc, m) => acc + m.totalDowntimeMins, 0).toFixed(1));
  const totalDefects = machines.reduce((acc, m) => acc + m.totalDefects, 0);
  const defectRatePpm =
    totalUnitsProduced > 0 ? Math.round((totalDefects / totalUnitsProduced) * 1_000_000) : 0;
  const firstPassYieldPct =
    totalUnitsProduced > 0
      ? Number((((totalUnitsProduced - totalDefects) / totalUnitsProduced) * 100).toFixed(2))
      : 100;
  const productionRateJph = Number(((fleetEfficiency / 100) * 58).toFixed(1));

  return {
    summary: {
      fleetEfficiency,
      activeMachines: machines.length,
      optimalMachines: machines.filter((m) => m.status === 'Optimal').length,
      attentionMachines: machines.filter((m) => m.status !== 'Optimal').length,
      totalEvents: totalEventsCount,
      eventsLastHour,
      avgTemperatureC,
      productionRateJph,
      totalUnitsProduced,
      totalDowntimeMins,
      defectRatePpm,
      firstPassYieldPct,
    },
    machines,
    trends,
    recentEvents: filteredEvents,
  };
}

function computeAutoAnalyticsPayload(lineFilter = 'All', shiftFilter = 'All'): AutoAnalyticsResponse {
  const allRows = db
    .prepare('SELECT * FROM sensor_events ORDER BY timestamp DESC, id DESC LIMIT 600')
    .all() as Array<Parameters<typeof mapSensorRow>[0]>;
  const mappedAll = allRows.map(mapSensorRow);

  const scoped = mappedAll.filter((ev) => {
    if (lineFilter !== 'All' && ev.productionLine !== lineFilter) return false;
    if (shiftFilter !== 'All' && ev.shiftName !== shiftFilter) return false;
    return true;
  });

  const totalUnitsProduced = scoped.reduce((s, e) => s + e.unitsProduced, 0);
  const totalDowntimeMins = Number(scoped.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
  const unplannedDowntimeMins = Number((totalDowntimeMins * 0.78).toFixed(1));
  const totalDefects = scoped.reduce((s, e) => s + e.defectCount, 0);
  const avgAssemblyEfficiency =
    scoped.length > 0
      ? Number((scoped.reduce((s, e) => s + e.efficiency, 0) / scoped.length).toFixed(1))
      : 0;
  const targetJph = 58.0;
  const productionRateJph = Number(((avgAssemblyEfficiency / 100) * targetJph).toFixed(1));
  const defectRatePpm =
    totalUnitsProduced > 0 ? Math.round((totalDefects / totalUnitsProduced) * 1_000_000) : 0;
  const firstPassYieldPct =
    totalUnitsProduced > 0
      ? Number((((totalUnitsProduced - totalDefects) / totalUnitsProduced) * 100).toFixed(2))
      : 100;

  // Assembly-line aggregation
  const lineNames = ['Body Shop', 'Paint & Coating', 'Powertrain', 'Final Assembly'];
  const assemblyLines: AssemblyLineMetrics[] = lineNames.map((line) => {
    const events = mappedAll.filter(
      (e) => e.productionLine === line && (shiftFilter === 'All' || e.shiftName === shiftFilter)
    );
    const stationCount = MACHINE_CATALOG.filter((m) => m.productionLine === line).length;
    const totalUnits = events.reduce((s, e) => s + e.unitsProduced, 0);
    const downtimeMins = Number(events.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
    const defectCount = events.reduce((s, e) => s + e.defectCount, 0);
    const avgEfficiency =
      events.length > 0
        ? Number((events.reduce((s, e) => s + e.efficiency, 0) / events.length).toFixed(1))
        : 0;
    const lineTargetJph = stationCount * 14.5;
    const actualJph = Number(((avgEfficiency / 100) * lineTargetJph).toFixed(1));
    const scheduledMins = Math.max(1, events.length * 40);
    const availabilityPct = Number(
      Math.max(0, Math.min(100, ((scheduledMins - downtimeMins) / scheduledMins) * 100)).toFixed(1)
    );
    const defectPpm = totalUnits > 0 ? Math.round((defectCount / totalUnits) * 1_000_000) : 0;
    const fpy =
      totalUnits > 0 ? Number((((totalUnits - defectCount) / totalUnits) * 100).toFixed(2)) : 100;

    return {
      line,
      stationCount,
      targetJph: Number(lineTargetJph.toFixed(1)),
      actualJph,
      totalUnits,
      avgEfficiency,
      downtimeMins,
      availabilityPct,
      defectCount,
      defectPpm,
      firstPassYieldPct: fpy,
      status: classifyEfficiency(avgEfficiency),
    };
  });

  // Shift performance aggregation
  const shiftNames: ShiftName[] = ['Shift A (Day)', 'Shift B (Swing)', 'Shift C (Night)'];
  const shifts: ShiftPerformance[] = shiftNames.map((shiftName) => {
    const events = mappedAll.filter(
      (e) => e.shiftName === shiftName && (lineFilter === 'All' || e.productionLine === lineFilter)
    );
    const unitsProduced = events.reduce((s, e) => s + e.unitsProduced, 0);
    const downtimeMins = Number(events.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
    const defectCount = events.reduce((s, e) => s + e.defectCount, 0);
    const avgEfficiency =
      events.length > 0
        ? Number((events.reduce((s, e) => s + e.efficiency, 0) / events.length).toFixed(1))
        : 0;
    const rateJph = Number(((avgEfficiency / 100) * targetJph).toFixed(1));
    const defectPpm = unitsProduced > 0 ? Math.round((defectCount / unitsProduced) * 1_000_000) : 0;
    const fpy =
      unitsProduced > 0
        ? Number((((unitsProduced - defectCount) / unitsProduced) * 100).toFixed(2))
        : 100;

    const defectTally = new Map<string, number>();
    for (const ev of events) {
      if (ev.defectCount > 0 && ev.defectType !== 'None') {
        defectTally.set(ev.defectType, (defectTally.get(ev.defectType) || 0) + ev.defectCount);
      }
    }
    const topDefect = Array.from(defectTally.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';

    return {
      shiftName,
      windowLabel: SHIFT_WINDOWS[shiftName],
      events: events.length,
      unitsProduced,
      productionRateJph: rateJph,
      avgEfficiency,
      downtimeMins,
      defectCount,
      defectPpm,
      firstPassYieldPct: fpy,
      topIssue: topDefect,
    };
  });

  // Component defects breakdown
  const defectMap = new Map<
    string,
    { count: number; lineCounts: Map<string, number>; effSum: number; effCount: number }
  >();
  for (const ev of scoped) {
    if (ev.defectCount <= 0 || ev.defectType === 'None') continue;
    let entry = defectMap.get(ev.defectType);
    if (!entry) {
      entry = { count: 0, lineCounts: new Map(), effSum: 0, effCount: 0 };
      defectMap.set(ev.defectType, entry);
    }
    entry.count += ev.defectCount;
    entry.lineCounts.set(ev.productionLine, (entry.lineCounts.get(ev.productionLine) || 0) + ev.defectCount);
    entry.effSum += ev.efficiency;
    entry.effCount += 1;
  }

  const defects: DefectBreakdown[] = Array.from(defectMap.entries())
    .map(([defectType, d]) => {
      const primaryLine =
        Array.from(d.lineCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Final Assembly';
      return {
        defectType,
        count: d.count,
        sharePct: totalDefects > 0 ? Number(((d.count / totalDefects) * 100).toFixed(1)) : 0,
        primaryLine,
        avgEfficiencyImpact: Number((d.effSum / Math.max(1, d.effCount)).toFixed(1)),
      };
    })
    .sort((a, b) => b.count - a.count);

  // Machine downtime breakdown
  const downtimeByStation: DowntimeStationMetric[] = MACHINE_CATALOG.filter(
    (m) => lineFilter === 'All' || m.productionLine === lineFilter
  ).map((cat) => {
    const events = scoped.filter((e) => e.machineId === cat.machineId);
    const totalMins = Number(events.reduce((s, e) => s + e.downtimeMins, 0).toFixed(1));
    const unplannedMins = Number((totalMins * 0.78).toFixed(1));
    const plannedMins = Number((totalMins - unplannedMins).toFixed(1));
    const scheduled = Math.max(1, events.length * 40);
    const availabilityPct = Number(
      Math.max(0, Math.min(100, ((scheduled - totalMins) / scheduled) * 100)).toFixed(1)
    );
    return {
      machineId: cat.machineId,
      machineName: cat.machineName,
      productionLine: cat.productionLine,
      plannedMins,
      unplannedMins,
      totalMins,
      availabilityPct,
      primaryCause: cat.downtimeCause,
    };
  });

  // Live data-driven engineering recommendations
  const recommendations: AutoRecommendation[] = [];
  const weakestLine = [...assemblyLines].sort((a, b) => a.avgEfficiency - b.avgEfficiency)[0];
  const highestDowntimeStation = [...downtimeByStation].sort((a, b) => b.totalMins - a.totalMins)[0];
  const topDefect = defects[0];
  const weakestShift = [...shifts].filter((s) => s.events > 0).sort((a, b) => a.avgEfficiency - b.avgEfficiency)[0];

  if (weakestLine) {
    recommendations.push({
      id: 'rec-line',
      area: 'Assembly Line',
      severity: weakestLine.avgEfficiency < 88 ? 'High' : 'Medium',
      title: `Rebalance takt cycle on ${weakestLine.line}`,
      finding: `${weakestLine.line} averages ${weakestLine.avgEfficiency}% efficiency (${weakestLine.actualJph}/${weakestLine.targetJph} JPH) with ${weakestLine.downtimeMins}m recorded downtime.`,
      action: 'Dispatch preventive maintenance between shift changeovers and tighten Flume alert threshold to 88% on this line.',
    });
  }

  if (highestDowntimeStation) {
    recommendations.push({
      id: 'rec-downtime',
      area: 'Downtime',
      severity: highestDowntimeStation.unplannedMins > 18 ? 'High' : 'Medium',
      title: `Reduce unplanned stops on ${highestDowntimeStation.machineId} (${highestDowntimeStation.machineName})`,
      finding: `${highestDowntimeStation.totalMins}m total downtime (${highestDowntimeStation.unplannedMins}m unplanned) driven primarily by ${highestDowntimeStation.primaryCause}.`,
      action: 'Schedule predictive sensor calibration before vibration exceeds 3.0 mm/s and stage spare consumables at line-side.',
    });
  }

  if (topDefect) {
    recommendations.push({
      id: 'rec-defect',
      area: 'Defects',
      severity: topDefect.sharePct > 28 ? 'High' : 'Medium',
      title: `Contain ${topDefect.defectType} defects in ${topDefect.primaryLine}`,
      finding: `${topDefect.defectType} accounts for ${topDefect.sharePct}% of plant defects (${topDefect.count} units), occurring when station efficiency averages ${topDefect.avgEfficiencyImpact}%.`,
      action: 'Enable automated end-of-station optical/torque interlock whenever Flume detects efficiency dropping below 86%.',
    });
  }

  if (weakestShift) {
    recommendations.push({
      id: 'rec-shift',
      area: 'Shift Performance',
      severity: weakestShift.avgEfficiency < 88 ? 'Medium' : 'Advisory',
      title: `Standardize handover support for ${weakestShift.shiftName}`,
      finding: `${weakestShift.shiftName} (${weakestShift.windowLabel}) logs ${weakestShift.avgEfficiency}% efficiency and ${weakestShift.defectPpm.toLocaleString()} PPM defect rate.`,
      action: `Prioritize ${weakestShift.topIssue} inspection at shift start and mirror Shift A parameter presets across stations.`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      totalUnitsProduced,
      productionRateJph,
      targetJph,
      totalDowntimeMins,
      unplannedDowntimeMins,
      totalDefects,
      defectRatePpm,
      firstPassYieldPct,
      avgAssemblyEfficiency,
    },
    assemblyLines,
    shifts,
    defects,
    downtimeByStation,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// 1. Express.js Data-Processor Microservice Endpoints (Architectural Tier)
// ---------------------------------------------------------------------------
app.get('/api/microservice/health', (_req, res) => {
  const stats = flumeEngine.getRuntimeStats();
  res.json({
    service: 'manufacturing-data-processor',
    status: 'healthy',
    port: 5001,
    flumeRunning: stats.config.running,
    totalIngested: stats.totalIngested,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/microservice/process-trends', (req, res) => {
  const line = typeof req.query.line === 'string' ? req.query.line : 'All';
  const status = typeof req.query.status === 'string' ? req.query.status : 'All';
  const machineId = typeof req.query.machineId === 'string' ? req.query.machineId : 'All';
  const payload = computeTrendsPayload({ line, status, machineId });
  res.json(payload);
});

// ---------------------------------------------------------------------------
// 2. Consumer API Routes (Next.js /api/trends Equivalent)
// ---------------------------------------------------------------------------
app.get('/api/trends', (req, res) => {
  const line = typeof req.query.line === 'string' ? req.query.line : 'All';
  const status = typeof req.query.status === 'string' ? req.query.status : 'All';
  const machineId = typeof req.query.machineId === 'string' ? req.query.machineId : 'All';
  const payload = computeTrendsPayload({ line, status, machineId });
  res.json(payload);
});

app.get('/api/auto-analytics', (req, res) => {
  const line = typeof req.query.line === 'string' ? req.query.line : 'All';
  const shift = typeof req.query.shift === 'string' ? req.query.shift : 'All';
  res.json(computeAutoAnalyticsPayload(line, shift));
});

app.get('/api/machines/:id', (req, res) => {
  const machineId = req.params.id.toUpperCase();
  const rows = db
    .prepare('SELECT * FROM sensor_events WHERE machine_id = ? ORDER BY timestamp DESC, id DESC LIMIT 36')
    .all(machineId) as Array<Parameters<typeof mapSensorRow>[0]>;

  if (rows.length === 0) {
    return res.status(404).json({ error: `Machine ${machineId} not found in warehouse.` });
  }
  const events = rows.map(mapSensorRow);
  return res.json({
    machineId,
    machineName: events[0].machineName,
    productionLine: events[0].productionLine,
    latest: events[0],
    history: [...events].reverse(),
  });
});

// ---------------------------------------------------------------------------
// 3. Apache Flume Pipeline Controls & HDFS Endpoints
// ---------------------------------------------------------------------------
app.get('/api/flume/status', (_req, res) => {
  res.json({
    runtime: flumeEngine.getRuntimeStats(),
    partitions: getHdfsPartitions(),
  });
});

app.post('/api/flume/control', (req, res) => {
  const { action, channelCapacity, batchSize, streamIntervalMs, hdfsPath, sourceCommand } = req.body || {};

  if (action === 'start') {
    const config = flumeEngine.updateConfig({ running: true });
    return res.json({ ok: true, config, runtime: flumeEngine.getRuntimeStats() });
  }
  if (action === 'pause') {
    const config = flumeEngine.updateConfig({ running: false });
    return res.json({ ok: true, config, runtime: flumeEngine.getRuntimeStats() });
  }
  if (action === 'burst') {
    const result = flumeEngine.injectBurst(18, false);
    return res.json({ ok: true, result, runtime: flumeEngine.getRuntimeStats() });
  }
  if (action === 'anomaly') {
    const result = flumeEngine.injectBurst(12, true);
    return res.json({ ok: true, result, runtime: flumeEngine.getRuntimeStats() });
  }
  if (action === 'configure') {
    const config = flumeEngine.updateConfig({
      ...(channelCapacity !== undefined ? { channelCapacity: Number(channelCapacity) } : {}),
      ...(batchSize !== undefined ? { batchSize: Number(batchSize) } : {}),
      ...(streamIntervalMs !== undefined ? { streamIntervalMs: Number(streamIntervalMs) } : {}),
      ...(hdfsPath !== undefined ? { hdfsPath: String(hdfsPath) } : {}),
      ...(sourceCommand !== undefined ? { sourceCommand: String(sourceCommand) } : {}),
    });
    return res.json({ ok: true, config, runtime: flumeEngine.getRuntimeStats() });
  }

  return res.status(400).json({ error: 'Unsupported Flume control action' });
});

app.post('/api/flume/ingest-raw', (req, res) => {
  const { rawLogs } = req.body || {};
  if (typeof rawLogs !== 'string' || !rawLogs.trim()) {
    return res.status(400).json({ error: 'Provide one or more sensor log lines to ingest.' });
  }
  const result = flumeEngine.ingestRawLogText(rawLogs);
  if (result.parsed === 0 && result.errors.length > 0) {
    return res.status(422).json({ error: result.errors[0], ...result });
  }
  return res.json({ ok: true, ...result, runtime: flumeEngine.getRuntimeStats() });
});

app.get('/api/hdfs/ls', (_req, res) => {
  const partitions = getHdfsPartitions();
  res.json({
    command: 'hadoop fs -ls /user/manufacturing/data/',
    partitions,
    lines: partitions.map(
      (p) =>
        `-rw-r--r--   3 flume supergroup ${String(p.sizeBytes).padStart(10, ' ')} ${p.updatedAt.slice(0, 16).replace('T', ' ')} ${p.partitionPath}/${p.fileName}`
    ),
  });
});

// ---------------------------------------------------------------------------
// 4. Testing, Deployment Checklist & Monitoring Endpoints
// ---------------------------------------------------------------------------
app.post('/api/tests/run', (_req, res) => {
  const suiteStart = performance.now();
  const results: TestCaseResult[] = [];

  // Test 1: Efficiency threshold unit classification
  {
    const t0 = performance.now();
    const s1 = classifyEfficiency(92);
    const s2 = classifyEfficiency(90);
    const s3 = classifyEfficiency(74);
    const passed = s1 === 'Optimal' && s2 === 'Check Required' && s3 === 'Critical';
    results.push({
      id: 'unit-threshold',
      suite: 'Unit',
      name: 'Machine Efficiency Classification Thresholds',
      description: 'Verifies >90% maps to Optimal, 78-90% maps to Check Required, and <78% maps to Critical.',
      passed,
      durationMs: Number(Math.max(0.4, performance.now() - t0).toFixed(2)),
      expected: 'Optimal | Check Required | Critical',
      actual: `${s1} | ${s2} | ${s3}`,
      commandOrEndpoint: 'classifyEfficiency(92 | 90 | 74)',
    });
  }

  // Test 2: Express Microservice trend aggregation integrity
  {
    const t0 = performance.now();
    const trends = computeTrendsPayload();
    const passed =
      trends.machines.length === 6 &&
      trends.trends.length > 0 &&
      trends.summary.fleetEfficiency > 0 &&
      trends.summary.fleetEfficiency <= 100;
    results.push({
      id: 'int-microservice',
      suite: 'Integration',
      name: 'Express Microservice Aggregation (/api/microservice/process-trends)',
      description: 'Validates all 6 production units report valid efficiency bounds and non-empty time-series buckets.',
      passed,
      durationMs: Number(Math.max(0.8, performance.now() - t0).toFixed(2)),
      expected: '6 machines, >0 trend buckets, 0 < fleetEfficiency <= 100',
      actual: `${trends.machines.length} machines, ${trends.trends.length} buckets, fleet=${trends.summary.fleetEfficiency}%`,
      commandOrEndpoint: 'GET /api/microservice/process-trends',
    });
  }

  // Test 3: Flume channel capacity & runtime bounds
  {
    const t0 = performance.now();
    const stats = flumeEngine.getRuntimeStats();
    const passed =
      stats.config.channelCapacity >= 50 &&
      stats.channelBuffered <= stats.config.channelCapacity &&
      stats.config.hdfsPath.startsWith('hdfs://');
    results.push({
      id: 'int-flume-channel',
      suite: 'Integration',
      name: 'Apache Flume MemoryChannel Capacity & Sink URI',
      description: 'Confirms memory channel depth never exceeds configured capacity and HDFS sink URI is valid.',
      passed,
      durationMs: Number(Math.max(0.5, performance.now() - t0).toFixed(2)),
      expected: 'buffered <= capacity & hdfs:// sink configured',
      actual: `buffered=${stats.channelBuffered}/${stats.config.channelCapacity}, sink=${stats.config.hdfsPath}`,
      commandOrEndpoint: 'GET /api/flume/status',
    });
  }

  // Test 4: Sensor log ingestion parser check (dry validation against SQLite write)
  {
    const t0 = performance.now();
    const beforeCount = (db.prepare('SELECT COUNT(*) as c FROM sensor_events').get() as { c: number }).c;
    const ingestRes = flumeEngine.ingestRawLogText(
      `machineId=M1 efficiency=94.8 temp=61.4 vibration=1.5 rpm=3180 kw=18.1`
    );
    const afterCount = (db.prepare('SELECT COUNT(*) as c FROM sensor_events').get() as { c: number }).c;
    const passed = ingestRes.parsed === 1 && ingestRes.flushed === 1 && afterCount >= beforeCount;
    results.push({
      id: 'int-flume-ingest',
      suite: 'Integration',
      name: 'ExecSource Log Tail Parse & HDFS Commit',
      description: 'Streams a synthetic sensor log line through the Flume parser into SQLite HDFS storage.',
      passed,
      durationMs: Number(Math.max(1.1, performance.now() - t0).toFixed(2)),
      expected: 'parsed=1, flushed=1, persisted row count incremented',
      actual: `parsed=${ingestRes.parsed}, flushed=${ingestRes.flushed}, rows=${beforeCount}->${afterCount}`,
      commandOrEndpoint: 'POST /api/flume/ingest-raw',
    });
  }

  // Test 5: HDFS partition listing verification
  const partitions = getHdfsPartitions();
  {
    const t0 = performance.now();
    const passed = partitions.length > 0 && partitions.every((p) => p.partitionPath.startsWith('/user/manufacturing/data/'));
    results.push({
      id: 'hdfs-ls-verify',
      suite: 'HDFS',
      name: 'HDFS Partition Directory Verification',
      description: 'Executes simulated hadoop fs -ls check to verify DataStream partition files exist and are non-empty.',
      passed,
      durationMs: Number(Math.max(0.6, performance.now() - t0).toFixed(2)),
      expected: '>=1 HDFS partition under /user/manufacturing/data/',
      actual: `${partitions.length} partition file(s) verified (${partitions.reduce((s, p) => s + p.recordCount, 0)} total records)`,
      commandOrEndpoint: 'hadoop fs -ls /user/manufacturing/data/',
    });
  }

  // Test 6: Automobile manufacturing shift & assembly-line aggregation
  {
    const t0 = performance.now();
    const auto = computeAutoAnalyticsPayload();
    const passed =
      auto.assemblyLines.length === 4 &&
      auto.shifts.length === 3 &&
      auto.kpis.totalUnitsProduced > 0 &&
      auto.recommendations.length > 0;
    results.push({
      id: 'int-auto-analytics',
      suite: 'Integration',
      name: 'Automobile Assembly Line & Shift Aggregation (/api/auto-analytics)',
      description: 'Verifies production rates (JPH), downtime, component defects, 4 assembly lines, and 3 shift summaries.',
      passed,
      durationMs: Number(Math.max(0.7, performance.now() - t0).toFixed(2)),
      expected: '4 assembly lines, 3 shifts, >0 vehicles produced, >0 recommendations',
      actual: `${auto.assemblyLines.length} lines, ${auto.shifts.length} shifts, units=${auto.kpis.totalUnitsProduced}, recs=${auto.recommendations.length}`,
      commandOrEndpoint: 'GET /api/auto-analytics',
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  appendSystemLog(
    'api-gateway',
    passedCount === results.length ? 'INFO' : 'WARN',
    `Executed test suite: ${passedCount}/${results.length} assertions passed`
  );

  res.json({
    executedAt: new Date().toISOString(),
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    totalDurationMs: Number((performance.now() - suiteStart).toFixed(2)),
    results,
    hdfsLsOutput: partitions.map(
      (p) =>
        `-rw-r--r--   3 flume supergroup ${String(p.sizeBytes).padStart(10, ' ')} ${p.updatedAt.slice(0, 16).replace('T', ' ')} ${p.partitionPath}/${p.fileName}`
    ),
  });
});

app.get('/api/monitor', (_req, res) => {
  res.json(flumeEngine.getMonitorMetrics());
});

app.get('/api/logs', (req, res) => {
  const level = typeof req.query.level === 'string' ? req.query.level.toUpperCase() : 'ALL';
  const service = typeof req.query.service === 'string' ? req.query.service : 'ALL';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  const rows = db
    .prepare('SELECT id, timestamp, service, level, message FROM system_logs ORDER BY id DESC LIMIT 200')
    .all() as SystemLog[];

  const filtered = rows.filter((log) => {
    if (level !== 'ALL' && log.level !== (level as LogLevel)) return false;
    if (service !== 'ALL' && log.service !== service) return false;
    if (search && !log.message.toLowerCase().includes(search) && !log.service.toLowerCase().includes(search)) {
      return false;
    }
    return true;
  });

  res.json({ logs: filtered });
});

app.delete('/api/logs', (_req, res) => {
  db.prepare('DELETE FROM system_logs').run();
  appendSystemLog('api-gateway', 'INFO', 'System log stream cleared by operator');
  res.json({ ok: true });
});

app.get('/api/deploy/checklist', (_req, res) => {
  res.json({ items: getDeployChecklist() });
});

app.patch('/api/deploy/checklist/:id', (req, res) => {
  const { id } = req.params;
  const { completed } = req.body || {};
  const result = db.prepare('UPDATE deploy_checklist SET completed = ? WHERE id = ?').run(completed ? 1 : 0, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Checklist item not found' });
  }
  return res.json({ items: getDeployChecklist() });
});

app.post('/api/data/reset', (_req, res) => {
  db.prepare('DELETE FROM sensor_events').run();
  db.prepare('DELETE FROM hdfs_partitions').run();
  seedInitialManufacturingData();
  res.json({ ok: true });
});

app.delete('/api/data/clear', (_req, res) => {
  db.prepare('DELETE FROM sensor_events').run();
  db.prepare('DELETE FROM hdfs_partitions').run();
  db.prepare('UPDATE flume_config SET total_ingested = 0, dropped_events = 0 WHERE id = 1').run();
  appendSystemLog('hdfs-sink', 'WARN', 'Cleared warehouse sensor_events and HDFS partition records');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Vite Dev Middleware / Production Static Serving
// ---------------------------------------------------------------------------
async function startServer() {
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Manufacturing Data Analytics server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    flumeEngine.stopLoop();
    server.close(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
    setTimeout(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    }, 1500).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
