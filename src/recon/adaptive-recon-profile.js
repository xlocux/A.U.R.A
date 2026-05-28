"use strict";

const os = require("node:os");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");

const DEFAULT_PROFILE = Object.freeze({
  profile: "balanced",
  cpuCores: 1,
  memoryMb: 512,
  cpuScore: 1,
  maxToolConcurrency: 1,
  httpxBatchSize: 250,
  httpxThreads: 25,
  dnsxThreads: 25,
  screenshotConcurrency: 2,
  timeoutMultiplier: 1.5,
  aiRationale: "Fallback profile selected because the benchmark could not read host capacity."
});

function benchmarkReconHost({ sampleSize = 8000 } = {}) {
  const startedAt = new Date().toISOString();
  const cpuCores = Math.max(1, os.cpus()?.length || 1);
  const memoryMb = Math.max(128, Math.floor(os.totalmem() / 1024 / 1024));
  const disk = readDiskHint();
  const cpuScore = runCpuProbe(sampleSize);
  const profile = classifyProfile({ cpuCores, memoryMb, cpuScore });
  const limits = deriveAdaptiveLimits({ profile, cpuCores, memoryMb, cpuScore });
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    profile,
    cpuCores,
    memoryMb,
    disk,
    cpuScore,
    ...limits,
    aiRationale: explainProfile({ profile, cpuCores, memoryMb, cpuScore, limits })
  };
}

function runCpuProbe(sampleSize) {
  const iterations = Math.max(1000, Number.parseInt(sampleSize, 10) || 8000);
  const started = performance.now();
  let score = 0;
  for (let index = 2; index < iterations; index += 1) {
    let prime = true;
    for (let divider = 2; divider * divider <= index; divider += 1) {
      if (index % divider === 0) {
        prime = false;
        break;
      }
    }
    if (prime) score += 1;
  }
  const elapsed = Math.max(1, performance.now() - started);
  return Number(((iterations / elapsed) * 10).toFixed(2));
}

function classifyProfile({ cpuCores, memoryMb, cpuScore }) {
  if (cpuCores >= 8 && memoryMb >= 8192 && cpuScore >= 900) return "aggressive";
  if (cpuCores >= 4 && memoryMb >= 4096 && cpuScore >= 450) return "balanced";
  return "conservative";
}

function deriveAdaptiveLimits({ profile, cpuCores, memoryMb, cpuScore }) {
  const memoryFactor = memoryMb >= 8192 ? 1.25 : memoryMb >= 4096 ? 1 : 0.65;
  const cpuFactor = cpuScore >= 900 ? 1.25 : cpuScore >= 450 ? 1 : 0.65;
  const base = profile === "aggressive" ? 1.5 : profile === "balanced" ? 1 : 0.55;
  const factor = Math.max(0.4, Math.min(1.75, base * memoryFactor * cpuFactor));
  return {
    maxToolConcurrency: clamp(Math.floor(cpuCores * factor), 1, 12),
    httpxBatchSize: clamp(Math.floor(750 * factor), 150, 1500),
    httpxThreads: clamp(Math.floor(60 * factor), 15, 120),
    dnsxThreads: clamp(Math.floor(80 * factor), 20, 150),
    screenshotConcurrency: clamp(Math.floor(4 * factor), 1, 8),
    timeoutMultiplier: Number((profile === "conservative" ? 1.8 : profile === "balanced" ? 1.25 : 1).toFixed(2))
  };
}

function readDiskHint() {
  try {
    const stat = fs.statSync(process.cwd());
    return { cwdDevice: stat.dev, writable: true };
  } catch (error) {
    return { writable: false, error: error.message };
  }
}

function explainProfile({ profile, cpuCores, memoryMb, cpuScore, limits }) {
  return [
    `AI-aware preflight selected the ${profile} recon profile before launch.`,
    `Detected ${cpuCores} CPU core(s), ${memoryMb}MB RAM, CPU probe score ${cpuScore}.`,
    `Recommended limits: ${limits.maxToolConcurrency} tool worker(s), httpx batches of ${limits.httpxBatchSize}, httpx threads ${limits.httpxThreads}, dnsx threads ${limits.dnsxThreads}, screenshot concurrency ${limits.screenshotConcurrency}.`,
    "The goal is to avoid one oversized httpx/dnsx/screenshot process starving the pipeline and hiding downstream tech/screenshot failures."
  ].join(" ");
}

function applyAdaptiveTimeout(timeoutMs, profile) {
  const base = Number(timeoutMs || 180000);
  const multiplier = Number(profile?.timeoutMultiplier || DEFAULT_PROFILE.timeoutMultiplier);
  return Math.max(30000, Math.floor(base * multiplier));
}

function chunkList(items, size) {
  const chunkSize = Math.max(1, Number.parseInt(size, 10) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  DEFAULT_PROFILE,
  applyAdaptiveTimeout,
  benchmarkReconHost,
  chunkList,
  deriveAdaptiveLimits
};
