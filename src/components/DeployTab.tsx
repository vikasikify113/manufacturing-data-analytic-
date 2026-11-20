import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  Cloud,
  Copy,
  Database,
  Download,
  GitBranch,
  Server,
  Square,
} from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { useFirebase } from '../contexts/FirebaseContext.tsx';
import { getBackendMode, getConfiguredApiBase } from '../lib/apiClient.ts';
import { buildDeployArtifacts, downloadTextFile } from '../lib/codeArtifacts.ts';
import type { DeployChecklistItem } from '../types/analytics.ts';

interface DeployTabProps {
  checklist: DeployChecklistItem[];
  onToggleChecklist: (id: string, completed: boolean) => Promise<void>;
}

type DeployTrack = 'firebase-terminal' | 'github-actions' | 'ai-studio';

interface TrackSpec {
  id: DeployTrack;
  label: string;
  costLabel: string;
  headline: string;
  summary: string;
  steps: Array<{ title: string; detail: string; command?: string }>;
}

const DEPLOY_TRACKS: TrackSpec[] = [
  {
    id: 'firebase-terminal',
    label: 'Firebase Terminal ($0)',
    costLabel: '$0/mo · No card required · Spark Hosting',
    headline: 'Deploy to Firebase Hosting from Your Computer Terminal',
    summary:
      'Publishes your production dist/ bundle, Google Auth, and Firestore rules to banded-order-th7nb.web.app using the free Spark plan. Built-in browser Flume streaming ticks live automatically.',
    steps: [
      {
        title: '1. Sign in to Firebase CLI once',
        detail:
          'Opens your browser automatically on a local computer. On remote terminals, add --no-localhost and paste the 4/... authorization code.',
        command: 'npx firebase-tools login',
      },
      {
        title: '2. Install packages cleanly',
        detail: 'Run inside the downloaded project folder before building.',
        command: 'npm install',
      },
      {
        title: '3. Build, verify & deploy Hosting + Rules',
        detail: 'Runs TypeScript check, Vite build, ESLint rules check, and deploys to Firebase Spark.',
        command: 'npm run deploy:firebase',
      },
    ],
  },
  {
    id: 'github-actions',
    label: 'GitHub Actions Auto-Deploy ($0)',
    costLabel: '$0/mo · Automated CI/CD on push & PR',
    headline: 'Auto-Deploy on Every GitHub Push & Pull Request',
    summary:
      'Includes two ready-to-run GitHub Actions workflows: live Firebase Hosting deployment on pushes to main and temporary preview URLs on every pull request.',
    steps: [
      {
        title: '1. Generate Firebase service account secret',
        detail:
          'Run once from your computer terminal to link your GitHub repository and create the FIREBASE_SERVICE_ACCOUNT_BANDED_ORDER_TH7NB secret automatically.',
        command: 'npx firebase-tools init hosting:github',
      },
      {
        title: '2. Push workflows & code to main',
        detail:
          'Pushing to main triggers firebase-hosting-merge.yml, running npm run lint, eslint firestore.rules, npm run build, and live deploy.',
        command: 'git add . && git commit -m "Add Firebase CI/CD" && git push origin main',
      },
      {
        title: '3. Open PRs for live preview channels',
        detail:
          'Every pull request targeting main triggers firebase-hosting-pull-request.yml and posts a temporary preview URL automatically.',
        command: 'git checkout -b feature/update && git push -u origin feature/update',
      },
    ],
  },
  {
    id: 'ai-studio',
    label: 'AI Studio Share ($0)',
    costLabel: '$0/mo · Instant full-stack Express + SQLite',
    headline: 'Share Full-Stack App Directly from AI Studio',
    summary:
      'Runs the complete Express.js microservice, SQLite warehouse, Apache Flume stream, Google Sign-In, and Cloud Firestore together with zero terminal setup.',
    steps: [
      {
        title: '1. Verify pipeline assertions',
        detail: 'Open the Test Suite tab and confirm all 6 automated assertions pass.',
      },
      {
        title: '2. Publish via AI Studio Share',
        detail: 'Click Share in the top-right AI Studio bar to publish or refresh your live public link.',
      },
      {
        title: '3. Confirm Authorized Domains',
        detail:
          'Ensure banded-order-th7nb.web.app and your .run.app host are listed under Firebase Console -> Authentication -> Settings -> Authorized domains.',
      },
    ],
  },
];

