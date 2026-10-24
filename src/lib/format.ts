export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(
    /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
    '',
  );
}
