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

```bash
napplet paja -- pnpm vite --host 127.0.0.1
```

Use the Paja URL printed by the command, not the underlying Vite URL. This
machine currently has the napplet CLI but not the `kehto`/Paja runtime, so the
manual live-shell preview remains open.

## Napplet boundaries

- Required domains: `identity`, `outbox`.
- Optional domains: `storage`, `theme`.
- No direct network, signer, relay pool, key, or browser persistence access.
- Normal social reads and publishes are OUTBOX-first.
- The source of truth is signed Nostr history, not local UI state.

The product design and exact event formats live in the repository-level
`docs/` directory.
