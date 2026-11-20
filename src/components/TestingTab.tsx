import React, { useState } from 'react';
import { CheckCircle2, Play, Terminal, XCircle } from 'lucide-react';
import { apiFetchJson } from '../lib/apiClient.ts';
import type { TestSuiteResponse } from '../types/analytics.ts';

interface TestingTabProps {
  onRunComplete?: () => void;
}

export const TestingTab: React.FC<TestingTabProps> = ({ onRunComplete }) => {
  const [suiteData, setSuiteData] = useState<TestSuiteResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunTests = async () => {
    setRunning(true);
    setError(null);
    try {
      const payload = await apiFetchJson<TestSuiteResponse>('/api/tests/run', { method: 'POST' });
      setSuiteData(payload);
      onRunComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute test suite');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">
              Unit, Integration &amp; HDFS Verification Suite
            </h1>
            <p className="mt-1 text-sm text-[#475569]">
              Executes live assertions against the Express.js microservice, Apache Flume channel bounds, log ingestion parser, and HDFS partition directory.
            </p>
          </div>
          <button
            onClick={handleRunTests}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-md bg-[#0284C7] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" />
            {running ? 'Running Assertions...' : 'Run All Verification Tests'}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#DC2626]">
            {error}
          </div>
        )}

        {!suiteData && !running && (
          <div className="mt-6 rounded-lg border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-10 text-center">
            <Terminal className="mx-auto mb-3 h-7 w-7 text-[#64748B]" />
            <p className="text-sm font-medium text-[#0F172A]">
              Ready to verify end-to-end pipeline health
            </p>
            <p className="mt-1 text-xs text-[#64748B]">
              Click &ldquo;Run All Verification Tests&rdquo; to execute real backend checks and inspect <span className="font-mono">hadoop fs -ls /user/manufacturing/data/</span> output.
            </p>
          </div>
        )}

        {suiteData && (
          <div className="mt-6 space-y-6">
            {/* Summary Strip */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <p className="text-xs text-[#64748B]">Total Assertions</p>
                <p className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                  {suiteData.total}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <p className="text-xs text-[#64748B]">Passed</p>
                <p className="mt-1 font-mono text-xl font-semibold text-[#16A34A] tabular-nums">
                  {suiteData.passed}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <p className="text-xs text-[#64748B]">Failed</p>
                <p className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                  {suiteData.failed}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <p className="text-xs text-[#64748B]">Suite Latency</p>
                <p className="mt-1 font-mono text-xl font-semibold text-[#0F172A] tabular-nums">
                  {suiteData.totalDurationMs} ms
                </p>
              </div>
            </div>

            {/* Individual Test Results */}
            <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
              {suiteData.results.map((tc) => (
                <div key={tc.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      {tc.passed ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A]">
                          {tc.name}
                        </p>
                        <p className="mt-0.5 text-xs text-[#64748B]">
                          {tc.suite} · <span className="font-mono">{tc.commandOrEndpoint}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <span className={tc.passed ? 'font-semibold text-[#16A34A]' : 'font-semibold text-[#DC2626]'}>
                        {tc.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="mx-1.5 text-[#CBD5E1]">·</span>
                      <span className="text-[#64748B]">{tc.durationMs} ms</span>
                    </div>
                  </div>
                  <p className="mt-2 pl-6.5 text-xs text-[#475569]">{tc.description}</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 pl-6.5 font-mono text-[11px] sm:grid-cols-2">
                    <div className="rounded bg-[#F8FAFC] px-2.5 py-1.5 text-[#475569]">
                      <span className="text-[#64748B]">Expected: </span>
                      {tc.expected}
                    </div>
                    <div className="rounded bg-[#F8FAFC] px-2.5 py-1.5 text-[#0F172A]">
                      <span className="text-[#64748B]">Actual: </span>
                      {tc.actual}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Live HDFS FS Listing */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#0F172A] p-4">
              <p className="font-mono text-xs font-medium text-[#94A3B8]">
                $ hadoop fs -ls /user/manufacturing/data/
              </p>
              <div className="mt-2 space-y-1 font-mono text-xs text-[#E2E8F0]">
                {suiteData.hdfsLsOutput.map((line, i) => (
                  <div key={i} className="overflow-x-auto whitespace-nowrap">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
