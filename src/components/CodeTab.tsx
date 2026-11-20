import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import { buildCodeArtifacts, downloadTextFile } from '../lib/codeArtifacts.ts';
import type { FlumeConfig } from '../types/analytics.ts';

interface CodeTabProps {
  flumeConfig: FlumeConfig | null;
}

export const CodeTab: React.FC<CodeTabProps> = ({ flumeConfig }) => {
  const defaultConfig: FlumeConfig = flumeConfig ?? {
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

  const artifacts = useMemo(() => buildCodeArtifacts(defaultConfig), [defaultConfig]);
  const [activeId, setActiveId] = useState<string>('flume-conf');
  const [copied, setCopied] = useState(false);

  const activeArtifact = artifacts.find((a) => a.id === activeId) || artifacts[0];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeArtifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <h1 className="text-xl font-bold text-[#0F172A]">
          Multi-Tier Source Code &amp; Flume Configuration
        </h1>
        <p className="mt-1 text-sm text-[#475569]">
          Inspect and export the complete stack artifacts: Apache Flume agent configuration (live-synced with your channel &amp; sink parameters), Express.js data-processor microservice, Next.js API route &amp; React dashboard, and Big Data SQL schema.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* File Selector List */}
          <div className="space-y-2 lg:col-span-4">
            {artifacts.map((art) => {
              const selected = art.id === activeArtifact.id;
              return (
                <button
                  key={art.id}
                  onClick={() => setActiveId(art.id)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors ${
                    selected
                      ? 'border-[#0284C7] bg-[#F0F9FF]/60'
                      : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#CBD5E1] hover:bg-white'
                  }`}
                >
                  <FileCode2
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      selected ? 'text-[#0284C7]' : 'text-[#64748B]'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-semibold text-[#0F172A]">
                      {art.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-[#64748B]">{art.tier}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Code Viewer */}
          <div className="flex flex-col rounded-lg border border-[#E2E8F0] bg-[#0F172A] lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] px-4 py-3">
              <div>
                <p className="font-mono text-xs font-semibold text-white">
                  {activeArtifact.filename}
                </p>
                <p className="mt-0.5 text-xs text-[#94A3B8]">
                  {activeArtifact.description}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded border border-[#334155] bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#334155] whitespace-nowrap shrink-0"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-[#4ADE80]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => downloadTextFile(activeArtifact.filename.split('/').pop() || 'artifact.txt', activeArtifact.content)}
                  className="inline-flex items-center gap-1.5 rounded bg-[#0284C7] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0369A1] whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            </div>

            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-[#E2E8F0]">
              <code>{activeArtifact.content}</code>
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
