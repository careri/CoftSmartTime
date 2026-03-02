import * as assert from "assert";
import {
  FillByLargestDistributor,
  assignProjectsToDeltaRows,
  ProjectBucket,
} from "./timeSummaryDistribution";
import { DateEntry, SummaryEntry } from "./timeSummary";

function makeDate(
  date: string,
  workTime: number,
  normalHours: number,
  include = true,
): DateEntry {
  return { date, workTime, normalHours, include, dayOfWeek: "Mon" };
}

function makeProject(project: string, totalTime: number): SummaryEntry {
  return { project, totalTime };
}

suite("FillByLargestDistributor", () => {
  let distributor: FillByLargestDistributor;

  setup(() => {
    distributor = new FillByLargestDistributor();
  });

  test("single project covers a single day exactly", () => {
    const dates = [makeDate("2026-03-03", 480, 480)];
    const projects = [makeProject("ProjectA", 480)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].date, "2026-03-03");
    assert.strictEqual(rows[0].project, "ProjectA");
    assert.strictEqual(rows[0].hours, 480);
    assert.strictEqual(rows[0].totalDateHours, 480);
  });

  test("project runs out mid-day and spills to next project", () => {
    const dates = [makeDate("2026-03-03", 480, 480)];
    const projects = [
      makeProject("ProjectA", 300),
      makeProject("ProjectB", 300),
    ];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].project, "ProjectA");
    assert.strictEqual(rows[0].hours, 300);
    assert.strictEqual(rows[1].project, "ProjectB");
    assert.strictEqual(rows[1].hours, 180);
  });

  test("projects are sorted largest first regardless of input order", () => {
    const dates = [makeDate("2026-03-03", 480, 480)];
    const projects = [makeProject("Small", 100), makeProject("Large", 480)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows[0].project, "Large");
  });

  test("project index persists across days", () => {
    const dates = [
      makeDate("2026-03-03", 480, 480),
      makeDate("2026-03-04", 480, 480),
    ];
    // ProjectA only covers day 1; ProjectB covers day 2
    const projects = [
      makeProject("ProjectA", 480),
      makeProject("ProjectB", 480),
    ];
    const { rows } = distributor.compute(dates, projects);

    const day1 = rows.filter((r) => r.date === "2026-03-03");
    const day2 = rows.filter((r) => r.date === "2026-03-04");

    assert.strictEqual(day1.length, 1);
    assert.strictEqual(day1[0].project, "ProjectA");
    assert.strictEqual(day2.length, 1);
    assert.strictEqual(day2[0].project, "ProjectB");
  });

  test("delta >= 0: target is normalHours", () => {
    // workTime (600) > normalHours (480) → target = 480
    const dates = [makeDate("2026-03-03", 600, 480)];
    const projects = [makeProject("ProjectA", 600)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hours, 480);
  });

  test("delta < 0: target is reduced by nearest 0.5h step", () => {
    // workTime 420, normalHours 480 → delta = -60 → distributedDelta = -60 → target = 420
    const dates = [makeDate("2026-03-03", 420, 480)];
    const projects = [makeProject("ProjectA", 480)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hours, 420);
  });

  test("delta < 0, fractional: rounded to nearest 30 min", () => {
    // workTime 435, normalHours 480 → delta = -45 → Math.round(-1.5)*30 = -30 → target = 450
    const dates = [makeDate("2026-03-03", 435, 480)];
    const projects = [makeProject("ProjectA", 480)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hours, 450);
  });

  test("targetMinutes <= 0: day is skipped", () => {
    // workTime 0, normalHours 0 → target 0 → skip
    const dates = [makeDate("2026-03-03", 0, 0)];
    const projects = [makeProject("ProjectA", 480)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows.length, 0);
  });

  test("empty date entries returns empty rows", () => {
    const { rows } = distributor.compute([], [makeProject("ProjectA", 480)]);
    assert.strictEqual(rows.length, 0);
  });

  test("empty projects returns empty rows", () => {
    const dates = [makeDate("2026-03-03", 480, 480)];
    const { rows } = distributor.compute(dates, []);
    assert.strictEqual(rows.length, 0);
  });

  test("totalDateHours reflects normalHours of the entry", () => {
    const dates = [makeDate("2026-03-03", 480, 360)];
    const projects = [makeProject("ProjectA", 480)];
    const { rows } = distributor.compute(dates, projects);

    assert.strictEqual(rows[0].totalDateHours, 360);
  });

  test("project spanning multiple days is split correctly", () => {
    // 2 days × 480 min normal, project has 600 min total → day1 gets 480, day2 gets 120
    const dates = [
      makeDate("2026-03-03", 480, 480),
      makeDate("2026-03-04", 480, 480),
    ];
    const projects = [
      makeProject("ProjectA", 600),
      makeProject("ProjectB", 600),
    ];
    const { rows } = distributor.compute(dates, projects);

    const d1a = rows.find(
      (r) => r.date === "2026-03-03" && r.project === "ProjectA",
    );
    const d2a = rows.find(
      (r) => r.date === "2026-03-04" && r.project === "ProjectA",
    );
    const d2b = rows.find(
      (r) => r.date === "2026-03-04" && r.project === "ProjectB",
    );

    assert.strictEqual(d1a?.hours, 480);
    assert.strictEqual(d2a?.hours, 120);
    assert.strictEqual(d2b?.hours, 360);
  });

  test("remainingBuckets contains projects with leftover time", () => {
    // ProjectA: 600, ProjectB: 600; 1 day × 480 → ProjectA takes 480, remaining: ProjectA=120, ProjectB=600
    const dates = [makeDate("2026-03-03", 480, 480)];
    const projects = [
      makeProject("ProjectA", 600),
      makeProject("ProjectB", 600),
    ];
    const { remainingBuckets } = distributor.compute(dates, projects);

    assert.strictEqual(remainingBuckets.length, 2);
    assert.strictEqual(remainingBuckets[0].project, "ProjectA");
    assert.strictEqual(remainingBuckets[0].remaining, 120);
    assert.strictEqual(remainingBuckets[1].project, "ProjectB");
    assert.strictEqual(remainingBuckets[1].remaining, 600);
  });

  test("remainingBuckets is empty when all projects are fully consumed", () => {
    const dates = [makeDate("2026-03-03", 480, 480)];
    const projects = [makeProject("ProjectA", 480)];
    const { remainingBuckets } = distributor.compute(dates, projects);
    assert.strictEqual(remainingBuckets.length, 0);
  });
});

