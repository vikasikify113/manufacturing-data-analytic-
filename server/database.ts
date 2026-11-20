import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type {
  DeployChecklistItem,
  FlumeConfig,
  HdfsPartition,
  LogLevel,
  MachineStatus,
  SensorEvent,
  ShiftName,
  SystemLog,
} from '../src/types/analytics.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'manufacturing.db');

function removeDbFiles(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

function openHealthyDatabase(): Database.Database {
  for (let attempt = 0; attempt < 2; attempt++) {
    let instance: Database.Database | null = null;
    try {
      instance = new Database(DB_PATH);
      instance.pragma('busy_timeout = 5000');
      instance.pragma('journal_mode = DELETE');
      instance.pragma('synchronous = NORMAL');
      const check = instance.pragma('quick_check', { simple: true }) as string;
      if (check !== 'ok') {
        throw new Error(`SQLite quick_check failed: ${check}`);
      }
      return instance;
    } catch (err) {
      try {
        instance?.close();
      } catch {
        // ignore close error on corrupt handle
      }
      if (attempt === 0) {
        console.warn('Recovering from corrupted local SQLite database:', err);
        removeDbFiles();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unable to initialize SQLite database');
}

export const db = openHealthyDatabase();

export const MACHINE_CATALOG = [
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

export const SHIFT_WINDOWS: Record<ShiftName, string> = {
  'Shift A (Day)': '06:00–14:00',
  'Shift B (Swing)': '14:00–22:00',
  'Shift C (Night)': '22:00–06:00',
};

export function resolveShiftFromIso(iso: string): ShiftName {
  const hour = new Date(iso).getUTCHours();
  if (hour >= 6 && hour < 14) return 'Shift A (Day)';
  if (hour >= 14 && hour < 22) return 'Shift B (Swing)';
  return 'Shift C (Night)';
}

export function classifyEfficiency(efficiency: number): MachineStatus {
  if (efficiency > 90) return 'Optimal';
  if (efficiency >= 78) return 'Check Required';
  return 'Critical';
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sensor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      machine_name TEXT NOT NULL,
      production_line TEXT NOT NULL,
      shift_name TEXT NOT NULL DEFAULT 'Shift A (Day)',
      efficiency REAL NOT NULL,
      temperature_c REAL NOT NULL,
      vibration_mm_s REAL NOT NULL,
      rpm INTEGER NOT NULL,
      power_kw REAL NOT NULL,
      units_produced INTEGER NOT NULL DEFAULT 1,
      downtime_mins REAL NOT NULL DEFAULT 0,
      defect_count INTEGER NOT NULL DEFAULT 0,
      defect_type TEXT NOT NULL DEFAULT 'None',
      status TEXT NOT NULL,
      hdfs_partition_path TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sensor_events_ts ON sensor_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_sensor_events_machine ON sensor_events(machine_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS hdfs_partitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partition_path TEXT NOT NULL,
      file_name TEXT NOT NULL UNIQUE,
      file_type TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flume_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      agent_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_command TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      channel_capacity INTEGER NOT NULL,
      transaction_capacity INTEGER NOT NULL,
      sink_type TEXT NOT NULL,
      hdfs_path TEXT NOT NULL,
      hdfs_file_type TEXT NOT NULL,
      batch_size INTEGER NOT NULL,
      stream_interval_ms INTEGER NOT NULL,
      running INTEGER NOT NULL DEFAULT 1,
      total_ingested INTEGER NOT NULL DEFAULT 0,
      dropped_events INTEGER NOT NULL DEFAULT 0,
      last_flush_at TEXT
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      service TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_system_logs_ts ON system_logs(id DESC);

    CREATE TABLE IF NOT EXISTS deploy_checklist (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Safe schema migration for pre-existing SQLite databases
  const cols = (db.prepare('PRAGMA table_info(sensor_events)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  const migrations: Array<[string, string]> = [
    ['shift_name', "ALTER TABLE sensor_events ADD COLUMN shift_name TEXT NOT NULL DEFAULT 'Shift A (Day)'"],
    ['units_produced', 'ALTER TABLE sensor_events ADD COLUMN units_produced INTEGER NOT NULL DEFAULT 1'],
    ['downtime_mins', 'ALTER TABLE sensor_events ADD COLUMN downtime_mins REAL NOT NULL DEFAULT 0'],
    ['defect_count', 'ALTER TABLE sensor_events ADD COLUMN defect_count INTEGER NOT NULL DEFAULT 0'],
    ['defect_type', "ALTER TABLE sensor_events ADD COLUMN defect_type TEXT NOT NULL DEFAULT 'None'"],
  ];
  for (const [col, ddl] of migrations) {
    if (!cols.includes(col)) {
      db.exec(ddl);
    }
  }

  const configExists = db.prepare('SELECT id FROM flume_config WHERE id = 1').get();
  if (!configExists) {
    db.prepare(`
      INSERT INTO flume_config (
        id, agent_name, source_type, source_command, channel_type,
        channel_capacity, transaction_capacity, sink_type, hdfs_path,
        hdfs_file_type, batch_size, stream_interval_ms, running, total_ingested, dropped_events, last_flush_at
      ) VALUES (
        1, 'agent', 'exec', 'tail -F /var/log/manufacturing/sensors.log', 'memory',
        1000, 100, 'hdfs', 'hdfs://localhost:9000/user/manufacturing/data/',
        'DataStream', 6, 3000, 1, 0, 0, NULL
      )
    `).run();
  }

  const checklistCount = (db.prepare('SELECT COUNT(*) as c FROM deploy_checklist').get() as { c: number }).c;
  if (checklistCount === 0) {
    const defaultChecklist = [
      {
        id: 'flume-conf',
        stage: 'Containerization',
        title: 'Verify flume-conf.properties agent bindings',
        detail: 'Confirm sensorSource exec command, memory channel capacity, and HDFS DataStream sink path.',
        completed: 1,
        sort_order: 1,
      },
      {
        id: 'docker-microservice',
        stage: 'Containerization',
        title: 'Package Express data-processor microservice in Docker',
        detail: 'Build multi-stage Node 22 Alpine image exposing port 5001 for /api/process-trends.',
        completed: 1,
        sort_order: 2,
      },
      {
        id: 'k8s-manifest',
        stage: 'Orchestration',
        title: 'Apply Kubernetes Deployment & HPA manifest',
        detail: 'Configure 3 replicas with readiness probes on /api/microservice/health and CPU autoscaling.',
        completed: 0,
        sort_order: 3,
      },
      {
        id: 'cloud-emr-vercel',
        stage: 'Cloud',
        title: 'Provision AWS EMR / GCP Dataproc HDFS sink cluster',
        detail: 'Connect Flume HDFS sink endpoint to managed Hadoop cluster and deploy frontend tier.',
        completed: 0,
        sort_order: 4,
      },
      {
        id: 'prom-elk',
        stage: 'Observability',
        title: 'Enable Prometheus scrape & centralized ELK log forwarding',
        detail: 'Export Flume channel utilization gauges and stream microservice logs to centralized index.',
        completed: 1,
        sort_order: 5,
      },
    ];
    const insertChecklist = db.prepare(`
      INSERT INTO deploy_checklist (id, stage, title, detail, completed, sort_order)
      VALUES (@id, @stage, @title, @detail, @completed, @sort_order)
    `);
    for (const item of defaultChecklist) {
      insertChecklist.run(item);
    }
  }

  const eventCount = (db.prepare('SELECT COUNT(*) as c FROM sensor_events').get() as { c: number }).c;
  const legacyRow = db
    .prepare("SELECT id FROM sensor_events WHERE production_line IN ('Line A', 'Line B') LIMIT 1")
    .get();
  if (eventCount === 0 || legacyRow) {
    db.prepare('DELETE FROM sensor_events').run();
    db.prepare('DELETE FROM hdfs_partitions').run();
    seedInitialManufacturingData();
  }
}

export function seedInitialManufacturingData(): void {
  const now = Date.now();
  const insertEvent = db.prepare(`
    INSERT INTO sensor_events (
      timestamp, machine_id, machine_name, production_line, shift_name,
      efficiency, temperature_c, vibration_mm_s, rpm, power_kw,
      units_produced, downtime_mins, defect_count, defect_type, status, hdfs_partition_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPartition = db.prepare(`
    INSERT INTO hdfs_partitions (
      partition_path, file_name, file_type, record_count, size_bytes, created_at, updated_at
    ) VALUES (?, ?, 'DataStream', ?, ?, ?, ?)
    ON CONFLICT(file_name) DO UPDATE SET
      record_count = record_count + excluded.record_count,
      size_bytes = size_bytes + excluded.size_bytes,
      updated_at = excluded.updated_at
  `);

  const profiles: Record<
    string,
    { baseEff: number; baseTemp: number; baseVib: number; baseRpm: number; baseKw: number; baseUnits: number }
  > = {
    M1: { baseEff: 93.8, baseTemp: 61.5, baseVib: 1.7, baseRpm: 1450, baseKw: 42.4, baseUnits: 14 },
    M2: { baseEff: 91.6, baseTemp: 69.2, baseVib: 2.0, baseRpm: 1850, baseKw: 38.1, baseUnits: 13 },
    M3: { baseEff: 85.4, baseTemp: 76.8, baseVib: 2.8, baseRpm: 1120, baseKw: 29.5, baseUnits: 11 },
    M4: { baseEff: 94.5, baseTemp: 58.2, baseVib: 1.2, baseRpm: 2450, baseKw: 21.2, baseUnits: 14 },
    M5: { baseEff: 92.4, baseTemp: 62.8, baseVib: 1.5, baseRpm: 960, baseKw: 26.7, baseUnits: 13 },
    M6: { baseEff: 83.2, baseTemp: 82.6, baseVib: 3.3, baseRpm: 1620, baseKw: 31.8, baseUnits: 10 },
  };

  let totalSeeded = 0;
  const partitionCounts = new Map<
    string,
    { path: string; file: string; count: number; bytes: number; firstTs: string; lastTs: string }
  >();

  const shifts: ShiftName[] = ['Shift A (Day)', 'Shift B (Swing)', 'Shift C (Night)'];

  const seedTx = db.transaction(() => {
    // 36 steps spaced 40 minutes apart across 24 hours so all 3 automobile shifts are populated
    for (let step = 35; step >= 0; step--) {
      const stepTime = new Date(now - step * 40 * 60 * 1000);
      const iso = stepTime.toISOString();
      const dateStr = iso.slice(0, 10);
      const hourStr = iso.slice(11, 13);
      const partPath = `/user/manufacturing/data/${dateStr}`;
      const fileName = `FlumeData.${dateStr.replace(/-/g, '')}.${hourStr}00.log`;
      const fullHdfsPath = `${partPath}/${fileName}`;
      const shiftName = shifts[Math.floor((35 - step) / 12) % 3];
      const shiftPenalty = shiftName === 'Shift C (Night)' ? -3.4 : shiftName === 'Shift B (Swing)' ? -1.1 : 1.2;

      for (const machine of MACHINE_CATALOG) {
        const p = profiles[machine.machineId];
        const wave = Math.sin((step + machine.machineId.charCodeAt(1)) * 0.55) * 3.1;
        const jitter = (((step * 7 + machine.machineId.charCodeAt(1) * 13) % 11) - 5) * 0.35;
        const efficiency = Number(
          Math.max(68, Math.min(99.2, p.baseEff + shiftPenalty + wave + jitter)).toFixed(1)
        );
        const temperatureC = Number((p.baseTemp + (100 - efficiency) * 0.42 + jitter * 0.6).toFixed(1));
        const vibrationMmS = Number(Math.max(0.6, p.baseVib + (100 - efficiency) * 0.08).toFixed(2));
        const rpm = Math.round(p.baseRpm + wave * 24);
        const powerKw = Number((p.baseKw + Math.abs(wave) * 0.5).toFixed(1));
        const status = classifyEfficiency(efficiency);

        const unitsProduced = Math.max(6, Math.round(p.baseUnits * (efficiency / 100)));
        const downtimeMins =
          status === 'Critical'
            ? Number((6.5 + ((step + machine.machineId.charCodeAt(1)) % 5) * 1.4).toFixed(1))
            : status === 'Check Required'
            ? Number((2.2 + ((step + machine.machineId.charCodeAt(1)) % 3) * 0.9).toFixed(1))
            : Number((((step + machine.machineId.charCodeAt(1)) % 4) === 0 ? 0.6 : 0).toFixed(1));

        const defectCount =
          status === 'Critical'
            ? 2 + (step % 2)
            : status === 'Check Required'
            ? (step % 2 === 0 ? 1 : 0)
            : step % 7 === 0
            ? 1
            : 0;
        const defectType = defectCount > 0 ? machine.defaultDefect : 'None';

        insertEvent.run(
          iso,
          machine.machineId,
          machine.machineName,
          machine.productionLine,
          shiftName,
          efficiency,
          temperatureC,
          vibrationMmS,
          rpm,
          powerKw,
          unitsProduced,
          downtimeMins,
          defectCount,
          defectType,
          status,
          fullHdfsPath
        );

        totalSeeded += 1;
        const entry = partitionCounts.get(fileName);
        if (!entry) {
          partitionCounts.set(fileName, {
            path: partPath,
            file: fileName,
            count: 1,
            bytes: 232,
            firstTs: iso,
            lastTs: iso,
          });
        } else {
          entry.count += 1;
          entry.bytes += 232;
          entry.lastTs = iso;
        }
      }
    }

    for (const part of partitionCounts.values()) {
      insertPartition.run(part.path, part.file, part.count, part.bytes, part.firstTs, part.lastTs);
    }

    db.prepare('UPDATE flume_config SET total_ingested = ?, last_flush_at = ? WHERE id = 1').run(
      totalSeeded,
      new Date(now).toISOString()
    );
  });

  seedTx();

  appendSystemLog(
    'flume-agent',
    'INFO',
    'Initialized Apache Flume ExecSource for Automobile Assembly Plant (Body Shop, Paint, Powertrain, Final Assembly)'
  );
  appendSystemLog(
    'hdfs-sink',
    'INFO',
    `Committed ${totalSeeded} automotive telemetry records across 3 production shifts into /user/manufacturing/data/`
  );
  appendSystemLog(
    'express-processor',
    'INFO',
    'Express.js data-processor aggregating JPH production rates, downtime minutes, and component defects'
  );
}

export function appendSystemLog(
  service: SystemLog['service'],
  level: LogLevel,
  message: string
): void {
  db.prepare('INSERT INTO system_logs (timestamp, service, level, message) VALUES (?, ?, ?, ?)').run(
    new Date().toISOString(),
    service,
    level,
    message
  );

  db.prepare(`
    DELETE FROM system_logs
    WHERE id NOT IN (SELECT id FROM system_logs ORDER BY id DESC LIMIT 500)
  `).run();
}

export function getFlumeConfig(): FlumeConfig {
  const row = db.prepare('SELECT * FROM flume_config WHERE id = 1').get() as {
    agent_name: string;
    source_type: string;
    source_command: string;
    channel_type: string;
    channel_capacity: number;
    transaction_capacity: number;
    sink_type: string;
    hdfs_path: string;
    hdfs_file_type: string;
    batch_size: number;
    stream_interval_ms: number;
    running: number;
  };
  return {
    agentName: row.agent_name,
    sourceType: row.source_type,
    sourceCommand: row.source_command,
    channelType: row.channel_type,
    channelCapacity: row.channel_capacity,
    transactionCapacity: row.transaction_capacity,
    sinkType: row.sink_type,
    hdfsPath: row.hdfs_path,
    hdfsFileType: row.hdfs_file_type,
    batchSize: row.batch_size,
    streamIntervalMs: row.stream_interval_ms,
    running: Boolean(row.running),
  };
}

export function getHdfsPartitions(): HdfsPartition[] {
  const rows = db
    .prepare('SELECT * FROM hdfs_partitions ORDER BY updated_at DESC LIMIT 30')
    .all() as Array<{
    id: number;
    partition_path: string;
    file_name: string;
    file_type: string;
    record_count: number;
    size_bytes: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    partitionPath: r.partition_path,
    fileName: r.file_name,
    fileType: r.file_type,
    recordCount: r.record_count,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getDeployChecklist(): DeployChecklistItem[] {
  const rows = db
    .prepare('SELECT * FROM deploy_checklist ORDER BY sort_order ASC')
    .all() as Array<{
    id: string;
    stage: DeployChecklistItem['stage'];
    title: string;
    detail: string;
    completed: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    title: r.title,
    detail: r.detail,
    completed: Boolean(r.completed),
  }));
}

export function mapSensorRow(r: {
  id: number;
  timestamp: string;
  machine_id: string;
  machine_name: string;
  production_line: string;
  shift_name: string;
  efficiency: number;
  temperature_c: number;
  vibration_mm_s: number;
  rpm: number;
  power_kw: number;
  units_produced: number;
  downtime_mins: number;
  defect_count: number;
  defect_type: string;
  status: string;
  hdfs_partition_path: string;
}): SensorEvent {
  return {
    id: r.id,
    timestamp: r.timestamp,
    machineId: r.machine_id,
    machineName: r.machine_name,
    productionLine: r.production_line,
    shiftName: r.shift_name || 'Shift A (Day)',
    efficiency: r.efficiency,
    temperatureC: r.temperature_c,
    vibrationMmS: r.vibration_mm_s,
    rpm: r.rpm,
    powerKw: r.power_kw,
    unitsProduced: r.units_produced ?? 1,
    downtimeMins: r.downtime_mins ?? 0,
    defectCount: r.defect_count ?? 0,
    defectType: r.defect_type || 'None',
    status: r.status as MachineStatus,
    hdfsPartitionPath: r.hdfs_partition_path,
  };
}
