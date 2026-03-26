# k6 Distributed Load Test

A **zero-infrastructure load testing tool** that runs entirely on GitHub Actions' free compute. No paid k6 Cloud, no AWS, no servers to manage. Trigger a test from a GitHub button, get results back as downloadable artifacts.

Works with any backend: **Node/Express, PHP/Laravel, Python/Django, Ruby on Rails, Go, static sites, REST APIs, GraphQL** — anything that responds over HTTP.

---

## Quick start

1. Copy `script.js` and `.github/workflows/main.yml` into your repository (keeping the directory structure).
2. Go to **Actions → k6 Distributed Load Test → Run workflow**.
3. Fill in your `target_url`, pick a `test_mode`, and hit **Run workflow**.
4. When it finishes, download the `k6-results-*` artifact from the job summary. It contains `summary.json` with full metrics.

That's it. No configuration files, no accounts, no billing.

---

## Test modes

### `crawl` (default)

Mimics realistic browser behaviour. Each virtual user (VU) starts at your root URL, reads the HTML, discovers links, queues them, and keeps browsing — prioritising API endpoints when it finds them. It also batches asset fetches (CSS, JS, images) the way a browser would.

**Best for:** websites, server-rendered apps (Laravel, Django, Rails), hybrid apps, e-commerce sites.

### `api`

Pure API endpoint hammering. You define a list of endpoints with HTTP methods, request bodies, and weights. The tool picks endpoints randomly according to those weights, simulating realistic traffic distribution.

**Best for:** REST APIs, GraphQL, microservices, headless backends.

### `smoke`

One VU, strict checks, short duration. Verifies your app responds with HTTP 200, returns a non-empty body, and is within your latency threshold. Use this before every deployment.

**Best for:** pre-deployment sanity checks, CI gate tests.

---

## Finding Your Breaking Point (Stress/Breakpoint Testing)

If you want to find precisely how much traffic it takes to crash your application or severely degrade its performance, you can use **Breakpoint Testing**.

1. Enable the `BREAKPOINT=true` flag. This configures k6 to instantly abort the test when error or latency thresholds are breached.
2. Set a very high `PEAK_VUS` (e.g., 2000) and a long `RAMP_UP` duration (e.g., `20m` or `30m`).

```bash
k6 run \
  -e TEST_MODE=crawl \
  -e TARGET_URL=https://mywebsite.com/ \
  -e BREAKPOINT=true \
  -e PEAK_VUS=2000 \
  -e RAMP_UP=20m \
  script.js
```

The load will gradually increase. The moment your server stops responding fast enough or starts throwing errors, the test will automatically halt. Look at the final active VU count in the summary output—that is your application's absolute limit.

---

## Testing Rate Limiting Behavior

When sending heavy traffic, Web Application Firewalls (WAF) like Cloudflare, AWS WAF, or Nginx often limit traffic from a single IP. To realistically simulate distributed traffic, there are a few methods you can employ.

### 1. Header Spoofing (Free / Simple)
Many basic load balancers determine the client's IP from HTTP headers. You can enable automatic Header Spoofing.

```bash
k6 run -e SPOOF_IP=true script.js
```
When `SPOOF_IP=true` is set, the script will automatically query `https://api.ipify.org` during initialization to find the exact public IP address of the worker executing the test. It then injects this true public IP into the following headers on *every single request*:
- `X-Forwarded-For`
- `X-Real-IP`
- `CF-Connecting-IP`
- `True-Client-IP`

*Note: This ensures intermediate proxies see your authentic routing IP in these headers rather than the internal Docker/Runner IP. Strict WAFs usually ignore these headers if traffic isn't originating from a trusted proxy, but it works to simulate external users on basic Nginx/Apache configurations.*

### 2. Distributed Execution via GitHub Actions (Free / Advanced)
The absolute best way to simulate realistic distributed traffic is to launch the test from **dozens of different IP addresses simultaneously**. 

