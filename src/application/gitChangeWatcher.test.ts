import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import {
  GitChangeWatcher,
  BranchResolver,
  QueueEntryWriter,
} from "./gitChangeWatcher";
import { CoftConfig } from "./config";
import { GitScanService } from "../services/gitScanService";
import { Logger } from "../utils/logger";

interface WrittenEntry {
  workspaceRoot: string;
  relativePath: string;
  gitBranch?: string;
}

suite("GitChangeWatcher Test Suite", () => {
  const workspaceRoot = path.join(os.tmpdir(), "coft-watcher-ws");
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;
  let config: CoftConfig;
  let written: WrittenEntry[];

  setup(() => {
    outputChannel = vscode.window.createOutputChannel("GitChangeWatcher Test");
    logger = new Logger(outputChannel, true);
    written = [];
    config = { gitScanSeconds: 30 } as CoftConfig;
  });

  const storage: QueueEntryWriter = {
    writeQueueEntry: async (root, relativePath, gitBranch) => {
      written.push({ workspaceRoot: root, relativePath, gitBranch });
    },
  };

  const git: BranchResolver = {
    getBranch: async () => "feature/test",
  };

  function folder(fsPath: string): vscode.WorkspaceFolder {
    return {
      uri: vscode.Uri.file(fsPath),
      name: path.basename(fsPath),
      index: 0,
    };
  }

  /** Scan service returning a fixed list, recording the (since, now) it saw. */
  function fakeScanService(
    filesPerCall: string[][],
    calls: { since: number; now: number }[] = [],
  ): GitScanService {
    let call = 0;
    return {
      findModifiedSince: async (_cwd: string, since: number, now: number) => {
        calls.push({ since, now });
        const files = filesPerCall[call] ?? [];
        call++;
        return files;
      },
    } as unknown as GitScanService;
  }

  function makeWatcher(
    scanService: GitScanService,
    folders: vscode.WorkspaceFolder[] = [folder(workspaceRoot)],
  ): GitChangeWatcher {
    return new GitChangeWatcher(
      config,
      storage,
      git,
      scanService,
      logger,
      () => folders,
    );
  }

  test("first scan only baselines the folder and writes nothing", async () => {
    const calls: { since: number; now: number }[] = [];
    const watcher = makeWatcher(
      fakeScanService([[path.join(workspaceRoot, "a.txt")]], calls),
    );

    const count = await watcher.scanOnce(1000);

    assert.strictEqual(count, 0);
    assert.strictEqual(calls.length, 0, "Should not scan on the first tick");
    assert.deepStrictEqual(written, []);
  });

  test("second scan queues modified files with the folder branch", async () => {
    const watcher = makeWatcher(
      fakeScanService([[path.join(workspaceRoot, "src", "a.ts")]]),
    );

    await watcher.scanOnce(1000);
    const count = await watcher.scanOnce(2000);

    assert.strictEqual(count, 1);
    assert.deepStrictEqual(written, [
      {
        workspaceRoot,
        relativePath: path.join("src", "a.ts"),
        gitBranch: "feature/test",
      },
    ]);
  });

  test("uses the previous tick timestamp as the scan window", async () => {
    const calls: { since: number; now: number }[] = [];
    const watcher = makeWatcher(fakeScanService([[], []], calls));

    await watcher.scanOnce(1000);
    await watcher.scanOnce(2000);
    await watcher.scanOnce(3000);

    assert.deepStrictEqual(calls, [
      { since: 1000, now: 2000 },
      { since: 2000, now: 3000 },
    ]);
  });

  test("does not advance the window when a scan fails", async () => {
    const calls: { since: number; now: number }[] = [];
    let failNext = true;
    const scanService = {
      findModifiedSince: async (_cwd: string, since: number, now: number) => {
        calls.push({ since, now });
        if (failNext) {
          failNext = false;
          throw new Error("git exploded");
        }
        return [];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(scanService);

    await watcher.scanOnce(1000);
    await watcher.scanOnce(2000);
    await watcher.scanOnce(3000);

    assert.deepStrictEqual(calls, [
      { since: 1000, now: 2000 },
      { since: 1000, now: 3000 },
    ]);
  });

  test("skips files resolved outside the workspace folder", async () => {
    const watcher = makeWatcher(
      fakeScanService([
        [
          path.join(path.dirname(workspaceRoot), "outside.txt"),
          path.join(workspaceRoot, "inside.txt"),
        ],
      ]),
    );

    await watcher.scanOnce(1000);
    const count = await watcher.scanOnce(2000);

    assert.strictEqual(count, 1);
    assert.deepStrictEqual(
      written.map((entry) => entry.relativePath),
      ["inside.txt"],
    );
  });

  test("tracks each workspace folder independently", async () => {
    const otherRoot = path.join(os.tmpdir(), "coft-watcher-ws2");
    const scanned: string[] = [];
    const scanService = {
      findModifiedSince: async (cwd: string) => {
        scanned.push(cwd);
        return [path.join(cwd, "a.txt")];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(scanService, [
      folder(workspaceRoot),
      folder(otherRoot),
    ]);

    await watcher.scanOnce(1000);
    const count = await watcher.scanOnce(2000);

    assert.strictEqual(count, 2);
    assert.deepStrictEqual(scanned, [workspaceRoot, otherRoot]);
    assert.deepStrictEqual(
      written.map((entry) => entry.workspaceRoot).sort(),
      [otherRoot, workspaceRoot].sort(),
    );
  });

  test("skips a tick while the previous scan is still running", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let callCount = 0;
    const scanService = {
      findModifiedSince: async () => {
        callCount++;
        await gate;
        return [];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(scanService);

    await watcher.scanOnce(1000);
    const first = watcher.scanOnce(2000);
    const second = await watcher.scanOnce(3000);
    release();
    await first;

    assert.strictEqual(second, 0);
    assert.strictEqual(callCount, 1, "Second tick should have been skipped");
  });

  test("start does nothing when the scan is disabled", async () => {
    config = { gitScanSeconds: 0 } as CoftConfig;
    const calls: { since: number; now: number }[] = [];
    const watcher = makeWatcher(fakeScanService([[]], calls));

    watcher.start();
    watcher.stop();

    assert.deepStrictEqual(calls, []);
  });

  test("no workspace folders is a no-op", async () => {
    const watcher = makeWatcher(fakeScanService([[]]), []);

    const count = await watcher.scanOnce(1000);

    assert.strictEqual(count, 0);
    assert.deepStrictEqual(written, []);
  });
});
