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

const SENSITIVE_PATH_SEGMENTS = new Set([".ssh", ".aws", ".npmrc", ".git-credentials", "credentials", "secrets"]);

const PATH_REDACTED = "[PATH:REDACTED]";

/** True when any path segment names a sensitive credential location (.env*, .ssh, .aws, id_rsa, credentials, secrets, .npmrc, .git-credentials). */
export function isSensitivePath(value: string): boolean {
  for (const raw of value.toLowerCase().split(/[/\\]+/)) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    if (SENSITIVE_PATH_SEGMENTS.has(segment)) return true;
    if (segment.startsWith(".env")) return true;
    if (segment.startsWith("id_rsa")) return true;
  }
  return false;
}

const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]+/g,
  /-----BEGIN[^-]*KEY-----/g,
];

/**
 * scrubText, provider-shaped secret masks, then free-text sensitive-path
 * masking; idempotent fixed-point. Secret+path composites mask the secret
 * first, then end as [PATH:REDACTED].
 */
export function redactTextDeep(value: string): string {
  let text = scrubText(value);
  for (const pattern of SECRET_TEXT_PATTERNS) text = text.replace(pattern, "[REDACTED:SECRET]");
  if (isSensitivePath(text)) return PATH_REDACTED;
  return text;
}

const PATHISH_KEY = /path|file|root|dir|uri/i;

function redactNode(value: unknown, underPathKey: boolean): unknown {
  if (typeof value === "string") {
    if (underPathKey && isSensitivePath(value)) return PATH_REDACTED;
    return redactTextDeep(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactNode(item, underPathKey));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (redactKey(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = redactNode(entry, underPathKey || PATHISH_KEY.test(key));
    }
    return out;
  }
  return value;
}

/** Recursively redacts secrets inside event payloads; null/primitive roots pass through. Idempotent. */
export function redactPayloadDeep(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((item) => redactNode(item, false));
  if (payload !== null && typeof payload === "object") return redactNode(payload, false);
  return payload;
}

/**
 * Shallow-clones an event for the wire with redacted payload and actor identity.
 * The sequence field is never touched: bigint stays bigint in-store and is
 * serialized to string only at the wire boundary by the caller.
 */
export function redactEventForWire<T>(event: T): T {
  if (event === null || typeof event !== "object") return event;
  const source = event as Record<string, unknown>;
  const clone: Record<string, unknown> = { ...source };
  if ("payload" in source) clone.payload = redactPayloadDeep(source.payload);
  const actor = source.actor;
  if (actor !== null && typeof actor === "object" && !Array.isArray(actor)) {
    const actorClone: Record<string, unknown> = { ...(actor as Record<string, unknown>) };
    if (typeof actorClone.id === "string") actorClone.id = redactTextDeep(actorClone.id);
    if (typeof actorClone.name === "string") actorClone.name = redactTextDeep(actorClone.name);
    clone.actor = actorClone;
  }
  return clone as T;
}
