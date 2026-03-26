import { CFG } from "./config.js";
import { TRAFFIC_SOURCES } from "./data.js";
import { randomItem, pickBrowserProfile } from "./utils.js";

const vuSessions = {};

export function resetSession() {
    const seed = Math.random().toString(36).slice(2, 10);
    vuSessions[__VU] = {
        id: `${Date.now().toString(36)}-${seed}`,
        referer: randomItem(TRAFFIC_SOURCES),
        profile: pickBrowserProfile(),  // rotate browser identity on each session
        queue: [],
        queued: {},
        visited: {},
        lastUrl: CFG.targetUrl,
        lastStatus: 200,  // track last response status for adaptive think time
    };
    enqueue(vuSessions[__VU], CFG.targetUrl, "page");
}

export function getSession() {
    if (!vuSessions[__VU]) resetSession();
    return vuSessions[__VU];
}

export function enqueue(session, url, kind) {
    if (!url || session.visited[url] || session.queued[url]) return;
    if (session.queue.length >= CFG.maxQueueSize) return;
    session.queue.push({ url, kind });
    session.queued[url] = true;
}

export function dequeue(session) {
    if (!session.queue.length) return null;

    // occasionally prioritise API endpoints to stress-test your backend
    if (Math.random() < CFG.apiPickRatio) {
        const idx = session.queue.findIndex(i => i.kind === "api");
        if (idx >= 0) {
            const [item] = session.queue.splice(idx, 1);
            delete session.queued[item.url];
            return item;
        }
    }

    const item = session.queue.shift();
    delete session.queued[item.url];
    return item;
}