Because this script uses GitHub Actions matrix strategies, you can scale the test horizontally across multiple GitHub virtual machines—each of which gets its own unique, fresh Microsoft Azure IP address.

To do this, update your workflow inputs to use multiple regions/instances:
```text
regions:   region-1,region-2,region-3
instances: 1,2,3,4
```

This matrix (3x4) will spin up **12 completely isolated GitHub runners**, all sending traffic to the target URL at exactly the same time from 12 different IP addresses. 

### 3. Using HTTPS Proxies ( k6 built-in)
If you have a pool of rotating residential proxies, you can natively pass them to k6 via the `HTTPS_PROXY` environment variable. k6 will route all traffic through the proxy.

```bash
HTTPS_PROXY="http://username:password@proxy.example.com:8080" k6 run script.js
```

---

## All workflow inputs

| Input | Default | Description |
|---|---|---|
| `test_mode` | `crawl` | `crawl`, `api`, or `smoke` |
| `target_url` | `https://example.com/` | Your application URL |
| `start_vus` | `5` | VUs at the start of ramp-up |
| `peak_vus` | `40` | VUs at peak (per runner) |
| `end_vus` | `5` | VUs at end of ramp-down |
| `ramp_up` | `1m` | Duration of ramp-up |
| `steady` | `3m` | Duration of peak load |
| `ramp_down` | `1m` | Duration of ramp-down |
| `target_total_rps` | `0` | Cap total RPS across all runners (0 = off) |
| `batch_size` | `6` | Max assets fetched in one batch (crawl mode) |
| `max_pages_per_vu` | `8` | Pages visited per VU iteration |
| `max_discovery_per_page` | `30` | Max links parsed per response |
| `max_queue_size` | `200` | Max URL queue per VU |
| `api_pick_ratio` | `0.35` | Chance to prioritise an API URL from queue |
| `endpoints_json` | _(empty)_ | JSON array of API endpoints (api mode) |
| `auth_url` | _(empty)_ | Auth login endpoint (leave empty to skip) |
| `auth_body` | _(empty)_ | Auth POST body as JSON string |
| `auth_token_path` | `token` | Dot-path to extract token from auth response |
| `auth_header` | `Authorization` | Header name to send token in |
| `auth_scheme` | `Bearer ` | Prefix before the token value |
| `max_error_rate` | `0.05` | Test fails if error rate exceeds this |
| `max_server_error_rate` | `0.02` | Test fails if 5xx rate exceeds this |
| `max_p95_ms` | `1500` | Test fails if p(95) latency exceeds this (ms) |
| `expect_429` | `false` | Test fails if rate-limiting is NOT observed |
| `min_429_rate` | `0.01` | Minimum 429 rate when `expect_429=true` |
| `regions` | `region-1` | Comma-separated region labels (for matrix) |
| `instances` | `1` | Comma-separated instance IDs (for matrix) |
| `k6_version` | `v0.51.0` | k6 binary version to install |

---

## Stack-specific examples

### Node.js / Express

```
test_mode:  crawl
target_url: https://myapp.com/
peak_vus:   50
steady:     5m
```

If you have an API at `/api/`:

```
test_mode:       api
target_url:      https://myapp.com/
endpoints_json:  [
  {"name":"users",    "url":"/api/users",       "method":"GET",  "weight":0.5},
  {"name":"products", "url":"/api/products",    "method":"GET",  "weight":0.3},
  {"name":"health",   "url":"/api/health",      "method":"GET",  "weight":0.2}
]
```

### PHP / Laravel

```
test_mode:  crawl
target_url: https://mylaravel.com/
peak_vus:   30
steady:     3m
```

Testing a Laravel API with Sanctum token auth:

```
test_mode:       api
target_url:      https://mylaravel.com/
auth_url:        https://mylaravel.com/api/login
auth_body:       {"email":"load@test.com","password":"secret"}
auth_token_path: token
endpoints_json:  [
  {"name":"menu",   "url":"/api/menu",   "method":"GET", "weight":0.7},
  {"name":"orders", "url":"/api/orders", "method":"GET", "weight":0.3}
]
```

