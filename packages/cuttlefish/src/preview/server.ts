import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { findConfigFile, parseConfigFile } from "../config-loader.js";
import { buildPreviewSnapshot } from "@typecad/ui/preview/build-program";
import { requireUIHook } from "../ui-hook.js";

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
  if (!found) throw new Error("No cuttlefish.config.ts found for preview.");
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
  const configPath = resolveConfigPath(options.configPath);
  const config = parseConfigFile(configPath);
  if (!config) throw new Error(`Could not parse ${configPath}`);
  const projectRoot = path.dirname(configPath);
  requireUIHook().generateProjectUITypeDeclarations(projectRoot);
  const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
        const snapshot = await buildPreviewSnapshot({ config, projectRoot });
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
      if (url.pathname.startsWith("/__cuttlefish/")) {
        const rel = decodeURIComponent(url.pathname.slice("/__cuttlefish/".length));
        const filePath = path.resolve(distRoot, rel);
        if (!filePath.startsWith(distRoot) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          writeText(res, 404, "Not found");
          return;
        }
        res.writeHead(200, { "content-type": contentType(filePath) });
        fs.createReadStream(filePath).pipe(res);
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
