import http from "k6/http";
import { check } from "k6";
import { CFG } from "../config.js";
import { USER_AGENTS } from "../data.js";
import { buildHeaders, randomItem } from "../utils.js";
import { serverErrors, failedRequests } from "../metrics.js";

/**
 * Smoke test — single GET of the root URL, strict checks.
 * Use for quick sanity checks before heavier runs.
 * Set START_VUS=1 PEAK_VUS=1 STEADY=30s for a true smoke run.
 */
export function runSmoke({ token, spoofedIp }) {
    const ua = randomItem(USER_AGENTS);
    const res = http.get(CFG.targetUrl, {
        headers: buildHeaders(ua, "", "page", token, spoofedIp),
        tags: { type: "smoke" },
    });

    serverErrors.add(res.status >= 500);
    failedRequests.add(!check(res, {
        "smoke — status 200": r => r.status === 200,
        "smoke — p95 threshold": r => r.timings.duration < CFG.maxP95Ms,
        "smoke — body not empty": r => (r.body || "").length > 0,
    }));
}
