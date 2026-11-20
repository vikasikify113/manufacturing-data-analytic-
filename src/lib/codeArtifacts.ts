import type { FlumeConfig } from '../types/analytics.ts';

export interface CodeArtifact {
  id: string;
  filename: string;
  tier: string;
  language: string;
  description: string;
  content: string;
}

export function buildCodeArtifacts(flumeConfig: FlumeConfig): CodeArtifact[] {
  const agent = flumeConfig.agentName || 'agent';

  return [
    {
      id: 'flume-conf',
      filename: 'flume-conf.properties',
      tier: 'Data Ingestion (Apache Flume)',
      language: 'properties',
      description:
        'Live-synced Apache Flume agent configuration tailing manufacturing sensor logs into a memory channel and writing DataStream blocks to Hadoop HDFS.',
      content: `# Apache Flume Manufacturing Sensor Ingestion Agent
# Define components
${agent}.sources = sensorSource
${agent}.channels = memChannel
${agent}.sinks = hdfsSink

# Source: Executing a tail on the manufacturing floor sensor log
${agent}.sources.sensorSource.type = ${flumeConfig.sourceType}
${agent}.sources.sensorSource.command = ${flumeConfig.sourceCommand}
${agent}.sources.sensorSource.channels = memChannel

# Channel: Memory buffer tuned for burst throughput
${agent}.channels.memChannel.type = ${flumeConfig.channelType}
${agent}.channels.memChannel.capacity = ${flumeConfig.channelCapacity}
${agent}.channels.memChannel.transactionCapacity = ${flumeConfig.transactionCapacity}

# Sink: Writing to HDFS Big Data Storage
${agent}.sinks.hdfsSink.type = ${flumeConfig.sinkType}
${agent}.sinks.hdfsSink.channel = memChannel
${agent}.sinks.hdfsSink.hdfs.path = ${flumeConfig.hdfsPath}%Y-%m-%d
${agent}.sinks.hdfsSink.hdfs.filePrefix = FlumeData
${agent}.sinks.hdfsSink.hdfs.fileType = ${flumeConfig.hdfsFileType}
${agent}.sinks.hdfsSink.hdfs.batchSize = ${flumeConfig.batchSize}
${agent}.sinks.hdfsSink.hdfs.rollInterval = 3600`,
    },
    {
      id: 'express-microservice',
      filename: 'data-processor.js',
      tier: 'Microservice (Express.js)',
      language: 'javascript',
      description:
        'Dedicated Express.js microservice responsible for aggregating sensor records from Big Data partitions and classifying machine health thresholds.',
      content: `const express = require('express');
const app = express();
const PORT = process.env.MICROSERVICE_PORT || 5001;

function classifyEfficiency(efficiency) {
  if (efficiency > 90) return 'Optimal';
  if (efficiency >= 78) return 'Check Required';
  return 'Critical';
}

app.get('/api/health', (_req, res) => {
  res.json({ service: 'data-processor', status: 'healthy', port: PORT });
});

app.get('/api/process-trends', async (req, res) => {
  // Aggregates ingested HDFS/SQLite sensor streams by machine and production line
  const { line = 'All', status = 'All' } = req.query;
  const records = [
    { timestamp: new Date().toISOString(), machineId: 'M1', line: 'Line A', efficiency: 93.4 },
    { timestamp: new Date().toISOString(), machineId: 'M2', line: 'Line A', efficiency: 95.1 },
    { timestamp: new Date().toISOString(), machineId: 'M3', line: 'Line A', efficiency: 86.2 }
  ].map((row) => ({
    ...row,
    status: classifyEfficiency(row.efficiency),
  }));

  const filtered = records.filter(
    (r) => (line === 'All' || r.line === line) && (status === 'All' || r.status === status)
  );
  res.json({ count: filtered.length, data: filtered });
});

app.listen(PORT, () => console.log(\`Microservice running on port \${PORT}\`));`,
    },
    {
      id: 'nextjs-api',
      filename: 'pages/api/trends.js',
      tier: 'Backend API Gateway (Next.js)',
      language: 'javascript',
      description:
        'Next.js API route forwarding trend aggregation requests to the Express.js data-processor microservice with resilient fallback handling.',
      content: `export default async function handler(req, res) {
  const microserviceUrl = process.env.PROCESSOR_URL || 'http://localhost:5001';
  const query = new URLSearchParams(req.query).toString();

  try {
    const upstream = await fetch(\`\${microserviceUrl}/api/process-trends?\${query}\`);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Microservice upstream error' });
    }
    const payload = await upstream.json();
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(502).json({ error: 'Unable to reach data-processor microservice' });
  }
}`,
    },
    {
      id: 'react-dashboard',
      filename: 'pages/index.js',
      tier: 'Frontend Consumer (React.js / Next.js)',
      language: 'jsx',
      description:
        'React dashboard component consuming /api/trends and rendering live machine performance status cards.',
      content: `import React, { useEffect, useState } from 'react';

export default function Dashboard() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch('/api/trends')
      .then((res) => res.json())
      .then((payload) => setData(payload.machines || []));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <header className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold">Manufacturing Data Analytics</h1>
      </header>
      <main>
        <h2 className="mb-4 text-lg font-semibold">Machine Performance Trends</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.map((item) => (
            <div key={item.machineId} className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-semibold">Machine: {item.machineId}</h3>
              <p className="font-mono tabular-nums">Efficiency: {item.latestEfficiency}%</p>
              <p>Status: {item.latestEfficiency > 90 ? 'Optimal' : 'Check Required'}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}`,
    },
    {
      id: 'bigdata-schema',
      filename: 'schema.sql',
      tier: 'Big Data Warehouse & Partition Metadata',
      language: 'sql',
      description:
        'Relational metadata and time-series sensor schema backing HDFS partition indexing and fast SQL trend queries.',
      content: `CREATE TABLE IF NOT EXISTS sensor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  production_line TEXT NOT NULL,
  efficiency REAL NOT NULL,
  temperature_c REAL NOT NULL,
  vibration_mm_s REAL NOT NULL,
  rpm INTEGER NOT NULL,
  power_kw REAL NOT NULL,
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
);`,
    },
  ];
}

