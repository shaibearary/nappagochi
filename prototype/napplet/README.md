# Nostr Pet Napplet

A portable prototype of Nostr Pet for NIP-5D-compatible shells. It demonstrates
the pet lifecycle and signed Nostr interactions; it is not yet an
operating-system desktop overlay.

## What works

- Recovers an existing pet from kind `78` birth events.
- Creates a first pet or a successor after terminal death.
- Derives six states from the owner's public kind `1` activity.
- Publishes user-written top-level notes through NAP-OUTBOX.
- Uses a reply to another person's verified note as medicine, prioritizing
  followed authors and falling back to recent public Discover notes.
- Publishes replaceable kind `30078` appearance settings.
- Calculates an eight-check Nostr habitat score from profile metadata, NIP-05,
  media hosting, Lightning, relays, follows, and NIP-60 wallet events.
- Combines habitat health with activity into Radiant, Thriving, Unsettled, and
  Fragile living-condition variants.
- Reconciles live kind `1` events and shows partial-sync status.
- Supports optional shell theme and storage domains with safe fallbacks.
- Supports a documented, temporary local-relay-only debug mode without exposing
  private keys to the napplet.
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

## Test every lifecycle state

Create eight signed, disposable accounts covering Happy, Content, Lonely,
Sick, Critical, Dead, medicine recovery, and successor birth:

```bash
pnpm run test:fixtures
pnpm run test:fixtures:matrix
```

The matrix command writes gitignored, owner-readable Paja configurations under
`.pet-test/fixtures/` and prints the command for opening each account in Paja.
Every event is signed and includes an `nevent` reference in `index.json`, but
Paja loads it into an isolated memory relay rather than publishing publicly.
The Happy fixture has no follows and exercises the public Discover fallback;
the Content fixture includes one followed author and exercises the primary
doctor route.

To build one scenario from an existing disposable test key:

```bash
pnpm run test:fixture:nsec -- --scenario sick
```

The prompt hides the `nsec`; the tool never prints or writes it and overwrites
the secret bytes before exit. Do not use a real identity or a key controlling
funds. Private-key handling remains completely outside the production napplet.
See [`docs/11-local-lifecycle-test-lab.md`](../../docs/11-local-lifecycle-test-lab.md)
for all scenarios and commands.

For a persistent, loopback-only live relay test, see
[`docs/13-local-relay-test.md`](../../docs/13-local-relay-test.md). The napplet
still publishes through NAP-OUTBOX; Paja owns the WebSocket connection.

For deterministic recovery without public relay discovery, including copying
an already-signed pet event into the loopback relay, see
[`docs/14-local-only-debug-mode.md`](../../docs/14-local-only-debug-mode.md).
Start the relay, Vite, and Paja together with:

```bash
pnpm demo:local
```

Open `http://127.0.0.1:5197/`. Its Paja Signer panel includes a temporary
**Test nsec** password field for disposable keys. The field belongs to the local
shell, not the napplet, and the secret is cleared on refresh. Keep the
`demo:local` command running; one Ctrl+C stops all three services. If any
service exits unexpectedly, the command identifies it and shuts down the
remaining services instead of leaving a stale half-running preview.

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
- Optional domains: `resource`, `storage`, `theme`, plus temporary debug-only
  `config` and `relay` support.
- No direct network, signer, relay pool, key, or browser persistence access.
- Normal social reads and publishes are OUTBOX-first.
- When NIP-65 is absent, publishes pass writable Identity candidates back
  through Outbox. The four disclosed prototype defaults are used only when the
  shell provides no writable candidate; the napplet never opens relay
  connections.
- The source of truth is signed Nostr history, not local UI state.
- Local fixture generation is a separate Node development script and is absent
  from the single-file production artifact.

The product design and exact event formats live in the repository-level
`docs/` directory.
