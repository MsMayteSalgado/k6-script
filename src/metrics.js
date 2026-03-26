import { Rate, Counter, Trend } from "k6/metrics";

export const failedRequests = new Rate("failed_requests");
export const rateLimited = new Rate("rate_limited");
export const serverErrors = new Rate("server_errors");
export const authFailures = new Counter("auth_failures");
export const crawlDepth = new Trend("crawl_depth", true);
