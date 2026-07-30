import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function startRelay(port, dataPath) {
  const deno = process.env.DENO_BIN || join(homedir(), '.deno', 'bin', 'deno');
  const directory = dirname(dataPath);
  const child = spawn(
    deno,
    [
      'run',
      `--allow-net=127.0.0.1:${port}`,
      `--allow-read=${directory}`,
      `--allow-write=${directory}`,
      new URL('./local-test-relay.ts', import.meta.url).pathname,
      '--port',
      String(port),
      '--data',
      dataPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('relay start timed out')), 10_000);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`relay exited early (${code}): ${stderr}`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (!chunk.includes('READY ')) return;
      clearTimeout(timeout);
      resolve();
    });
  });
  return child;
}

async function stopRelay(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function publish(relay, event) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(relay);
    const timeout = setTimeout(() => reject(new Error('publish timed out')), 5_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify(['EVENT', event])));
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message[0] !== 'OK' || message[1] !== event.id) return;
      clearTimeout(timeout);
      socket.close();
      resolve(message);
    });
    socket.addEventListener('error', () => reject(new Error('publish connection failed')));
  });
}

async function query(relay, filter) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(relay);
    const subscriptionId = `test-${Date.now()}`;
    const events = [];
    const timeout = setTimeout(() => reject(new Error('query timed out')), 5_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(['REQ', subscriptionId, filter]));
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message[0] === 'EVENT' && message[1] === subscriptionId) events.push(message[2]);
      if (message[0] !== 'EOSE' || message[1] !== subscriptionId) return;
      clearTimeout(timeout);
      socket.send(JSON.stringify(['CLOSE', subscriptionId]));
      socket.close();
      resolve(events);
    });
    socket.addEventListener('error', () => reject(new Error('query connection failed')));
  });
}

test('stores, queries, and reloads a signed pet birth event', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nostr-pet-relay-'));
  const dataPath = join(directory, 'events.json');
  const port = await availablePort();
  const relayUrl = `ws://127.0.0.1:${port}`;
  const secretKey = generateSecretKey();
  const birth = finalizeEvent(
    {
      kind: 78,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [['d', 'nostr.pet.birth.v1']],
      content: JSON.stringify({ v: 1, name: 'Relay Test' }),
    },
    secretKey,
  );
  secretKey.fill(0);

  let relay = await startRelay(port, dataPath);
  try {
    const accepted = await publish(relayUrl, birth);
    assert.deepEqual(accepted.slice(0, 3), ['OK', birth.id, true]);
    assert.deepEqual(
      (await query(relayUrl, {
        authors: [birth.pubkey],
        kinds: [78],
        '#d': ['nostr.pet.birth.v1'],
      })).map((event) => event.id),
      [birth.id],
    );

    await stopRelay(relay);
    relay = await startRelay(port, dataPath);
    assert.deepEqual(
      (await query(relayUrl, { ids: [birth.id] })).map((event) => event.id),
      [birth.id],
    );
  } finally {
    await stopRelay(relay);
    await rm(directory, { recursive: true, force: true });
  }
});
