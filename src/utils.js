import { CFG } from "./config.js";
import { BROWSER_PROFILES } from "./data.js";

export function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick a random, fully consistent browser identity profile.
 * Returns the same profile for the entire call — callers should store it
 * per-VU so all requests in a session share the same identity.
 */
export function pickBrowserProfile() {
    return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

/**
 * Adaptive think time — increases sleep duration when the server
 * is rate-limiting (429) to back off naturally, mimicking a real user.
 * @param {number} lastStatus - HTTP status from the last response
 */
export function getAdaptiveThinkTime(lastStatus) {
    const base = CFG.minThinkTime + Math.random() * CFG.thinkJitter;
    if (lastStatus === 429) return base * 3 + Math.random() * 2; // triple delay on 429
    if (lastStatus >= 500) return base * 1.5;                    // slow down on server errors
    return base;
}

export function baseOrigin(url) {
  const match = url.match(/^https?:\/\/[^\/]+/);
  return match ? match[0] : url;
}

/**
 * Walk a dot-notation path through an object.
 * e.g. getNestedValue({data:{token:"abc"}}, "data.token") => "abc"
 */
export function getNestedValue(obj, path) {
    return path.split(".").reduce((o, k) => (o != null && o[k] !== undefined ? o[k] : null), obj);
}

export function normalizeUrl(candidate, base, origin) {
    if (!candidate) return null;
    // skip non-HTTP schemes
    if (/^(mailto:|tel:|javascript:|#)/i.test(candidate)) return null;
    try {
        const u = new URL(candidate, base);
        if (u.origin !== origin) return null;
        u.hash = "";
        return u.toString();
    } catch (e) {
        return null;
    }
}

export function isApiUrl(url) {
    const p = new URL(url).pathname.toLowerCase();
    return (
        p.includes("/api/") ||
        p.startsWith("/graphql") ||
        p.startsWith("/v1/") ||
        p.startsWith("/v2/") ||
        p.startsWith("/v3/") ||
        p.startsWith("/rest/") ||
        p.startsWith("/rpc/") ||
        p.endsWith(".json")
    );
}

export function isAssetUrl(url) {
    return /\.(css|js|mjs|png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|map|xml|txt|pdf)$/i
        .test(new URL(url).pathname);
}

export function classifyUrl(url) {
    if (isAssetUrl(url)) return "asset";
    if (isApiUrl(url)) return "api";
    return "page";
}

export function isAllowedStatus(s) {
    return s === 200 || s === 201 || s === 204 ||
        s === 301 || s === 302 || s === 304 ||
        s === 429;
}

// ─── URL extraction ───────────────────────────────────────────────────────────
export function extractUrls(body, contentType) {
    const urls = [];
    const limit = CFG.maxDiscoveryPerPage;

    if (contentType.includes("text/html")) {
        // standard attributes
        const reAttr = /(?:href|src|action|data-href|data-src)=["']([^"']+)["']/gi;
        let m;
        while ((m = reAttr.exec(body)) !== null && urls.length < limit) {
            urls.push(m[1]);
        }

        // srcset (each descriptor is "url [width/density]")
        const reSrcset = /srcset=["']([^"']+)["']/gi;
        while ((m = reSrcset.exec(body)) !== null && urls.length < limit) {
            m[1].split(",").forEach(part => {
                const u = part.trim().split(/\s+/)[0];
                if (u) urls.push(u);
            });
        }

        // <meta http-equiv="refresh"> redirect targets
        const reMeta = /content=["'][^"']*url=([^"';\s]+)/gi;
        while ((m = reMeta.exec(body)) !== null && urls.length < limit) {
            urls.push(m[1]);
        }
    } else if (
        contentType.includes("application/json") ||
        contentType.includes("text/plain")
    ) {
        const reUrl = /(https?:\/\/[^\s"'<>]+|\/[A-Za-z0-9._~!$&'()*+,;=:@/?#%-]{2,})/g;
        let m;
        while ((m = reUrl.exec(body)) !== null && urls.length < limit) {
            urls.push(m[1]);
        }
    }

    return urls;
}

// ─── Headers builder ──────────────────────────────────────────────────────────
/**
 * @param {object|string} profile - Full BROWSER_PROFILES entry OR a plain UA string (legacy)
 * @param {string} referer
 * @param {string} kind - 'page' | 'api' | 'asset'
 * @param {string|null} token
 * @param {string|null} spoofedIp
 */
export function buildHeaders(profile, referer, kind, token, spoofedIp) {
    // Support legacy callers that pass a plain UA string
    const ua = typeof profile === "string" ? profile : profile.ua;
    const hints = typeof profile === "object" ? (profile.hints || {}) : {};
    const lang = typeof profile === "object" ? (profile.languages || "en-US,en;q=0.9") : "en-US,en;q=0.9";

    const h = { "User-Agent": ua, "Accept-Language": lang };

    // Inject all matched client hints (Sec-CH-UA, Sec-CH-UA-Mobile, etc.)
    Object.assign(h, hints);

    if (referer) h["Referer"] = referer;
    if (token) h[CFG.authHeader] = `${CFG.authScheme}${token}`;

    if (CFG.spoofIp && spoofedIp) {
        h["X-Forwarded-For"] = spoofedIp;
        h["X-Real-IP"] = spoofedIp;
        h["CF-Connecting-IP"] = spoofedIp;
        h["True-Client-IP"] = spoofedIp;
    } else if (CFG.spoofIp) {
        // Fallback to random if ipify failed
        const randomIp = () => Math.floor(Math.random() * 255) + 1;
        const ip = `${randomIp()}.${randomIp()}.${randomIp()}.${randomIp()}`;
        h["X-Forwarded-For"] = ip;
        h["X-Real-IP"] = ip;
        h["CF-Connecting-IP"] = ip;
        h["True-Client-IP"] = ip;
    }

    switch (kind) {
        case "asset":
            h["Accept"] = "*/*";
            h["Sec-Fetch-Site"] = "same-origin";
            h["Sec-Fetch-Mode"] = "no-cors";
            h["Sec-Fetch-Dest"] = "empty";
            break;
        case "api":
            h["Accept"] = "application/json, text/plain, */*";
            h["Sec-Fetch-Site"] = "same-origin";
            h["Sec-Fetch-Mode"] = "cors";
            h["Sec-Fetch-Dest"] = "empty";
            break;
        default: // page
            h["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
            h["Upgrade-Insecure-Requests"] = "1";
            h["Sec-Fetch-Site"] = referer ? "same-origin" : "none";
            h["Sec-Fetch-Mode"] = "navigate";
            h["Sec-Fetch-Dest"] = "document";
    }

    return h;
}

