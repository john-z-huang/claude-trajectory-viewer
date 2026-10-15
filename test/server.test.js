import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiscoveryService } from "../server/discovery.js";
import { startServer } from "../server/index.js";

test("runs Vite middleware and local discovery API on one loopback Node server", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "claude-viewer-server-fixture-"));
  context.after(() => rm(homeDir, { recursive: true, force: true }));
  const roots = {
    claudeCode: path.join(homeDir, "claude-projects"),
    claude3pSessions: path.join(homeDir, "claude3p", "claude-code-sessions"),
    localAgentMode: path.join(homeDir, "claude3p", "local-agent-mode-sessions"),
    cspOrgs: path.join(homeDir, "csp", "orgs"),
  };
  await Promise.all(Object.values(roots).map((directory) => mkdir(directory, { recursive: true })));
  const discoveryService = createDiscoveryService({ homeDir, roots });
  const running = await startServer({
    development: true,
    port: 0,
    discoveryService,
    skipDependencyOptimization: true,
  });
  context.after(() => running.close());

  const address = running.server.address();
  assert.equal(address.address, "127.0.0.1");
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Claude Code JSONL Viewer|\/src\/main\.jsx/);
  const sources = await fetch(`${origin}/api/sources`).then((response) => response.json());
  assert.equal(sources.sources.length, 4);
});
