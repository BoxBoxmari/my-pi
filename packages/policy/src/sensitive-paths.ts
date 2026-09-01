/**
 * Sensitive/secret path rules. A minimal glob matcher (no external dependency)
 * that supports the V1 default sensitive set. Deny is the default; an external
 * workspace config may allow-list, never a model tool argument (A6).
 */

export interface SensitiveRule {
  pattern: string;
}

export const DEFAULT_SENSITIVE_PATTERNS: string[] = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".aws/**",
  ".ssh/**",
  "credentials*",
  "secrets*",
];

/** Convert a single glob segment (no '/' or '**') into a regex source. */
function segmentToRegex(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === undefined) continue;
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Match a path (POSIX-style, relative) against a single pattern.
 * Supports '*', '?', '**' (recursive directory), and exact segment names.
 */
export function matchesSensitivePattern(path: string, pattern: string): boolean {
  if (!pattern.includes("/") && !pattern.includes("**")) {
    const re = new RegExp(`^${segmentToRegex(pattern)}$`);
    for (const seg of path.split("/")) {
      if (re.test(seg)) return true;
    }
    return false;
  }
  const re = new RegExp(`^${globToRegex(pattern)}$`);
  return re.test(path);
}

function globToRegex(pattern: string): string {
  const segments = pattern.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "**") {
      out.push("(?:[^/]+/)*[^/]*");
    } else if (seg === "") {
    } else {
      out.push(segmentToRegex(seg));
    }
  }
  return out.join("/");
}

export class SensitivePathPolicy {
  private readonly rules: string[];

  constructor(rules: string[] = DEFAULT_SENSITIVE_PATTERNS) {
    this.rules = rules;
  }

  isSensitive(relPosixPath: string): string | undefined {
    for (const rule of this.rules) {
      if (matchesSensitivePattern(relPosixPath, rule)) return rule;
    }
    return undefined;
  }
}
