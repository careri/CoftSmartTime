import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FileLock } from "../lock";

suite("Lock Test Suite", () => {
  let testDir: string;
  let outputChannel: vscode.OutputChannel;

  setup(async () => {
    testDir = path.join(os.tmpdir(), `coft-lock-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    outputChannel = vscode.window.createOutputChannel("Lock Test");
  });

  teardown(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("FileLock should acquire and release lock", async () => {
    const lock = new FileLock(testDir, outputChannel);

    const acquired = await lock.acquire(1000);
    assert.strictEqual(acquired, true);

    // Lock file should exist
    const lockPath = path.join(testDir, ".lock");
    const stat = await fs.stat(lockPath);
    assert.ok(stat.isFile());

    await lock.release();

    // Lock file should be gone
    try {
      await fs.stat(lockPath);
      assert.fail("Lock file should not exist after release");
    } catch (error: any) {
      assert.strictEqual(error.code, "ENOENT");
    }
  });

  test("FileLock should fail when lock is already held", async () => {
    const lock1 = new FileLock(testDir, outputChannel);
    const lock2 = new FileLock(testDir, outputChannel);

    const acquired1 = await lock1.acquire(1000);
    assert.strictEqual(acquired1, true);

    // Second lock should fail (short timeout)
    const acquired2 = await lock2.acquire(200);
    assert.strictEqual(acquired2, false);

    await lock1.release();
  });

  test("FileLock should succeed after previous lock is released", async () => {
    const lock1 = new FileLock(testDir, outputChannel);
    const lock2 = new FileLock(testDir, outputChannel);

    const acquired1 = await lock1.acquire(1000);
    assert.strictEqual(acquired1, true);
    await lock1.release();

    const acquired2 = await lock2.acquire(1000);
    assert.strictEqual(acquired2, true);
    await lock2.release();
  });

  test("FileLock should detect stale lock with invalid PID", async () => {
    // Write a lock file with a PID that doesn't exist
    const lockPath = path.join(testDir, ".lock");
    await fs.writeFile(lockPath, "999999999", "utf-8");

    const lock = new FileLock(testDir, outputChannel);
    const acquired = await lock.acquire(1000);
    assert.strictEqual(acquired, true);

    await lock.release();
  });

  test("FileLock should store current PID in lock file", async () => {
    const lock = new FileLock(testDir, outputChannel);
    await lock.acquire(1000);

    const lockPath = path.join(testDir, ".lock");
    const content = await fs.readFile(lockPath, "utf-8");
    assert.strictEqual(content, String(process.pid));

    await lock.release();
  });
});
