import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiHandler } from "./api.js";
import { createDiscoveryService } from "./discovery.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

function supportedNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function serveProductionFile(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  } catch {
    sendText(response, 400, "Invalid request path");
    return;
  }
  if (pathname.includes("\\") || pathname.includes("\0")) {
    sendText(response, 400, "Invalid request path");
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(DIST_ROOT, relativePath);
  const relative = path.relative(DIST_ROOT, filePath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    sendText(response, 404, "Not found");
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    await fs.access(filePath);
  } catch {
    if (path.extname(relativePath)) {
      sendText(response, 404, "Not found");
      return;
    }
    filePath = path.join(DIST_ROOT, "index.html");
    try {
      await fs.access(filePath);
    } catch {
      sendText(response, 503, "Production build is missing. Run npm run build first.");
      return;
    }
  }

  const stat = await fs.stat(filePath);
  response.writeHead(200, {
    "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

export async function startServer({
  development = process.argv.includes("--dev"),
  port,
  discoveryService,
  skipDependencyOptimization = false,
} = {}) {
  if (!supportedNodeVersion()) {
    throw new Error("需要 Node.js 22.13.0 或更高版本（使用内置只读 SQLite 支持）。");
  }
  const configuredPort = port ?? Number(process.env.PORT || (development ? 4399 : 4400));
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error("PORT 必须是 0 到 65535 之间的整数。");
  }

  const discovery = discoveryService || createDiscoveryService();
  await discovery.refresh();
  const apiHandler = createApiHandler(discovery);
  let vite = null;
  let httpServer;
  httpServer = createServer((request, response) => {
    void (async () => {
      try {
        if (await apiHandler(request, response)) return;
        if (development) {
          vite.middlewares(request, response, (error) => {
            if (error) sendText(response, 500, "Development server request failed");
            else if (!response.writableEnded) sendText(response, 404, "Not found");
          });
        } else {
          await serveProductionFile(request, response);
        }
      } catch {
        if (!response.headersSent) sendText(response, 500, "Local viewer request failed");
        else response.destroy();
      }
    })();
  });

  try {
    if (development) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({
        configFile: false,
        root: PROJECT_ROOT,
        appType: "spa",
        ...(skipDependencyOptimization ? { optimizeDeps: { noDiscovery: true } } : {}),
        server: {
          middlewareMode: true,
          hmr: { server: httpServer },
        },
      });
    }
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(configuredPort, "127.0.0.1", resolve);
    });
  } catch (error) {
    await vite?.close();
    throw error;
  }

  const mode = development ? "development" : "production";
  const actualPort = httpServer.address()?.port ?? configuredPort;
  if (isMain) process.stdout.write(`Claude session viewer (${mode}) listening at http://127.0.0.1:${actualPort}\n`);
  const close = () => new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      Promise.resolve(vite?.close()).then(resolve, reject);
    });
  });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return { server: httpServer, discovery, vite, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "无法启动本地服务。"}\n`);
    process.exitCode = 1;
  });
}