### Python / Django or FastAPI

```
test_mode:       api
target_url:      https://myapi.com/
auth_url:        https://myapi.com/api/token/
auth_body:       {"username":"testuser","password":"testpass"}
auth_token_path: access
auth_scheme:     Bearer 
endpoints_json:  [
  {"name":"list", "url":"/api/items/",       "method":"GET",  "weight":0.6},
  {"name":"get",  "url":"/api/items/1/",     "method":"GET",  "weight":0.3},
  {"name":"post", "url":"/api/items/",       "method":"POST",
   "body":"{\"name\":\"test\",\"price\":10}", "weight":0.1}
]
```

### Ruby on Rails

```
test_mode:  crawl
target_url: https://myrailsapp.com/
peak_vus:   25
steady:     4m
```

### Go (any HTTP framework)

```
test_mode:  api
target_url: https://mygoservice.com/
peak_vus:   100
steady:     5m
endpoints_json: [
  {"name":"health",   "url":"/health",      "method":"GET", "weight":0.1},
  {"name":"data",     "url":"/api/data",    "method":"GET", "weight":0.9}
]
max_p95_ms: 200
```

Go services tend to be fast — tighten `max_p95_ms` to catch regressions early.

### Static site / CDN

```
test_mode:             crawl
target_url:            https://mystaticsite.com/
peak_vus:              200
steady:                10m
max_discovery_per_page: 50
max_p95_ms:            300
```

Static sites can handle much higher VUs — push the numbers up to find where your CDN starts throttling.

### GraphQL

```
test_mode:       api
target_url:      https://myapp.com/
endpoints_json:  [
  {
    "name": "query",
    "url": "/graphql",
    "method": "POST",
    "headers": {"Content-Type": "application/json"},
    "body": "{\"query\":\"{ users { id name } }\"}",
    "weight": 0.7
  },
  {
    "name": "mutation",
    "url": "/graphql",
    "method": "POST",
    "headers": {"Content-Type": "application/json"},
    "body": "{\"query\":\"mutation { createSession { token } }\"}",
    "weight": 0.3
  }
]
```

---

## Auth examples

### JWT / Bearer token (most REST APIs)

```
auth_url:        https://myapp.com/api/auth/login
auth_body:       {"email":"test@example.com","password":"loadtest123"}
auth_token_path: token
auth_header:     Authorization
auth_scheme:     Bearer 
```

If your response nests the token (e.g. `{"data":{"accessToken":"abc"}}`):

```
auth_token_path: data.accessToken
```

### API key (no login step needed)

Leave `auth_url` empty and pass the key directly via a GitHub Actions secret:

In your workflow file, add an extra `-e` line in the **Run k6** step:
```yaml
-e AUTH_BODY=""
```

Then set `AUTH_HEADER` to `X-API-Key` and `AUTH_SCHEME` to `""` (empty), and pass your key as an environment secret. You would need a small wrapper or directly set the header in `ENDPOINTS_JSON` headers field:

```json
[{"name":"secure","url":"/api/data","method":"GET",
  "headers":{"X-API-Key":"your-key-here"},"weight":1}]
```

### Session cookie (classic web apps)

Many server-rendered apps (Laravel, Rails, Django) use cookie-based sessions. The crawl mode automatically maintains a `session_id` cookie per VU. If your app issues its own session cookie on login, set:

```
auth_url:        https://myapp.com/login
auth_body:       {"_token":"csrf","email":"test@x.com","password":"pw"}
auth_token_path: session
auth_header:     Cookie
auth_scheme:     session=
```

---

## Distributed testing

The matrix multiplies `regions × instances` to create parallel runners. To run 4 simultaneous runners:

```
regions:   region-1,region-2
instances: 1,2
```

