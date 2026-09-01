/**
 * Redaction: never log source contents, credentials, secrets, auth headers, or
 * sensitive environment variables by default.
 */

const SECRET_KEY_HINTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "auth",
  "credential",
  "private_key",
  "authorization",
];

export function redactKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_HINTS.some((h) => k.includes(h));
}

export function redactValue(key: string, value: unknown): unknown {
  if (redactKey(key)) return "[REDACTED]";
  return value;
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) out[k] = redactValue(k, v);
  return out;
}

export function scrubText(text: string): string {
  return text.replace(
    /(authorization|bearer)\s*[:=]\s*[A-Za-z0-9._\-]+/gi,
    "$1: [REDACTED]",
  );
}
