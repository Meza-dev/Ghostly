import type { AssistedMeta } from "@ghosttester/runner";

const REDACTED = "[REDACTED]";
const SENSITIVE_WORDS = [
  "password",
  "passwd",
  "token",
  "secret",
  "api key",
  "apikey",
  "authorization",
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function redactGoal(goal: string): string {
  const normalized = normalize(goal);
  if (SENSITIVE_WORDS.some((word) => normalized.includes(word))) {
    return REDACTED;
  }
  return goal;
}

export function redactAssistedMeta(meta: AssistedMeta): AssistedMeta {
  return {
    ...meta,
    goal: redactGoal(meta.goal),
  };
}