This gives you a 2×2 matrix = 4 runners each independently hitting your target. GitHub Actions allows up to `max-parallel: 8` by default (configurable in the workflow file).

**Using `target_total_rps`:** When set, the workflow divides the total RPS evenly across all runners. For example, `target_total_rps=100` with 4 runners → each runner fires 25 RPS. This is the most reliable way to control total load.

---

## Reading results

After a run, download the `k6-results-{region}-{instance}` artifact. It contains:

**`summary.json`** — Full metrics dump including all percentiles, rates, and custom metrics.

Key fields to look at:

```json
{
  "metrics": {
    "http_req_duration": {
      "values": {
        "avg":   142.3,
        "p(50)": 98.1,
        "p(95)": 487.2,   ← most important
        "p(99)": 1201.5
      }
    },
    "http_reqs":      { "values": { "count": 18420, "rate": 61.4 } },
    "failed_requests":{ "values": { "rate": 0.012 } },  ← 1.2% failed
    "server_errors":  { "values": { "rate": 0.0 } },
    "rate_limited":   { "values": { "rate": 0.0 } },
    "crawl_depth":    { "values": { "avg": 6.2, "max": 8 } }
  }
}
```

**`results.json`** — Per-request time-series data. Useful for plotting latency over time in Grafana or a spreadsheet.

You also get a **live summary** directly in the GitHub Actions step log and the **Job Summary** tab of the workflow run.

---

## Thresholds (pass/fail)

The test exits with a non-zero code (failing the GitHub Actions job) if any threshold is breached:

| Metric | Default threshold | Override via |
|---|---|---|
| Error rate | < 5% | `max_error_rate` |
| 5xx rate | < 2% | `max_server_error_rate` |
| p(95) latency | < 1500ms | `max_p95_ms` |
| 429 rate | — | `expect_429` + `min_429_rate` |

Tighten these per-environment. A reasonable production gate:

```
max_error_rate:       0.01   (1%)
max_server_error_rate: 0.005 (0.5%)
max_p95_ms:           800
```

---

## Running locally (without GitHub Actions)

Install k6: https://k6.io/docs/get-started/installation/

```bash
# Smoke test
k6 run -e TEST_MODE=smoke -e TARGET_URL=http://localhost:3000/ script.js

# Crawl test — 10 VUs for 2 minutes
k6 run \
  -e TEST_MODE=crawl \
  -e TARGET_URL=http://localhost:3000/ \
  -e PEAK_VUS=10 \
  -e STEADY=2m \
  script.js

# API mode with auth
k6 run \
  -e TEST_MODE=api \
  -e TARGET_URL=http://localhost:3000/ \
  -e AUTH_URL=http://localhost:3000/api/login \
  -e AUTH_BODY='{"email":"test@x.com","password":"pw"}' \
  -e ENDPOINTS_JSON='[{"url":"/api/users","method":"GET","weight":1}]' \
  -e PEAK_VUS=5 \
  -e STEADY=1m \
  script.js
```

Results are written to `summary.json` and `results.json` in your current directory.

---

## Environment variables reference

All inputs available as env vars when running locally:

