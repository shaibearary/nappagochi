import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
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
    }),
  ],
});
