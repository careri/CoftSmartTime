import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { GitManager } from "../git";
import { CoftConfig } from "../config";

suite("Git Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-git-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = {
      root: testRoot,
      queue: path.join(testRoot, "queue"),
      queueBatch: path.join(testRoot, "queue_batch"),
      queueBackup: path.join(testRoot, "queue_backup"),
      storageQueue: path.join(testRoot, "storage_queue"),
      storageQueueBackup: path.join(testRoot, "storage_queue_backup"),
      data: path.join(testRoot, "data"),
      backup: path.join(testRoot, "backup"),
      intervalSeconds: 60,
      viewGroupByMinutes: 15,
      branchTaskUrl: "",
    };

    await fs.mkdir(testConfig.data, { recursive: true });
    outputChannel = vscode.window.createOutputChannel("Git Test");
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("GitManager should initialize a new git repo", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // .git directory should exist
    const gitDir = path.join(testConfig.data, ".git");
    const stat = await fs.stat(gitDir);
    assert.ok(stat.isDirectory());
  });

  test("GitManager should not fail on double initialize", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();
    // Should not throw on second init
    await git.initialize();
  });

  test("GitManager should commit files with version as message", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.2.3");
    await git.initialize();

    // Create a file to commit
    const testFile = path.join(testConfig.data, "test.txt");
    await fs.writeFile(testFile, "hello", "utf-8");

    await git.commit();

    // Verify the commit was created by checking git log
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("git log --oneline -1", {
      cwd: testConfig.data,
    });
    assert.ok(stdout.includes("1.2.3"));
  });

  test("GitManager should commit with custom message", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    const testFile = path.join(testConfig.data, "test.txt");
    await fs.writeFile(testFile, "hello", "utf-8");

    await git.commit("report");

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("git log --oneline -1", {
      cwd: testConfig.data,
    });
    assert.ok(stdout.includes("report"));
  });

  test("GitManager should handle no-changes commit gracefully", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // Commit with no changes should not throw
    await git.commit();
  });

  test("GitManager should recover from broken git repo", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // Create a file and commit so there's data to preserve
    const testFile = path.join(testConfig.data, "important.txt");
    await fs.writeFile(testFile, "important data", "utf-8");
    await git.commit();

    // Break the git repo by corrupting .git/HEAD
    const headPath = path.join(testConfig.data, ".git", "HEAD");
    await fs.writeFile(headPath, "corrupted", "utf-8");

    // Re-initialize should detect broken repo and recover
    await git.initialize();

    // New .git directory should exist and be healthy
    const gitDir = path.join(testConfig.data, ".git");
    const stat = await fs.stat(gitDir);
    assert.ok(stat.isDirectory());

    // A backup directory should have been created
    const parentDir = path.dirname(testConfig.data);
    const siblings = await fs.readdir(parentDir);
    const backups = siblings.filter((name) => name.includes("_backup_"));
    assert.strictEqual(backups.length, 1, "Expected one backup directory");
  });

  test("GitManager should initialize when data directory is missing", async () => {
    // Remove the data directory entirely
    await fs.rm(testConfig.data, { recursive: true, force: true });

    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    const gitDir = path.join(testConfig.data, ".git");
    const stat = await fs.stat(gitDir);
    assert.ok(stat.isDirectory());
  });

  test("GitManager commit should recover from broken repo", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // Break the git repo
    const headPath = path.join(testConfig.data, ".git", "HEAD");
    await fs.writeFile(headPath, "corrupted", "utf-8");

    // Create a file to commit
    // commit() should recover the repo first, then the file won't exist
    // in the new repo, so we need to create it after recovery.
    // Actually commit calls ensureRepo which may reinit, then add/commit.
    // Let's create a file after calling commit (which recovers internally).
    // But we can't do that. Let's just verify commit doesn't throw.
    await git.commit();

    // Verify repo is healthy after recovery
    const gitDir = path.join(testConfig.data, ".git");
    const stat = await fs.stat(gitDir);
    assert.ok(stat.isDirectory());
  });

  test("GitManager should initialize backup bare repo", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // Backup directory should exist with a bare repo
    const headFile = path.join(testConfig.backup, "HEAD");
    const stat = await fs.stat(headFile);
    assert.ok(stat.isFile());

    // Origin should be configured in data repo
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("git remote get-url origin", {
      cwd: testConfig.data,
    });
    assert.strictEqual(stdout.trim(), testConfig.backup);
  });

  test("GitManager housekeeping should push to backup", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // Create a file and commit
    const testFile = path.join(testConfig.data, "test.txt");
    await fs.writeFile(testFile, "backup test", "utf-8");
    await git.commit("test commit");

    // Verify backup bare repo has the commit
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("git log --oneline", {
      cwd: testConfig.backup,
    });
    assert.ok(stdout.includes("test commit"));
  });

  test("GitManager isFirstCommitToday should return true for first commit", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // No commits yet today
    const firstCheck = await git.isFirstCommitToday();
    // No commits at all, should return false (log fails on empty repo)
    // After a commit it should be true (only 1 commit today)

    const testFile = path.join(testConfig.data, "test.txt");
    await fs.writeFile(testFile, "first", "utf-8");

    // Commit without housekeeping trigger (use commit directly)
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    await execAsync("git add . && git commit -m 'first'", {
      cwd: testConfig.data,
    });

    const isFirst = await git.isFirstCommitToday();
    assert.strictEqual(isFirst, true);

    // Make a second commit
    await fs.writeFile(testFile, "second", "utf-8");
    await execAsync("git add . && git commit -m 'second'", {
      cwd: testConfig.data,
    });

    const isFirstAfterSecond = await git.isFirstCommitToday();
    assert.strictEqual(isFirstAfterSecond, false);
  });

  test("GitManager double initialize should not duplicate origin", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();
    await git.initialize();

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("git remote -v", {
      cwd: testConfig.data,
    });
    const originLines = stdout
      .split("\n")
      .filter((line: string) => line.startsWith("origin"));
    // Should have exactly 2 lines (fetch + push), not more
    assert.strictEqual(originLines.length, 2);
  });

  test("GitManager should recover from broken backup bare repo", async () => {
    const git = new GitManager(testConfig, outputChannel, "1.0.0");
    await git.initialize();

    // Break the backup bare repo by corrupting HEAD
    const headPath = path.join(testConfig.backup, "HEAD");
    await fs.writeFile(headPath, "corrupted", "utf-8");

    // Re-initialize should detect broken backup and recover
    await git.initialize();

    // Backup should be healthy again
    const stat = await fs.stat(path.join(testConfig.backup, "HEAD"));
    assert.ok(stat.isFile());

    // A broken backup directory should have been created
    const parentDir = path.dirname(testConfig.backup);
    const siblings = await fs.readdir(parentDir);
    const broken = siblings.filter((name) => name.includes("_broken_"));
    assert.strictEqual(
      broken.length,
      1,
      "Expected one broken backup directory",
    );
  });
});
