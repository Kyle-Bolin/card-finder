import { isGenericHost } from "../lib/storeFinder";
import type { FetchFn } from "../lib/types";

const STOREFRONT_LINK = /\b([a-z0-9-]+)\.tcgplayerpro\.com\b/gi;
const SHOP_LINK_HINT = /(shop|singles|store|buy|cards|mtg|magic|tcg)/i;
const MAX_HTML_BYTES = 2_000_000;
const MAX_EXTRA_PAGES = 3;
const ROBOTS_AGENT = "card-finder";

/** Storefront origins linked from a page ("https://x.tcgplayerpro.com"). */
export function extractStorefrontLinks(html: string): string[] {
  const subs = new Set<string>();
  for (const match of html.matchAll(STOREFRONT_LINK)) {
    const sub = match[1]?.toLowerCase();
    if (sub && sub !== "www") subs.add(sub);
  }
  return [...subs].sort().map((sub) => `https://${sub}.tcgplayerpro.com`);
}

/** Same-site links that look like they lead to the store's shop pages. */
export function shopPageLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const links: string[] = [];
  for (const match of html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const [, href = "", text = ""] = match;
    if (!SHOP_LINK_HINT.test(href) && !SHOP_LINK_HINT.test(text.replace(/<[^>]+>/g, ""))) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname || !/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    if (url.href !== base.href && !links.includes(url.href)) links.push(url.href);
    if (links.length >= MAX_EXTRA_PAGES) break;
  }
  return links;
}

/**
 * Whether robots.txt lets our crawler fetch `path`. Uses the most specific
 * matching user-agent group and the longest matching Allow/Disallow rule.
 */
export function robotsAllows(robotsTxt: string, path: string, agent = ROBOTS_AGENT): boolean {
  interface Group {
    agents: string[];
    rules: { allow: boolean; prefix: string }[];
  }
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", prefix: value.replace(/\*$/, "") });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const name = agent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && name.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; prefix: string } | undefined;
  for (const rule of group.rules) {
    if (path.startsWith(rule.prefix) && (!best || rule.prefix.length > best.prefix.length)) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

/** Normalize a store's website to an http(s) origin we may crawl, or null. */
export function websiteOrigin(website: string | null | undefined): string | null {
  const value = website?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol) || isGenericHost(url.hostname)) return null;
    if (url.hostname.endsWith(".tcgplayerpro.com")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, fetchFn: FetchFn): Promise<string | null> {
  try {
    const res = await fetchFn(url, { headers: { Accept: "text/html" }, redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const text = await res.text();
    return text.length > MAX_HTML_BYTES ? text.slice(0, MAX_HTML_BYTES) : text;
  } catch {
    return null;
  }
}

export interface HomepageScan {
  /** Storefront origins linked from the store's site. */
  storefronts: string[];
  /** Origins that might be a storefront on a custom domain (the site itself, shop.{domain}). */
  customDomainCandidates: string[];
  robotsBlocked: boolean;
}

/** Look for TCGplayer Pro storefront links on a store's homepage and a few shop pages. */
export async function scanHomepage(
  website: string | null | undefined,
  fetchFn: FetchFn,
): Promise<HomepageScan> {
  const origin = websiteOrigin(website);
  const result: HomepageScan = {
    storefronts: [],
    customDomainCandidates: [],
    robotsBlocked: false,
  };
  if (!origin) return result;
  const host = new URL(origin).hostname.replace(/^www\./, "");
  result.customDomainCandidates = [origin, `https://shop.${host}`];

  let robots = "";
  try {
    const res = await fetchFn(`${origin}/robots.txt`);
    if (res.ok) robots = await res.text();
  } catch {
    // No robots.txt reachable: treat as allowed.
  }
  if (!robotsAllows(robots, "/")) {
    result.robotsBlocked = true;
    return result;
  }

  const homepage = await fetchHtml(origin, fetchFn);
  if (!homepage) return result;
  const found = new Set(extractStorefrontLinks(homepage));
  if (found.size === 0) {
    for (const page of shopPageLinks(homepage, origin)) {
      if (!robotsAllows(robots, new URL(page).pathname)) continue;
      const html = await fetchHtml(page, fetchFn);
      if (html) extractStorefrontLinks(html).forEach((u) => found.add(u));
      if (found.size) break;
    }
  }
  result.storefronts = [...found];
  return result;
}