suite("assignProjectsToDeltaRows", () => {
  function makeRow(
    date: string,
    hours: number,
    project = "Delta",
  ): import("./timeSummaryDistribution").DistributionRow {
    return { date, project, hours, totalDateHours: 480, delta: true };
  }

  function makeBucket(project: string, remaining: number): ProjectBucket {
    return { project, remaining };
  }

  test("assigns single delta row to the only remaining project", () => {
    const rows = assignProjectsToDeltaRows(
      [makeRow("2026-03-03", 120)],
      [makeBucket("ProjectA", 200)],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].project, "ProjectA");
    assert.strictEqual(rows[0].hours, 120);
  });

  test("splits row across two projects when first is depleted", () => {
    const rows = assignProjectsToDeltaRows(
      [makeRow("2026-03-03", 150)],
      [makeBucket("ProjectA", 100), makeBucket("ProjectB", 200)],
    );
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].project, "ProjectA");
    assert.strictEqual(rows[0].hours, 100);
    assert.strictEqual(rows[1].project, "ProjectB");
    assert.strictEqual(rows[1].hours, 50);
  });

  test("multiple delta rows share the same bucket pool", () => {
    const rows = assignProjectsToDeltaRows(
      [makeRow("2026-03-03", 60), makeRow("2026-03-04", 60)],
      [makeBucket("ProjectA", 80), makeBucket("ProjectB", 100)],
    );
    // First row: 60 from ProjectA (80→20 left)
    // Second row: 20 from ProjectA, 40 from ProjectB
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].project, "ProjectA");
    assert.strictEqual(rows[0].hours, 60);
    assert.strictEqual(rows[1].project, "ProjectA");
    assert.strictEqual(rows[1].hours, 20);
    assert.strictEqual(rows[2].project, "ProjectB");
    assert.strictEqual(rows[2].hours, 40);
  });

  test("keeps original project label when no buckets remain", () => {
    const rows = assignProjectsToDeltaRows(
      [makeRow("2026-03-03", 60, "Delta")],
      [],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].project, "Delta");
    assert.strictEqual(rows[0].hours, 60);
  });

  test("preserves delta flag on all output rows", () => {
    const rows = assignProjectsToDeltaRows(
      [makeRow("2026-03-03", 120)],
      [makeBucket("ProjectA", 60), makeBucket("ProjectB", 60)],
    );
    assert.ok(rows.every((r) => r.delta === true));
  });
});
