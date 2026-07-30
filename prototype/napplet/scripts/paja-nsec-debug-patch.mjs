const SIGNER_RENDER_MARKER =
  'function renderSignerStatus(state, signerPubkey) {';

const METHOD_LABEL_MARKER =
  'const methodLabel = state.signer.method === "nip07" ? "NIP-07" : state.signer.method === "nip46" ? "bunker" : state.signer.method === "dev" ? "dev" : "none";';

const DEV_CLICK_MARKER =
  'devButton.addEventListener("click", () => state.useDevSigner());';

const NIP07_CLICK_MARKER =
  'nip07Button.addEventListener("click", () => void state.connectNip07());';

const BUNKER_CLICK_MARKER =
  'bunkerButton.addEventListener("click", () => void state.connectBunker(bunkerInput.value));';

const CONTROLS_MARKER =
  'controls.replaceChildren(devButton, nip07Button, bunkerInput, bunkerButton);';

const DEBUG_SIGNER_HELPERS = `var NOSTR_PET_ORIGINAL_NIP07_SIGNER = globalThis.nostr;
var NOSTR_PET_DEBUG_NSEC_SIGNER = null;
function setNostrPetShellSigner(signer) {
  try {
    Object.defineProperty(globalThis, "nostr", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: signer
    });
  } catch {
    globalThis.nostr = signer;
  }
  if (globalThis.nostr !== signer) {
    throw new Error("The browser signer cannot be replaced in this profile");
  }
}
function restoreNostrPetBrowserSigner() {
  if (!NOSTR_PET_DEBUG_NSEC_SIGNER) return;
  NOSTR_PET_DEBUG_NSEC_SIGNER.dispose();
  NOSTR_PET_DEBUG_NSEC_SIGNER = null;
  if (NOSTR_PET_ORIGINAL_NIP07_SIGNER) {
    setNostrPetShellSigner(NOSTR_PET_ORIGINAL_NIP07_SIGNER);
    return;
  }
  try {
    delete globalThis.nostr;
  } catch {
    globalThis.nostr = void 0;
  }
}
function installNostrPetDebugNsecSigner(value, relayUrl) {
  const decoded = decode2(value.trim());
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array) || decoded.data.length !== 32) {
    throw new Error("Enter a valid nsec test key");
  }
  restoreNostrPetBrowserSigner();
  const secretKey = new Uint8Array(decoded.data);
  const signer = {
    __nostrPetDebugNsec: true,
    getPublicKey: async () => getPublicKey(secretKey),
    getRelays: async () => ({
      [relayUrl]: { read: true, write: true }
    }),
    signEvent: async (event) => finalizeEvent({ ...event }, secretKey),
    dispose: () => secretKey.fill(0)
  };
  try {
    setNostrPetShellSigner(signer);
    NOSTR_PET_DEBUG_NSEC_SIGNER = signer;
  } catch (error) {
    secretKey.fill(0);
    throw error;
  }
}
`;

const DEBUG_NSEC_CONTROLS = `const nsecInput = document.createElement("input");
  nsecInput.id = "signer-test-nsec";
  nsecInput.type = "password";
  nsecInput.autocomplete = "off";
  nsecInput.spellcheck = false;
  nsecInput.placeholder = "nsec1… (test only)";
  nsecInput.setAttribute("aria-label", "Disposable test nsec");
  nsecInput.title = "Local debug only. Never use a key that controls funds.";
  nsecInput.addEventListener("input", () => nsecInput.setCustomValidity(""));
  const nsecButton = document.createElement("button");
  nsecButton.type = "button";
  nsecButton.id = "signer-test-nsec-connect";
  nsecButton.dataset.active = String(
    state.signer.method === "nip07" && Boolean(globalThis.nostr?.__nostrPetDebugNsec)
  );
  nsecButton.textContent = "Use test nsec";
  const connectTestNsec = async () => {
    try {
      const relayUrl = state.simulation.relay.urls[0] ?? "ws://127.0.0.1:7777";
      installNostrPetDebugNsecSigner(nsecInput.value, relayUrl);
      nsecInput.value = "";
      await state.connectNip07();
    } catch (error) {
      nsecInput.setCustomValidity(error instanceof Error ? error.message : String(error));
      nsecInput.reportValidity();
    }
  };
  nsecButton.addEventListener("click", () => void connectTestNsec());
  nsecInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void connectTestNsec();
  });
  `;

function replaceExactlyOnce(source, marker, replacement) {
  const first = source.indexOf(marker);
  if (first === -1) {
    throw new Error(`Paja debug patch is incompatible: missing marker ${marker}`);
  }
  if (source.indexOf(marker, first + marker.length) !== -1) {
    throw new Error(`Paja debug patch is ambiguous: repeated marker ${marker}`);
  }
  return source.replace(marker, replacement);
}

export function patchPajaBrowserHost(source) {
  let patched = replaceExactlyOnce(
    source,
    SIGNER_RENDER_MARKER,
    `${DEBUG_SIGNER_HELPERS}\n${SIGNER_RENDER_MARKER}`,
  );
  patched = replaceExactlyOnce(
    patched,
    METHOD_LABEL_MARKER,
    'const methodLabel = state.signer.method === "nip07" ? globalThis.nostr?.__nostrPetDebugNsec ? "test nsec" : "NIP-07" : state.signer.method === "nip46" ? "bunker" : state.signer.method === "dev" ? "dev" : "none";',
  );
  patched = replaceExactlyOnce(
    patched,
    DEV_CLICK_MARKER,
    'devButton.addEventListener("click", () => { restoreNostrPetBrowserSigner(); state.useDevSigner(); });',
  );
  patched = replaceExactlyOnce(
    patched,
    NIP07_CLICK_MARKER,
    'nip07Button.addEventListener("click", () => { restoreNostrPetBrowserSigner(); void state.connectNip07(); });',
  );
  patched = replaceExactlyOnce(
    patched,
    BUNKER_CLICK_MARKER,
    'bunkerButton.addEventListener("click", () => { restoreNostrPetBrowserSigner(); void state.connectBunker(bunkerInput.value); });',
  );
  patched = replaceExactlyOnce(
    patched,
    CONTROLS_MARKER,
    `${DEBUG_NSEC_CONTROLS}controls.replaceChildren(devButton, nip07Button, nsecInput, nsecButton, bunkerInput, bunkerButton);`,
  );
  return patched;
}
