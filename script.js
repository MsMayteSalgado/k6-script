/**
 * Universal k6 Load Test Script
 * Supports: crawl | api | smoke modes
 * Works with any tech stack: Node/Express, PHP/Laravel, Django, Rails, Go, static sites, etc.
 *
 * See README.md for full usage and examples.
 */

import { sleep } from "k6";
import { CFG, options } from "./src/config.js";
import { setup } from "./src/auth.js";
import { runSmoke } from "./src/modes/smoke.js";
import { runApi } from "./src/modes/api.js";
import { runCrawl } from "./src/modes/crawl.js";

// Export options so k6 can pick them up
export { options };

// ─── AUTH setup ───────────────────────────────────────────────────────────────
export { setup };

// ─── Main entry ───────────────────────────────────────────────────────────────
export default function (data) {
    const passData = {
        token: (data && data.token) || null,
        spoofedIp: (data && data.spoofedIp) || null,
    };

    switch (CFG.testMode) {
        case "api": runApi(passData); break;
        case "smoke": runSmoke(passData); break;
        default: runCrawl(passData);
    }

    // only sleep when not in RPS-controlled mode
    if (CFG.targetRps === 0) {
        sleep(CFG.minThinkTime + Math.random() * CFG.thinkJitter);
    }
}

// ─── Summary export ───────────────────────────────────────────────────────────
/**
 * Writes summary.json to the working directory after the test.
 * GitHub Actions uploads this as an artifact (see main.yml).
 */
export function handleSummary(data) {
    const m = data.metrics || {};

    const fmt = (metric, path) => {
        const v = m[metric];
        if (!v) return "n/a";
        const val = path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), v.values);
        return val !== null ? (typeof val === "number" ? val.toFixed(2) : String(val)) : "n/a";
    };

    const lines = [
        "═══════════════════════════════════════════",
        "  k6 Load Test — Summary",
        "═══════════════════════════════════════════",
        `  Mode          : ${CFG.testMode}`,
        `  Target        : ${CFG.targetUrl}`,
        `  VUs (peak)    : ${CFG.peakVUs}`,
        `  Total requests: ${fmt("http_reqs", "count")}`,
        `  RPS (avg)     : ${fmt("http_reqs", "rate")}`,
        `  Failed reqs   : ${fmt("failed_requests", "rate")}`,
        `  Server errors : ${fmt("server_errors", "rate")}`,
        `  Rate limited  : ${fmt("rate_limited", "rate")}`,
        `  p(50) latency : ${fmt("http_req_duration", "p(50)")} ms`,
        `  p(95) latency : ${fmt("http_req_duration", "p(95)")} ms`,
        `  p(99) latency : ${fmt("http_req_duration", "p(99)")} ms`,
        "═══════════════════════════════════════════",
    ];

    return {
        "summary.json": JSON.stringify(data, null, 2),
        stdout: lines.join("\n") + "\n",
    };
}