import * as assert from "assert";
import { Logger } from "./logger";
import type * as vscode from "vscode";

function makeChannel(): { lines: string[]; channel: vscode.OutputChannel } {
  const lines: string[] = [];
  const channel = {
    appendLine(value: string): void {
      lines.push(value);
    },
    // stub remaining OutputChannel methods
    name: "test",
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

suite("Logger Test Suite", () => {
  test("info logs a message containing INFO level", () => {
    const { lines, channel } = makeChannel();
    const logger = new Logger(channel, false);
    logger.info("hello info");
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes("INFO"), "should contain INFO label");
    assert.ok(lines[0].includes("hello info"), "should contain the message");
  });

  test("error logs a message containing ERROR level", () => {
    const { lines, channel } = makeChannel();
    const logger = new Logger(channel, false);
    logger.error("something failed");
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes("ERROR"));
    assert.ok(lines[0].includes("something failed"));
  });

  test("debug logs message when debugEnabled is true", () => {
    const { lines, channel } = makeChannel();
    const logger = new Logger(channel, true);
    logger.debug("debug msg");
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes("DEBUG"));
    assert.ok(lines[0].includes("debug msg"));
  });

  test("debug suppresses message when debugEnabled is false", () => {
    const { lines, channel } = makeChannel();
    const logger = new Logger(channel, false);
    logger.debug("should not appear");
    assert.strictEqual(lines.length, 0, "debug message should be suppressed");
  });

  test("isDebugEnabled returns true when constructed with true", () => {
    const { channel } = makeChannel();
    const logger = new Logger(channel, true);
    assert.strictEqual(logger.isDebugEnabled(), true);
  });

  test("isDebugEnabled returns false when constructed with false", () => {
    const { channel } = makeChannel();
    const logger = new Logger(channel, false);
    assert.strictEqual(logger.isDebugEnabled(), false);
  });

  test("info message includes a timestamp", () => {
    const { lines, channel } = makeChannel();
    const logger = new Logger(channel, false);
    logger.info("ts test");
    // Timestamp format: [HH:MM:SS AM/PM] or [HH:MM:SS] depending on locale
    assert.ok(lines[0].startsWith("["), "should start with timestamp bracket");
  });

  test("multiple log calls all appear in output", () => {
    const { lines, channel } = makeChannel();
    const logger = new Logger(channel, true);
    logger.info("one");
    logger.debug("two");
    logger.error("three");
    assert.strictEqual(lines.length, 3);
  });
});
