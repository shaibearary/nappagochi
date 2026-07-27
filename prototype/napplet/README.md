# Nostr Pet Napplet

A portable prototype of Nostr Pet for NIP-5D-compatible shells. It demonstrates
the pet lifecycle and signed Nostr interactions; it is not yet an
operating-system desktop overlay.

## What works

- Recovers an existing pet from kind `78` birth events.
- Creates a first pet or a successor after terminal death.
- Derives six states from the owner's public kind `1` activity.
- Publishes user-written top-level notes through NAP-OUTBOX.
- Uses a reply to another person's verified note as medicine.
- Publishes replaceable kind `30078` appearance settings.
- Calculates an eight-check Nostr habitat score from profile metadata, NIP-05,
  media hosting, Lightning, relays, follows, and NIP-60 wallet events.
- Combines habitat health with activity into Radiant, Thriving, Unsettled, and
  Fragile living-condition variants.
- Reconciles live kind `1` events and shows partial-sync status.
- Supports optional shell theme and storage domains with safe fallbacks.
- Includes a visual-state lab that never changes canonical Nostr state.

## Run checks

```bash
pnpm install
pnpm run verify
pnpm run test:conformance
```

The production artifact is one self-contained `dist/index.html`. The
conformance build also creates a local, test-key-signed
`dist/.nip5a-manifest.json`; the fixed key is public test material and must
never be reused for production signing.

## Preview in a real shell

Start the napplet and Paja in separate terminals:

```bash
pnpm vite --host 127.0.0.1 --port 5188
PATH="$PATH:$HOME/.deno/bin" kehto paja \
  --target-url http://127.0.0.1:5188/ \
  --relay-mode memory \
  --port 5198
```

Open the Paja URL, not the underlying Vite URL. Deno, Kehto, and Paja were
verified on this machine on 2026-07-27: the shell loaded the app, injected the
runtime, connected the development signer, and exercised adoption, note,
appearance, and doctor flows. Memory-relay mode keeps test events off public
relays.

## Napplet boundaries

- Required domains: `identity`, `outbox`.
- Optional domains: `resource`, `storage`, `theme`.
- No direct network, signer, relay pool, key, or browser persistence access.
- Normal social reads and publishes are OUTBOX-first.
- When NIP-65 is absent, publishes pass writable Identity candidates plus four
  disclosed prototype defaults back through Outbox; the napplet never opens
  relay connections.
- The source of truth is signed Nostr history, not local UI state.

The product design and exact event formats live in the repository-level
`docs/` directory.
