import http from "k6/http";
import { CFG } from "./config.js";
import { USER_AGENTS } from "./data.js";
import { getNestedValue } from "./utils.js";
import { authFailures } from "./metrics.js";

/**
 * Runs once before the test begins.
 * Returns { token } which is passed as `data` to every VU iteration.
 * Leave AUTH_URL empty to skip.
 */
export function setup() {
    let token = null;

    if (CFG.authUrl) {
        const res = http.post(CFG.authUrl, CFG.authBody, {
            headers: { "Content-Type": "application/json", "User-Agent": USER_AGENTS[0] },
            tags: { type: "auth" },
        });

        if (res.status !== 200 && res.status !== 201) {
            console.warn(`[auth] Failed — HTTP ${res.status}: ${res.body}`);
            authFailures.add(1);
        } else {
            try {
                token = getNestedValue(JSON.parse(res.body), CFG.authTokenPath);
            } catch (e) {
                console.warn(`[auth] Could not parse token from response: ${e}`);
            }
        }
    }

    if (!token && CFG.authUrl) {
        console.warn(`[auth] Token path "${CFG.authTokenPath}" returned null`);
        authFailures.add(1);
    } else if (CFG.authUrl) {
        console.log(`[auth] Token acquired successfully`);
    }

    let ip = null;
    if (CFG.spoofIp) {
        const ipRes = http.get("https://api.ipify.org?format=json");
        if (ipRes.status === 200) {
            try {
                ip = JSON.parse(ipRes.body).ip;
                console.log(`[spoof] Fetched real public IP: ${ip}`);
            } catch (e) {
                console.warn(`[spoof] Failed to parse IP response: ${e}`);
            }
        } else {
            console.warn(`[spoof] Failed to fetch IP from ipify: ${ipRes.status}`);
        }
    }

    return { token, spoofedIp: ip };
}
