# Nappagochi

A gamified Nostr pet whose condition reflects its owner's public Nostr posts
and profile health.

[Open the current release in Kehto Paja](https://kehto.github.io/web/paja/?naddr=naddr1qvzqqqyf8ypzqte9nen2lgah6szky3hr0ympcj5v3znps9umamlzsm53fxn9ynyxqyxhwumn8ghj7mn0wvhxcmmvqy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9nhwden5te0wfjkccte9ec8y6tdv9kzumn9wsqqjmn0wd68yttsv46qhg7xxf)

## How it works

- A signed kind `78` event creates a pet and records its birth.
- The pet's condition is derived from the owner's kind `1` activity.
- A top-level note feeds a healthy pet.
- A reply to another person's note acts as medicine for a sick pet.
- Long inactivity progresses through Lonely, Sick, Critical, and Dead.
- Death is terminal for that pet; the owner may create a successor.
- Kind `30078` stores replaceable appearance settings.
- An eight-check habitat score, inspired by
  [Gigi's Profile Health project](https://github.com/dergigi/napplet-workshop/tree/master/profile-health),
  adds a second Sick trigger after 14 continuous Incomplete days.

## Run locally

```bash
pnpm install
pnpm run verify
pnpm run test:conformance
```

The production build is a single self-contained `dist/index.html`. Use Paja or
another NIP-5D-compatible shell for an interactive preview; the Vite page alone
does not provide the napplet runtime.

To start a development environment that uses the shell-provided NAP-OUTBOX API:

```bash
pnpm dev
```

To start the local relay, Vite server, and Paja debug environment together:

```bash
pnpm demo:local
```

## Demo fixtures

```bash
pnpm run test:fixtures
pnpm run test:fixtures:matrix
```

The fixture tools create disposable, signed test accounts for every lifecycle
state. Generated keys and relay data stay in the gitignored `.pet-test/`
directory and must never use a real identity or a key controlling funds.

## Napplet boundaries

- Required NAP domains: `identity` and `outbox`.
- Normal Nostr reads and publishes are OUTBOX-first.
- Signing, relay discovery, validation, and fanout belong to the shell.
- The napplet never handles private keys or uses direct browser network access.
- The existing `nostr-pet` manifest and event metadata remain unchanged so
  previously created pets continue to load.

## License

[MIT](LICENSE)
