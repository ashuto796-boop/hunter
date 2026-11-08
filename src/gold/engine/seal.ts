// Real-money data is published on a public branch, so it is sealed with a passphrase only the
// owner knows (GitHub secret AURUM_PASSPHRASE on the server, typed once in the app).
// AES-256-GCM, key derived with PBKDF2-SHA256. WebCrypto: the same code runs in Node and browsers.
export interface Sealed {
  v: 1;
  salt: string;
  iv: string;
  data: string; // ciphertext followed by the GCM tag
}

const ITERATIONS = 210_000;

const toB64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(value: unknown, passphrase: string): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  return { v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

// null when the passphrase is wrong (GCM authentication fails) or the box is malformed
export async function unseal<T>(box: Sealed | null | undefined, passphrase: string): Promise<T | null> {
  if (!box || box.v !== 1 || !passphrase) return null;
  try {
    const key = await keyFor(passphrase, fromB64(box.salt));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.data));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
