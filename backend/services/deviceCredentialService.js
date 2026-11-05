
const crypto = require("crypto");

function getEncryptionKey() {
  const value = process.env.DEVICE_ENCRYPTION_KEY;

  if (!value) {
    throw new Error("DEVICE_ENCRYPTION_KEY is missing.");
  }

  const key = Buffer.from(value, "base64");

  if (key.length !== 32) {
    throw new Error("DEVICE_ENCRYPTION_KEY must decode to 32 bytes.");
  }

  return key;
}

function generateDeviceSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptSecret(value) {
  const parts = value.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted device secret.");
  }

  const [ivValue, tagValue, encryptedValue] = parts;

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64")
  );

  decipher.setAuthTag(Buffer.from(tagValue, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function createSignature(secret, method, path, timestamp, nonce, rawBody) {
  const message = [
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    rawBody,
  ].join("\n");

  return crypto
    .createHmac("sha256", secret)
    .update(message, "utf8")
    .digest("hex");
}

function safeCompare(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    !/^[a-f0-9]{64}$/i.test(a) ||
    !/^[a-f0-9]{64}$/i.test(b)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex")
  );
}

module.exports = {
  generateDeviceSecret,
  hashSecret,
  encryptSecret,
  decryptSecret,
  createSignature,
  safeCompare,
};
