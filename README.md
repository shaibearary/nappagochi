# Nostr Pet

Planning repository for a desktop pet whose life reflects its owner's public
Nostr activity.

Status: **research and product planning only**. No application code has been
started.

## Product premise

- A Nostr account can create a pet by signing a birth event.
- The pet's health is derived from the owner's normal Nostr activity.
- A normal top-level kind `1` note nourishes a pet that is not yet sick.
- A valid kind `1` reply to another person acts as medicine and can recover a
  sick or critical pet.
- Prolonged inactivity makes the pet lonely, sick, critical, and finally dead.
- Death is terminal for that pet. The owner may create a new pet afterward.
- Appearance is customizable without rewriting the pet's birth history.

## Protocol recommendation

Use NIP-78 kind `78` for append-only pet records and kind `30078` for replaceable
appearance/preferences. Do not invent a new event kind for the MVP.

The event design, examples, relay queries, lifecycle algorithm, and protocol
limitations are in [docs/02-nostr-protocol-design.md](docs/02-nostr-protocol-design.md).

## Documents

1. [Product and UX](docs/01-product-and-ux.md)
2. [Nostr protocol design](docs/02-nostr-protocol-design.md)
3. [Lifecycle rules](docs/03-lifecycle-rules.md)
4. [Technical architecture](docs/04-technical-architecture.md)
5. [Implementation plan](docs/05-implementation-plan.md)
6. [Risks and open decisions](docs/06-risks-and-open-decisions.md)
7. [Research sources](docs/07-research-sources.md)

## Decisions already made for the plan

- Working product name: **Nostr Pet**.
- Desktop shell candidate: Tauri 2, subject to an early transparent-window
  prototype.
- Primary desktop signer: NIP-46 remote signing. The app never asks for or
  stores an `nsec`.
- Login accepts `npub`/`nprofile` for read-only preview, but creating a pet or
  posting requires a connected signer.
- Default lifecycle is forgiving: death occurs after 45 days without a
  qualifying recovery.
- The app uses the user's NIP-65 write relays plus an optional user-selected
  durable storage relay.
- The pet state is derived from signed source events; mutable status events are
  not authoritative.