type ManifestKey =
  | 'firebaseJson'
  | 'firebaseMergeWorkflow'
  | 'firebasePrWorkflow'
  | 'renderYaml'
  | 'dockerfile'
  | 'k8sDeployment';

export const DeployTab: React.FC<DeployTabProps> = ({ checklist, onToggleChecklist }) => {
  const { user } = useFirebase();
  const artifacts = useMemo(() => buildDeployArtifacts(), []);
  const [selectedTrack, setSelectedTrack] = useState<DeployTrack>('firebase-terminal');
  const [activeFile, setActiveFile] = useState<ManifestKey>('firebaseJson');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const completedCount = checklist.filter((i) => i.completed).length;
  const backendMode = getBackendMode();
  const remoteApiBase = getConfiguredApiBase();
  const currentTrack = DEPLOY_TRACKS.find((t) => t.id === selectedTrack) || DEPLOY_TRACKS[0];

  const fileMap: Record<ManifestKey, { name: string; content: string; label: string }> = {
    firebaseJson: {
      name: 'firebase.json',
      content: artifacts.firebaseJson,
      label: 'Firebase Spark Hosting (Cache-Control + SPA Rewrites) & Firestore Rules',
    },
    firebaseMergeWorkflow: {
      name: 'firebase-hosting-merge.yml',
      content: artifacts.firebaseMergeWorkflow,
      label: 'GitHub Actions Live Deployment (.github/workflows/firebase-hosting-merge.yml)',
    },
    firebasePrWorkflow: {
      name: 'firebase-hosting-pull-request.yml',
      content: artifacts.firebasePrWorkflow,
      label: 'GitHub Actions PR Preview Channel (.github/workflows/firebase-hosting-pull-request.yml)',
    },
    renderYaml: {
      name: 'render.yaml',
      content: artifacts.renderYaml,
      label: 'Optional Free Node.js Full-Stack Blueprint',
    },
    dockerfile: {
      name: 'Dockerfile',
      content: artifacts.dockerfile,
      label: 'Express Microservice Container',
    },
    k8sDeployment: {
      name: 'k8s-deployment.yaml',
      content: artifacts.k8sDeployment,
      label: 'Kubernetes Orchestration',
    },
  };

  const currentFile = fileMap[activeFile];

  const handleCopyCommand = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="space-y-6">
      {/* Zero-Cost Deployment Guide & Live Backend Status */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <p className="text-xs font-medium text-[#0284C7]">
              Firebase Spark Hosting &amp; CI/CD · Project {firebaseConfig.projectId}
            </p>
            <h1 className="mt-1 text-xl font-bold text-[#0F172A]">
              Zero-Cost Firebase Deployment &amp; GitHub Auto-Deploy
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-[#475569]">
              Deploy the static React dashboard, Google Auth, and Cloud Firestore rules to Firebase Hosting for $0/month—either directly from your computer terminal or automatically via GitHub Actions.
            </p>
          </div>
          <div className="text-left lg:text-right shrink-0">
            <span className="font-mono text-xs font-medium text-[#0284C7] tabular-nums">
              {completedCount} / {checklist.length} readiness checks complete
            </span>
            <p className="mt-1 font-mono text-[11px] text-[#64748B]">
              Runtime: {backendMode === 'express' ? 'Express + SQLite' : 'Firebase Spark Live Sim'}
              {remoteApiBase ? ` (${remoteApiBase})` : ''}
            </p>
          </div>
        </div>

        {/* Segmented Zero-Cost Track Selector */}
        <div className="mt-5 flex flex-wrap items-center gap-1 rounded-md bg-[#F1F5F9] p-1 w-fit">
          {DEPLOY_TRACKS.map((track) => (
            <button
              key={track.id}
              onClick={() => {
                setSelectedTrack(track.id);
                if (track.id === 'firebase-terminal') setActiveFile('firebaseJson');
                if (track.id === 'github-actions') setActiveFile('firebaseMergeWorkflow');
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                selectedTrack === track.id
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {track.label}
            </button>
          ))}
        </div>

        {/* Selected Track Step-by-Step Runbook */}
        <div className="mt-5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-[#0F172A]">{currentTrack.headline}</h2>
            <span className="text-xs font-medium text-[#16A34A]">{currentTrack.costLabel}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[#475569]">{currentTrack.summary}</p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {currentTrack.steps.map((step, idx) => {
              const cmdKey = `${currentTrack.id}-${idx}`;
              return (
                <div
                  key={cmdKey}
                  className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-white p-4"
                >
                  <div>
                    <p className="text-xs font-semibold text-[#0F172A]">{step.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{step.detail}</p>
                  </div>
                  {step.command && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded border border-[#E2E8F0] bg-[#0F172A] px-2.5 py-2">
                      <code className="overflow-x-auto font-mono text-[11px] text-[#E2E8F0] whitespace-nowrap">
                        {step.command}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyCommand(cmdKey, step.command!)}
                        aria-label={`Copy command for ${step.title}`}
                        className="rounded p-1 text-[#94A3B8] transition-colors hover:bg-[#1E293B] hover:text-white shrink-0"
                      >
                        {copiedKey === cmdKey ? (
                          <Check className="h-3.5 w-3.5 text-[#16A34A]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Provisioned Stack Metadata Row */}
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Database className="h-4 w-4 text-[#0284C7]" />
              Firebase Auth &amp; Firestore ($0 Spark)
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#475569]">
              Project <span className="font-mono text-[#0F172A]">{firebaseConfig.projectId}</span> · DB{' '}
              <span className="font-mono break-all text-[#0F172A]">{firebaseConfig.firestoreDatabaseId}</span>
            </p>
            <p className="mt-2 font-mono text-[11px] text-[#16A34A]">
              {user ? `Signed in: ${user.email}` : 'Google Auth ready · Rules deployed'}
            </p>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Cloud className="h-4 w-4 text-[#0284C7]" />
              Live Static Spark Simulator
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#475569]">
              On Firebase Hosting, the built-in Flume simulator ticks continuously on a configurable interval so charts, JPH rates, and HDFS tables stream live without a paid server.
            </p>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <GitBranch className="h-4 w-4 text-[#0284C7]" />
              GitHub Actions CI/CD Included
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#475569]">
              Pre-configured workflows verify TypeScript, lint <span className="font-mono">firestore.rules</span>, build <span className="font-mono">dist/</span>, and deploy live &amp; PR preview channels.
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Checklist & Manifest Viewer */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0F172A]">
              Production Rollout Checklist
            </h2>
            <Server className="h-4 w-4 text-[#64748B]" />
          </div>
          <p className="mt-1 text-xs text-[#64748B]">
            Persisted to SQLite and synced per signed-in operator in Cloud Firestore.
          </p>

          <div className="mt-4 divide-y divide-[#E2E8F0]">
            {checklist.map((item) => (
              <button
                key={item.id}
                onClick={() => onToggleChecklist(item.id, !item.completed)}
                className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-[#F8FAFC]"
              >
                {item.completed ? (
                  <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />
                ) : (
                  <Square className="mt-0.5 h-4 w-4 shrink-0 text-[#94A3B8]" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#64748B]">{item.stage}</p>
                  <p className="text-sm font-medium text-[#0F172A]">{item.title}</p>
                  <p className="mt-0.5 text-xs text-[#64748B]">{item.detail}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-lg border border-[#E2E8F0] bg-[#0F172A] lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  'firebaseJson',
                  'firebaseMergeWorkflow',
                  'firebasePrWorkflow',
                  'renderYaml',
                  'dockerfile',
                  'k8sDeployment',
                ] as const
              ).map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveFile(key)}
                  className={`rounded px-2.5 py-1 font-mono text-xs transition-colors whitespace-nowrap shrink-0 ${
                    activeFile === key
                      ? 'bg-[#0284C7] text-white'
                      : 'text-[#94A3B8] hover:bg-[#1E293B] hover:text-white'
                  }`}
                >
                  {fileMap[key].name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopyCommand(`file-${activeFile}`, currentFile.content)}
                className="inline-flex items-center gap-1.5 rounded bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#334155] whitespace-nowrap shrink-0"
              >
                {copiedKey === `file-${activeFile}` ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#16A34A]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => downloadTextFile(currentFile.name, currentFile.content)}
                className="inline-flex items-center gap-1.5 rounded bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#334155] whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          </div>

          <div className="border-b border-[#1E293B] px-4 py-2 text-xs text-[#94A3B8]">
            {currentFile.label}
          </div>

          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-[#E2E8F0]">
            <code>{currentFile.content}</code>
          </pre>
        </div>
      </section>
    </div>
  );
};
