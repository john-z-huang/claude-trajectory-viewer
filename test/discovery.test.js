import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDiscoveryService } from "../server/discovery.js";

const tempRoots = [];

async function makeFixture(pageSize = 2) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "claude-viewer-fixture-"));
  tempRoots.push(homeDir);
  const roots = {
    claudeCode: path.join(homeDir, "claude-projects"),
    claude3pSessions: path.join(homeDir, "claude3p", "claude-code-sessions"),
    localAgentMode: path.join(homeDir, "claude3p", "local-agent-mode-sessions"),
    cspOrgs: path.join(homeDir, "csp", "orgs"),
  };
  await Promise.all(Object.values(roots).map((directory) => mkdir(directory, { recursive: true })));
  return { homeDir, roots, service: createDiscoveryService({ homeDir, roots, pageSize }) };
}

async function sha256(filePath) {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function addCspFixture(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE projects (project_id TEXT, name TEXT, cwd TEXT);
      CREATE TABLE frames (frame_id TEXT, project_id TEXT, parent_frame_id TEXT, root_frame_id TEXT, is_hidden INTEGER, title TEXT);
      CREATE TABLE frame_messages (frame_id TEXT, idx INTEGER, msg_json TEXT, msg_uuid TEXT);
      CREATE TABLE artifacts (artifact_id TEXT, project_id TEXT, frame_id TEXT, name TEXT, path TEXT, mime_type TEXT);
      CREATE TABLE artifact_versions (artifact_id TEXT, version_id TEXT, version INTEGER, path TEXT);
      INSERT INTO projects VALUES ('p-1', 'Synthetic project', '/synthetic/project');
      INSERT INTO frames VALUES ('root-1', 'p-1', NULL, 'root-1', 0, 'Synthetic root');
      INSERT INTO frames VALUES ('child-1', 'p-1', 'root-1', 'root-1', 0, 'Synthetic child');
      INSERT INTO frame_messages VALUES ('root-1', 1, '{"role":"user","content":"fixture"}', 'msg-1');
      INSERT INTO frame_messages VALUES ('child-1', 2, '{"type":"tool_call","name":"fixture-tool","artifact":{"path":"/synthetic/artifact.txt","content":"inline attachment fixture body"}}', 'msg-2');
      INSERT INTO artifacts VALUES ('artifact-1', 'p-1', 'child-1', 'Synthetic artifact', '/synthetic/artifact.txt', 'text/plain');
      INSERT INTO artifact_versions VALUES ('artifact-1', 'version-1', 1, '/synthetic/artifact.txt');
    `);
  } finally {
    db.close();
  }
}

test.after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test("discovers Claude Code and associates Claude-3p metadata by cliSessionId", async () => {
  const { roots, homeDir } = await makeFixture(1);
  const service = createDiscoveryService({ homeDir, roots, pageSize: 1 });
  const transcript = path.join(roots.claudeCode, "project-a", "cli-session-1.jsonl");
  await mkdir(path.dirname(transcript), { recursive: true });
  await writeFile(transcript, [
    JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "cli-session-1", message: { role: "user", content: "synthetic one" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:01Z", sessionId: "cli-session-1", message: { role: "assistant", content: "synthetic two" } }),
  ].join("\n"));
  await writeFile(path.join(roots.claude3pSessions, "metadata.json"), JSON.stringify({
    sessionId: "desktop-session-1",
    cliSessionId: "cli-session-1",
    title: "Synthetic Claude-3p title",
    ignoredField: "not exposed",
  }));

  const snapshot = await service.refresh();
  const list = service.listSessions({ limit: 10 });
  assert.equal(list.total, 1);
  assert.deepEqual(list.items[0].sources.sort(), ["claude-3p", "claude-code"]);
  assert.equal(list.items[0].title, "Synthetic Claude-3p title");
  assert.equal(snapshot.sources.find((source) => source.id === "claude-code").status, "available");
  const detail = service.getSession(list.items[0].id);
  assert.equal(detail.metadata.claude3p.cliSessionId, "cli-session-1");
  assert.equal(JSON.stringify(detail).includes("not exposed"), false);
  let page = await service.getRecordsPage(list.items[0].id);
  const categories = [];
  while (true) {
    categories.push(...page.items.map((item) => item.category));
    if (page.done) break;
    page = await service.getRecordsPage(list.items[0].id, page.nextCursor);
  }
  assert.deepEqual(categories, ["timeline", "timeline"]);
});

test("keeps damaged JSONL records readable and maps records back to physical lines", async () => {
  const { roots, service } = await makeFixture();
  const transcript = path.join(roots.claudeCode, "damaged.jsonl");
  await writeFile(transcript, [
    "",
    JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "synthetic" } }),
    "{broken fixture",
    JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: "still readable" } }),
  ].join("\n"));
  await service.refresh();
  const id = service.listSessions().items[0].id;
  let page = await service.getRecordsPage(id);
  const items = [...page.items];
  while (!page.done) {
    page = await service.getRecordsPage(id, page.nextCursor);
    items.push(...page.items);
  }
  const error = items.find((item) => item.category === "error");
  assert.ok(error);
  assert.equal(error.lineNumber, 3);
  assert.equal(items.filter((item) => item.category === "timeline").length, 2);
});

test("associates Local Agent Mode audit records and paginates matching streams", async () => {
  const { roots, service } = await makeFixture();
  const sessionDir = path.join(roots.localAgentMode, "nested", "session-a");
  await mkdir(sessionDir, { recursive: true });
  const transcript = path.join(sessionDir, "agent-session-a.jsonl");
  await writeFile(transcript, JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "agent-session-a", message: { role: "user", content: "synthetic agent" } }));
  await writeFile(path.join(sessionDir, "session.meta.json"), JSON.stringify({ cliSessionId: "agent-session-a", title: "Synthetic agent session" }));
  await writeFile(path.join(roots.localAgentMode, "nested", "audit.jsonl"), [
    JSON.stringify({ type: "system", sessionId: "agent-session-a", subtype: "synthetic-system" }),
    JSON.stringify({ type: "user", sessionId: "agent-session-a", message: { role: "user", content: "synthetic audit user" } }),
    JSON.stringify({ type: "system", sessionId: "unrelated-session", subtype: "synthetic-unrelated" }),
  ].join("\n"));

  await service.refresh();
  const session = service.listSessions({ source: "claude-local-agent-mode" }).items.find((item) => item.streamCount === 2);
  assert.ok(session);
  assert.equal(session.title, "Synthetic agent session");
  let page = await service.getRecordsPage(session.id);
  const auditItems = [];
  while (true) {
    auditItems.push(...page.items.filter((item) => item.streamKind === "audit"));
    if (page.done) break;
    page = await service.getRecordsPage(session.id, page.nextCursor);
  }
  assert.equal(auditItems.length, 2);
  assert.equal(auditItems.some((item) => JSON.stringify(item).includes("synthetic-unrelated")), false);
});

test("reads synthetic CSP allowlisted rows without modifying the database or opening artifact paths", async () => {
  const { roots, homeDir } = await makeFixture(1);
  const service = createDiscoveryService({ homeDir, roots, pageSize: 1 });
  const orgDir = path.join(roots.cspOrgs, "org-fixture");
  await mkdir(orgDir, { recursive: true });
  const dbPath = path.join(orgDir, "operon-cli.db");
  addCspFixture(dbPath);
  const artifactPath = path.join(orgDir, "artifact.txt");
  await writeFile(artifactPath, "synthetic attachment body");
  const databaseHashBefore = await sha256(dbPath);
  const artifactHashBefore = await sha256(artifactPath);

  await service.refresh();
  const session = service.listSessions({ source: "claude-science" }).items[0];
  assert.ok(session);
  const detail = service.getSession(session.id);
  assert.equal(detail.frames.length, 2);
  assert.equal(detail.artifacts[0].versions.length, 1);
  assert.equal(JSON.stringify(detail).includes("synthetic attachment body"), false);
  const firstPage = await service.getRecordsPage(session.id);
  assert.equal(firstPage.items[0].category, "csp-message");
  assert.ok(firstPage.nextCursor);
  const secondPage = await service.getRecordsPage(session.id, firstPage.nextCursor);
  assert.equal(secondPage.items[0].category, "csp-message");
  const allMessages = JSON.stringify([...firstPage.items, ...secondPage.items]);
  assert.equal(allMessages.includes("inline attachment fixture body"), false);
  assert.equal(allMessages.includes("[附件正文已省略]"), true);
  assert.equal(secondPage.done, true);
  assert.equal(await sha256(dbPath), databaseHashBefore);
  assert.equal(await sha256(artifactPath), artifactHashBefore);
});

test("ignores CSP database symlinks that point outside their org directory", async () => {
  const { roots, homeDir, service } = await makeFixture();
  const orgDir = path.join(roots.cspOrgs, "org-fixture");
  await mkdir(orgDir, { recursive: true });
  const externalDbPath = path.join(homeDir, "external-operon-cli.db");
  addCspFixture(externalDbPath);
  await symlink(externalDbPath, path.join(orgDir, "operon-cli.db"));
  const externalDatabaseHash = await sha256(externalDbPath);

  const snapshot = await service.refresh();
  const cspSource = snapshot.sources.find((source) => source.id === "claude-science");
  assert.equal(cspSource.sessionCount, 0);
  assert.equal(cspSource.status, "unavailable");
  assert.equal(service.listSessions({ source: "claude-science" }).total, 0);
  assert.equal(await sha256(externalDbPath), externalDatabaseHash);
});

test("isolates CSP schema drift from other sources", async () => {
  const { roots, service } = await makeFixture();
  await writeFile(path.join(roots.claudeCode, "available.jsonl"), JSON.stringify({ type: "user", message: { role: "user", content: "available fixture" } }));
  const orgDir = path.join(roots.cspOrgs, "bad-schema");
  await mkdir(orgDir, { recursive: true });
  const db = new DatabaseSync(path.join(orgDir, "operon-cli.db"));
  db.exec("CREATE TABLE projects (project_id TEXT)");
  db.close();

  const snapshot = await service.refresh();
  assert.equal(service.listSessions().total, 1);
  assert.equal(snapshot.sources.find((source) => source.id === "claude-science").status, "error");
  assert.match(snapshot.sources.find((source) => source.id === "claude-science").message, /schema|缺少/);
});
