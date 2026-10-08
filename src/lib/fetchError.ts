/**
 * Turn a failed fetch into a message for the user. A bare `TypeError` is what the
 * browser throws when site access hasn't been granted, so point at that.
 */
export function describeFetchError(err: unknown, url: string): string {
  if (err instanceof TypeError) {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      // keep the raw string
    }
    return `Couldn't reach ${host}. Check Card Finder's site access in your browser's extension settings.`;
  }
  return err instanceof Error ? err.message : String(err);
}
