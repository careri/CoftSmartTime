import * as assert from "assert";
import { TimeSummaryMarkdownBuilder } from "./timeSummaryMarkdownBuilder";
import { SummaryData, DateEntry, SummaryEntry } from "./timeSummary";
import { DistributionRow } from "./timeSummaryDistribution";

function makeSummary(
  projects: SummaryEntry[],
  dates: DateEntry[] = [],
): SummaryData {
  return {
    summaryEntries: projects,
    dateEntries: dates,
    grandTotalReportedMinutes: 0,
    grandTotalNormalMinutes: 0,
    grandDeltaMinutes: 0,
    configWarning: false,
  };
}

function makeProject(project: string, totalTime: number): SummaryEntry {
  return { project, totalTime };
}

function makeRow(
  date: string,
  project: string,
  hours: number,
  delta: boolean,
): DistributionRow {
  return { date, project, hours, totalDateHours: 480, delta };
}

suite("TimeSummaryMarkdownBuilder", () => {
  let builder: TimeSummaryMarkdownBuilder;

  setup(() => {
    builder = new TimeSummaryMarkdownBuilder();
  });

  test("includes Summary by Project header", () => {
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), []);
    assert.ok(md.includes("## Summary by Project"));
  });

  test("summary table has correct columns", () => {
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), []);
    assert.ok(md.includes("| Project | Normal Time | Delta Time | Time |"));
  });

  test("summary row shows formatted Time", () => {
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), []);
    assert.ok(md.includes("| ProjectA |"));
    assert.ok(md.includes("8h 0m"));
  });

  test("Normal Time and Delta Time show — when no distribution rows", () => {
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), []);
    const dataRow = md.split("\n").find((l) => l.startsWith("| ProjectA"));
    assert.ok(dataRow);
    assert.ok(dataRow!.includes("| — |"));
  });

  test("Normal Time populated from non-delta rows", () => {
    const rows = [makeRow("2026-03-03", "ProjectA", 480, false)];
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), rows);
    const dataRow = md.split("\n").find((l) => l.startsWith("| ProjectA"));
    assert.ok(dataRow?.includes("8h 0m"));
  });

  test("Delta Time populated from delta rows", () => {
    const rows = [
      makeRow("2026-03-03", "ProjectA", 480, false),
      makeRow("2026-03-03", "ProjectA", 60, true),
    ];
    const md = builder.build(makeSummary([makeProject("ProjectA", 540)]), rows);
    const dataRow = md.split("\n").find((l) => l.startsWith("| ProjectA"));
    assert.ok(dataRow?.includes("1h 0m")); // delta time
  });

  test("no Distribution section when no rows", () => {
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), []);
    assert.ok(!md.includes("## Distribution"));
  });

  test("Distribution section present when rows exist", () => {
    const rows = [makeRow("2026-03-03", "ProjectA", 480, false)];
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), rows);
    assert.ok(md.includes("## Distribution"));
  });

  test("date section header shows date, Normal and Delta hours", () => {
    const rows = [
      makeRow("2026-03-03", "ProjectA", 480, false),
      makeRow("2026-03-03", "ProjectA", 60, true),
    ];
    const md = builder.build(makeSummary([makeProject("ProjectA", 540)]), rows);
    assert.ok(md.includes("### 2026-03-03 (Normal: 8h 0m, Delta: 1h 0m)"));
  });

  test("distribution table has correct columns", () => {
    const rows = [makeRow("2026-03-03", "ProjectA", 480, false)];
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), rows);
    assert.ok(md.includes("| Project | Hours | Delta |"));
  });

  test("non-delta row shows — in Delta column", () => {
    const rows = [makeRow("2026-03-03", "ProjectA", 480, false)];
    const md = builder.build(makeSummary([makeProject("ProjectA", 480)]), rows);
    assert.ok(md.includes("| ProjectA | 8h 0m | — |"));
  });

  test("delta row shows ✓ in Delta column", () => {
    const rows = [makeRow("2026-03-03", "ProjectA", 60, true)];
    const md = builder.build(makeSummary([makeProject("ProjectA", 60)]), rows);
    assert.ok(md.includes("| ProjectA | 1h 0m | ✓ |"));
  });

  test("multiple dates produce separate sections", () => {
    const rows = [
      makeRow("2026-03-03", "ProjectA", 480, false),
      makeRow("2026-03-04", "ProjectA", 480, false),
    ];
    const md = builder.build(makeSummary([makeProject("ProjectA", 960)]), rows);
    assert.ok(md.includes("### 2026-03-03"));
    assert.ok(md.includes("### 2026-03-04"));
  });

  test("formatMinutes handles only minutes", () => {
    const rows = [makeRow("2026-03-03", "ProjectA", 45, false)];
    const md = builder.build(makeSummary([makeProject("ProjectA", 45)]), rows);
    assert.ok(md.includes("45m"));
  });
});
