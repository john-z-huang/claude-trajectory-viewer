import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, get as httpGet } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiHandler } from "../server/api.js";
import { createDiscoveryService } from "../server/discovery.js";

test("serves discovery API only for loopback hosts and accepts only current opaque session IDs", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "claude-viewer-api-fixture-"));
  context.after(() => rm(homeDir, { recursive: true, force: true }));
  const roots = {
    claudeCode: path.join(homeDir, "claude-projects"),
    claude3pSessions: path.join(homeDir, "claude3p", "claude-code-sessions"),
    localAgentMode: path.join(homeDir, "claude3p", "local-agent-mode-sessions"),
    cspOrgs: path.join(homeDir, "csp", "orgs"),
  };
  await Promise.all(Object.values(roots).map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(path.join(roots.claudeCode, "synthetic-session.jsonl"), JSON.stringify({
    type: "user",
    timestamp: "2026-02-03T04:05:06Z",
    message: { role: "user", content: "fixture content" },
  }));
  const discovery = createDiscoveryService({ homeDir, roots, pageSize: 1 });
  await discovery.refresh();
  const apiHandler = createApiHandler(discovery);
  const server = createServer((request, response) => {
    void apiHandler(request, response).then((handled) => {
      if (!handled && !response.writableEnded) response.writeHead(404).end();
    });
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const sources = await fetch(`${origin}/api/sources`).then((response) => response.json());
  assert.equal(sources.sources.length, 4);
  const list = await fetch(`${origin}/api/sessions`).then((response) => response.json());
  assert.equal(list.total, 1);
  const id = list.items[0].id;
  assert.match(id, /^[0-9a-f-]{36}$/i);

  const detailResponse = await fetch(`${origin}/api/sessions/${id}`);
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).id, id);
  const firstPage = await fetch(`${origin}/api/sessions/${id}/records`).then((response) => response.json());
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.done, true);

  const arbitraryPathResponse = await fetch(`${origin}/api/sessions/%2Fetc%2Fpasswd`);
  assert.equal(arbitraryPathResponse.status, 404);
  assert.deepEqual(await arbitraryPathResponse.json(), { error: "未找到当前发现的会话。" });

  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = httpGet(`${origin}/api/sessions`, { headers: { host: "external.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
  });
  assert.equal(hostileHostStatus, 403);
  const crossOriginResponse = await fetch(`${origin}/api/sessions`, {
    headers: { origin: "http://external.example" },
  });
  assert.equal(crossOriginResponse.status, 403);

  const refreshResponse = await fetch(`${origin}/api/refresh`, { method: "POST" });
  assert.equal(refreshResponse.status, 200);
});
