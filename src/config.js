export const CFG = {
    // Core
    targetUrl: __ENV.TARGET_URL || "http://localhost:3000/",
    testMode: (__ENV.TEST_MODE || "crawl").toLowerCase(),   // crawl | api | smoke

    // Duration / Scaling
    startVUs: Number(__ENV.START_VUS) || 5,
    peakVUs: Number(__ENV.PEAK_VUS) || 40,
    endVUs: Number(__ENV.END_VUS) || 5,
    rampUp: __ENV.RAMP_UP || "1m",
    steady: __ENV.STEADY || "3m",
    rampDown: __ENV.RAMP_DOWN || "1m",
    targetRps: Number(__ENV.TARGET_RPS) || 0,
    targetIterations: Number(__ENV.TARGET_ITERATIONS) || 0,

    // RPS mode (overrides VU ramp when set > 0)
    preAllocVUs: Number(__ENV.PREALLOCATED_VUS) || 0,
    maxVUs: Number(__ENV.MAX_VUS) || 0,

    // Crawl-specific
    batchSize: Math.max(1, Number(__ENV.BATCH_SIZE) || 6),
    maxPagesPerVu: Math.max(1, Number(__ENV.MAX_PAGES_PER_VU) || 8),
    maxDiscoveryPerPage: Math.max(5, Number(__ENV.MAX_DISCOVERY_PER_PAGE) || 30),
    maxQueueSize: Math.max(20, Number(__ENV.MAX_QUEUE_SIZE) || 200),
    apiPickRatio: Math.min(1, Math.max(0, Number(__ENV.API_PICK_RATIO) || 0.35)),

    // Think time
    minThinkTime: Number(__ENV.MIN_THINK_TIME) || 0.5,
    thinkJitter: Number(__ENV.THINK_JITTER) || 1.5,

    // Auth (optional — leave empty to skip)
    authUrl: __ENV.AUTH_URL || "",  // e.g. https://myapp.com/api/auth/login
    authBody: __ENV.AUTH_BODY || "",  // e.g. {"email":"test@x.com","password":"secret"}
    authTokenPath: __ENV.AUTH_TOKEN_PATH || "token",   // dot-notation: "data.accessToken"
    authHeader: __ENV.AUTH_HEADER || "Authorization",
    authScheme: __ENV.AUTH_SCHEME || "Bearer ",  // include trailing space; use "" for API keys

    // API mode — JSON array of endpoint definitions (see README)
    endpointsJson: __ENV.ENDPOINTS_JSON || "",

    // Thresholds (override via env vars in CI)
    maxErrorRate: Number(__ENV.MAX_ERROR_RATE) || 0.05,  // 5%
    maxServerErrorRate: Number(__ENV.MAX_SERVER_ERROR_RATE) || 0.02, // 2%
    maxP95Ms: Number(__ENV.MAX_P95_MS) || 1500,

    // Breakpoint testing
    isBreakpoint: (__ENV.BREAKPOINT || "false") === "true",

    // Rate-limiting assertions
    expect429: (__ENV.EXPECT_429 || "false") === "true",
    min429Rate: Number(__ENV.MIN_429_RATE) || 0.01,

    // Traffic simulation options
    spoofIp: (__ENV.SPOOF_IP || "false") === "true",
};

// Derived values
const _preAlloc = CFG.preAllocVUs || Math.max(CFG.peakVUs, 1);
const _maxVUs = CFG.maxVUs || Math.max(_preAlloc * 2, CFG.peakVUs);

// Thresholds
const thresholds = {
    failed_requests: [{ threshold: `rate<${CFG.maxErrorRate}`, abortOnFail: CFG.isBreakpoint }],
    server_errors: [{ threshold: `rate<${CFG.maxServerErrorRate}`, abortOnFail: CFG.isBreakpoint }],
    http_req_duration: [{ threshold: `p(95)<${CFG.maxP95Ms}`, abortOnFail: CFG.isBreakpoint }],
    http_req_failed: [{ threshold: `rate<${CFG.maxErrorRate}`, abortOnFail: CFG.isBreakpoint }],
};
if (CFG.expect429) {
    thresholds.rate_limited = [`rate>${CFG.min429Rate}`];
}

// Options export
export const options = {
    discardResponseBodies: false,
    noConnectionReuse: false,
    batchPerHost: 6,
    scenarios: {
        load: CFG.targetIterations > 0
            ? {
                executor: "shared-iterations",
                vus: CFG.peakVUs,
                iterations: CFG.targetIterations,
                maxDuration: "24h", // large cap; test will end as soon as iterations hit 0
            }
            : CFG.targetRps > 0
            ? {
                executor: "constant-arrival-rate",
                rate: CFG.targetRps,
                timeUnit: "1s",
                duration: CFG.steady,
                preAllocatedVUs: _preAlloc,
                maxVUs: _maxVUs,
            }
            : {
                executor: "ramping-vus",
                startVUs: CFG.startVUs,
                gracefulRampDown: "30s",
                stages: [
                    { duration: CFG.rampUp, target: CFG.peakVUs },
                    { duration: CFG.steady, target: CFG.peakVUs },
                    { duration: CFG.rampDown, target: CFG.endVUs },
                ],
            },
    },
    thresholds,
};
