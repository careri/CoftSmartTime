import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProjectRepository } from "./projectRepository";
import { CoftConfig } from "../application/config";

function createTestConfig(testRoot: string): CoftConfig {
  return {
    root: testRoot,
    queue: path.join(testRoot, "queue"),
    queueBatch: path.join(testRoot, "queue_batch"),
    queueBackup: path.join(testRoot, "queue_backup"),
    operationQueue: path.join(testRoot, "operation_queue"),
    operationQueueBackup: path.join(testRoot, "operation_queue_backup"),
    data: path.join(testRoot, "data"),
    backup: path.join(testRoot, "backup"),
    intervalSeconds: 60,
    viewGroupByMinutes: 15,
    branchTaskUrl: "",
    exportDir: "",
    exportAgeDays: 90,
  };
}

suite("ProjectRepository Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let repository: ProjectRepository;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-project-repo-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = createTestConfig(testRoot);
    outputChannel = vscode.window.createOutputChannel("ProjectRepository Test");
    repository = new ProjectRepository(testConfig, outputChannel);

    // Create data directory
    await fs.mkdir(testConfig.data, { recursive: true });
  });

  teardown(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  test("addOrUpdateProject adds new project mapping", async () => {
    await repository.addOrUpdateProject("main", "/workspace", "TestProject");

    const projects = await repository.readProjects();
    assert.strictEqual(projects["main"]["/workspace"], "TestProject");
  });

  test("addOrUpdateProject updates existing project mapping", async () => {
    await repository.addOrUpdateProject("main", "/workspace", "TestProject");
    await repository.addOrUpdateProject("main", "/workspace", "UpdatedProject");

    const projects = await repository.readProjects();
    assert.strictEqual(projects["main"]["/workspace"], "UpdatedProject");
  });

  test("deleteProject removes project mapping", async () => {
    await repository.addOrUpdateProject("main", "/workspace", "TestProject");
    await repository.deleteProject("main", "/workspace");

    const projects = await repository.readProjects();
    assert.strictEqual(projects["main"], undefined);
  });

  test("deleteProject removes only the specified directory", async () => {
    await repository.addOrUpdateProject("main", "/workspace", "TestProject");
    await repository.addOrUpdateProject("main", "/other", "OtherProject");
    await repository.deleteProject("main", "/workspace");

    const projects = await repository.readProjects();
    assert.strictEqual(projects["main"]["/other"], "OtherProject");
    assert.strictEqual(projects["main"]["/workspace"], undefined);
  });

  test("addUnboundProject adds to _unbound array", async () => {
    await repository.addUnboundProject("NewProject");

    const projects = await repository.readProjects();
    assert.deepStrictEqual((projects as any)["_unbound"], ["NewProject"]);
  });

  test("addUnboundProject does not duplicate existing project", async () => {
    await repository.addUnboundProject("NewProject");
    await repository.addUnboundProject("NewProject");

    const projects = await repository.readProjects();
    assert.deepStrictEqual((projects as any)["_unbound"], ["NewProject"]);
  });
});
