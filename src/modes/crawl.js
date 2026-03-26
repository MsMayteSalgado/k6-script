import http from "k6/http";
import { check, sleep } from "k6";
import { CFG } from "../config.js";
import { USER_AGENTS } from "../data.js";
import { buildHeaders, baseOrigin, randomItem, isAllowedStatus, extractUrls, normalizeUrl, classifyUrl, getAdaptiveThinkTime } from "../utils.js";
import { serverErrors, failedRequests, rateLimited, crawlDepth } from "../metrics.js";
import { getSession, resetSession, dequeue, enqueue } from "../session.js";

/**
 * Crawl mode — mimics realistic browser behaviour.
 * Each VU maintains a URL queue seeded from the root page.
 * Discovers links, batches asset fetches, prioritises API endpoints.
 * Works with HTML sites, SPAs (static routes), and hybrid apps.
 */
export function runCrawl({ token, spoofedIp }) {
    const session = getSession();
    const profile = session.profile;  // persistent identity for this session
    const origin = baseOrigin(CFG.targetUrl);

    // attach a persistent session cookie
    http.cookieJar().set(origin, "session_id", session.id, { path: "/" });

    let success = true;
    let pagesVisited = 0;

    for (let step = 0; step < CFG.maxPagesPerVu; step++) {
        const target = dequeue(session);
        if (!target) break;
        if (session.visited[target.url]) continue;

        const referer = step === 0 ? session.referer : session.lastUrl;
        const headers = buildHeaders(profile, referer, target.kind, token, spoofedIp);
        const isAsset = target.kind === "asset";

        const res = http.get(target.url, {
            headers,
            responseType: isAsset ? "none" : "text",
            tags: { type: target.kind },
        });

        session.visited[target.url] = true;
        session.lastUrl = target.url;
        session.lastStatus = res.status;  // track for adaptive think time
        pagesVisited++;

        rateLimited.add(res.status === 429);
        serverErrors.add(res.status >= 500);

        const ok = check(res, {
            "allowed status": r => isAllowedStatus(r.status),
            "no server error": r => r.status < 500,
            "within p95": r => r.status === 429 || r.timings.duration < CFG.maxP95Ms,
        });
        if (!ok) success = false;

        if (res.status === 429) { sleep(getAdaptiveThinkTime(429)); continue; }

        // discover links and batch-fetch assets
        if (!isAsset && res.body) {
            const ct = (res.headers["Content-Type"] || "").toLowerCase();
            const discovered = extractUrls(res.body, ct);
            const assets = [];

            discovered.forEach(candidate => {
                const norm = normalizeUrl(candidate, target.url, origin);
                if (!norm) return;
                const kind = classifyUrl(norm);
                enqueue(session, norm, kind);
                if (kind === "asset") assets.push(norm);
            });

            // batch-fetch the first N assets in a single HTTP batch call
            const batch = assets.slice(0, CFG.batchSize).map(assetUrl => [
                "GET", assetUrl, null,
                {
                    headers: buildHeaders(profile, target.url, "asset", token, spoofedIp),
                    tags: { type: "asset" },
                    responseType: "none",
                },
            ]);

            if (batch.length) {
                const batchRes = http.batch(batch);
                batchRes.forEach(r => {
                    rateLimited.add(r.status === 429);
                    serverErrors.add(r.status >= 500);
                });
                if (!check(batchRes, { "assets ok": arr => arr.every(r => isAllowedStatus(r.status)) })) {
                    success = false;
                }
            }
        }
    }

    crawlDepth.add(pagesVisited);
    failedRequests.add(!success);

    // cap memory: reset session once the visited map is saturated
    if (Object.keys(session.visited).length >= CFG.maxQueueSize) {
        resetSession();
    }
}
