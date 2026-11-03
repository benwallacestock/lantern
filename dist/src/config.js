// Settings a project (or a tool wrapping lantern, such as forest) can give the daemon: in the environment of the
// command that starts it, or in a `.lantern.json` at the project root. The environment wins.
//
//   url     where relative paths go the first time: "http://localhost:3000"
//   hosts   the only hosts the page may visit (comma-separated, or an array): "app.localhost,api.app.localhost"
//   out     where pictures and videos go, relative to the project root: "tmp/lantern"
//   note    a word for the frame's footer — a ticket, say: "SPR-123"
//   onLoad  JavaScript to run in the page after every load — a dev login, say
import fs from 'node:fs';
import path from 'node:path';
export function readConfig(root) {
    let file = {};
    try {
        file = JSON.parse(fs.readFileSync(path.join(root, '.lantern.json'), 'utf8'));
    }
    catch { }
    const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : undefined);
    const env = process.env;
    return {
        url: env.LANTERN_URL || file.url || undefined,
        hosts: list(env.LANTERN_HOSTS) ?? list(file.hosts),
        out: env.LANTERN_OUT || file.out || undefined,
        note: env.LANTERN_NOTE || file.note || undefined,
        onLoad: env.LANTERN_ON_LOAD || file.onLoad || undefined,
    };
}
/** Is this host one the page may visit? With no list, anywhere. */
export const hostAllowed = (hosts, host) => !hosts?.length || hosts.some((h) => host === h || host.endsWith('.' + h));
