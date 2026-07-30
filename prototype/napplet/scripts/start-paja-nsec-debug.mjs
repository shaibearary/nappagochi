import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPajaHostConfig,
  normalizePajaOptions,
  renderPajaHtml,
} from '@kehto/paja';
import { patchPajaBrowserHost } from './paja-nsec-debug-patch.mjs';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 5197,
  relayUrl: 'ws://127.0.0.1:7777',
  targetUrl: 'http://127.0.0.1:5188/',
};

function parseArgs(argv) {
  const values = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--host' && value) values.host = value;
    else if (argument === '--port' && value) values.port = Number(value);
    else if (argument === '--relay-url' && value) values.relayUrl = value;
    else if (argument === '--target-url' && value) values.targetUrl = value;
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
    index += 1;
  }
  if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65_535) {
    throw new Error('The Paja debug port must be an integer from 1 to 65535');
  }
  return values;
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

async function loadPatchedBrowserHost() {
  const pajaEntry = fileURLToPath(import.meta.resolve('@kehto/paja'));
  const source = await readFile(join(dirname(pajaEntry), 'browser-host.js'), 'utf8');
  return patchPajaBrowserHost(source);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = normalizePajaOptions({
    targetUrl: args.targetUrl,
    host: args.host,
    port: args.port,
    simulation: {
      identity: { mode: 'anonymous' },
      relay: { mode: 'live', urls: [args.relayUrl] },
      storage: { mode: 'memory' },
      config: {
        values: {
          nostrPetLocalRelayOnly: true,
          nostrPetLocalRelayUrl: args.relayUrl,
        },
      },
    },
  });
  const hostConfig = createPajaHostConfig(options, new Date());
  const html = renderPajaHtml(hostConfig);
  const configJson = JSON.stringify(hostConfig, null, 2);
  const browserHost = await loadPatchedBrowserHost();

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = request.url ?? '/';
      if (requestUrl === '/' || requestUrl.startsWith('/?')) {
        send(response, 200, 'text/html; charset=utf-8', html);
        return;
      }
      if (requestUrl === '/__kehto/config.json') {
        send(response, 200, 'application/json; charset=utf-8', configJson);
        return;
      }
      if (requestUrl === '/__kehto/browser-host.js') {
        send(response, 200, 'text/javascript; charset=utf-8', browserHost);
        return;
      }
      if (requestUrl === '/__kehto/target.html') {
        const target = await fetch(args.targetUrl, {
          headers: {
            accept: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.8',
          },
        });
        if (!target.ok) {
          send(
            response,
            502,
            'text/plain; charset=utf-8',
            `Target ${args.targetUrl} returned ${target.status} ${target.statusText}`,
          );
          return;
        }
        send(response, 200, 'text/html; charset=utf-8', await target.text());
        return;
      }
      send(response, 404, 'text/plain; charset=utf-8', 'Not found');
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      send(
        response,
        502,
        'text/plain; charset=utf-8',
        error instanceof Error ? error.message : String(error),
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(args.port, args.host, resolve);
  });

  const close = () => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  console.log(`Nostr Pet test Paja: http://${args.host}:${args.port}/`);
  console.log(`Napplet target: ${args.targetUrl}`);
  console.log(`Local relay only: ${args.relayUrl}`);
  console.log('The Test nsec field is in Paja’s Signer panel and is memory-only.');
}

await main();
