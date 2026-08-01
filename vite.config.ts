import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  server: {
    // Paja loads the dev app in an opaque-origin sandbox. Allow its module
    // requests during local development; the production artifact is inline.
    cors: true,
  },
  build: {
    modulePreload: false,
  },
  plugins: [
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'nostr-pet',
      title: 'Nostr Pet Prototype',
      description: 'A portable Nostr activity pet prototype.',
      artifactMode: 'single-file',
      requires: ['identity', 'outbox'],
      configSchema: {
        type: 'object',
        properties: {
          nostrPetLocalRelayOnly: {
            type: 'boolean',
            title: 'Local relay only (debug)',
            description:
              'DEBUG ONLY: bypass NIP-65 discovery and use Paja’s configured loopback relay.',
            default: false,
          },
          nostrPetLocalRelayMirror: {
            type: 'boolean',
            title: 'Local relay mirror (debug)',
            description:
              'DEBUG ONLY: add the configured loopback relay to normal Outbox reads and publishes.',
            default: false,
          },
          nostrPetLocalRelayUrl: {
            type: 'string',
            title: 'Local relay URL (debug)',
            description: 'DEBUG ONLY: must resolve to localhost or a loopback address.',
            default: 'ws://127.0.0.1:7777',
          },
        },
      },
    }),
  ],
});
