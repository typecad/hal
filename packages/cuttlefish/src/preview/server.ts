import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import chalk from "chalk";
import { findConfigFile, parseConfigFile } from "../config-loader.js";
import { requireUIHook, hasUIHook } from "../ui-hook.js";
import { loadUIEngine } from "../ui/ui-bridge.js";

export interface PreviewServerOptions {
  configPath?: string;
  port?: number;
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cuttlefish Preview</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #111315; color: #e8ecef; }
    body { margin: 0; height: 100vh; overflow: hidden; display: grid; grid-template-columns: minmax(360px, 1fr) 280px; }
    main { display: grid; place-items: center; padding: 24px; background: #191d20; }
    canvas { image-rendering: pixelated; width: min(92vw, 960px); max-height: calc(100vh - 48px); aspect-ratio: var(--display-aspect, 4 / 3); background: #000; box-shadow: 0 12px 36px rgba(0,0,0,.35); }
    #debugOverlay { position: absolute; pointer-events: none; image-rendering: pixelated; background: transparent; }
    main { position: relative; }
    #debugModes { display: grid; gap: 2px; }
    #debugModes label { display: flex; align-items: center; gap: 8px; color: #aab3ba; font-size: 12px; cursor: pointer; padding: 5px 6px; border-radius: 5px; }
    #debugModes label:hover { background: #232a30; color: #dfe6eb; }
    #debugModes input[type="checkbox"] { width: 14px; height: 14px; margin: 0; }
    #debugState { color: #7d8790; font-size: 11px; margin-top: 6px; }
    aside { border-left: 1px solid #2d3338; padding: 18px; display: flex; flex-direction: column; gap: 18px; min-height: 0; }
    aside > section:first-child, aside > section:nth-child(2) { flex-shrink: 0; }  /* Display + GPIO stay visible */
    aside > section:last-child { min-height: 0; display: flex; flex-direction: column; }
    #diagnostics { overflow-y: auto; min-height: 0; }
    h1 { font-size: 15px; margin: 0 0 8px; font-weight: 650; }
    #status, #diagnostics, .empty { color: #aab3ba; font-size: 12px; line-height: 1.4; }
    #pins { display: grid; gap: 8px; }
    button { appearance: none; border: 1px solid #44505a; background: #252b30; color: #f3f6f8; border-radius: 6px; padding: 9px 10px; text-align: left; font: inherit; cursor: pointer; }
    button:hover { background: #303841; }
    @media (max-width: 760px) {
      body { height: auto; min-height: 100vh; overflow: auto; grid-template-rows: auto 1fr; grid-template-columns: 1fr; }
      aside { border-left: 0; border-top: 1px solid #2d3338; }
      canvas { width: min(94vw, 640px); }
    }
  </style>
  <script type="importmap">
    {
      "imports": {
        "@typecad/ui/": "/__cuttlefish-ui/",
        "@typecad/cuttlefish/api/shared": "/__cuttlefish/preview/api-shared-shim.js"
      }
    }
  </script>
</head>
<body>
  <main><canvas id="display" width="320" height="240"></canvas></main>
  <aside>
    <section>
      <h1>Display</h1>
      <div id="status"></div>
    </section>
    <section>
      <h1>GPIO</h1>
      <div id="pins"></div>
    </section>
    <section>
      <h1>Debug overlay</h1>
      <div id="debugModes">
        <label><input type="checkbox" data-mode="boxes"> boxes (colors by kind)</label>
        <label><input type="checkbox" data-mode="clips"> scroll clips (dashed)</label>
        <label><input type="checkbox" data-mode="dirty"> dirty flash (repaints)</label>
        <label><input type="checkbox" data-mode="inspect"> inspect taps (blocks input)</label>
      </div>
      <div id="debugState">overlay: off — check a box or press D</div>
      <div style="color:#7d8790;font-size:11px;margin-top:4px">D cycles boxes/clips/dirty · Ctrl-click always inspects</div>
    </section>
    <section>
      <h1>Diagnostics</h1>
      <div id="diagnostics"></div>
    </section>
  </aside>
  <script type="module" src="/__cuttlefish/preview/client.js"></script>
</body>
</html>`;

function contentType(filePath: string): string {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/** Serve a file from a dist root, with ESM-specifier fallbacks: extensionless
 *  paths try +".js" (package-exports style "./preview/host-ui-runtime" →
 *  host-ui-runtime.js) and bare directories try +"/index.js". */
function serveFromRoot(res: http.ServerResponse, root: string, relRaw: string): void {
  const rel = decodeURIComponent(relRaw);
  const candidates = [rel, `${rel}.js`, `${rel}/index.js`];
  for (const candidate of candidates) {
    const filePath = path.resolve(root, candidate);
    if (!filePath.startsWith(root)) break;  // path traversal — 404 below
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      // no-store: these are compiled dist files that change between builds;
      // heuristic browser caching serves stale modules after a rebuild and
      // breaks the preview dev loop (and any debugging of it).
      res.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }
  writeText(res, 404, "Not found");
}

/** Resolve a dependency package's dist directory (served to the browser).
 *  Resolves through the package's exports map (subpath → dist file) and walks
 *  up to the enclosing "dist" — packages don't export "./package.json". */
function packageDistDir(specifier: string): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve(specifier);  // e.g. .../dist/engine.js
  let dir = path.dirname(entry);
  for (let i = 0; i < 4 && path.basename(dir) !== "dist"; i++) {
    dir = path.dirname(dir);
  }
  if (path.basename(dir) !== "dist") {
    throw new Error(`Could not locate the dist directory for ${specifier} (resolved ${entry}).`);
  }
  return dir;
}

function writeText(res: http.ServerResponse, status: number, text: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type });
  res.end(text);
}

function resolveConfigPath(configPath: string | undefined): string {
  if (configPath) {
    const abs = path.resolve(process.cwd(), configPath);
    if (!fs.existsSync(abs)) throw new Error(`Config file not found: ${abs}`);
    return abs;
  }
  const found = findConfigFile(process.cwd());
  if (!found) throw new Error("No typecad-hal.config.ts found for preview.");
  return found;
}

function watchPreviewFiles(projectRoot: string, configPath: string, notify: () => void): fs.FSWatcher[] {
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(notify, 80);
  };

  const addWatch = (target: string, recursive = false) => {
    if (!fs.existsSync(target)) return;
    try {
      watchers.push(fs.watch(target, { recursive }, (_event, filename) => {
        const name = String(filename ?? "");
        if (!name || /\.(ts|css|html)$/.test(name) || name === path.basename(configPath)) debounced();
      }));
    } catch {
      if (recursive) addWatch(target, false);
    }
  };

  addWatch(path.join(projectRoot, "src"), true);
  addWatch(configPath);
  return watchers;
}

async function listen(server: http.Server, preferredPort: number): Promise<number> {
  for (let port = preferredPort; port < preferredPort + 20; port++) {
    const result = await new Promise<"ok" | "busy">((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE") resolve("busy");
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve("ok");
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (result === "ok") return port;
  }
  throw new Error(`No available preview port found starting at ${preferredPort}.`);
}

export async function runPreviewServer(options: PreviewServerOptions = {}): Promise<void> {
  // The preview pipeline drives the UI engine directly (snapshot builds,
  // type-decl generation) without going through transpileFile(), which is the
  // only path that lazily registers the hook — so load it here first. Preview
  // is a UI feature: when the engine is absent, fail with a clear message
  // instead of the generic "hook is not registered" error.
  await loadUIEngine();
  if (!hasUIHook()) {
    throw new Error(
      `typecad-hal preview requires the @typecad/ui package — install it in this project (npm install @typecad/ui).`,
    );
  }
  const configPath = resolveConfigPath(options.configPath);
  const config = parseConfigFile(configPath);
  if (!config) throw new Error(`Could not parse ${configPath}`);
  // Snapshots re-read the config on every build (see /snapshot.json below);
  // this holds the most recent config that parsed, for fallback mid-edit.
  let lastGoodConfig = config;
  const projectRoot = path.dirname(configPath);
  requireUIHook().generateProjectUITypeDeclarations(projectRoot);
  const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // The browser client imports the host runtime from @typecad/ui via the
  // import map — resolve where that package's dist lives on this machine.
  const uiDistRoot = packageDistDir("@typecad/ui/engine");
  const clients = new Set<http.ServerResponse>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/") {
        writeText(res, 200, HTML, "text/html; charset=utf-8");
        return;
      }
      if (url.pathname === "/snapshot.json") {
        requireUIHook().generateProjectUITypeDeclarations(projectRoot);
        // Re-read the config for every snapshot build so edits (themeClass,
        // entry, display) take effect on page refresh without restarting the
        // preview server. A config that momentarily fails to parse (mid-edit)
        // falls back to the last good one — the page keeps working; refresh
        // again once the edit settles.
        const latest = parseConfigFile(configPath) ?? lastGoodConfig;
        lastGoodConfig = latest;
        // Imported via a computed file:// URL (never a string-literal bare
        // specifier) so tsc types this as `any` and never resolves
        // @typecad/ui's declaration files — see the comment in ui/ui-bridge.ts
        // for why a literal specifier causes TS5055 on rebuilds where dist/
        // already exists. The ?t= cache-bust forces a fresh ESM load per
        // snapshot build: without it the server caches the module graph from
        // startup, and engine rebuilds (font planning, layout fixes, ...)
        // never take effect until the server restarts — a recurring source of
        // "fixed but the preview still shows it" confusion. Dev-only cost:
        // re-evaluating the module graph per snapshot request.
        const buildProgramUrl = pathToFileURL(path.join(uiDistRoot, "preview", "build-program.js")).href;
        const { buildPreviewSnapshot } = await import(buildProgramUrl + "?t=" + Date.now());
        const snapshot = await buildPreviewSnapshot({ config: latest, projectRoot });
        writeText(res, 200, JSON.stringify(snapshot), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        });
        res.write("\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (url.pathname.startsWith("/__cuttlefish-ui/")) {
        // The @typecad/ui package's dist — the browser client resolves
        // "@typecad/ui/..." bare specifiers onto this prefix via the import
        // map (host runtime, gfx, and their relative engine imports).
        serveFromRoot(res, uiDistRoot, url.pathname.slice("/__cuttlefish-ui/".length));
        return;
      }
      if (url.pathname.startsWith("/__cuttlefish/")) {
        serveFromRoot(res, distRoot, url.pathname.slice("/__cuttlefish/".length));
        return;
      }
      writeText(res, 404, "Not found");
    } catch (error) {
      writeText(res, 500, error instanceof Error ? error.message : String(error));
    }
  });

  const notify = () => {
    for (const client of clients) {
      client.write("event: reload\n");
      client.write(`data: ${Date.now()}\n\n`);
    }
  };
  const watchers = watchPreviewFiles(projectRoot, configPath, notify);
  server.on("close", () => watchers.forEach((watcher) => watcher.close()));

  const port = await listen(server, options.port ?? 5174);
  console.log(chalk.cyan("Cuttlefish preview") + chalk.gray(` ${path.relative(process.cwd(), configPath)}`));
  console.log(`  http://127.0.0.1:${port}/`);

  await new Promise<void>((resolve) => {
    server.on("close", resolve);
  });
}
