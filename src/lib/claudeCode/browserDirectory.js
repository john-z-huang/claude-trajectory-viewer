/**
 * 浏览器侧的 Claude Code 目录读取器。
 *
 * 本模块只负责把用户授权的目录内容转换成解析 Lib 所需的 entries，
 * 不依赖 React，也不承担界面状态管理。
 */

import { isSupportedClaudeCodeDirectoryFile, normalizeRelativePath } from "./source.js";

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sortEntries(entries) {
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function createSkippedFile(relativePath, error, fallback) {
  return {
    relativePath,
    error: getErrorMessage(error, fallback),
  };
}

async function collectFromDirectoryHandle(directoryHandle, directoryPath, entries, skippedFiles) {
  try {
    for await (const [name, childHandle] of directoryHandle.entries()) {
      const relativePath = `${directoryPath}/${name}`;

      if (childHandle.kind === "directory") {
        await collectFromDirectoryHandle(childHandle, relativePath, entries, skippedFiles);
        continue;
      }

      if (childHandle.kind !== "file" || !isSupportedClaudeCodeDirectoryFile(relativePath)) {
        continue;
      }

      try {
        const file = await childHandle.getFile();
        entries.push({
          name: file.name || name,
          relativePath,
          text: await file.text(),
        });
      } catch (error) {
        skippedFiles.push(createSkippedFile(relativePath, error, "无法读取文件"));
      }
    }
  } catch (error) {
    skippedFiles.push(createSkippedFile(directoryPath, error, "无法读取目录"));
  }
}

/**
 * 递归读取 File System Access API 返回的目录句柄。
 *
 * 返回的数据可以直接传给 parseClaudeCodeDirectory(entries)。
 */
export async function collectClaudeCodeDirectoryEntries(directoryHandle) {
  if (!directoryHandle || directoryHandle.kind !== "directory") {
    throw new TypeError("请选择一个可读取的 Workflow 目录。");
  }

  if (typeof directoryHandle.entries !== "function") {
    throw new TypeError("当前浏览器无法读取所选目录。");
  }

  const rootName = directoryHandle.name || "workflow";
  const entries = [];
  const skippedFiles = [];

  await collectFromDirectoryHandle(directoryHandle, rootName, entries, skippedFiles);

  return {
    rootName,
    entries: sortEntries(entries),
    skippedFiles,
  };
}

function getUploadRootName(files) {
  for (const file of files) {
    const relativePath = normalizeRelativePath(file?.webkitRelativePath || "");
    if (relativePath.includes("/")) {
      return relativePath.split("/")[0];
    }
  }

  return "workflow";
}

/**
 * 读取 webkitdirectory 回退控件提供的 FileList。
 *
 * 该函数使 UI 在不支持 File System Access API 时仍能使用同一个目录选择按钮。
 */
export async function collectClaudeCodeDirectoryUploadEntries(files) {
  const uploadedFiles = Array.from(files || []);
  const rootName = getUploadRootName(uploadedFiles);
  const entries = [];
  const skippedFiles = [];

  for (const file of uploadedFiles) {
    const originalRelativePath = normalizeRelativePath(file?.webkitRelativePath || file?.name);
    const relativePath = originalRelativePath.includes("/")
      ? originalRelativePath
      : `${rootName}/${originalRelativePath}`;

    if (!isSupportedClaudeCodeDirectoryFile(relativePath)) {
      continue;
    }

    try {
      entries.push({
        name: file.name,
        relativePath,
        text: await file.text(),
      });
    } catch (error) {
      skippedFiles.push(createSkippedFile(relativePath, error, "无法读取文件"));
    }
  }

  return {
    rootName,
    entries: sortEntries(entries),
    skippedFiles,
  };
}
