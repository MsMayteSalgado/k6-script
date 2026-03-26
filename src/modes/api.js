import http from "k6/http";
import { check, sleep } from "k6";
import { CFG } from "../config.js";
import { USER_AGENTS } from "../data.js";
import { buildHeaders, baseOrigin, randomItem, isAllowedStatus } from "../utils.js";
import { serverErrors, failedRequests, rateLimited } from "../metrics.js";

/**
 * API mode — weighted random selection from ENDPOINTS_JSON.
 *
 * ENDPOINTS_JSON format (JSON array):
 * [
 *   { "name": "list users",  "url": "/api/users",          "method": "GET",  "weight": 0.5 },
 *   { "name": "create order","url": "/api/orders",         "method": "POST",
 *     "body": "{\"items\":[1,2]}", "headers": {"X-Source":"test"}, "weight": 0.3 },
 *   { "name": "health",      "url": "/health",             "method": "GET",  "weight": 0.2 }
 * ]
 *
 * If omitted, falls back to a single GET of TARGET_URL.
 */
let _parsedEndpoints = null;

function getEndpoints() {
    if (_parsedEndpoints) return _parsedEndpoints;

    if (!CFG.endpointsJson) {
        _parsedEndpoints = [{ name: "root", url: CFG.targetUrl, method: "GET", weight: 1 }];
        return _parsedEndpoints;
    }

    try {
        const raw = JSON.parse(CFG.endpointsJson);
        const total = raw.reduce((s, e) => s + (e.weight || 1), 0);
        _parsedEndpoints = raw.map(e => ({
            ...e,
            weight: (e.weight || 1) / total,
        }));
    } catch (e) {
        console.warn(`[api] ENDPOINTS_JSON parse error: ${e} — falling back to root URL`);
        _parsedEndpoints = [{ name: "root", url: CFG.targetUrl, method: "GET", weight: 1 }];
    }

    return _parsedEndpoints;
}

function pickEndpoint() {
    const eps = getEndpoints();
    let r = Math.random();
    for (const ep of eps) {
        r -= ep.weight;
        if (r <= 0) return ep;
    }
    return eps[eps.length - 1];
}

export function runApi({ token, spoofedIp }) {
    const ep = pickEndpoint();
    const origin = baseOrigin(CFG.targetUrl);
    const url = ep.url.startsWith("http") ? ep.url : `${origin}${ep.url}`;
    const method = (ep.method || "GET").toUpperCase();
    const ua = randomItem(USER_AGENTS);

    const headers = {
        ...buildHeaders(ua, CFG.targetUrl, "api", token, spoofedIp),
        ...(ep.headers || {}),
    };

    let body = null;
    if (ep.body) {
        body = typeof ep.body === "string" ? ep.body : JSON.stringify(ep.body);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }

    const res = http.request(method, url, body, {
        headers,
        tags: { type: "api", name: ep.name || ep.url },
    });

    rateLimited.add(res.status === 429);
    serverErrors.add(res.status >= 500);

    failedRequests.add(!check(res, {
        "api — allowed status": r => isAllowedStatus(r.status),
        "api — no server error": r => r.status < 500,
        "api — within p95": r => r.status === 429 || r.timings.duration < CFG.maxP95Ms,
    }));

    if (res.status === 429) sleep(1 + Math.random());
}
