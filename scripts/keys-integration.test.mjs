import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createPajaHostConfig,
  normalizePajaOptions,
  renderPajaHtml,
} from '@kehto/paja';
import { chromium } from 'playwright';

function send(response, contentType, body) {
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

async function startPaja(distHtml) {
  const pajaEntry = fileURLToPath(import.meta.resolve('@kehto/paja'));
  const browserHost = await readFile(join(dirname(pajaEntry), 'browser-host.js'), 'utf8');
  let hostHtml = '';
  let configJson = '';

  const server = createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    if (requestUrl === '/' || requestUrl.startsWith('/?')) {
      send(response, 'text/html; charset=utf-8', hostHtml);
    } else if (requestUrl === '/__kehto/config.json') {
      send(response, 'application/json; charset=utf-8', configJson);
    } else if (requestUrl === '/__kehto/browser-host.js') {
      send(response, 'text/javascript; charset=utf-8', browserHost);
    } else if (requestUrl === '/__kehto/target.html' || requestUrl === '/artifact') {
      send(response, 'text/html; charset=utf-8', distHtml);
    } else {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Paja test server has no port');

  const options = normalizePajaOptions({
    targetUrl: `http://127.0.0.1:${address.port}/artifact`,
    host: '127.0.0.1',
    port: address.port,
    simulation: {
      identity: { mode: 'anonymous' },
      relay: { mode: 'memory', urls: ['wss://relay.example'] },
      storage: { mode: 'memory' },
    },
  });
  const hostConfig = createPajaHostConfig(options, new Date());
  hostHtml = renderPajaHtml(hostConfig);
  configJson = JSON.stringify(hostConfig);

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test('NAP-KEYS registers the panel action and suppresses editable keystrokes', {
  timeout: 30_000,
}, async (t) => {
  const distHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const paja = await startPaja(distHtml);
  t.after(() => paja.close());

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (message) => logs.push(message.text()));
  await page.addInitScript(() => {
    globalThis.__napKeyMessages = [];
    window.addEventListener('message', (event) => {
      if (event.data && typeof event.data.type === 'string' && event.data.type.startsWith('keys.')) {
        globalThis.__napKeyMessages.push(event.data);
      }
    });
  });

  await page.goto(paja.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const nappletFrame = page.frames().find((frame) => frame.url() === 'about:srcdoc');
  assert.ok(nappletFrame, 'Paja should load the napplet in a sandboxed iframe');
  const input = nappletFrame.locator('input[type="text"], input:not([type])').first();
  await input.waitFor({ timeout: 5_000 });
  await page.waitForFunction(() => globalThis.__napKeyMessages.some(
    (message) => message.type === 'keys.registerAction',
  ), null, { timeout: 5_000 });

  const registration = await page.evaluate(() => globalThis.__napKeyMessages.find(
    (message) => message.type === 'keys.registerAction',
  ));
  assert.deepEqual(registration.action, {
    id: 'pet.toggle-care-panel',
    label: 'Toggle pet care panel',
    defaultKey: 'Alt+P',
  });

  await input.focus();
  await page.keyboard.type('input probe');
  await page.keyboard.press('Alt+P');
  await nappletFrame.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'nap-keys-textarea-probe';
    document.body.append(textarea);
    textarea.focus();
  });
  await page.keyboard.type('textarea probe');
  await page.keyboard.press('Alt+P');
  await page.waitForTimeout(50);

  let messages = await page.evaluate(() => globalThis.__napKeyMessages);
  assert.equal(messages.some((message) => message.type === 'keys.forward'), false);
  assert.equal(logs.some((line) => line.includes('care panel visibility changed')), false);

  await nappletFrame.locator('h1').first().click();
  await page.keyboard.press('Alt+P');
  await page.waitForTimeout(50);
  assert.equal(logs.filter((line) => line.includes('care panel visibility changed')).length, 1);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(50);
  messages = await page.evaluate(() => globalThis.__napKeyMessages);
  const forwards = messages.filter((message) => message.type === 'keys.forward');
  assert.deepEqual(forwards, [{
    type: 'keys.forward',
    key: 'ArrowDown',
    code: 'ArrowDown',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  }]);
});
