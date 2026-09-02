import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import {
  ChangeWatcher,
  BranchResolver,
  QueueEntryWriter,
} from "./changeWatcher";
import { CoftConfig } from "./config";
import { ChangeScanner } from "../services/changeScanner";
import { GitScanService } from "../services/gitScanService";
import { Logger } from "../utils/logger";

interface WrittenEntry {
  workspaceRoot: string;
  relativePath: string;
  gitBranch?: string;
}

interface ScanCall {
  since: number;
  now: number;
}

/** Captures what the watcher writes to the output channel. */
function makeChannel(): { lines: string[]; channel: vscode.OutputChannel } {
  const lines: string[] = [];
  const channel = {
    name: "test",
    appendLine(value: string): void {
      lines.push(value);
    },
    append() {
      /* noop */
    },
    clear() {
      /* noop */
    },
    show() {
      /* noop */
    },
    hide() {
      /* noop */
    },
    dispose() {
      /* noop */
    },
    replace() {
      /* noop */
    },
  } as unknown as vscode.OutputChannel;
  return { lines, channel };
}

suite("ChangeWatcher Test Suite", () => {
  const workspaceRoot = path.join(os.tmpdir(), "coft-watcher-ws");
  let logged: string[];
  let logger: Logger;
  let config: CoftConfig;
  let written: WrittenEntry[];

  setup(() => {
    const { lines, channel } = makeChannel();
    logged = lines;
    logger = new Logger(channel, true);
    written = [];
    config = { changeScanSeconds: 30 } as CoftConfig;
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

  /** Git scanner returning a fixed list, recording the (since, now) it saw. */
  function fakeGitScanner(
    filesPerCall: string[][],
    calls: ScanCall[] = [],
    canScan = true,
  ): GitScanService {
    let call = 0;
    return {
      canScan: async () => canScan,
      findModifiedSince: async (_cwd: string, since: number, now: number) => {
        calls.push({ since, now });
        const files = filesPerCall[call] ?? [];
        call++;
        return files;
      },
    } as unknown as GitScanService;
  }

  function fakeFolderScanner(
    filesPerCall: string[][] = [],
    calls: ScanCall[] = [],
  ): ChangeScanner {
    let call = 0;
    return {
      findModifiedSince: async (_cwd: string, since: number, now: number) => {
        calls.push({ since, now });
        const files = filesPerCall[call] ?? [];
        call++;
        return files;
      },
    };
  }

  function makeWatcher(
    gitScanner: GitScanService,
    folders: vscode.WorkspaceFolder[] = [folder(workspaceRoot)],
    folderScanner: ChangeScanner = fakeFolderScanner(),
  ): ChangeWatcher {
    return new ChangeWatcher(
      config,
      storage,
      git,
      gitScanner,
      folderScanner,
      logger,
      () => folders,
    );
  }

  test("first scan only baselines the folder and writes nothing", async () => {
    const calls: ScanCall[] = [];
    const watcher = makeWatcher(
      fakeGitScanner([[path.join(workspaceRoot, "a.txt")]], calls),
    );

    const count = await watcher.scanOnce(1000);

    assert.strictEqual(count, 0);
    assert.strictEqual(calls.length, 0, "Should not scan on the first tick");
    assert.deepStrictEqual(written, []);
  });

  test("second scan queues modified files with the folder branch", async () => {
    const watcher = makeWatcher(
      fakeGitScanner([[path.join(workspaceRoot, "src", "a.ts")]]),
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
    const calls: ScanCall[] = [];
    const watcher = makeWatcher(fakeGitScanner([[], []], calls));

    await watcher.scanOnce(1000);
    await watcher.scanOnce(2000);
    await watcher.scanOnce(3000);

    assert.deepStrictEqual(calls, [
      { since: 1000, now: 2000 },
      { since: 2000, now: 3000 },
    ]);
  });

  test("falls back to the folder scanner when the folder is not a git repo", async () => {
    const gitCalls: ScanCall[] = [];
    const folderCalls: ScanCall[] = [];
    const watcher = makeWatcher(
      fakeGitScanner([[path.join(workspaceRoot, "git.txt")]], gitCalls, false),
      [folder(workspaceRoot)],
      fakeFolderScanner(
        [[path.join(workspaceRoot, "folder.txt")]],
        folderCalls,
      ),
    );

    await watcher.scanOnce(1000);
    const count = await watcher.scanOnce(2000);

    assert.strictEqual(count, 1);
    assert.deepStrictEqual(gitCalls, [], "Git scanner should not be used");
    assert.deepStrictEqual(folderCalls, [{ since: 1000, now: 2000 }]);
    assert.deepStrictEqual(
      written.map((entry) => entry.relativePath),
      ["folder.txt"],
    );
  });

  test("re-checks for a git repo on every tick", async () => {
    let isRepo = false;
    const gitCalls: ScanCall[] = [];
    const folderCalls: ScanCall[] = [];
    const gitScanner = {
      canScan: async () => isRepo,
      findModifiedSince: async (_cwd: string, since: number, now: number) => {
        gitCalls.push({ since, now });
        return [];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(
      gitScanner,
      [folder(workspaceRoot)],
      fakeFolderScanner([[], []], folderCalls),
    );

    await watcher.scanOnce(1000);
    await watcher.scanOnce(2000);
    isRepo = true;
    await watcher.scanOnce(3000);

    assert.deepStrictEqual(folderCalls, [{ since: 1000, now: 2000 }]);
    assert.deepStrictEqual(gitCalls, [{ since: 2000, now: 3000 }]);
  });

  test("does not advance the window when a scan fails", async () => {
    const calls: ScanCall[] = [];
    let failNext = true;
    const gitScanner = {
      canScan: async () => true,
      findModifiedSince: async (_cwd: string, since: number, now: number) => {
        calls.push({ since, now });
        if (failNext) {
          failNext = false;
          throw new Error("git exploded");
        }
        return [];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(gitScanner);

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
      fakeGitScanner([
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
    const gitScanner = {
      canScan: async () => true,
      findModifiedSince: async (cwd: string) => {
        scanned.push(cwd);
        return [path.join(cwd, "a.txt")];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(gitScanner, [
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
    const gitScanner = {
      canScan: async () => true,
      findModifiedSince: async () => {
        callCount++;
        await gate;
        return [];
      },
    } as unknown as GitScanService;
    const watcher = makeWatcher(gitScanner);

    await watcher.scanOnce(1000);
    const first = watcher.scanOnce(2000);
    const second = await watcher.scanOnce(3000);
    release();
    await first;

    assert.strictEqual(second, 0);
    assert.strictEqual(callCount, 1, "Second tick should have been skipped");
  });

  test("start does nothing when the scan is disabled", async () => {
    config = { changeScanSeconds: 0 } as CoftConfig;
    const calls: ScanCall[] = [];
    const watcher = makeWatcher(fakeGitScanner([[]], calls));

    watcher.start();
    watcher.stop();

    assert.deepStrictEqual(calls, []);
  });

  test("logs queued entries at INFO, so a scan is visible without debug logs", async () => {
    const { lines, channel } = makeChannel();
    logged = lines;
    logger = new Logger(channel, false);
    const watcher = makeWatcher(
      fakeGitScanner([[path.join(workspaceRoot, "a.txt")]]),
    );

    await watcher.scanOnce(1000);
    await watcher.scanOnce(2000);

    const queued = logged.filter((line) => line.includes("Change scan queued"));
    assert.strictEqual(queued.length, 1, logged.join("\n"));
    assert.ok(queued[0].includes("INFO"));
    assert.ok(queued[0].includes("1 entry/entries"));
    assert.ok(queued[0].includes("(git scan)"));
  });

  test("names the folder scanner in the log and stays quiet when nothing changed", async () => {
    const { lines, channel } = makeChannel();
    logged = lines;
    logger = new Logger(channel, false);
    const watcher = makeWatcher(
      fakeGitScanner([[]], [], false),
      [folder(workspaceRoot)],
      fakeFolderScanner([[path.join(workspaceRoot, "a.txt")], []]),
    );

    await watcher.scanOnce(1000);
    await watcher.scanOnce(2000);
    await watcher.scanOnce(3000);

    const queued = logged.filter((line) => line.includes("Change scan queued"));
    assert.strictEqual(queued.length, 1, logged.join("\n"));
    assert.ok(queued[0].includes("(folder scan)"));
  });

  test("no workspace folders is a no-op", async () => {
    const watcher = makeWatcher(fakeGitScanner([[]]), []);

    const count = await watcher.scanOnce(1000);

    assert.strictEqual(count, 0);
    assert.deepStrictEqual(written, []);
  });
});
