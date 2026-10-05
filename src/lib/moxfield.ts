/** Public deck ID from a Moxfield deck URL or path ("/decks/6bUjMtA1NUiqQYvr8uqXBg" → "6bUjMtA1NUiqQYvr8uqXBg"). */
export function parseDeckId(urlOrPath: string): string | null {
  const match = urlOrPath.match(/\/decks\/([A-Za-z0-9_-]{8,})(?:[/?#]|$)/);
  if (!match?.[1] || match[1] === "public" || match[1] === "personal") return null;
  return match[1];
}

export function deckApiUrl(deckId: string): string {
  return `https://api2.moxfield.com/v3/decks/all/${deckId}`;
}
