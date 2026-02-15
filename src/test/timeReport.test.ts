import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TimeReportProvider } from "../timeReport";
import { GitManager } from "../git";
import { CoftConfig } from "../config";

suite("TimeReport Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let git: GitManager;
  let provider: TimeReportProvider;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-timereport-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = {
      root: testRoot,
      queue: path.join(testRoot, "queue"),
      queueBatch: path.join(testRoot, "queue_batch"),
      queueBackup: path.join(testRoot, "queue_backup"),
      data: path.join(testRoot, "data"),
      backup: path.join(testRoot, "backup"),
      intervalSeconds: 60,
      viewGroupByMinutes: 15,
      branchTaskUrl: "",
    };

    await fs.mkdir(testConfig.queue, { recursive: true });
    await fs.mkdir(testConfig.queueBatch, { recursive: true });
    await fs.mkdir(testConfig.queueBackup, { recursive: true });
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(path.join(testConfig.data, "batches"), { recursive: true });
    await fs.mkdir(path.join(testConfig.data, "reports"), { recursive: true });

    outputChannel = vscode.window.createOutputChannel("TimeReport Test");
    git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    provider = new TimeReportProvider(testConfig, git, outputChannel);
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
      provider.lookupProject(projects, "feature", "/project-a"),
      "Alpha",
    );
    assert.strictEqual(
      provider.lookupProject(projects, "feature", "/project-b"),
      "Beta",
    );
  });

  test("lookupProject falls back to same branch other directory", () => {
    const projects = {
      feature: { "/project-a": "Alpha" },
    };
    assert.strictEqual(
      provider.lookupProject(projects, "feature", "/other-project"),
      "Alpha",
    );
  });

  test("lookupProject returns empty string for unknown branch", () => {
    const projects = {
      feature: { "/project-a": "Alpha" },
    };
    assert.strictEqual(
      provider.lookupProject(projects, "unknown", "/project-a"),
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
    provider.assignBranches(report, projects);

    // Both entries in 09:00 should be assigned to "main" (3 files vs 1)
    assert.strictEqual(report.entries[0].assignedBranch, "main");
    assert.strictEqual(report.entries[1].assignedBranch, "main");
    // Project should come from the assigned branch
    assert.strictEqual(report.entries[0].project, "Alpha");
    assert.strictEqual(report.entries[1].project, "Alpha");
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
    provider.assignBranches(report, projects);

    // 09:00: develop wins (2 files vs 1)
    assert.strictEqual(report.entries[0].assignedBranch, "develop");
    assert.strictEqual(report.entries[1].assignedBranch, "develop");
    assert.strictEqual(report.entries[0].project, "Beta");
    assert.strictEqual(report.entries[1].project, "Beta");

    // 10:00: main wins (only branch)
    assert.strictEqual(report.entries[2].assignedBranch, "main");
    assert.strictEqual(report.entries[2].project, "Alpha");
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

    provider.assignBranches(report, {});

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

    provider.assignBranches(report, projects);

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

    provider.assignBranches(report, projects);

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

    provider.assignBranches(report, projects);

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

    provider.assignBranches(report, projects, true);

    assert.strictEqual(report.entries[0].project, "UpdatedProject");
  });

  test("lookupProject returns in-memory project for default branches", () => {
    const projects = {
      main: { "/project": "Persisted" },
    };

    // Simulate setting a default branch project via the in-memory map
    const defaultBranchProjects = (provider as any).defaultBranchProjects;
    defaultBranchProjects["main\0/project"] = "InMemoryProject";

    const result = provider.lookupProject(projects, "main", "/project");
    assert.strictEqual(result, "InMemoryProject");

    // Clean up
    delete defaultBranchProjects["main\0/project"];
  });

  test("lookupProject falls back to persisted for default branches without in-memory mapping", () => {
    const projects = {
      main: { "/project": "Persisted" },
    };

    const result = provider.lookupProject(projects, "main", "/project");
    assert.strictEqual(result, "Persisted");
  });

  test("lookupProject does not use in-memory map for non-default branches", () => {
    const projects = {
      feature: { "/project": "FromFile" },
    };

    const defaultBranchProjects = (provider as any).defaultBranchProjects;
    defaultBranchProjects["feature\0/project"] = "InMemory";

    const result = provider.lookupProject(projects, "feature", "/project");
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

    const result = provider.lookupProject(projects, "no-branch", "/project");
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

    provider.updateStartEndOfDay(report);
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

    provider.updateStartEndOfDay(report);
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

    provider.updateStartEndOfDay(report);
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

    provider.updateStartEndOfDay(report);
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
});
