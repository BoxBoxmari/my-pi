export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export function isDataClassification(value: unknown): value is DataClassification {
  return value === "public" || value === "internal" || value === "confidential" || value === "restricted";
}
