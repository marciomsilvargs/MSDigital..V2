const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? "";
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY ausente nas Edge Function secrets.");
  const bytes = fromBase64(raw);
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY deve ser base64 de 32 bytes.");
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(token));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptToken(value: string): Promise<string> {
  const [version, iv64, cipher64] = value.split(".");
  if (version !== "v1" || !iv64 || !cipher64) throw new Error("Token criptografado em formato inválido.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv64) }, await encryptionKey(), fromBase64(cipher64));
  return new TextDecoder().decode(plain);
}
