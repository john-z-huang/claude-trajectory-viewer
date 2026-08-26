import assert from "node:assert/strict";
import test from "node:test";

import {
  collectClaudeCodeDirectoryEntries,
  collectClaudeCodeDirectoryUploadEntries,
  parseClaudeCodeDirectory,
} from "../src/lib/claudeCode/index.js";

function fileHandle(name, text) {
  return {
    kind: "file",
    name,
    async getFile() {
      return {
        name,
        async text() {
          return text;
        },
      };
    },
  };
}

function unreadableFileHandle(name) {
  return {
    kind: "file",
    name,
    async getFile() {
      throw new Error("permission denied");
    },
  };
}

function directoryHandle(name, children) {
  return {
    kind: "directory",
    name,
    async *entries() {
      yield* children;
    },
  };
}

test("浏览器目录读取器递归收集 JSON 和 JSONL，并保留读取错误", async () => {
  const workflowDirectory = directoryHandle("workflow", [
    ["main.jsonl", fileHandle("main.jsonl", '{"type":"user"}\n')],
    [
      "nested",
      directoryHandle("nested", [
        ["settings.json", fileHandle("settings.json", '{"enabled":true}')],
        ["ignored.txt", fileHandle("ignored.txt", "ignored")],
        ["unreadable.json", unreadableFileHandle("unreadable.json")],
      ]),
    ],
  ]);

  const loaded = await collectClaudeCodeDirectoryEntries(workflowDirectory);

  assert.equal(loaded.rootName, "workflow");
  assert.deepEqual(
    loaded.entries.map((entry) => entry.relativePath),
    ["workflow/main.jsonl", "workflow/nested/settings.json"],
  );
  assert.deepEqual(loaded.skippedFiles, [
    {
      relativePath: "workflow/nested/unreadable.json",
      error: "permission denied",
    },
  ]);

  const parsed = parseClaudeCodeDirectory(loaded.entries);
  assert.equal(parsed.summary.parsedFileCount, 2);
  assert.equal(parsed.summary.jsonFileCount, 1);
  assert.equal(parsed.summary.jsonlFileCount, 1);
});

test("目录上传回退读取器保留目录层级并跳过不支持的文件", async () => {
  const loaded = await collectClaudeCodeDirectoryUploadEntries([
    {
      name: "main.jsonl",
      webkitRelativePath: "workflow/main.jsonl",
      async text() {
        return '{"type":"user"}\n';
      },
    },
    {
      name: "settings.json",
      webkitRelativePath: "workflow/config/settings.json",
      async text() {
        return '{"enabled":true}';
      },
    },
    {
      name: "ignored.txt",
      webkitRelativePath: "workflow/config/ignored.txt",
      async text() {
        return "ignored";
      },
    },
  ]);

  assert.equal(loaded.rootName, "workflow");
  assert.deepEqual(
    loaded.entries.map((entry) => entry.relativePath),
    ["workflow/config/settings.json", "workflow/main.jsonl"],
  );
  assert.deepEqual(loaded.skippedFiles, []);
});
