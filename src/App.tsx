import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Car,
  Code2,
  FlaskConical,
  LogIn,
  LogOut,
  Menu,
  Pause,
  Play,
  Rocket,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { useFirebase } from './contexts/FirebaseContext.tsx';
import {
  type BackendMode,
  apiFetchJson,
  getBackendMode,
  subscribeBackendMode,
} from './lib/apiClient.ts';
import { AutoOperationsTab } from './components/AutoOperationsTab.tsx';
import { CodeTab } from './components/CodeTab.tsx';
import { DeployTab } from './components/DeployTab.tsx';
import { FlumeTab } from './components/FlumeTab.tsx';
import { MonitorTab } from './components/MonitorTab.tsx';
import { OverviewTab } from './components/OverviewTab.tsx';
import { TestingTab } from './components/TestingTab.tsx';
import type {
  DeployChecklistItem,
  FlumeRuntimeStats,
  HdfsPartition,
  MonitorMetrics,
  SystemLog,
  TrendsResponse,
} from './types/analytics.ts';

type NavTab = 'overview' | 'auto' | 'flume' | 'code' | 'testing' | 'deploy' | 'monitor';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Trend Analytics', icon: BarChart3 },
  { id: 'auto', label: 'Auto Operations', icon: Car },
  { id: 'flume', label: 'Flume Pipeline', icon: Workflow },
  { id: 'code', label: 'Code & Config', icon: Code2 },
  { id: 'testing', label: 'Test Suite', icon: FlaskConical },
  { id: 'deploy', label: 'Deploy & Cloud', icon: Rocket },
  { id: 'monitor', label: 'Monitor & Logs', icon: Activity },
];

