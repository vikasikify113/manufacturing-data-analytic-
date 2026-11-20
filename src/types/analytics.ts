export type MachineStatus = 'Optimal' | 'Check Required' | 'Critical';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type ProductionLine =
  | 'All'
  | 'Line A'
  | 'Line B'
  | 'Body Shop'
  | 'Paint & Coating'
  | 'Powertrain'
  | 'Final Assembly';

export type ShiftName = 'Shift A (Day)' | 'Shift B (Swing)' | 'Shift C (Night)';

export interface SensorEvent {
  id: number;
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
  status: MachineStatus;
  hdfsPartitionPath: string;
}

export interface MachineSummary {
  machineId: string;
  machineName: string;
  productionLine: string;
  latestEfficiency: number;
  avgEfficiency: number;
  temperatureC: number;
  vibrationMmS: number;
  rpm: number;
  powerKw: number;
  totalUnitsProduced: number;
  totalDowntimeMins: number;
  totalDefects: number;
  defectRatePpm: number;
  eventCount: number;
  status: MachineStatus;
  lastUpdated: string;
}

export interface TrendBucket {
  bucketLabel: string;
  timestamp: string;
  avgEfficiency: number;
  byMachine: Record<string, number>;
  eventCount: number;
  unitsProduced: number;
  defects: number;
}

export interface TrendsResponse {
  summary: {
    fleetEfficiency: number;
    activeMachines: number;
    optimalMachines: number;
    attentionMachines: number;
    totalEvents: number;
    eventsLastHour: number;
    avgTemperatureC: number;
    productionRateJph: number;
    totalUnitsProduced: number;
    totalDowntimeMins: number;
    defectRatePpm: number;
    firstPassYieldPct: number;
  };
  machines: MachineSummary[];
  trends: TrendBucket[];
  recentEvents: SensorEvent[];
}

export interface AssemblyLineMetrics {
  line: string;
  stationCount: number;
  targetJph: number;
  actualJph: number;
  totalUnits: number;
  avgEfficiency: number;
  downtimeMins: number;
  availabilityPct: number;
  defectCount: number;
  defectPpm: number;
  firstPassYieldPct: number;
  status: MachineStatus;
}

export interface ShiftPerformance {
  shiftName: string;
  windowLabel: string;
  events: number;
  unitsProduced: number;
  productionRateJph: number;
  avgEfficiency: number;
  downtimeMins: number;
  defectCount: number;
  defectPpm: number;
  firstPassYieldPct: number;
  topIssue: string;
}

export interface DefectBreakdown {
  defectType: string;
  count: number;
  sharePct: number;
  primaryLine: string;
  avgEfficiencyImpact: number;
}

export interface DowntimeStationMetric {
  machineId: string;
  machineName: string;
  productionLine: string;
  plannedMins: number;
  unplannedMins: number;
  totalMins: number;
  availabilityPct: number;
  primaryCause: string;
}

export interface AutoRecommendation {
  id: string;
  area: 'Production Rate' | 'Downtime' | 'Defects' | 'Assembly Line' | 'Shift Performance';
  severity: 'High' | 'Medium' | 'Advisory';
  title: string;
  finding: string;
  action: string;
}

export interface AutoAnalyticsResponse {
  generatedAt: string;
  kpis: {
    totalUnitsProduced: number;
    productionRateJph: number;
    targetJph: number;
    totalDowntimeMins: number;
    unplannedDowntimeMins: number;
    totalDefects: number;
    defectRatePpm: number;
    firstPassYieldPct: number;
    avgAssemblyEfficiency: number;
  };
  assemblyLines: AssemblyLineMetrics[];
  shifts: ShiftPerformance[];
  defects: DefectBreakdown[];
  downtimeByStation: DowntimeStationMetric[];
  recommendations: AutoRecommendation[];
}

export interface FlumeConfig {
  agentName: string;
  sourceType: string;
  sourceCommand: string;
  channelType: string;
  channelCapacity: number;
  transactionCapacity: number;
  sinkType: string;
  hdfsPath: string;
  hdfsFileType: string;
  batchSize: number;
  streamIntervalMs: number;
  running: boolean;
}

export interface FlumeRuntimeStats {
  config: FlumeConfig;
  channelBuffered: number;
  channelUtilizationPct: number;
  totalIngested: number;
  eventsPerSecond: number;
  droppedEvents: number;
  lastFlushAt: string | null;
  recentLogLines: string[];
}

export interface HdfsPartition {
  id: number;
  partitionPath: string;
  fileName: string;
  fileType: string;
  recordCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface SystemLog {
  id: number;
  timestamp: string;
  service: 'flume-agent' | 'express-processor' | 'hdfs-sink' | 'api-gateway';
  level: LogLevel;
  message: string;
}

export interface TestCaseResult {
  id: string;
  suite: 'Unit' | 'Integration' | 'HDFS';
  name: string;
  description: string;
  passed: boolean;
  durationMs: number;
  expected: string;
  actual: string;
  commandOrEndpoint: string;
}

export interface TestSuiteResponse {
  executedAt: string;
  total: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  results: TestCaseResult[];
  hdfsLsOutput: string[];
}

export interface MonitorMetrics {
  uptimeSeconds: number;
  microservicePort: number;
  apiLatencyMs: number;
  memoryRssMb: number;
  flumeEventsPerSec: number;
  channelDepth: number;
  channelCapacity: number;
  errorRatePct: number;
  throughputHistory: Array<{
    label: string;
    eventsPerSec: number;
    latencyMs: number;
    channelPct: number;
  }>;
}

export interface DeployChecklistItem {
  id: string;
  stage: 'Containerization' | 'Orchestration' | 'Cloud' | 'Observability';
  title: string;
  detail: string;
  completed: boolean;
}
