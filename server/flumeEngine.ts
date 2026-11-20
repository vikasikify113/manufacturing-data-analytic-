import {
  MACHINE_CATALOG,
  appendSystemLog,
  classifyEfficiency,
  db,
  getFlumeConfig,
  resolveShiftFromIso,
} from './database.ts';
import type { FlumeConfig, FlumeRuntimeStats, MonitorMetrics } from '../src/types/analytics.ts';

interface QueuedSensorRecord {
  timestamp: string;
  machineId: string;
  machineName: string;
  productionLine: string;
  shiftName: string;
  efficiency: number;
  temperatureC: number;
  vibrationMmS: number;
  rpm: number;
  powerKw: number;
  unitsProduced: number;
  downtimeMins: number;
  defectCount: number;
  defectType: string;
}

class FlumePipelineEngine {
  private channelQueue: QueuedSensorRecord[] = [];
  private recentLogLines: string[] = [];
  private throughputHistory: MonitorMetrics['throughputHistory'] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = Date.now();
  private eventsThisWindow = 0;
  private currentEventsPerSec = 2.0;
  private lastLatencyMs = 4.2;

  private machineState = new Map<
    string,
    { eff: number; temp: number; vib: number; rpm: number; kw: number }
  >([
    ['M1', { eff: 93.8, temp: 61.5, vib: 1.72, rpm: 1450, kw: 42.4 }],
    ['M2', { eff: 91.8, temp: 69.0, vib: 1.98, rpm: 1850, kw: 38.1 }],
    ['M3', { eff: 85.8, temp: 76.4, vib: 2.75, rpm: 1120, kw: 29.5 }],
    ['M4', { eff: 94.5, temp: 58.2, vib: 1.24, rpm: 2450, kw: 21.2 }],
    ['M5', { eff: 92.6, temp: 62.6, vib: 1.52, rpm: 960, kw: 26.7 }],
    ['M6', { eff: 83.6, temp: 82.2, vib: 3.25, rpm: 1620, kw: 31.8 }],
  ]);

  public startLoop(): void {
    this.seedInitialThroughputHistory();
    this.rescheduleTimer();
  }

  public stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private seedInitialThroughputHistory(): void {
    const now = Date.now();
    for (let i = 11; i >= 0; i--) {
      const t = new Date(now - i * 15000);
      this.throughputHistory.push({
        label: t.toISOString().slice(11, 19),
        eventsPerSec: Number((1.8 + Math.sin(i * 0.7) * 0.6).toFixed(2)),
        latencyMs: Number((3.8 + (i % 4) * 0.7).toFixed(1)),
        channelPct: Number((2.5 + (i % 5) * 1.1).toFixed(1)),
      });
    }
  }

  public rescheduleTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const cfg = getFlumeConfig();
    if (!cfg.running) return;

