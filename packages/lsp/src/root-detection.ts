/**
 * Root detection: precedence of markers (e.g., tsconfig.json, Cargo.toml, pyproject.toml).
 */
export const ROOT_MARKERS: Record<string, string[]> = {
  typescript: ["tsconfig.json", "package.json"],
  python: ["pyproject.toml", "setup.py"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
};
export function detectRoot(files: string[], language: string): string | undefined {
  const markers = ROOT_MARKERS[language] ?? [];
  return markers.find((m) => files.includes(m));
}
