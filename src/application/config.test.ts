import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { ConfigManager, getStartDayOfWeek } from "./config";
import { Logger } from "../utils/logger";

suite("Config Test Suite", () => {
  test("ConfigManager should return valid config", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    assert.ok(config);
    assert.ok(config.root);
    assert.ok(config.queue);
    assert.ok(config.queueBatch);
    assert.ok(config.queueBackup);
    assert.ok(config.data);
    assert.strictEqual(typeof config.intervalSeconds, "number");
    assert.strictEqual(typeof config.viewGroupByMinutes, "number");
  });

  test("ConfigManager should validate intervalSeconds", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    assert.ok(config);
    assert.ok(config.intervalSeconds >= 60);
    assert.ok(config.intervalSeconds <= 300);
  });

  test("ConfigManager should validate viewGroupByMinutes", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    assert.ok(config);
    assert.ok(config.viewGroupByMinutes > 0);
    assert.ok(config.viewGroupByMinutes <= 60);
    assert.strictEqual(60 % config.viewGroupByMinutes, 0);
  });

  test("ConfigManager should use default root when not configured", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    const expectedDefault = path.join(os.homedir(), ".coft.smarttime");
    assert.strictEqual(config.root, expectedDefault);
  });

  test("ConfigManager should derive subdirectory paths from root", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    assert.strictEqual(config.queue, path.join(config.root, "queue"));
    assert.strictEqual(
      config.queueBatch,
      path.join(config.root, "queue_batch"),
    );
    assert.strictEqual(
      config.queueBackup,
      path.join(config.root, "queue_backup"),
    );
    assert.strictEqual(
      config.operationQueue,
      path.join(config.root, "operation_queue"),
    );
    assert.strictEqual(
      config.operationQueueBackup,
      path.join(config.root, "operation_queue_backup"),
    );
    assert.strictEqual(config.data, path.join(config.root, "data"));
  });

  test("ConfigManager getConfig should never return null", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    // getConfig always returns a valid CoftConfig
    assert.notStrictEqual(config, null);
    assert.notStrictEqual(config, undefined);
  });

  test("ConfigManager isValidPath should reject relative paths", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);

    // Access private method via any cast for testing
    const isValidPath = (configManager as any).isValidPath.bind(configManager);

    assert.strictEqual(isValidPath("relative/path"), false);
    assert.strictEqual(isValidPath(""), false);
    assert.strictEqual(isValidPath("foo"), false);
  });

  test("ConfigManager isValidPath should reject paths with null bytes", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);

    const isValidPath = (configManager as any).isValidPath.bind(configManager);

    assert.strictEqual(isValidPath("/valid/path\0/bad"), false);
  });

  test("ConfigManager isValidPath should accept valid absolute paths", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);

    const isValidPath = (configManager as any).isValidPath.bind(configManager);

    assert.strictEqual(isValidPath("/home/user/.coft.smarttime"), true);
    assert.strictEqual(isValidPath("/tmp/test"), true);
  });

  test("ConfigManager should return branchTaskUrl from config", () => {
    const outputChannel = vscode.window.createOutputChannel("Test");
    const logger = new Logger(outputChannel, true);
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    assert.strictEqual(typeof config.branchTaskUrl, "string");
  });
});

suite("getStartDayOfWeek Test Suite", () => {
  test("getStartDayOfWeek should return 0 for sunday", () => {
    assert.strictEqual(getStartDayOfWeek("sunday"), 0);
  });

  test("getStartDayOfWeek should return 1 for monday", () => {
    assert.strictEqual(getStartDayOfWeek("monday"), 1);
  });

  test("getStartDayOfWeek should return culture default for auto", () => {
    const result = getStartDayOfWeek("auto");
    assert.ok(result === 0 || result === 1); // Should be 0 or 1
  });
});