export default function App() {
  const {
    user,
    authReady,
    authBusy,
    authError,
    cloudChecklistMap,
    signInWithGoogle,
    signOutUser,
    syncChecklistItem,
  } = useFirebase();

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [trendsData, setTrendsData] = useState<TrendsResponse | null>(null);
  const [flumeRuntime, setFlumeRuntime] = useState<FlumeRuntimeStats | null>(null);
  const [partitions, setPartitions] = useState<HdfsPartition[]>([]);
  const [monitorMetrics, setMonitorMetrics] = useState<MonitorMetrics | null>(null);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [checklist, setChecklist] = useState<DeployChecklistItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [logFilters, setLogFilters] = useState({ level: 'ALL', service: 'ALL', search: '' });
  const [backendMode, setBackendMode] = useState<BackendMode>(getBackendMode());

  useEffect(() => subscribeBackendMode(setBackendMode), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 3200);
  }, []);

  const fetchLogs = useCallback(
    async (filters = logFilters) => {
      const params = new URLSearchParams({
        level: filters.level,
        service: filters.service,
        search: filters.search,
      });
      const data = await apiFetchJson<{ logs?: SystemLog[] }>(`/api/logs?${params.toString()}`);
      setLogs(data.logs || []);
    },
    [logFilters]
  );

  const fetchAllData = useCallback(async () => {
    try {
      const [trendsJson, flumeJson, monitorJson, checklistJson] = await Promise.all([
        apiFetchJson<TrendsResponse>('/api/trends'),
        apiFetchJson<{ runtime: FlumeRuntimeStats; partitions: HdfsPartition[] }>('/api/flume/status'),
        apiFetchJson<MonitorMetrics>('/api/monitor'),
        apiFetchJson<{ items: DeployChecklistItem[] }>('/api/deploy/checklist'),
      ]);

      setTrendsData(trendsJson);
      setFlumeRuntime(flumeJson.runtime);
      setPartitions(flumeJson.partitions || []);
      setMonitorMetrics(monitorJson);
      setChecklist(checklistJson.items || []);
      setError(null);
      await fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Express backend');
    } finally {
      setLoading(false);
    }
  }, [fetchLogs]);

  useEffect(() => {
    fetchAllData();
    const timer = setInterval(() => {
      fetchAllData();
    }, 3500);
    return () => clearInterval(timer);
  }, [fetchAllData]);

  const handleFlumeControl = async (
    action: 'start' | 'pause' | 'burst' | 'anomaly' | 'configure',
    payload?: Record<string, unknown>
  ) => {
    await apiFetchJson('/api/flume/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (action === 'start') showToast('Apache Flume agent stream started');
    if (action === 'pause') showToast('Apache Flume agent stream paused');
    if (action === 'burst') showToast('Injected 18 sensor events through Flume pipeline');
    if (action === 'anomaly') showToast('Simulated efficiency anomaly batch ingested');
    if (action === 'configure') showToast('Flume configuration saved and applied');
    await fetchAllData();
  };

  const handleIngestRaw = async (rawLogs: string) => {
    const data = await apiFetchJson<{ ok?: boolean; parsed?: number; flushed?: number; error?: string }>(
      '/api/flume/ingest-raw',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawLogs }),
      }
    );
    if (data.ok) {
      showToast(`Ingested ${data.parsed ?? 0} custom sensor log record(s)`);
      await fetchAllData();
    }
    return data;
  };

  const handleClearWarehouse = async () => {
    await apiFetchJson('/api/data/clear', { method: 'DELETE' });
    showToast('Warehouse sensor events and HDFS partitions cleared');
    await fetchAllData();
  };

  const handleResetWarehouse = async () => {
    await apiFetchJson('/api/data/reset', { method: 'POST' });
    showToast('Seeded baseline manufacturing telemetry dataset');
    await fetchAllData();
  };

  const handleToggleChecklist = async (id: string, completed: boolean) => {
    const data = await apiFetchJson<{ items?: DeployChecklistItem[] }>(`/api/deploy/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    setChecklist(data.items || []);
    if (user) {
      await syncChecklistItem(id, completed);
      showToast('Deployment checklist synced to Firestore');
    }
  };

  const mergedChecklist = user
    ? checklist.map((item) =>
        cloudChecklistMap[item.id] !== undefined
          ? { ...item, completed: cloudChecklistMap[item.id] }
          : item
      )
    : checklist;

  const handleClearLogs = async () => {
    await apiFetchJson('/api/logs', { method: 'DELETE' });
    showToast('System log stream cleared');
    await fetchLogs();
  };

  const activeNavMeta = NAV_ITEMS.find((i) => i.id === activeTab) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-[#0F172A]/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Fixed Sidebar (248px Desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-62 flex-col border-r border-[#E2E8F0] bg-white transition-transform duration-150 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-[#E2E8F0] px-5">
          <span className="font-display text-sm font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0">
            FlumePlant Analytics
          </span>
          <button
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="rounded p-1 text-[#64748B] hover:bg-[#F1F5F9] lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Primary Workspace Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-[#F0F9FF] text-[#0284C7]'
                    : 'text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#0284C7]' : 'text-[#64748B]'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#E2E8F0] p-4 text-xs space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#475569]">Flume Agent</span>
              <span
                className={`inline-flex items-center gap-1.5 font-mono font-medium ${
                  flumeRuntime?.config.running ? 'text-[#16A34A]' : 'text-[#D97706]'
                }`}
              >
                {flumeRuntime?.config.running && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" aria-hidden="true" />
                )}
                {flumeRuntime?.config.running ? 'RUNNING' : 'PAUSED'}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-[#64748B] tabular-nums">
              HDFS Sink: {flumeRuntime?.totalIngested.toLocaleString() ?? 0} records
            </p>
            <p className="mt-0.5 text-[11px] text-[#64748B]">
              Source: {backendMode === 'express' ? 'Express + SQLite' : 'Firebase Spark Sim'}
            </p>
          </div>

          <div className="border-t border-[#E2E8F0] pt-3">
            {!authReady ? (
              <p className="text-[11px] text-[#64748B]">Checking operator session...</p>
            ) : user ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2.5">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'Operator avatar'}
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 rounded-full border border-[#E2E8F0] object-cover shrink-0"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0284C7] text-[11px] font-semibold text-white shrink-0">
                      {(user.displayName || user.email || 'O')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#0F172A]">
                      {user.displayName || 'Plant Operator'}
                    </p>
                    <p className="truncate text-[11px] text-[#64748B]">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#16A34A]">Firestore Synced</span>
                  <button
                    onClick={signOutUser}
                    disabled={authBusy}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#475569] hover:text-[#0F172A]"
                  >
                    <LogOut className="h-3 w-3" />
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-[#64748B]">
                  Sign in with Google to save trend snapshots and Flume presets.
                </p>
                <button
                  onClick={signInWithGoogle}
                  disabled={authBusy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#0F172A] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1E293B] disabled:opacity-60"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  {authBusy ? 'Signing in...' : 'Sign in with Google'}
                </button>
                {authError && (
                  <p className="text-[11px] text-[#DC2626] break-words">{authError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="lg:pl-62">
        {/* Top Bar Contract: Breadcrumb on left + 1-2 primary actions on right */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[#E2E8F0] bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded p-1.5 text-[#475569] hover:bg-[#F1F5F9] lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-[#64748B] hidden sm:inline">Manufacturing Analytics</span>
              <span className="text-[#CBD5E1] hidden sm:inline">/</span>
              <span className="font-semibold text-[#0F172A] truncate">{activeNavMeta.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => handleFlumeControl(flumeRuntime?.config.running ? 'pause' : 'start')}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] whitespace-nowrap shrink-0"
            >
              {flumeRuntime?.config.running ? (
                <>
                  <Pause className="h-3.5 w-3.5 text-[#D97706]" />
                  Pause Stream
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 text-[#16A34A]" />
                  Start Stream
                </>
              )}
            </button>
            <button
              onClick={() => handleFlumeControl('burst')}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0284C7] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] whitespace-nowrap shrink-0"
            >
              <Zap className="h-3.5 w-3.5" />
              Inject Burst
            </button>
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {activeTab === 'overview' && (
            <OverviewTab
              trendsData={trendsData}
              flumeRuntime={flumeRuntime}
              partitions={partitions}
              loading={loading}
              error={error}
              onRetry={fetchAllData}
              onRefresh={fetchAllData}
              onInjectBurst={() => handleFlumeControl('burst')}
              onSeedBaseline={handleResetWarehouse}
              onNavigateTab={(t) => setActiveTab(t)}
            />
          )}

          {activeTab === 'auto' && (
            <AutoOperationsTab
              onSnapshotSaved={(title) => showToast(`Saved "${title}" to Firestore`)}
            />
          )}

          {activeTab === 'flume' && (
            <FlumeTab
              runtime={flumeRuntime}
              partitions={partitions}
              onControl={handleFlumeControl}
              onIngestRaw={handleIngestRaw}
              onClearWarehouse={handleClearWarehouse}
              onResetWarehouse={handleResetWarehouse}
            />
          )}

          {activeTab === 'code' && <CodeTab flumeConfig={flumeRuntime?.config ?? null} />}

          {activeTab === 'testing' && <TestingTab onRunComplete={fetchAllData} />}

          {activeTab === 'deploy' && (
            <DeployTab checklist={mergedChecklist} onToggleChecklist={handleToggleChecklist} />
          )}

          {activeTab === 'monitor' && (
            <MonitorTab
              metrics={monitorMetrics}
              logs={logs}
              onRefreshLogs={(next) => {
                setLogFilters(next);
                fetchLogs(next);
              }}
              onClearLogs={handleClearLogs}
            />
          )}
        </main>
      </div>

      {/* Subtle Toast Feedback */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 rounded-md border border-[#E2E8F0] bg-[#0F172A] px-4 py-2.5 text-xs font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
