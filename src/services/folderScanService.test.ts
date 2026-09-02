import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FolderScanService } from "./folderScanService";
import { Logger } from "../utils/logger";

suite("FolderScanService Test Suite", () => {
  let testRoot: string;
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;
  let service: FolderScanService;

  /** Writes a file and stamps it with an explicit mtime. */
  async function writeFileAt(
    relativePath: string,
    mtimeMs: number,
  ): Promise<string> {
    const fullPath = path.join(testRoot, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, "content", "utf-8");
    const stamp = new Date(mtimeMs);
    await fs.utimes(fullPath, stamp, stamp);
    return fullPath;
  }

  setup(async () => {
    testRoot = path.join(
      os.tmpdir(),
      `coft-folderscan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testRoot, { recursive: true });
    outputChannel = vscode.window.createOutputChannel("FolderScanService Test");
    logger = new Logger(outputChannel, true);
    service = new FolderScanService(logger);
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns files modified inside the window", async () => {
    const changed = await writeFileAt("changed.txt", 1500);
    await writeFileAt("old.txt", 500);

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, [changed]);
  });

  test("finds files in nested directories", async () => {
    const nested = await writeFileAt(path.join("a", "b", "c.txt"), 1500);

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, [nested]);
  });

  test("excludes a file whose mtime equals the last scan", async () => {
    await writeFileAt("edge.txt", 1000);

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("excludes a file with a future mtime", async () => {
    await writeFileAt("future.txt", 9999);

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("skips generated directories", async () => {
    await writeFileAt(path.join("node_modules", "dep", "index.js"), 1500);
    await writeFileAt(path.join("out", "bundle.js"), 1500);
    await writeFileAt(path.join("dist", "app.js"), 1500);
    const kept = await writeFileAt(path.join("src", "app.ts"), 1500);

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, [kept]);
  });

  test("skips hidden directories but keeps hidden files", async () => {
    await writeFileAt(path.join(".git", "index"), 1500);
    const hiddenFile = await writeFileAt(".env", 1500);

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, [hiddenFile]);
  });

  test("returns nothing for an empty folder", async () => {
    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("returns nothing for a missing folder", async () => {
    const files = await service.findModifiedSince(
      path.join(testRoot, "nope"),
      1000,
      2000,
    );

    assert.deepStrictEqual(files, []);
  });

  test("does not follow symlinked directories", async () => {
    const linkTarget = path.join(testRoot, "real");
    await fs.mkdir(linkTarget, { recursive: true });
    await writeFileAt(path.join("real", "file.txt"), 1500);
    await fs.symlink(linkTarget, path.join(testRoot, "link"), "dir");

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    // Found once through the real directory, not again through the symlink.
    assert.deepStrictEqual(files, [path.join(linkTarget, "file.txt")]);
  });

  test("finds many modified files", async () => {
    for (let i = 0; i < 50; i++) {
      await writeFileAt(`file${i}.txt`, 1500);
    }

    const files = await service.findModifiedSince(testRoot, 1000, 2000);

    assert.strictEqual(files.length, 50);
  });
});
