import assert from 'node:assert/strict';
import test from 'node:test';
import { patchPajaBrowserHost } from './paja-nsec-debug-patch.mjs';

const compatiblePajaSource = `
function renderSignerStatus(state, signerPubkey) {
  const methodLabel = state.signer.method === "nip07" ? "NIP-07" : state.signer.method === "nip46" ? "bunker" : state.signer.method === "dev" ? "dev" : "none";
  devButton.addEventListener("click", () => state.useDevSigner());
  nip07Button.addEventListener("click", () => void state.connectNip07());
  bunkerButton.addEventListener("click", () => void state.connectBunker(bunkerInput.value));
  controls.replaceChildren(devButton, nip07Button, bunkerInput, bunkerButton);
}
`;

test('adds a shell-owned test nsec signer without exposing it to the napplet', () => {
  const patched = patchPajaBrowserHost(compatiblePajaSource);
  assert.match(patched, /signer-test-nsec/);
  assert.match(patched, /type = "password"/);
  assert.match(patched, /Use test nsec/);
  assert.match(patched, /secretKey\.fill\(0\)/);
  assert.match(patched, /catch \(error\) \{\s+secretKey\.fill\(0\)/);
  assert.match(patched, /state\.simulation\.relay\.urls\[0\]/);
  assert.match(
    patched,
    /devButton\.addEventListener\("click", \(\) => \{ restoreNostrPetBrowserSigner\(\)/,
  );
  assert.match(
    patched,
    /bunkerButton\.addEventListener\("click", \(\) => \{ restoreNostrPetBrowserSigner\(\)/,
  );
  assert.match(
    patched,
    /controls\.replaceChildren\(devButton, nip07Button, nsecInput, nsecButton,/,
  );
});

test('fails closed when the installed Paja bundle is incompatible', () => {
  assert.throws(
    () => patchPajaBrowserHost('function unrelated() {}'),
    /Paja debug patch is incompatible/,
  );
});
