# Nostr Pet Napplet Guide

Keep this application narrow: it renders and operates one activity-driven pet
inside a NIP-5D shell.

## Protocol boundaries

- Use current `@napplet/sdk` helpers.
- Keep ordinary social reads and publishes on `outbox`.
- The shell owns identity, signing, relay discovery, validation, and fanout.
- Never add direct network access, browser persistence, raw key access,
  app-owned signing, a relay pool, or a `window.nostr` dependency.
- Treat `identity` and `outbox` as hard requirements.
- Check optional `storage` and `theme` domains after runtime injection.
- Preserve the missing-runtime explanatory UI.
- Keep the published artifact self-contained in one `index.html`.

## Product invariants

- Death is terminal for one birth event.
- A successor can be created only after the predecessor is derived dead.
- A top-level kind `1` note cannot revive a sick or critical pet.
- Medicine is a kind `1` reply whose parent resolves to another author.
- Preview state is visual-only and never authoritative.
- All post and reply text must come from the user.

## Verification

```bash
pnpm run verify
pnpm run test:conformance
```

Also scan `src` and `dist/index.html` for forbidden browser authority before
committing. Use Paja for a real runtime preview when `kehto` is installed.
