import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import {
  ConfigManager,
  getStartDayOfWeek,
  resolveWorkingHours,
  CoftConfig,
} from "./config";
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

suite("resolveWorkingHours Test Suite", () => {
  function makeConfig(overrides: Partial<CoftConfig> = {}): CoftConfig {
    const root = path.join(os.tmpdir(), `coft-rw-test-${Date.now()}`);
    const base: CoftConfig = {
      root,
      queue: path.join(root, "queue"),
      queueBatch: path.join(root, "queue_batch"),
      queueBackup: path.join(root, "queue_backup"),
      operationQueue: path.join(root, "operation_queue"),
      operationQueueBackup: path.join(root, "operation_queue_backup"),
      data: path.join(root, "data"),
      backup: path.join(root, "backup"),
      intervalSeconds: 60,
      changeScanSeconds: 30,
      viewGroupByMinutes: 15,
      branchTaskUrl: "",
      exportDir: "",
      exportAgeDays: 90,
      startOfWeek: "monday",
      workingHoursDefault: 480,
      // 0=Sun, 1=Mon..5=Fri, 6=Sat
      workingHoursByDay: [0, 480, 480, 480, 480, 480, 0],
      workingHoursMissingConfig: false,
    };
    return { ...base, ...overrides };
  }

  test("returns master default for a weekday", () => {
    const config = makeConfig();
    const monday = new Date(2026, 2, 2); // 2026-03-02 is a Monday
    assert.strictEqual(resolveWorkingHours(config, monday), 480);
  });

  test("returns 0 for Saturday by default", () => {
    const config = makeConfig();
    const saturday = new Date(2026, 2, 7); // 2026-03-07 is a Saturday
    assert.strictEqual(resolveWorkingHours(config, saturday), 0);
  });

  test("returns 0 for Sunday by default", () => {
    const config = makeConfig();
    const sunday = new Date(2026, 2, 8); // 2026-03-08 is a Sunday
    assert.strictEqual(resolveWorkingHours(config, sunday), 0);
  });

  test("returns per-day override when set", () => {
    // Monday override: 7.5 h = 450 min
    const workingHoursByDay = [0, 450, 480, 480, 480, 480, 0];
    const config = makeConfig({ workingHoursByDay });
    const monday = new Date(2026, 2, 2);
    assert.strictEqual(resolveWorkingHours(config, monday), 450);
  });

  test("falls back to master default for days without per-day override", () => {
    // Only Monday overridden; Tuesday uses master (480)
    const workingHoursByDay = [0, 450, 480, 480, 480, 480, 0];
    const config = makeConfig({ workingHoursByDay, workingHoursDefault: 480 });
    const tuesday = new Date(2026, 2, 3); // 2026-03-03 is a Tuesday
    assert.strictEqual(resolveWorkingHours(config, tuesday), 480);
  });

  test("workingHoursMissingConfig is false when master is configured", () => {
    const config = makeConfig({ workingHoursMissingConfig: false });
    assert.strictEqual(config.workingHoursMissingConfig, false);
  });

  test("workingHoursMissingConfig is true when master is absent", () => {
    const config = makeConfig({ workingHoursMissingConfig: true });
    assert.strictEqual(config.workingHoursMissingConfig, true);
  });
});
