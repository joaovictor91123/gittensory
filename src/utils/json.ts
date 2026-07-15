export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function errorMessage(error: unknown, fallback = "unknown error"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function strippedErrorMessage(error: unknown, fallback: string): string {
  const message = errorMessage(error, "");
  return message.replace(/^Error: /, "") || fallback;
}

/** A truncated stack trace for structured-log JSON context, when the caught value is a real Error. Sentry's
 *  generic console-forwarder (sentry.ts's forwardStructuredLogToSentry) never sees the original Error object,
 *  only the already-`JSON.stringify`d line — this is the only way a stack reaches Sentry for a fail-safe catch
 *  that logs rather than calling captureError directly (console.error is always auto-forwarded, so an explicit
 *  captureError call alongside it would double-capture the same failure). Capped short: a full stack rarely adds
 *  diagnostic value over the first several frames and would bloat every log line. */
export function errorStack(error: unknown, maxLength = 500): string | undefined {
  return error instanceof Error && error.stack ? error.stack.slice(0, maxLength) : undefined;
}

export function normalizeRepoFullName(value: string): string {
  return value.trim();
}

export function repoParts(fullName: string): { owner: string; name: string } {
  const normalized = fullName.trim();
  if (normalized.length === 0) return { owner: "", name: "" };
  const [owner, ...rest] = normalized.split("/") as [string, ...string[]];
  return {
    owner,
    name: rest.join("/"),
  };
}

export function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}
