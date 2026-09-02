import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { GitStatusReader } from "./gitStatusReader";
import { Logger } from "../utils/logger";

const execAsync = promisify(exec);

suite("GitStatusReader Test Suite", () => {
  let testRoot: string;
  let repo: string;
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;
  let reader: GitStatusReader;

  async function git(command: string): Promise<void> {
    await execAsync(`git ${command}`, { cwd: repo });
  }

  setup(async () => {
    testRoot = path.join(
      os.tmpdir(),
      `coft-gitstatus-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    repo = path.join(testRoot, "repo");
    await fs.mkdir(repo, { recursive: true });

    outputChannel = vscode.window.createOutputChannel("GitStatusReader Test");
    logger = new Logger(outputChannel, true);
    reader = new GitStatusReader(logger);

    await git("init");
    await git('config user.name "Test"');
    await git('config user.email "test@test.local"');
    await fs.writeFile(path.join(repo, "tracked.txt"), "original", "utf-8");
    await fs.writeFile(path.join(repo, "deleteme.txt"), "gone soon", "utf-8");
    await fs.writeFile(path.join(repo, "renameme.txt"), "rename me", "utf-8");
    await fs.writeFile(path.join(repo, ".gitignore"), "ignored/\n", "utf-8");
    await git("add .");
    await git('commit -m "initial"');
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("isRepository is true inside a repo and false outside", async () => {
    const plain = path.join(testRoot, "plain");
    await fs.mkdir(plain, { recursive: true });

    assert.strictEqual(await reader.isRepository(repo), true);
    assert.strictEqual(
      await reader.isRepository(path.join(repo, "sub-missing")),
      false,
    );
    assert.strictEqual(await reader.isRepository(plain), false);
  });

  test("returns nothing for a clean repo", async () => {
    const files = await reader.getChangedFiles(repo);
    assert.deepStrictEqual(files, []);
  });

  test("reports a modified tracked file as an absolute path", async () => {
    await fs.writeFile(path.join(repo, "tracked.txt"), "changed", "utf-8");

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files, [path.join(repo, "tracked.txt")]);
  });

  test("reports untracked files individually, including in new directories", async () => {
    await fs.mkdir(path.join(repo, "newdir"), { recursive: true });
    await fs.writeFile(path.join(repo, "newdir", "a.txt"), "a", "utf-8");
    await fs.writeFile(path.join(repo, "newdir", "b.txt"), "b", "utf-8");

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files.sort(), [
      path.join(repo, "newdir", "a.txt"),
      path.join(repo, "newdir", "b.txt"),
    ]);
  });

  test("skips gitignored files", async () => {
    await fs.mkdir(path.join(repo, "ignored"), { recursive: true });
    await fs.writeFile(path.join(repo, "ignored", "out.txt"), "out", "utf-8");

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files, []);
  });

  test("skips deleted files", async () => {
    await fs.rm(path.join(repo, "deleteme.txt"));

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files, []);
  });

  test("reports the destination of a rename but not the source", async () => {
    await git("mv renameme.txt renamed.txt");

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files, [path.join(repo, "renamed.txt")]);
  });

  test("handles paths with spaces and special characters", async () => {
    const name = "a file with spaces & stuff.txt";
    await fs.writeFile(path.join(repo, name), "x", "utf-8");

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files, [path.join(repo, name)]);
  });

  test("resolves paths relative to the repo root when run from a subdirectory", async () => {
    const subdir = path.join(repo, "sub");
    await fs.mkdir(subdir, { recursive: true });
    await fs.writeFile(path.join(repo, "tracked.txt"), "changed", "utf-8");

    const files = await reader.getChangedFiles(subdir);

    assert.deepStrictEqual(files, [path.join(repo, "tracked.txt")]);
  });

  test("returns nothing for a folder that is not a git repo", async () => {
    const plain = path.join(testRoot, "plain");
    await fs.mkdir(plain, { recursive: true });
    await fs.writeFile(path.join(plain, "file.txt"), "x", "utf-8");

    const files = await reader.getChangedFiles(plain);

    assert.deepStrictEqual(files, []);
  });

  test("returns nothing for a missing folder", async () => {
    const files = await reader.getChangedFiles(
      path.join(testRoot, "does-not-exist"),
    );
    assert.deepStrictEqual(files, []);
  });

  test("reports staged changes as well as unstaged", async () => {
    await fs.writeFile(path.join(repo, "staged.txt"), "staged", "utf-8");
    await git("add staged.txt");

    const files = await reader.getChangedFiles(repo);

    assert.deepStrictEqual(files, [path.join(repo, "staged.txt")]);
  });
});