| Variable | Default | Notes |
|---|---|---|
| `TEST_MODE` | `crawl` | `crawl`, `api`, `smoke` |
| `TARGET_URL` | `http://localhost:3000/` | Must include trailing slash |
| `START_VUS` | `5` | |
| `PEAK_VUS` | `50` | |
| `END_VUS` | `5` | |
| `RAMP_UP` | `1m` | k6 duration string |
| `STEADY` | `3m` | |
| `RAMP_DOWN` | `1m` | |
| `TARGET_RPS` | `0` | Enables arrival-rate mode when > 0 |
| `PREALLOCATED_VUS` | auto | Used with TARGET_RPS |
| `MAX_VUS` | auto | Used with TARGET_RPS |
| `BATCH_SIZE` | `6` | |
| `MAX_PAGES_PER_VU` | `8` | |
| `MAX_DISCOVERY_PER_PAGE` | `30` | |
| `MAX_QUEUE_SIZE` | `200` | |
| `API_PICK_RATIO` | `0.35` | |
| `ENDPOINTS_JSON` | _(empty)_ | JSON string |
| `AUTH_URL` | _(empty)_ | |
| `AUTH_BODY` | _(empty)_ | JSON string |
| `AUTH_TOKEN_PATH` | `token` | Dot notation |
| `AUTH_HEADER` | `Authorization` | |
| `AUTH_SCHEME` | `Bearer ` | Include trailing space |
| `MAX_ERROR_RATE` | `0.05` | |
| `MAX_SERVER_ERROR_RATE` | `0.02` | |
| `MAX_P95_MS` | `1500` | |
| `EXPECT_429` | `false` | |
| `MIN_429_RATE` | `0.01` | |
| `BREAKPOINT` | `false` | Set true to stop test instantly on fail |
| `SPOOF_IP` | `false` | Set true to generate random IP headers |
| `MIN_THINK_TIME` | `0.5` | Seconds |
| `THINK_JITTER` | `1.5` | Random add-on (seconds) |

---

## Architecture & File Structure

The k6 load test script has been refactored into a modular architecture to improve maintainability for both human developers and AI assistants.

### Directory Layout

```text
your-repo/
├── script.js                      ← Main k6 test entry point (router)
├── src/                           ← Core logic modules
│   ├── config.js                  ← Environment variable parsing and k6 options/thresholds
│   ├── metrics.js                 ← Custom k6 Metrics (Rates, Trends, Counters)
│   ├── data.js                    ← Static robust constants (User Agents, Referral sources)
│   ├── utils.js                   ← Helper functions (URL extraction, header building)
│   ├── session.js                 ← VU (Virtual User) queue and session management for crawler
│   ├── auth.js                    ← Authentication setup phase (token acquisition)
│   └── modes/                     ← Execution mode strategies
│       ├── smoke.js               ← Single validation GET request logic
│       ├── api.js                 ← Weighted API endpoint pounding logic
│       └── crawl.js               ← Stateful web crawler logic
├── .github/
│   └── workflows/
│       └── main.yml               ← GitHub Actions workflow
└── README.md
```

### Module Responsibilities (Understanding the codebase)
For anyone maintaining or adding features to this codebase:
- **`script.js`**: Keeps `handleSummary` and acts as the entry point importing and routing to specific modes based on `CFG.testMode`.
- **`src/config.js`**: Centralizing configuration ensures you only add new `__ENV` variables here. It also dynamically builds the exported `options`.
- **`src/metrics.js`**: Isolate definitions of custom metrics so they don't clutter the execution logic.
- **`src/utils.js`**: Pure functions. If a function doesn't rely on VU state, it goes here.
- **`src/session.js`**: Manages state for the `crawl` mode. It keeps track of visited URLs, enqueuing, and dequeuing limits to prevent unbounded memory usage in long tests.
- **`src/auth.js`**: Contains the k6 `setup()` lifecycle hook. Runs exactly once before the test starts to get a token and passes it as `data` to every VU.
- **`src/modes/*`**: Adding a new mode (e.g., `grpc`, `websockets`) is as simple as creating a new file in here and importing it into `script.js`.

No other dependencies. No `package.json`, no Docker, nothing to install beyond k6 itself (which the workflow handles automatically).

---

## Limitations

- GitHub-hosted runners all originate from Azure datacenters (mostly US East / West). If your server is geographically distant, latency will reflect that — it doesn't simulate users from multiple global regions unless you self-host runners.
- k6 does not execute JavaScript in responses. Crawl mode parses raw HTML/JSON. Single-page apps that render their `<a>` tags only after JS execution will have fewer links discovered — pass your known routes directly via `ENDPOINTS_JSON` in API mode instead.
- GitHub Actions free tier allows 2,000 runner-minutes/month per account. A 5-minute test on 4 runners uses 20 minutes. Plan accordingly.