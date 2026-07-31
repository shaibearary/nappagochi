# Nostr Pet

Product plan and working napplet prototype for a pet whose life reflects its
owner's public Nostr activity.

Status: **napplet published; native desktop shell not started**.

## Try the prototype

The implementation is in [`prototype/napplet`](prototype/napplet/README.md).

[Open the public Nostr Pet napplet in Kehto Paja](https://kehto.github.io/web/paja/?naddr=naddr1qvzqqqyf8ypzqte9nen2lgah6szky3hr0ympcj5v3znps9umamlzsm53fxn9ynyxqyxhwumn8ghj7mn0wvhxcmmvqy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9nhwden5te0wfjkccte9ec8y6tdv9kzumn9wsqqjmn0wd68yttsv46qhg7xxf).

```bash
cd prototype/napplet
pnpm install
pnpm run verify
pnpm run test:conformance
```

The build produces one self-contained `dist/index.html`. A real interactive
preview must be opened through Paja or another compatible NIP-5D runtime, not
as a standalone web page.

```bash
pnpm vite --host 127.0.0.1 --port 5188
PATH="$PATH:$HOME/.deno/bin" kehto paja \
  --target-url http://127.0.0.1:5188/ \
  --relay-mode memory
```

Open the Paja runtime URL it prints. The local Paja preview and development
signer flow were verified on 2026-07-27. The in-memory relay mode keeps test
events off public relays.

To generate eight signed test accounts covering every lifecycle condition:

```bash
pnpm run test:fixtures:matrix
```

To append a fresh eight-account matrix to the persistent loopback relay, run
`pnpm demo:seed`, then use **View pet** to paste any printed npub. This is a
single-tab, signer-free, read-only demo flow.

The local fixture lab can also accept a disposable test `nsec` through a hidden
prompt. Private keys never enter the napplet or generated files.

For the local-only interactive test page, start the loopback relay and Vite,
then run `pnpm paja:debug`. Open `http://127.0.0.1:5197/` and use the
**Test nsec** field in Paja's Signer panel with a disposable key.

For normal NIP-07 testing with local persistence, keep the loopback relay
running and use `pnpm paja:hybrid`. The shell follows NIP-65 and mirrors to the
local relay; if NIP-65 is unavailable, it uses local plus the public fallback
relays.

## Product premise

- A Nostr account can create a pet by signing a birth event.
- The pet's health is derived from the owner's normal Nostr activity.
- A normal top-level kind `1` note nourishes a pet that is not yet sick.
- A valid kind `1` reply to another person acts as medicine and can recover a
  sick or critical pet.
- Prolonged inactivity makes the pet lonely, sick, critical, and finally dead.
- Death is terminal for that pet. The owner may create a new pet afterward.
- An eight-check Nostr profile-health score enriches the pet's habitat. Staying
  in the Incomplete tier for 14 days can cause Sick, while activity alone
  controls Critical and terminal death.
- Appearance is customizable without rewriting the pet's birth history.

## Protocol recommendation

Use NIP-78 kind `78` for append-only pet records and kind `30078` for replaceable
appearance/preferences. Do not invent a new event kind for the MVP.

## Decisions already made for the plan

- Working product name: **Nostr Pet**.
- Desktop shell candidate: Tauri 2, subject to an early transparent-window
  prototype.
- Primary desktop signer: NIP-46 remote signing. The app never asks for or
  stores an `nsec`.
- The viewer accepts an `npub` for read-only inspection, while creating a pet
  or posting requires the matching connected signer.
- Default lifecycle is forgiving: death occurs after 45 days without a
  qualifying recovery.
- The prototype uses the user's NIP-65 relays plus a loopback persistence
  mirror; without NIP-65 it uses the mirror plus disclosed public fallbacks.
- The pet state is derived from signed source events; mutable status events are
  not authoritative.
