import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { type Hex, isHex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

const KDF_N = 1 << 15;
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;

type KeystoreV1 = {
  version: 1;
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  kdfParams: { N: number; r: number; p: number; salt: string };
  iv: string;
  authTag: string;
  ciphertext: string;
};

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password, salt, KEY_LEN, {
    N: KDF_N,
    r: KDF_R,
    p: KDF_P,
    maxmem: 128 * KDF_N * KDF_R * 2,
  });
}

export async function encryptPrivateKey(
  privateKey: Hex,
  password: string,
): Promise<KeystoreV1> {
  if (!isHex(privateKey) || privateKey.length !== 66) {
    throw new Error("privateKey must be a 0x-prefixed 32-byte hex string");
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(privateKey.slice(2), "hex");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    kdfParams: { N: KDF_N, r: KDF_R, p: KDF_P, salt: salt.toString("hex") },
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export async function decryptPrivateKey(
  keystore: KeystoreV1,
  password: string,
): Promise<Hex> {
  if (keystore.version !== 1 || keystore.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported keystore format");
  }
  const salt = Buffer.from(keystore.kdfParams.salt, "hex");
  const iv = Buffer.from(keystore.iv, "hex");
  const authTag = Buffer.from(keystore.authTag, "hex");
  const ciphertext = Buffer.from(keystore.ciphertext, "hex");
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return `0x${plaintext.toString("hex")}` as Hex;
  } catch {
    throw new Error("Failed to decrypt keystore: wrong password or corrupted file");
  }
}

export async function saveKeystore(path: string, keystore: KeystoreV1): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(keystore, null, 2), { mode: 0o600 });
}

export async function loadKeystore(path: string): Promise<KeystoreV1> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as KeystoreV1;
}

export async function loadAccount(
  keystorePath: string,
  password: string,
): Promise<PrivateKeyAccount> {
  const ks = await loadKeystore(keystorePath);
  const pk = await decryptPrivateKey(ks, password);
  return privateKeyToAccount(pk);
}
