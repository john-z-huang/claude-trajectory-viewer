const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function json(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function requestHostname(value, fallbackProtocol = "http:") {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `${fallbackProtocol}//${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalRequest(request) {
  const host = requestHostname(request.headers.host);
  if (!host || !LOOPBACK_HOSTNAMES.has(host)) return false;
  const origin = request.headers.origin;
  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      return false;
    }
    if (!LOOPBACK_HOSTNAMES.has(parsedOrigin.hostname.toLowerCase())
      || parsedOrigin.host.toLowerCase() !== String(request.headers.host || "").toLowerCase()) {
      return false;
    }
  }
  const fetchSite = request.headers["sec-fetch-site"];
  return !fetchSite || fetchSite !== "cross-site";
}

export function createApiHandler(discovery) {
  return async function handleApi(request, response) {
    if (!isLocalRequest(request)) {
      json(response, 403, { error: "仅允许从本机页面访问。" });
      return true;
    }

    let url;
    try {
      url = new URL(request.url || "/", `http://${request.headers.host}`);
    } catch {
      json(response, 400, { error: "请求地址无效。" });
      return true;
    }

    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return false;

    try {
      if (request.method === "GET" && pathname === "/api/sources") {
        json(response, 200, discovery.getSnapshot());
        return true;
      }
      if (request.method === "GET" && pathname === "/api/sessions") {
        const offset = Number(url.searchParams.get("offset") || 0);
        const limit = Number(url.searchParams.get("limit") || 100);
        const source = url.searchParams.get("source") || undefined;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000
          || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
          json(response, 400, { error: "分页参数无效。" });
          return true;
        }
        json(response, 200, discovery.listSessions({ source, offset, limit }));
        return true;
      }
      if (request.method === "POST" && pathname === "/api/refresh") {
        const snapshot = await discovery.refresh();
        json(response, 200, snapshot);
        return true;
      }

      const detailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      const recordsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/records$/);
      if (request.method === "GET" && (detailMatch || recordsMatch)) {
        let id;
        try {
          id = decodeURIComponent((recordsMatch || detailMatch)[1]);
        } catch {
          json(response, 400, { error: "会话 ID 无效。" });
          return true;
        }
        if (!OPAQUE_ID.test(id)) {
          json(response, 404, { error: "未找到当前发现的会话。" });
          return true;
        }
        if (detailMatch) {
          const session = discovery.getSession(id);
          if (!session) json(response, 404, { error: "未找到当前发现的会话。" });
          else json(response, 200, session);
          return true;
        }
        const page = await discovery.getRecordsPage(id, url.searchParams.get("cursor"));
        if (!page) json(response, 404, { error: "未找到当前发现的会话。" });
        else json(response, 200, page);
        return true;
      }

      if (pathname === "/api/sources" || pathname === "/api/sessions" || pathname === "/api/refresh"
        || detailMatch || recordsMatch) {
        json(response, 405, { error: "不支持该请求方法。" });
        return true;
      }
      json(response, 404, { error: "未找到 API。" });
      return true;
    } catch {
      json(response, 500, { error: "读取本地会话记录时发生错误。" });
      return true;
    }
  };
}