    this.timer = setInterval(() => {
      this.runStreamCycle();
    }, Math.max(800, cfg.streamIntervalMs));
  }

  private generateNextRecord(machineIdx: number, forceAnomaly = false): QueuedSensorRecord {
    const meta = MACHINE_CATALOG[machineIdx % MACHINE_CATALOG.length];
    const current = this.machineState.get(meta.machineId)!;

    let nextEff: number;
    if (forceAnomaly) {
      nextEff = Number((66 + Math.random() * 14).toFixed(1));
    } else {
      const drift = (Math.random() - 0.48) * 2.4;
      const anchor = meta.machineId === 'M3' || meta.machineId === 'M6' ? 85.5 : 93.8;
      nextEff = Number(
        Math.max(64, Math.min(99.5, current.eff * 0.72 + anchor * 0.28 + drift)).toFixed(1)
      );
    }

    const tempDelta = (100 - nextEff) * 0.44 + (Math.random() - 0.5) * 1.8;
    const nextTemp = Number(Math.max(44, Math.min(104, 58 + tempDelta)).toFixed(1));
    const nextVib = Number(
      Math.max(0.7, Math.min(6.4, 1.1 + (100 - nextEff) * 0.095 + (Math.random() - 0.5) * 0.3)).toFixed(2)
    );
    const nextRpm = Math.max(600, Math.round(current.rpm + (Math.random() - 0.5) * 70));
    const nextKw = Number(Math.max(8, current.kw + (Math.random() - 0.5) * 1.1).toFixed(1));

    this.machineState.set(meta.machineId, {
      eff: nextEff,
      temp: nextTemp,
      vib: nextVib,
      rpm: nextRpm,
      kw: nextKw,
    });

    const timestamp = new Date().toISOString();
    const status = classifyEfficiency(nextEff);
    const unitsProduced = Math.max(5, Math.round(14 * (nextEff / 100)));
    const downtimeMins =
      status === 'Critical'
        ? Number((5.2 + Math.random() * 4.5).toFixed(1))
        : status === 'Check Required'
        ? Number((1.5 + Math.random() * 2.5).toFixed(1))
        : Number((Math.random() < 0.2 ? 0.5 : 0).toFixed(1));
    const defectCount =
      status === 'Critical' ? 2 : status === 'Check Required' ? (Math.random() < 0.6 ? 1 : 0) : Math.random() < 0.12 ? 1 : 0;

    return {
      timestamp,
      machineId: meta.machineId,
      machineName: meta.machineName,
      productionLine: meta.productionLine,
      shiftName: resolveShiftFromIso(timestamp),
      efficiency: nextEff,
      temperatureC: nextTemp,
      vibrationMmS: nextVib,
      rpm: nextRpm,
      powerKw: nextKw,
      unitsProduced,
      downtimeMins,
      defectCount,
      defectType: defectCount > 0 ? meta.defaultDefect : 'None',
    };
  }

  private formatSensorLogLine(rec: QueuedSensorRecord): string {
    return `${rec.timestamp} INFO [sensorSource] machineId=${rec.machineId} line="${rec.productionLine}" shift="${rec.shiftName}" efficiency=${rec.efficiency}% units=${rec.unitsProduced} downtime=${rec.downtimeMins}m defects=${rec.defectCount} temp=${rec.temperatureC}C`;
  }

  private runStreamCycle(): void {
    const cfg = getFlumeConfig();
    if (!cfg.running) return;

    const batchCount = Math.min(cfg.batchSize, 12);
    const generated: QueuedSensorRecord[] = [];
    for (let i = 0; i < batchCount; i++) {
      generated.push(this.generateNextRecord(i, false));
    }

    this.enqueueEvents(generated, cfg);
    this.flushChannelToHdfs(cfg);

    const rate = Number((batchCount / (cfg.streamIntervalMs / 1000)).toFixed(2));
    this.currentEventsPerSec = rate;
    this.recordTelemetrySample(rate, cfg);
  }

  public enqueueEvents(records: QueuedSensorRecord[], cfg = getFlumeConfig()): { accepted: number; dropped: number } {
    let accepted = 0;
    let dropped = 0;

    for (const rec of records) {
      this.recentLogLines.unshift(this.formatSensorLogLine(rec));
      if (this.channelQueue.length < cfg.channelCapacity) {
        this.channelQueue.push(rec);
        accepted += 1;
      } else {
        dropped += 1;
      }
    }

    if (this.recentLogLines.length > 40) {
      this.recentLogLines = this.recentLogLines.slice(0, 40);
    }

    if (dropped > 0) {
      db.prepare('UPDATE flume_config SET dropped_events = dropped_events + ? WHERE id = 1').run(dropped);
      appendSystemLog(
        'flume-agent',
        'WARN',
        `MemoryChannel capacity (${cfg.channelCapacity}) reached; dropped ${dropped} incoming sensor events`
      );
    }

    return { accepted, dropped };
  }

  public flushChannelToHdfs(cfg = getFlumeConfig(), maxFlush?: number): number {
    if (this.channelQueue.length === 0) return 0;

    const start = performance.now();
    const takeCount = maxFlush ? Math.min(maxFlush, this.channelQueue.length) : Math.min(cfg.transactionCapacity, this.channelQueue.length);
    const batch = this.channelQueue.splice(0, takeCount);

    const insertEvent = db.prepare(`
      INSERT INTO sensor_events (
        timestamp, machine_id, machine_name, production_line, shift_name,
        efficiency, temperature_c, vibration_mm_s, rpm, power_kw,
        units_produced, downtime_mins, defect_count, defect_type, status, hdfs_partition_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertPartition = db.prepare(`
      INSERT INTO hdfs_partitions (
        partition_path, file_name, file_type, record_count, size_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_name) DO UPDATE SET
        record_count = record_count + excluded.record_count,
        size_bytes = size_bytes + excluded.size_bytes,
        updated_at = excluded.updated_at
    `);

    const partitionAgg = new Map<string, { path: string; file: string; count: number; bytes: number; ts: string }>();
    let anomalyCount = 0;

    const tx = db.transaction(() => {
      for (const rec of batch) {
        const dateStr = rec.timestamp.slice(0, 10);
        const hourStr = rec.timestamp.slice(11, 13);
        const partPath = `/user/manufacturing/data/${dateStr}`;
        const fileName = `FlumeData.${dateStr.replace(/-/g, '')}.${hourStr}00.log`;
        const fullHdfsPath = `${partPath}/${fileName}`;
        const status = classifyEfficiency(rec.efficiency);

        if (status !== 'Optimal') {
          anomalyCount += 1;
        }

        insertEvent.run(
          rec.timestamp,
          rec.machineId,
          rec.machineName,
          rec.productionLine,
          rec.shiftName,
          rec.efficiency,
          rec.temperatureC,
          rec.vibrationMmS,
          rec.rpm,
          rec.powerKw,
          rec.unitsProduced,
          rec.downtimeMins,
          rec.defectCount,
          rec.defectType,
          status,
          fullHdfsPath
        );

        const existing = partitionAgg.get(fileName);
        if (!existing) {
          partitionAgg.set(fileName, { path: partPath, file: fileName, count: 1, bytes: 232, ts: rec.timestamp });
        } else {
          existing.count += 1;
          existing.bytes += 232;
          existing.ts = rec.timestamp;
        }
      }

      for (const part of partitionAgg.values()) {
        upsertPartition.run(part.path, part.file, cfg.hdfsFileType, part.count, part.bytes, part.ts, part.ts);
      }

      db.prepare('UPDATE flume_config SET total_ingested = total_ingested + ?, last_flush_at = ? WHERE id = 1').run(
        batch.length,
        new Date().toISOString()
      );
    });

    tx();

    db.prepare(`
      DELETE FROM sensor_events
      WHERE id NOT IN (SELECT id FROM sensor_events ORDER BY id DESC LIMIT 2500)
    `).run();

    this.eventsThisWindow += batch.length;
    this.lastLatencyMs = Number(Math.max(1.2, performance.now() - start).toFixed(1));

    if (anomalyCount > 0) {
      const flagged = batch.filter((b) => classifyEfficiency(b.efficiency) === 'Critical');
      if (flagged.length > 0) {
        appendSystemLog(
          'express-processor',
          'ERROR',
          `Detected ${flagged.length} critical automotive assembly line drop(s) (<78%) on ${[...new Set(flagged.map((f) => f.machineId))].join(', ')}`
        );
      } else {
        appendSystemLog(
          'express-processor',
          'WARN',
          `Threshold warning: ${anomalyCount} station reading(s) fell below 90% target efficiency`
        );
      }
    }

    return batch.length;
  }

  public injectBurst(count = 18, forceAnomaly = false): { accepted: number; flushed: number; dropped: number } {
    const cfg = getFlumeConfig();
    const generated: QueuedSensorRecord[] = [];
    for (let i = 0; i < count; i++) {
      const anomaly = forceAnomaly && i % 2 === 0;
      generated.push(this.generateNextRecord(i, anomaly));
    }

    const { accepted, dropped } = this.enqueueEvents(generated, cfg);
    const flushed = this.flushChannelToHdfs(cfg, count);

    appendSystemLog(
      'hdfs-sink',
      forceAnomaly ? 'WARN' : 'INFO',
      `${forceAnomaly ? 'Anomaly simulation' : 'Burst injection'}: ingested ${accepted} events and committed ${flushed} records to HDFS`
    );

    const instantRate = Number((accepted / 1.0).toFixed(2));
    this.currentEventsPerSec = instantRate;
    this.recordTelemetrySample(instantRate, cfg);

    return { accepted, flushed, dropped };
  }

  public ingestRawLogText(rawText: string): { parsed: number; flushed: number; errors: string[] } {
    const cfg = getFlumeConfig();
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parsedRecords: QueuedSensorRecord[] = [];
    const errors: string[] = [];

    lines.forEach((line, idx) => {
      try {
        if (line.startsWith('{')) {
          const obj = JSON.parse(line);
          const machineId = String(obj.machineId || 'M1').toUpperCase();
          const meta = MACHINE_CATALOG.find((m) => m.machineId === machineId) || MACHINE_CATALOG[0];
          const efficiency = Number(obj.efficiency);
          if (Number.isNaN(efficiency) || efficiency < 0 || efficiency > 100) {
            throw new Error('efficiency must be between 0 and 100');
          }
          const ts = obj.timestamp || new Date().toISOString();
          const defectCount = Number(obj.defectCount ?? (efficiency < 88 ? 1 : 0));
          parsedRecords.push({
            timestamp: ts,
            machineId: meta.machineId,
            machineName: meta.machineName,
            productionLine: obj.productionLine || meta.productionLine,
            shiftName: obj.shiftName || resolveShiftFromIso(ts),
            efficiency: Number(efficiency.toFixed(1)),
            temperatureC: Number(obj.temperatureC ?? 68.5),
            vibrationMmS: Number(obj.vibrationMmS ?? 1.9),
            rpm: Number(obj.rpm ?? 1450),
            powerKw: Number(obj.powerKw ?? 28.5),
            unitsProduced: Number(obj.unitsProduced ?? Math.max(5, Math.round(14 * (efficiency / 100)))),
            downtimeMins: Number(obj.downtimeMins ?? (efficiency < 85 ? 3.5 : 0)),
            defectCount,
            defectType: obj.defectType || (defectCount > 0 ? meta.defaultDefect : 'None'),
          });
        } else {
          const mMatch = line.match(/machineId=([A-Za-z0-9_-]+)/i);
          const effMatch = line.match(/eff(?:iciency)?=([0-9.]+)/i);
          if (!effMatch) {
            throw new Error('Missing efficiency=<number> field');
          }
          const machineId = (mMatch ? mMatch[1] : 'M1').toUpperCase();
          const meta = MACHINE_CATALOG.find((m) => m.machineId === machineId) || MACHINE_CATALOG[0];
          const efficiency = Number(effMatch[1]);
          if (Number.isNaN(efficiency) || efficiency < 0 || efficiency > 100) {
            throw new Error('efficiency out of 0-100 range');
          }
          const tempMatch = line.match(/temp(?:eratureC)?=([0-9.]+)/i);
          const vibMatch = line.match(/vib(?:ration)?=([0-9.]+)/i);
          const rpmMatch = line.match(/rpm=([0-9]+)/i);
          const kwMatch = line.match(/(?:kw|power)=([0-9.]+)/i);
          const unitsMatch = line.match(/units(?:Produced)?=([0-9]+)/i);
          const downMatch = line.match(/downtime(?:Mins)?=([0-9.]+)/i);
          const defectMatch = line.match(/defects?(?:Count)?=([0-9]+)/i);
          const ts = new Date().toISOString();
          const defectCount = defectMatch ? Number(defectMatch[1]) : efficiency < 88 ? 1 : 0;

          parsedRecords.push({
            timestamp: ts,
            machineId: meta.machineId,
            machineName: meta.machineName,
            productionLine: meta.productionLine,
            shiftName: resolveShiftFromIso(ts),
            efficiency: Number(efficiency.toFixed(1)),
            temperatureC: tempMatch ? Number(tempMatch[1]) : 67.0,
            vibrationMmS: vibMatch ? Number(vibMatch[1]) : 1.85,
            rpm: rpmMatch ? Number(rpmMatch[1]) : 1450,
            powerKw: kwMatch ? Number(kwMatch[1]) : 28.0,
            unitsProduced: unitsMatch ? Number(unitsMatch[1]) : Math.max(5, Math.round(14 * (efficiency / 100))),
            downtimeMins: downMatch ? Number(downMatch[1]) : efficiency < 85 ? 3.2 : 0,
            defectCount,
            defectType: defectCount > 0 ? meta.defaultDefect : 'None',
          });
        }
      } catch (err) {
        errors.push(`Line ${idx + 1}: ${err instanceof Error ? err.message : 'Invalid format'}`);
      }
    });

    let flushed = 0;
    if (parsedRecords.length > 0) {
      this.enqueueEvents(parsedRecords, cfg);
      flushed = this.flushChannelToHdfs(cfg, parsedRecords.length);
      appendSystemLog(
        'flume-agent',
        'INFO',
        `Custom ExecSource batch parsed ${parsedRecords.length} log line(s) and flushed ${flushed} to HDFS`
      );
    }

    return { parsed: parsedRecords.length, flushed, errors };
  }

  public updateConfig(patch: Partial<FlumeConfig>): FlumeConfig {
    const current = getFlumeConfig();
    const next: FlumeConfig = {
      ...current,
      ...patch,
      channelCapacity: Math.max(50, Math.min(10000, Number(patch.channelCapacity ?? current.channelCapacity))),
      transactionCapacity: Math.max(10, Math.min(1000, Number(patch.transactionCapacity ?? current.transactionCapacity))),
      batchSize: Math.max(1, Math.min(50, Number(patch.batchSize ?? current.batchSize))),
      streamIntervalMs: Math.max(1000, Math.min(15000, Number(patch.streamIntervalMs ?? current.streamIntervalMs))),
    };

    db.prepare(`
      UPDATE flume_config
      SET agent_name = ?, source_command = ?, channel_capacity = ?, transaction_capacity = ?,
          hdfs_path = ?, hdfs_file_type = ?, batch_size = ?, stream_interval_ms = ?, running = ?
      WHERE id = 1
    `).run(
      next.agentName,
      next.sourceCommand,
      next.channelCapacity,
      next.transactionCapacity,
      next.hdfsPath,
      next.hdfsFileType,
      next.batchSize,
      next.streamIntervalMs,
      next.running ? 1 : 0
    );

    this.rescheduleTimer();
    appendSystemLog(
      'flume-agent',
      'INFO',
      `Updated Flume config: state=${next.running ? 'RUNNING' : 'PAUSED'}, memChannel.capacity=${next.channelCapacity}, batchSize=${next.batchSize}`
    );

    return getFlumeConfig();
  }

  private recordTelemetrySample(eventsPerSec: number, cfg: FlumeConfig): void {
    const channelPct = Number(
      Math.min(100, (this.channelQueue.length / Math.max(1, cfg.channelCapacity)) * 100).toFixed(1)
    );
    this.throughputHistory.push({
      label: new Date().toISOString().slice(11, 19),
      eventsPerSec,
      latencyMs: this.lastLatencyMs,
      channelPct,
    });
    if (this.throughputHistory.length > 24) {
      this.throughputHistory = this.throughputHistory.slice(-24);
    }
  }

  public getRuntimeStats(): FlumeRuntimeStats {
    const cfg = getFlumeConfig();
    const meta = db.prepare('SELECT total_ingested, dropped_events, last_flush_at FROM flume_config WHERE id = 1').get() as {
      total_ingested: number;
      dropped_events: number;
      last_flush_at: string | null;
    };

    const utilization = Number(
      Math.min(100, (this.channelQueue.length / Math.max(1, cfg.channelCapacity)) * 100).toFixed(1)
    );

    return {
      config: cfg,
      channelBuffered: this.channelQueue.length,
      channelUtilizationPct: utilization,
      totalIngested: meta.total_ingested,
      eventsPerSecond: cfg.running ? this.currentEventsPerSec : 0,
      droppedEvents: meta.dropped_events,
      lastFlushAt: meta.last_flush_at,
      recentLogLines: this.recentLogLines,
    };
  }

  public getMonitorMetrics(): MonitorMetrics {
    const stats = this.getRuntimeStats();
    const memMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
    const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM system_logs').get() as { c: number }).c;
    const errLogs = (db.prepare("SELECT COUNT(*) as c FROM system_logs WHERE level = 'ERROR'").get() as { c: number }).c;
    const errorRatePct = totalLogs > 0 ? Number(((errLogs / totalLogs) * 100).toFixed(2)) : 0;

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      microservicePort: 5001,
      apiLatencyMs: this.lastLatencyMs,
      memoryRssMb: memMb,
      flumeEventsPerSec: stats.eventsPerSecond,
      channelDepth: stats.channelBuffered,
      channelCapacity: stats.config.channelCapacity,
      errorRatePct,
      throughputHistory: this.throughputHistory,
    };
  }
}

export const flumeEngine = new FlumePipelineEngine();
