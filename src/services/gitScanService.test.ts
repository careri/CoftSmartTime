import * as assert from "assert";
import * as vscode from "vscode";
import { GitScanService, FileStat, StatFunction } from "./gitScanService";
import { GitStatusReader } from "../storage/gitStatusReader";
import { Logger } from "../utils/logger";

suite("GitScanService Test Suite", () => {
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;

  setup(() => {
    outputChannel = vscode.window.createOutputChannel("GitScanService Test");
    logger = new Logger(outputChannel, true);
  });

  function fakeReader(files: string[], isRepository = true): GitStatusReader {
    return {
      getChangedFiles: async () => files,
      isRepository: async () => isRepository,
    } as unknown as GitStatusReader;
  }

  function fakeStat(entries: {
    [file: string]: { mtimeMs: number; isFile?: boolean } | "error";
  }): StatFunction {
    return async (filePath: string): Promise<FileStat> => {
      const entry = entries[filePath];
      if (entry === undefined || entry === "error") {
        throw new Error(`ENOENT: ${filePath}`);
      }
      return {
        isFile: () => entry.isFile !== false,
        mtimeMs: entry.mtimeMs,
      };
    };
  }

  test("canScan follows the reader's repository check", async () => {
    const inRepo = new GitScanService(
      fakeReader([], true),
      logger,
      fakeStat({}),
    );
    const outside = new GitScanService(
      fakeReader([], false),
      logger,
      fakeStat({}),
    );

    assert.strictEqual(await inRepo.canScan("/repo"), true);
    assert.strictEqual(await outside.canScan("/plain"), false);
  });

  test("returns files modified after the last scan", async () => {
    const service = new GitScanService(
      fakeReader(["/repo/a.txt", "/repo/b.txt"]),
      logger,
      fakeStat({
        "/repo/a.txt": { mtimeMs: 1500 },
        "/repo/b.txt": { mtimeMs: 500 },
      }),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, ["/repo/a.txt"]);
  });

  test("excludes a file whose mtime equals the last scan", async () => {
    const service = new GitScanService(
      fakeReader(["/repo/a.txt"]),
      logger,
      fakeStat({ "/repo/a.txt": { mtimeMs: 1000 } }),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("includes a file whose mtime equals now", async () => {
    const service = new GitScanService(
      fakeReader(["/repo/a.txt"]),
      logger,
      fakeStat({ "/repo/a.txt": { mtimeMs: 2000 } }),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, ["/repo/a.txt"]);
  });

  test("excludes a file with a future mtime", async () => {
    const service = new GitScanService(
      fakeReader(["/repo/a.txt"]),
      logger,
      fakeStat({ "/repo/a.txt": { mtimeMs: 9999 } }),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("excludes paths that are not files", async () => {
    const service = new GitScanService(
      fakeReader(["/repo/submodule"]),
      logger,
      fakeStat({ "/repo/submodule": { mtimeMs: 1500, isFile: false } }),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("skips files that vanish between status and stat", async () => {
    const service = new GitScanService(
      fakeReader(["/repo/gone.txt", "/repo/a.txt"]),
      logger,
      fakeStat({
        "/repo/gone.txt": "error",
        "/repo/a.txt": { mtimeMs: 1500 },
      }),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, ["/repo/a.txt"]);
  });

  test("returns nothing when git reports no candidates", async () => {
    const service = new GitScanService(fakeReader([]), logger, fakeStat({}));

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.deepStrictEqual(files, []);
  });

  test("returns every modified file when many changed", async () => {
    const paths: string[] = [];
    const stats: { [file: string]: { mtimeMs: number } } = {};
    for (let i = 0; i < 500; i++) {
      const file = `/repo/file${i}.txt`;
      paths.push(file);
      stats[file] = { mtimeMs: 1500 };
    }

    const service = new GitScanService(
      fakeReader(paths),
      logger,
      fakeStat(stats),
    );

    const files = await service.findModifiedSince("/repo", 1000, 2000);

    assert.strictEqual(files.length, 500);
  });
});
