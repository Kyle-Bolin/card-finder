/**
 * Links to EDH Power Level (https://edhpowerlevel.com), which analyses a deck list.
 * The `?d=` format follows the site's published "button" snippet (edhpowerlevel.com/button):
 * each line drops anything from "(" on and any [..] / <..> parts, lines are joined with "~",
 * URL-encoded with spaces as "+", and the list ends with "~Z~".
 */
export function edhPowerLevelUrl(lines: string[]): string {
  const cleaned = lines
    .map((line) =>
      line
        .replace(/\(.*$/, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/<[^>]*>/g, "")
        .trim(),
    )
    .filter(Boolean);
  const encoded = encodeURIComponent(cleaned.join("~")).replace(/%20/g, "+");
  return `https://edhpowerlevel.com?d=${encoded}~Z~`;
}
