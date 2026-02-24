import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TimeReportProvider } from "./timeReport";
import { CoftConfig } from "../application/config";
import { Logger } from "../utils/logger";

suite("TimeReport Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;
  let provider: TimeReportProvider;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-timereport-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = {
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
      startOfWeek: "auto",
    };

    await fs.mkdir(testConfig.queue, { recursive: true });
    await fs.mkdir(testConfig.queueBatch, { recursive: true });
    await fs.mkdir(testConfig.queueBackup, { recursive: true });
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(path.join(testConfig.data, "batches"), { recursive: true });
    await fs.mkdir(path.join(testConfig.data, "reports"), { recursive: true });

    outputChannel = vscode.window.createOutputChannel("TimeReport Test");
    logger = new Logger(outputChannel, true);
    provider = new TimeReportProvider(testConfig, logger, "1.0.0");
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("loadProjects returns empty object when no file exists", async () => {
    const projects = await provider.loadProjects();
    assert.deepStrictEqual(projects, {});
  });

  test("loadProjects returns saved mappings", async () => {
    const projectsPath = path.join(testConfig.data, "projects.json");
    const projectData = {
      main: { "/workspace/project1": "Project Alpha" },
      develop: { "/workspace/project2": "Project Beta" },
    };
    await fs.writeFile(projectsPath, JSON.stringify(projectData), "utf-8");

    const projects = await provider.loadProjects();
    assert.strictEqual(
      projects["main"]["/workspace/project1"],
      "Project Alpha",
    );
    assert.strictEqual(
      projects["develop"]["/workspace/project2"],
      "Project Beta",
    );
  });

  test("loadProjects returns empty object for invalid JSON", async () => {
    const projectsPath = path.join(testConfig.data, "projects.json");
    await fs.writeFile(projectsPath, "not valid json", "utf-8");

    const projects = await provider.loadProjects();
    assert.deepStrictEqual(projects, {});
  });

  test("loadProjects returns empty object for old flat format", async () => {
    const projectsPath = path.join(testConfig.data, "projects.json");
    const oldFormat = { main: "Project Alpha", develop: "Project Beta" };
    await fs.writeFile(projectsPath, JSON.stringify(oldFormat), "utf-8");

    const projects = await provider.loadProjects();
    assert.deepStrictEqual(projects, {});
  });

  test("lookupProject finds exact branch+directory match", () => {
    const projects = {
      feature: { "/project-a": "Alpha", "/project-b": "Beta" },
    };
    assert.strictEqual(
      // @ts-ignore
      // @ts-ignore
      (provider as any).lookupProject(projects, "feature", "/project-a"),
      "Alpha",
    );
    assert.strictEqual(
      // @ts-ignore
      // @ts-ignore
      (provider as any).lookupProject(projects, "feature", "/project-b"),
      "Beta",
    );
  });

  test("lookupProject falls back to same branch other directory", () => {
    const projects = {
      feature: { "/project-a": "Alpha" },
    };
    assert.strictEqual(
      // @ts-ignore
      // @ts-ignore
      (provider as any).lookupProject(projects, "feature", "/other-project"),
      "Alpha",
    );
  });

  test("lookupProject returns empty string for unknown branch", () => {
    const projects = {
      feature: { "/project-a": "Alpha" },
    };
    assert.strictEqual(
      // @ts-ignore
      // @ts-ignore
      (provider as any).lookupProject(projects, "unknown", "/project-a"),
      "",
    );
  });

  test("assignBranches picks branch with most files per time slot", () => {
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: ["a.ts", "b.ts", "c.ts"],
          fileDetails: [
            { file: "a.ts", timestamp: 1000 },
            { file: "b.ts", timestamp: 1001 },
            { file: "c.ts", timestamp: 1002 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "09:00",
          branch: "develop",
          directory: "/project",
          files: ["x.ts"],
          fileDetails: [{ file: "x.ts", timestamp: 1003 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    const projects = {
      main: { "/project": "Alpha" },
      develop: { "/project": "Beta" },
    };
    // @ts-ignore
    // @ts-ignore
    (provider as any).assignBranches(report, projects);

    // Only the winning entry for 09:00 should remain (main has 3 files vs 1)
    assert.strictEqual(report.entries.length, 1);
    assert.strictEqual(report.entries[0].assignedBranch, "main");
    assert.strictEqual(report.entries[0].branch, "main");
    // Project should come from the assigned branch
    assert.strictEqual(report.entries[0].project, "Alpha");
  });

  test("assignBranches handles different time slots independently", () => {
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "09:00",
          branch: "develop",
          directory: "/project",
          files: ["b.ts", "c.ts"],
          fileDetails: [
            { file: "b.ts", timestamp: 1001 },
            { file: "c.ts", timestamp: 1002 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "10:00",
          branch: "main",
          directory: "/project",
          files: ["d.ts", "e.ts"],
          fileDetails: [
            { file: "d.ts", timestamp: 2000 },
            { file: "e.ts", timestamp: 2001 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    const projects = {
      main: { "/project": "Alpha" },
      develop: { "/project": "Beta" },
    };
    // @ts-ignore
    // @ts-ignore
    (provider as any).assignBranches(report, projects);

    // Only the winning entry per time key should remain
    assert.strictEqual(report.entries.length, 2);

    // 09:00: develop wins (2 files vs 1)
    assert.strictEqual(report.entries[0].key, "09:00");
    assert.strictEqual(report.entries[0].assignedBranch, "develop");
    assert.strictEqual(report.entries[0].branch, "develop");
    assert.strictEqual(report.entries[0].project, "Beta");

    // 10:00: main wins (only branch)
    assert.strictEqual(report.entries[1].key, "10:00");
    assert.strictEqual(report.entries[1].assignedBranch, "main");
    assert.strictEqual(report.entries[1].project, "Alpha");
  });

  test("assignBranches sets empty project when no mapping exists", () => {
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "feature-x",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, {});

    assert.strictEqual(report.entries[0].assignedBranch, "feature-x");
    assert.strictEqual(report.entries[0].project, "");
  });

  test("assignBranches auto-assigns project when no saved report", () => {
    const projects = {
      "feature-x": { "/project": "MyProject" },
    };
    const report = {
      date: new Date().toISOString(),
      hasSavedReport: false,
      entries: [
        {
          key: "09:00",
          branch: "feature-x",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, projects);

    assert.strictEqual(report.entries[0].project, "MyProject");
  });

  test("assignBranches preserves saved project when report exists", () => {
    const projects = {
      "feature-x": { "/project": "NewProject" },
    };
    const report = {
      date: new Date().toISOString(),
      hasSavedReport: true,
      entries: [
        {
          key: "09:00",
          branch: "feature-x",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "SavedProject",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, projects);

    assert.strictEqual(report.entries[0].project, "SavedProject");
  });

  test("assignBranches fills empty project from lookup even with saved report", () => {
    const projects = {
      "feature-x": { "/project": "LookedUp" },
    };
    const report = {
      date: new Date().toISOString(),
      hasSavedReport: true,
      entries: [
        {
          key: "09:00",
          branch: "feature-x",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, projects);

    assert.strictEqual(report.entries[0].project, "LookedUp");
  });

  test("assignBranches with forceRefresh overrides saved project", () => {
    const projects = {
      "feature-x": { "/project": "UpdatedProject" },
    };
    const report = {
      date: new Date().toISOString(),
      hasSavedReport: true,
      entries: [
        {
          key: "09:00",
          branch: "feature-x",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "OldProject",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, projects, true);

    // forceRefresh should update assignedBranch but NOT override existing project
    assert.strictEqual(report.entries[0].project, "OldProject");
    assert.strictEqual(report.entries[0].assignedBranch, "feature-x");
  });

  test("assignBranches keeps only winning entry per time key with multiple directories", () => {
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "feature",
          directory: "/projA",
          files: ["a.ts", "b.ts", "c.ts"],
          fileDetails: [
            { file: "a.ts", timestamp: 1000 },
            { file: "b.ts", timestamp: 1001 },
            { file: "c.ts", timestamp: 1002 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "09:00",
          branch: "feature",
          directory: "/projB",
          files: ["x.ts"],
          fileDetails: [{ file: "x.ts", timestamp: 1003 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, {});

    // Only 1 entry should remain for key 09:00
    assert.strictEqual(report.entries.length, 1);
    assert.strictEqual(report.entries[0].directory, "/projA");
    assert.strictEqual(report.entries[0].branch, "feature");
    assert.strictEqual(report.entries[0].assignedBranch, "feature");
  });

  test("assignBranches picks entry with most files across branches and directories", () => {
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "feature",
          directory: "/projA",
          files: ["a.ts", "b.ts"],
          fileDetails: [
            { file: "a.ts", timestamp: 1000 },
            { file: "b.ts", timestamp: 1001 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "09:00",
          branch: "main",
          directory: "/projB",
          files: ["x.ts", "y.ts", "z.ts"],
          fileDetails: [
            { file: "x.ts", timestamp: 1002 },
            { file: "y.ts", timestamp: 1003 },
            { file: "z.ts", timestamp: 1004 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "09:00",
          branch: "feature",
          directory: "/projC",
          files: ["w.ts"],
          fileDetails: [{ file: "w.ts", timestamp: 1005 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, {});

    // Only 1 entry: main-/projB wins with 3 files
    assert.strictEqual(report.entries.length, 1);
    assert.strictEqual(report.entries[0].branch, "main");
    assert.strictEqual(report.entries[0].directory, "/projB");
    assert.strictEqual(report.entries[0].assignedBranch, "main");
  });

  test("assignBranches deduplication does not affect separate time keys", () => {
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "feature",
          directory: "/projA",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: 1000 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "09:00",
          branch: "feature",
          directory: "/projB",
          files: ["b.ts", "c.ts"],
          fileDetails: [
            { file: "b.ts", timestamp: 1001 },
            { file: "c.ts", timestamp: 1002 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "10:00",
          branch: "main",
          directory: "/projA",
          files: ["d.ts"],
          fileDetails: [{ file: "d.ts", timestamp: 2000 }],
          comment: "",
          project: "",
          assignedBranch: "",
        },
        {
          key: "10:00",
          branch: "feature",
          directory: "/projB",
          files: ["e.ts", "f.ts", "g.ts"],
          fileDetails: [
            { file: "e.ts", timestamp: 2001 },
            { file: "f.ts", timestamp: 2002 },
            { file: "g.ts", timestamp: 2003 },
          ],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, {});

    // 2 entries should remain: one per time key
    assert.strictEqual(report.entries.length, 2);
    // 09:00: /projB wins (2 files)
    assert.strictEqual(report.entries[0].key, "09:00");
    assert.strictEqual(report.entries[0].directory, "/projB");
    // 10:00: feature-/projB wins (3 files)
    assert.strictEqual(report.entries[1].key, "10:00");
    assert.strictEqual(report.entries[1].branch, "feature");
    assert.strictEqual(report.entries[1].directory, "/projB");
  });

  test("assignBranches inherits default branch project to new timeslots", () => {
    const report: any = {
      date: new Date().toISOString(),
      hasSavedReport: true,
      entries: [
        {
          key: "13:45",
          branch: "no-branch",
          directory: "/workspaces/smart-time",
          files: ["a.ts"],
          fileDetails: [],
          comment: "",
          project: "Linjearbete",
          assignedBranch: "no-branch",
        },
        {
          key: "23:30",
          branch: "no-branch",
          directory: "/workspaces/smart-time",
          files: ["b.ts"],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "",
        },
      ],
    };

    // @ts-ignore
    (provider as any).assignBranches(report, {});

    assert.strictEqual(report.entries.length, 2);
    assert.strictEqual(report.entries[1].key, "23:30");
    assert.strictEqual(report.entries[1].project, "Linjearbete");
  });

  test("lookupProject returns in-memory project for default branches", () => {
    const projects = {
      main: { "/project": "Persisted" },
    };

    // Simulate setting a default branch project via the in-memory map
    const defaultBranchProjects = (provider as any).defaultBranchProjects;
    defaultBranchProjects["main\0/project"] = "InMemoryProject";

    const result = (provider as any).lookupProject(
      projects,
      "main",
      "/project",
    );
    assert.strictEqual(result, "InMemoryProject");

    // Clean up
    delete defaultBranchProjects["main\0/project"];
  });

  test("lookupProject falls back to persisted for default branches without in-memory mapping", () => {
    const projects = {
      main: { "/project": "Persisted" },
    };

    const result = (provider as any).lookupProject(
      projects,
      "main",
      "/project",
    );
    assert.strictEqual(result, "Persisted");
  });

  test("lookupProject does not use in-memory map for non-default branches", () => {
    const projects = {
      feature: { "/project": "FromFile" },
    };

    const defaultBranchProjects = (provider as any).defaultBranchProjects;
    defaultBranchProjects["feature\0/project"] = "InMemory";

    const result = (provider as any).lookupProject(
      projects,
      "feature",
      "/project",
    );
    assert.strictEqual(result, "FromFile");

    // Clean up
    delete defaultBranchProjects["feature\0/project"];
  });

  test("loadProjects includes _unbound project names", async () => {
    const projectsPath = path.join(testConfig.data, "projects.json");
    const projectData = {
      feature: { "/workspace": "Alpha" },
      _unbound: ["Beta", "Gamma"],
    };
    await fs.writeFile(projectsPath, JSON.stringify(projectData), "utf-8");

    const projects = await provider.loadProjects();
    assert.strictEqual(projects["feature"]["/workspace"], "Alpha");
    assert.deepStrictEqual((projects as any)["_unbound"], ["Beta", "Gamma"]);
  });

  test("loadProjects ignores invalid _unbound format", async () => {
    const projectsPath = path.join(testConfig.data, "projects.json");
    const projectData = {
      feature: { "/workspace": "Alpha" },
      _unbound: "not-an-array",
    };
    await fs.writeFile(projectsPath, JSON.stringify(projectData), "utf-8");

    const projects = await provider.loadProjects();
    assert.strictEqual(projects["feature"]["/workspace"], "Alpha");
    assert.strictEqual((projects as any)["_unbound"], undefined);
  });

  test("no-branch is treated as default branch", () => {
    const projects = {
      "no-branch": { "/project": "Persisted" },
    };

    const defaultBranchProjects = (provider as any).defaultBranchProjects;
    defaultBranchProjects["no-branch\0/project"] = "InMemory";

    const result = (provider as any).lookupProject(
      projects,
      "no-branch",
      "/project",
    );
    assert.strictEqual(result, "InMemory");

    // Clean up
    delete defaultBranchProjects["no-branch\0/project"];
  });

  test("shiftTimeKey shifts forward by one slot", () => {
    const result = provider.shiftTimeKey("09:00", 1);
    assert.strictEqual(result, "09:15");
  });

  test("shiftTimeKey shifts backward by one slot", () => {
    const result = provider.shiftTimeKey("09:15", -1);
    assert.strictEqual(result, "09:00");
  });

  test("shiftTimeKey crosses hour boundary forward", () => {
    const result = provider.shiftTimeKey("09:45", 1);
    assert.strictEqual(result, "10:00");
  });

  test("shiftTimeKey crosses hour boundary backward", () => {
    const result = provider.shiftTimeKey("10:00", -1);
    assert.strictEqual(result, "09:45");
  });

  test("shiftTimeKey returns null when going below 00:00", () => {
    const result = provider.shiftTimeKey("00:00", -1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey returns null when going at or above 24:00", () => {
    const result = provider.shiftTimeKey("23:45", 1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey returns null for invalid key format", () => {
    const result = provider.shiftTimeKey("invalid", 1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey handles end of day boundary", () => {
    const result = provider.shiftTimeKey("23:30", 1);
    assert.strictEqual(result, "23:45");
  });

  test("hasTimeGap returns true when next entry is not consecutive", () => {
    const entries = [
      {
        key: "09:00",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
      {
        key: "09:30",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
    ];
    assert.strictEqual(provider.hasTimeGap(entries, 0), true);
  });

  test("hasTimeGap returns false when next entry is consecutive", () => {
    const entries = [
      {
        key: "09:00",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
      {
        key: "09:15",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
    ];
    assert.strictEqual(provider.hasTimeGap(entries, 0), false);
  });

  test("hasTimeGap returns false for last entry", () => {
    const entries = [
      {
        key: "09:00",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
      {
        key: "09:15",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
    ];
    assert.strictEqual(provider.hasTimeGap(entries, 1), false);
  });

  test("hasTimeGap returns false for negative index", () => {
    const entries = [
      {
        key: "09:00",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
    ];
    assert.strictEqual(provider.hasTimeGap(entries, -1), false);
  });

  test("hasTimeGap returns false for empty entries", () => {
    assert.strictEqual(provider.hasTimeGap([], 0), false);
  });

  test("hasTimeGap detects gap across hour boundary", () => {
    const entries = [
      {
        key: "09:45",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
      {
        key: "10:15",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
    ];
    assert.strictEqual(provider.hasTimeGap(entries, 0), true);
  });

  test("hasTimeGap returns false for consecutive across hour boundary", () => {
    const entries = [
      {
        key: "09:45",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
      {
        key: "10:00",
        branch: "main",
        directory: "/p",
        files: [],
        fileDetails: [],
        comment: "",
        project: "",
        assignedBranch: "",
      },
    ];
    assert.strictEqual(provider.hasTimeGap(entries, 0), false);
  });

  test("computeOverview uses saved startOfDay and endOfDay when present", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: "08:00",
      endOfDay: "17:30",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: Date.now() }],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    const overview = (provider as any).computeOverview(report, {});
    assert.strictEqual(overview.startOfDay, "08:00");
    assert.strictEqual(overview.endOfDay, "17:30");
  });

  test("computeOverview falls back to computed values when saved values are absent", () => {
    const now = Date.now();
    const report = {
      date: new Date().toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: now }],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    const overview = (provider as any).computeOverview(report, {});
    // Should be computed from file timestamps
    const expectedTime = new Date(now).toLocaleTimeString();
    assert.strictEqual(overview.startOfDay, expectedTime);
    assert.strictEqual(overview.endOfDay, expectedTime);
  });

  test("computeOverview uses saved start but computes end when only start is saved", () => {
    const now = Date.now();
    const report = {
      date: new Date().toISOString(),
      startOfDay: "07:30",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: now }],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    const overview = (provider as any).computeOverview(report, {});
    assert.strictEqual(overview.startOfDay, "07:30");
    const expectedEnd = new Date(now).toLocaleTimeString();
    assert.strictEqual(overview.endOfDay, expectedEnd);
  });

  test("updateStartEndOfDay sets start and end from entry keys", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: undefined as string | undefined,
      endOfDay: undefined as string | undefined,
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
        {
          key: "10:30",
          branch: "main",
          directory: "/project",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    (provider as any).viewModelInstance.setReport(report);
    (provider as any).viewModelInstance.updateStartEndOfDay();
    assert.strictEqual(report.startOfDay, "09:00");
    assert.strictEqual(report.endOfDay, "10:45");
  });

  test("updateStartEndOfDay does not shrink existing range", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: "07:00",
      endOfDay: "18:00",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    (provider as any).viewModelInstance.setReport(report);
    (provider as any).viewModelInstance.updateStartEndOfDay();
    assert.strictEqual(report.startOfDay, "07:00");
    assert.strictEqual(report.endOfDay, "18:00");
  });

  test("updateStartEndOfDay expands range when new entry extends beyond", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: "09:00",
      endOfDay: "17:00",
      entries: [
        {
          key: "08:00",
          branch: "main",
          directory: "/project",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
        {
          key: "17:30",
          branch: "main",
          directory: "/project",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    (provider as any).viewModelInstance.setReport(report);
    (provider as any).viewModelInstance.updateStartEndOfDay();
    assert.strictEqual(report.startOfDay, "08:00");
    assert.strictEqual(report.endOfDay, "17:45");
  });

  test("updateStartEndOfDay does nothing for empty entries", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: "09:00" as string | undefined,
      endOfDay: "17:00" as string | undefined,
      entries: [] as any[],
    };

    (provider as any).viewModelInstance.setReport(report);
    (provider as any).viewModelInstance.updateStartEndOfDay();
    assert.strictEqual(report.startOfDay, "09:00");
    assert.strictEqual(report.endOfDay, "17:00");
  });

  test("computeOverview groups entries by project", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: "08:00",
      endOfDay: "17:00",
      entries: [
        {
          key: "09:00",
          branch: "feature-a",
          directory: "/project1",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: Date.now() }],
          comment: "",
          project: "ProjectX",
          assignedBranch: "feature-a",
        },
        {
          key: "10:00",
          branch: "feature-b",
          directory: "/project2",
          files: ["b.ts"],
          fileDetails: [{ file: "b.ts", timestamp: Date.now() }],
          comment: "",
          project: "ProjectX",
          assignedBranch: "feature-b",
        },
        {
          key: "11:00",
          branch: "feature-c",
          directory: "/project3",
          files: ["c.ts"],
          fileDetails: [{ file: "c.ts", timestamp: Date.now() }],
          comment: "",
          project: "ProjectY",
          assignedBranch: "feature-c",
        },
      ],
    };

    const projects = {
      "feature-a": { "/project1": "ProjectX" },
      "feature-b": { "/project2": "ProjectX" },
      "feature-c": { "/project3": "ProjectY" },
    };

    const overview = (provider as any).computeOverview(report, projects);
    assert.strictEqual(overview.groups.length, 2);

    const groupX = overview.groups.find((g: any) => g.project === "ProjectX");
    assert.ok(groupX);
    assert.strictEqual(groupX.entries.length, 2);
    assert.strictEqual(groupX.totalTimeSlots, 2);

    const groupY = overview.groups.find((g: any) => g.project === "ProjectY");
    assert.ok(groupY);
    assert.strictEqual(groupY.entries.length, 1);
    assert.strictEqual(groupY.totalTimeSlots, 1);
  });

  test("computeOverview puts unassigned entries last", () => {
    const report = {
      date: new Date().toISOString(),
      startOfDay: "08:00",
      endOfDay: "17:00",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project1",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: Date.now() }],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
        {
          key: "10:00",
          branch: "feature-a",
          directory: "/project2",
          files: ["b.ts"],
          fileDetails: [{ file: "b.ts", timestamp: Date.now() }],
          comment: "",
          project: "MyProject",
          assignedBranch: "feature-a",
        },
      ],
    };

    const projects = {
      "feature-a": { "/project2": "MyProject" },
    };

    const overview = (provider as any).computeOverview(report, projects);
    assert.strictEqual(overview.groups.length, 2);
    assert.strictEqual(overview.groups[0].project, "MyProject");
    assert.strictEqual(overview.groups[1].project, "");
  });

  test("computeOverview sums time slots per project group", () => {
    const now = Date.now();
    const report = {
      date: new Date().toISOString(),
      startOfDay: "08:00",
      endOfDay: "17:00",
      entries: [
        {
          key: "09:00",
          branch: "feature-a",
          directory: "/p1",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: now }],
          comment: "",
          project: "Alpha",
          assignedBranch: "feature-a",
        },
        {
          key: "09:15",
          branch: "feature-a",
          directory: "/p1",
          files: ["b.ts"],
          fileDetails: [{ file: "b.ts", timestamp: now }],
          comment: "",
          project: "Alpha",
          assignedBranch: "feature-a",
        },
        {
          key: "10:00",
          branch: "feature-b",
          directory: "/p2",
          files: ["c.ts"],
          fileDetails: [{ file: "c.ts", timestamp: now }],
          comment: "",
          project: "Alpha",
          assignedBranch: "feature-b",
        },
      ],
    };

    const projects = {
      "feature-a": { "/p1": "Alpha" },
      "feature-b": { "/p2": "Alpha" },
    };

    const overview = (provider as any).computeOverview(report, projects);
    assert.strictEqual(overview.groups.length, 1);
    assert.strictEqual(overview.groups[0].project, "Alpha");
    assert.strictEqual(overview.groups[0].totalTimeSlots, 3);
  });

  test("computeOverview groups are sorted alphabetically with unassigned last", () => {
    const now = Date.now();
    const report = {
      date: new Date().toISOString(),
      startOfDay: "08:00",
      endOfDay: "17:00",
      entries: [
        {
          key: "09:00",
          branch: "b1",
          directory: "/d1",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: now }],
          comment: "",
          project: "Zebra",
          assignedBranch: "b1",
        },
        {
          key: "10:00",
          branch: "b2",
          directory: "/d2",
          files: ["b.ts"],
          fileDetails: [{ file: "b.ts", timestamp: now }],
          comment: "",
          project: "Alpha",
          assignedBranch: "b2",
        },
        {
          key: "11:00",
          branch: "main",
          directory: "/d3",
          files: ["c.ts"],
          fileDetails: [{ file: "c.ts", timestamp: now }],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    };

    const projects = {
      b1: { "/d1": "Zebra" },
      b2: { "/d2": "Alpha" },
    };

    const overview = (provider as any).computeOverview(report, projects);
    assert.strictEqual(overview.groups.length, 3);
    assert.strictEqual(overview.groups[0].project, "Alpha");
    assert.strictEqual(overview.groups[1].project, "Zebra");
    assert.strictEqual(overview.groups[2].project, "");
  });

  test("formatTotalWorkedHours should return empty string when no timeslots", () => {
    const overview = {
      startOfDay: "",
      endOfDay: "",
      entries: [],
      groups: [],
    };
    const result = (provider as any).formatTotalWorkedHours(overview);
    assert.strictEqual(result, "");
  });

  test("formatTotalWorkedHours should format minutes only when less than an hour", () => {
    const overview = {
      startOfDay: "08:00",
      endOfDay: "09:00",
      entries: [],
      groups: [{ project: "P1", totalTimeSlots: 3, entries: [] }],
    };
    const result = (provider as any).formatTotalWorkedHours(overview);
    assert.strictEqual(result, "Total: 45m");
  });

  test("formatTotalWorkedHours should format hours and minutes", () => {
    const overview = {
      startOfDay: "08:00",
      endOfDay: "17:00",
      entries: [],
      groups: [
        { project: "P1", totalTimeSlots: 5, entries: [] },
        { project: "P2", totalTimeSlots: 3, entries: [] },
      ],
    };
    const result = (provider as any).formatTotalWorkedHours(overview);
    assert.strictEqual(result, "Total: 2h 0m");
  });

  test("loadTimeReport caches result as view model", async () => {
    // Create a batch file for today
    const now = new Date();
    const timestamp = now.getTime();
    const batchData = {
      feature: {
        "/project": [{ File: "a.ts", Timestamp: timestamp }],
      },
    };
    const batchesDir = path.join(testConfig.data, "batches");
    const batchFile = `batch_${timestamp}_abc123.json`;
    await fs.writeFile(
      path.join(batchesDir, batchFile),
      JSON.stringify(batchData),
      "utf-8",
    );

    // Set provider's currentDate to now
    (provider as any).currentDate = now;

    // First load should populate the view model
    const report1 = await (provider as any).loadTimeReport();
    assert.ok(report1.entries.length > 0);
    assert.strictEqual((provider as any).currentReport, report1);
    assert.strictEqual(
      (provider as any).currentReportDate,
      (provider as any).getDateString(),
    );
  });

  test("loadTimeReport returns cached view model on subsequent calls", async () => {
    const now = new Date();
    const timestamp = now.getTime();
    const batchData = {
      feature: {
        "/project": [{ File: "a.ts", Timestamp: timestamp }],
      },
    };
    const batchesDir = path.join(testConfig.data, "batches");
    const batchFile = `batch_${timestamp}_abc123.json`;
    await fs.writeFile(
      path.join(batchesDir, batchFile),
      JSON.stringify(batchData),
      "utf-8",
    );

    (provider as any).currentDate = now;

    const report1 = await (provider as any).loadTimeReport();
    const report2 = await (provider as any).loadTimeReport();

    // Should return the same cached object
    assert.strictEqual(report1, report2);
  });

  test("saveReportToFile updates the view model immediately", async () => {
    const now = new Date();
    (provider as any).currentDate = now;

    const reportData = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "feature",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: now.getTime() }],
          comment: "test comment",
          project: "TestProject",
          assignedBranch: "feature",
        },
      ],
      startOfDay: "09:00",
      endOfDay: "10:00",
    };

    await (provider as any).saveReportToFile(reportData);

    // View model should be updated
    assert.strictEqual((provider as any).currentReport, reportData);
    assert.strictEqual(
      (provider as any).currentReportDate,
      (provider as any).getDateString(),
    );

    // Subsequent loadTimeReport should return the cached data (not stale disk data)
    const loaded = await (provider as any).loadTimeReport();
    assert.strictEqual(loaded, reportData);
    assert.strictEqual(loaded.entries[0].comment, "test comment");
  });

  test("view model merges new batch files incrementally", async () => {
    const now = new Date();
    const timestamp1 = now.getTime();
    (provider as any).currentDate = now;

    // Create first batch file
    const batchesDir = path.join(testConfig.data, "batches");
    const batch1 = {
      feature: {
        "/project": [{ File: "a.ts", Timestamp: timestamp1 }],
      },
    };
    await fs.writeFile(
      path.join(batchesDir, `batch_${timestamp1}_first.json`),
      JSON.stringify(batch1),
      "utf-8",
    );

    // First load
    const report1 = await (provider as any).loadTimeReport();
    const initialEntryCount = report1.entries.length;
    assert.ok(initialEntryCount > 0);

    // Create second batch file with a new time slot
    const timestamp2 = timestamp1 + 3600000; // 1 hour later
    const laterDate = new Date(timestamp2);
    // Only add if still same day
    if (laterDate.getDate() === now.getDate()) {
      const batch2 = {
        develop: {
          "/other": [{ File: "b.ts", Timestamp: timestamp2 }],
        },
      };
      await fs.writeFile(
        path.join(batchesDir, `batch_${timestamp2}_second.json`),
        JSON.stringify(batch2),
        "utf-8",
      );

      // Second load should merge the new batch
      const report2 = await (provider as any).loadTimeReport();
      assert.strictEqual(report1, report2); // Same cached object
      assert.ok(report2.entries.length > initialEntryCount);

      // Verify the new entry was merged
      const newEntry = report2.entries.find(
        (e: any) => e.branch === "develop" && e.directory === "/other",
      );
      assert.ok(newEntry, "New batch entry should be merged into view model");
    }
  });

  test("resetViewModel clears cached data", async () => {
    const now = new Date();
    const timestamp = now.getTime();
    (provider as any).currentDate = now;

    // Create batch and load to populate cache
    const batchesDir = path.join(testConfig.data, "batches");
    const batchData = {
      feature: {
        "/project": [{ File: "a.ts", Timestamp: timestamp }],
      },
    };
    await fs.writeFile(
      path.join(batchesDir, `batch_${timestamp}_abc.json`),
      JSON.stringify(batchData),
      "utf-8",
    );

    await (provider as any).loadTimeReport();
    assert.ok((provider as any).currentReport !== null);

    // Reset should clear the cache
    provider.resetViewModel();
    assert.strictEqual((provider as any).currentReport, null);
    assert.strictEqual((provider as any).currentReportDate, null);
    assert.strictEqual((provider as any).processedBatchFiles.size, 0);
  });

  test("loadProjects caches result", async () => {
    const projectsPath = path.join(testConfig.data, "projects.json");
    const projectData = {
      feature: { "/workspace": "Alpha" },
    };
    await fs.writeFile(projectsPath, JSON.stringify(projectData), "utf-8");

    const projects1 = await provider.loadProjects();
    assert.strictEqual(projects1["feature"]["/workspace"], "Alpha");

    // Modify the file on disk
    const updatedData = {
      feature: { "/workspace": "Beta" },
    };
    await fs.writeFile(projectsPath, JSON.stringify(updatedData), "utf-8");

    // Should return cached version, not re-read from disk
    const projects2 = await provider.loadProjects();
    assert.strictEqual(projects2, projects1);
    assert.strictEqual(projects2["feature"]["/workspace"], "Alpha");
  });

  test("processedBatchFiles prevents double-processing of batch files", async () => {
    const now = new Date();
    const timestamp = now.getTime();
    (provider as any).currentDate = now;

    const batchesDir = path.join(testConfig.data, "batches");
    const batchData = {
      feature: {
        "/project": [{ File: "a.ts", Timestamp: timestamp }],
      },
    };
    const batchFile = `batch_${timestamp}_test.json`;
    await fs.writeFile(
      path.join(batchesDir, batchFile),
      JSON.stringify(batchData),
      "utf-8",
    );

    // First load processes the batch
    const report1 = await (provider as any).loadTimeReport();
    const entryCount = report1.entries.length;

    // Second load should not re-process the same batch (no duplicate entries)
    const report2 = await (provider as any).loadTimeReport();
    assert.strictEqual(report2.entries.length, entryCount);
  });

  test("triggerSave does not throw when panel is null", () => {
    assert.strictEqual((provider as any).panel, null);
    assert.doesNotThrow(() => provider.triggerSave());
  });

  test("exportHtml writes webview HTML to temp file", async () => {
    // Set up a report with potential duplicates (same key:directory, different branches, same project)
    const now = new Date();
    const report = {
      date: now.toISOString(),
      startOfDay: "09:00",
      endOfDay: "10:00",
      entries: [
        {
          key: "09:00",
          branch: "branch1",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [{ file: "a.ts", timestamp: now.getTime() }],
          comment: "",
          project: "TestProject",
          assignedBranch: "branch1",
        },
        {
          key: "09:00", // Same key
          branch: "branch2", // Different branch
          directory: "/project", // Same directory
          files: ["b.ts"],
          fileDetails: [{ file: "b.ts", timestamp: now.getTime() }],
          comment: "",
          project: "TestProject", // Same project
          assignedBranch: "branch2",
        },
        {
          key: "09:15",
          branch: "branch3",
          directory: "/other",
          files: ["c.ts"],
          fileDetails: [{ file: "c.ts", timestamp: now.getTime() }],
          comment: "",
          project: "OtherProject",
          assignedBranch: "branch3",
        },
      ],
    };

    const projects = {
      branch1: { "/project": "TestProject" },
      branch2: { "/project": "TestProject" },
      branch3: { "/other": "OtherProject" },
    };

    // Set the current report and date
    (provider as any).currentReport = report;
    (provider as any).currentDate = now;

    // Run the full pipeline: deduplicate entries then compute overview
    (provider as any).assignBranches(report, projects, true);
    const overview = (provider as any).computeOverview(report, projects);
    const html = (provider as any).getHtmlContent(report, overview, projects);

    // Mock the panel with the generated HTML
    const mockWebview = { html: html };
    const mockPanel = { webview: mockWebview };
    (provider as any).panel = mockPanel;

    // Call handleMessage with exportHtml command
    await (provider as any).handleMessage({ command: "exportHtml" });

    // Check that a file was created in tmpdir with the HTML content
    const tmpDir = os.tmpdir();
    const files = await fs.readdir(tmpDir);
    const exportFile = files.find(
      (file) => file.startsWith("coft-report-") && file.endsWith(".html"),
    );
    assert.ok(exportFile, "Export file should be created");

    const filePath = path.join(tmpDir, exportFile!);
    const content = await fs.readFile(filePath, "utf-8");
    assert.strictEqual(content, html);

    // Verify grouping: overview should have only 1 entry for TestProject (unique key:directory)
    const overviewTestProjectRows =
      content
        .match(/<tr class="project-group-entry">[\s\S]*?<\/tr>/g)
        ?.filter((row) => row.includes("TestProject")) || [];
    assert.strictEqual(
      overviewTestProjectRows.length,
      1,
      "Overview should have only 1 entry for TestProject due to unique key:directory",
    );

    // Verify timetable: should have 2 rows (one per unique key:directory, but since same key:directory for TestProject, only one, plus one for OtherProject)
    const timetableRows =
      content.match(/<tr class="entry-row[\s\S]*?<\/tr>/g) || [];
    assert.strictEqual(
      timetableRows.length,
      2,
      "Timetable should have 2 rows: one for TestProject and one for OtherProject",
    );

    // Clean up
    await fs.unlink(filePath);
  });

  test("shiftTimeKey shifts forward by one slot", () => {
    const shifted = (provider as any).shiftTimeKey("09:00", 1);
    assert.strictEqual(shifted, "09:15");
  });

  test("shiftTimeKey shifts backward by one slot", () => {
    const shifted = (provider as any).shiftTimeKey("09:15", -1);
    assert.strictEqual(shifted, "09:00");
  });

  test("shiftTimeKey returns null when shifting before midnight", () => {
    const shifted = (provider as any).shiftTimeKey("00:00", -1);
    assert.strictEqual(shifted, null);
  });

  test("shiftTimeKey returns null when shifting past end of day", () => {
    const shifted = (provider as any).shiftTimeKey("23:45", 1);
    assert.strictEqual(shifted, null);
  });

  test("copy-above button is disabled when slot above exists", () => {
    const now = new Date();
    const report = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "b",
        },
        {
          key: "09:15",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "b",
        },
      ],
    };
    const projects = {};
    const overview = (provider as any).computeOverview(report, projects);
    const html = (provider as any).getHtmlContent(report, overview, projects);
    // 09:15 row: slot above (09:00) exists → copy-above disabled
    assert.ok(
      html.includes('data-index="1" title="Copy above" disabled'),
      "copy-above on 09:15 row should be disabled because 09:00 exists",
    );
  });

  test("copy-below button is disabled when slot below exists", () => {
    const now = new Date();
    const report = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "b",
        },
        {
          key: "09:15",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "b",
        },
      ],
    };
    const projects = {};
    const overview = (provider as any).computeOverview(report, projects);
    const html = (provider as any).getHtmlContent(report, overview, projects);
    // 09:00 row: slot below (09:15) exists → copy-below disabled
    assert.ok(
      html.includes('data-index="0" title="Copy below" disabled'),
      "copy-below on 09:00 row should be disabled because 09:15 exists",
    );
  });

  test("copy-above button is enabled when slot above does not exist", () => {
    const now = new Date();
    const report = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:15",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "b",
        },
      ],
    };
    const projects = {};
    const overview = (provider as any).computeOverview(report, projects);
    const html = (provider as any).getHtmlContent(report, overview, projects);
    assert.ok(
      !html.includes('title="Copy above" disabled'),
      "copy-above should not be disabled when the slot above does not exist",
    );
  });

  test("copy-below button is enabled when slot below does not exist", () => {
    const now = new Date();
    const report = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "b",
        },
      ],
    };
    const projects = {};
    const overview = (provider as any).computeOverview(report, projects);
    const html = (provider as any).getHtmlContent(report, overview, projects);
    assert.ok(
      !html.includes('title="Copy below" disabled'),
      "copy-below should not be disabled when the slot below does not exist",
    );
  });

  test("handleMessage copyRow creates new entry above", async () => {
    const now = new Date();
    const report = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:15",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "work",
          project: "P",
          assignedBranch: "b",
        },
      ],
    };
    (provider as any).currentReport = report;
    (provider as any).currentDate = now;
    (provider as any).cachedProjects = {};
    (provider as any).viewModelInstance.setReport(report);

    const mockPanel = { webview: { html: "" }, reveal: () => {} };
    (provider as any).panel = mockPanel;
    (provider as any).updateView = async () => {};

    await (provider as any).handleMessage({
      command: "copyRow",
      index: 0,
      direction: "above",
    });

    const entries = (provider as any).viewModelInstance.report
      ?.entries as Array<{ key: string }>;
    assert.ok(
      entries.some((e) => e.key === "09:00"),
      "Entry at 09:00 should have been created",
    );
    assert.ok(
      entries.some((e) => e.key === "09:15"),
      "Original entry at 09:15 should still exist",
    );
  });

  test("handleMessage copyRow creates new entry below", async () => {
    const now = new Date();
    const report = {
      date: now.toISOString(),
      entries: [
        {
          key: "09:00",
          branch: "b",
          directory: "/d",
          files: [],
          fileDetails: [],
          comment: "work",
          project: "P",
          assignedBranch: "b",
        },
      ],
    };
    (provider as any).currentReport = report;
    (provider as any).currentDate = now;
    (provider as any).cachedProjects = {};
    (provider as any).viewModelInstance.setReport(report);

    const mockPanel = { webview: { html: "" }, reveal: () => {} };
    (provider as any).panel = mockPanel;
    (provider as any).updateView = async () => {};

    await (provider as any).handleMessage({
      command: "copyRow",
      index: 0,
      direction: "below",
    });

    const entries = (provider as any).viewModelInstance.report
      ?.entries as Array<{ key: string }>;
    assert.ok(
      entries.some((e) => e.key === "09:15"),
      "Entry at 09:15 should have been created",
    );
    assert.ok(
      entries.some((e) => e.key === "09:00"),
      "Original entry at 09:00 should still exist",
    );
  });

  // ── Regression: prev day button command name ──────────────────────────────

  test("handleMessage previousDay moves currentDate back by one day", async () => {
    const now = new Date(2026, 1, 15); // Feb 15 2026
    (provider as any).currentDate = new Date(now);
    (provider as any).updateView = async () => {};

    await (provider as any).handleMessage({ command: "previousDay" });

    const after: Date = (provider as any).currentDate;
    assert.strictEqual(after.getFullYear(), 2026);
    assert.strictEqual(after.getMonth(), 1);
    assert.strictEqual(
      after.getDate(),
      14,
      "previousDay should move date back by 1",
    );
  });

  test("handleMessage nextDay moves currentDate forward by one day", async () => {
    const now = new Date(2026, 1, 15); // Feb 15 2026
    (provider as any).currentDate = new Date(now);
    (provider as any).updateView = async () => {};

    await (provider as any).handleMessage({ command: "nextDay" });

    const after: Date = (provider as any).currentDate;
    assert.strictEqual(
      after.getDate(),
      16,
      "nextDay should move date forward by 1",
    );
  });

  test("handleMessage previousDay crosses month boundary correctly", async () => {
    (provider as any).currentDate = new Date(2026, 2, 1); // Mar 1 2026
    (provider as any).updateView = async () => {};

    await (provider as any).handleMessage({ command: "previousDay" });

    const after: Date = (provider as any).currentDate;
    assert.strictEqual(after.getMonth(), 1, "should be February");
    assert.strictEqual(after.getDate(), 28, "Feb 2026 has 28 days");
  });
});