export function buildDeployArtifacts() {
  return {
    dockerfile: `FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5001
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:5001/api/health || exit 1
CMD ["node", "data-processor.js"]`,
    dockerCompose: `services:
  flume-agent:
    image: apache/flume:1.11.0
    volumes:
      - ./flume-conf.properties:/opt/flume/conf/flume-conf.properties
      - /var/log/manufacturing:/var/log/manufacturing:ro
    depends_on:
      - hdfs-namenode

  data-processor:
    build: ./microservice
    ports:
      - "5001:5001"
    environment:
      - HDFS_NAMENODE=hdfs://hdfs-namenode:9000

  analytics-web:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - PROCESSOR_URL=http://data-processor:5001
    depends_on:
      - data-processor`,
    k8sDeployment: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: manufacturing-data-processor
  labels:
    app: manufacturing-analytics
    tier: microservice
spec:
  replicas: 3
  selector:
    matchLabels:
      app: manufacturing-data-processor
  template:
    metadata:
      labels:
        app: manufacturing-data-processor
    spec:
      containers:
        - name: data-processor
          image: ghcr.io/plant-ops/data-processor:1.0.0
          ports:
            - containerPort: 5001
          readinessProbe:
            httpGet:
              path: /api/health
              port: 5001
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"`,
    firebaseJson: `{
  "firestore": {
    "database": "ai-studio-manufacturingdat-0be39e6a-dacf-4952-9f1f-c34f2ccaa0e9",
    "rules": "firestore.rules"
  },
  "hosting": {
    "public": "dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**",
      "data/**"
    ],
    "headers": [
      {
        "source": "/assets/**",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=31536000, immutable"
          }
        ]
      },
      {
        "source": "/index.html",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache, no-store, must-revalidate"
          }
        ]
      }
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}`,
    firebaseMergeWorkflow: `name: Deploy to Firebase Hosting (Live)

on:
  push:
    branches:
      - main

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Type-check and lint Firestore rules
        run: |
          npm run lint
          npx eslint firestore.rules

      - name: Build production Vite bundle
        run: npm run build

      - name: Deploy Hosting to Firebase Spark
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: \${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: \${{ secrets.FIREBASE_SERVICE_ACCOUNT_BANDED_ORDER_TH7NB }}
          channelId: live
          projectId: banded-order-th7nb`,
    firebasePrWorkflow: `name: Deploy Preview to Firebase Hosting (PR)

on:
  pull_request:
    branches:
      - main

jobs:
  build_and_preview:
    if: \${{ github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout pull request
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Type-check and lint Firestore rules
        run: |
          npm run lint
          npx eslint firestore.rules

      - name: Build production Vite bundle
        run: npm run build

      - name: Deploy Preview Channel to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: \${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: \${{ secrets.FIREBASE_SERVICE_ACCOUNT_BANDED_ORDER_TH7NB }}
          projectId: banded-order-th7nb`,
    renderYaml: `services:
  - type: web
    name: flume-manufacturing-analytics
    runtime: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm start
    healthCheckPath: /api/microservice/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: CORS_ORIGIN
        value: https://banded-order-th7nb.web.app,https://banded-order-th7nb.firebaseapp.com`,
  };
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
