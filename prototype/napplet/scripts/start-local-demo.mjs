#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { createInterface } from 'node:readline';

const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 2_000;

const SERVICES = [
  {
    name: 'relay',
    command: 'pnpm',
    args: ['run', 'relay:local'],
    port: 7777,
  },
  {
    name: 'vite',
    command: 'pnpm',
    args: ['run', 'dev'],
    port: 5188,
  },
  {
    name: 'paja',
    command: 'pnpm',
    args: ['run', 'paja:debug'],
    port: 5197,
  },
];

const children = new Map();
let shuttingDown = false;
let resolveDone;
const done = new Promise((resolve) => {
  resolveDone = resolve;
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canConnect(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, HOST);
  });
}

function prefixOutput(name, stream, writer) {
  if (!stream) return;
  createInterface({ input: stream }).on('line', (line) => {
    writer(`[${name}] ${line}`);
  });
}

async function waitUntilReady(service, child) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${service.name} stopped before opening ${HOST}:${service.port}.`,
      );
    }
    if (await canConnect(service.port)) return;
    await delay(100);
  }
  throw new Error(
    `${service.name} did not open ${HOST}:${service.port} within 10 seconds.`,
  );
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...children.values()].reverse().map(stopChild));
  process.exitCode = exitCode;
  resolveDone();
}

async function startService(service) {
  if (await canConnect(service.port)) {
    throw new Error(
      `${HOST}:${service.port} is already in use. Stop the old local demo before starting a new one.`,
    );
  }

  const child = spawn(service.command, service.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(service.name, child);
  prefixOutput(service.name, child.stdout, console.log);
  prefixOutput(service.name, child.stderr, console.error);

  child.once('error', (error) => {
    if (shuttingDown) return;
    console.error(`[${service.name}] Could not start: ${error.message}`);
    void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(
      `[${service.name}] Stopped unexpectedly (${reason}). Stopping the other local demo services.`,
    );
    void shutdown(code === 0 ? 1 : (code ?? 1));
  });

  await waitUntilReady(service, child);
  console.log(`[${service.name}] Ready on ${HOST}:${service.port}`);
}

async function main() {
  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));

  try {
    for (const service of SERVICES) await startService(service);
    console.log('');
    console.log('Nappagochi local demo is ready: http://127.0.0.1:5197/');
    console.log('Keep this command running. Press Ctrl+C once to stop all services.');
    await done;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await shutdown(1);
  }
}

await main();
