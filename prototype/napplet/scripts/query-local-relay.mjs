#!/usr/bin/env node

function optionValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const relay = optionValue('--relay', 'ws://127.0.0.1:7777');
const author = optionValue('--author');
const kind = optionValue('--kind');
const dTag = optionValue('--d');
const filter = {};
if (author) filter.authors = [author];
if (kind) {
  const parsed = Number(kind);
  if (!Number.isSafeInteger(parsed)) throw new Error('--kind must be an integer');
  filter.kinds = [parsed];
}
if (dTag) filter['#d'] = [dTag];

const subscriptionId = `inspect-${Date.now()}`;
const events = [];
const socket = new WebSocket(relay);
const timeout = setTimeout(() => {
  socket.close();
  console.error(`Timed out querying ${relay}`);
  process.exitCode = 1;
}, 5_000);

socket.addEventListener('open', () => {
  socket.send(JSON.stringify(['REQ', subscriptionId, filter]));
});
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data));
  if (message[0] === 'EVENT' && message[1] === subscriptionId) events.push(message[2]);
  if (message[0] === 'EOSE' && message[1] === subscriptionId) {
    clearTimeout(timeout);
    socket.send(JSON.stringify(['CLOSE', subscriptionId]));
    socket.close();
    process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
  }
});
socket.addEventListener('error', () => {
  clearTimeout(timeout);
  console.error(`Could not connect to ${relay}`);
  process.exitCode = 1;
});
