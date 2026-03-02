import { SummaryData } from "./timeSummary";
import {
  computeProjectDistributionSummary,
  DistributionRow,
} from "./timeSummaryDistribution";

export class TimeSummaryMarkdownBuilder {
  build(summary: SummaryData, distributionRows: DistributionRow[]): string {
    const distSummary = computeProjectDistributionSummary(distributionRows);

    const summaryRows = summary.summaryEntries
      .map((entry) => {
        const dist = distSummary.get(entry.project);
        const normal =
          dist && dist.normalMinutes > 0
            ? this.formatMinutes(dist.normalMinutes)
            : "—";
        const delta =
          dist && dist.deltaMinutes > 0
            ? this.formatMinutes(dist.deltaMinutes)
            : "—";
        return `| ${entry.project} | ${normal} | ${delta} | ${this.formatMinutes(entry.totalTime)} |`;
      })
      .join("\n");

    const byDate = new Map<string, DistributionRow[]>();
    for (const row of distributionRows) {
      const existing = byDate.get(row.date) ?? [];
      existing.push(row);
      byDate.set(row.date, existing);
    }

    const distributionSections = [...byDate.entries()]
      .map(([date, rows]) => {
        const normalMinutes = rows
          .filter((r) => !r.delta)
          .reduce((s, r) => s + r.hours, 0);
        const deltaMinutes = rows
          .filter((r) => r.delta)
          .reduce((s, r) => s + r.hours, 0);
        const header = `### ${date} (Normal: ${this.formatMinutes(normalMinutes)}, Delta: ${this.formatMinutes(deltaMinutes)})`;
        const tableRows = rows
          .map(
            (r) =>
              `| ${r.project} | ${this.formatMinutes(r.hours)} | ${r.delta ? "✓" : "—"} |`,
          )
          .join("\n");
        return `${header}\n\n| Project | Hours | Delta |\n| --- | --- | --- |\n${tableRows}`;
      })
      .join("\n\n");

    const parts: string[] = [
      "## Summary by Project",
      "",
      "| Project | Normal Time | Delta Time | Time |",
      "| --- | --- | --- | --- |",
      summaryRows,
    ];

    if (distributionSections.length > 0) {
      parts.push("", "## Distribution", "", distributionSections);
    }

    return parts.join("\n");
  }

  private formatMinutes(totalMinutes: number): string {
    const sign = totalMinutes < 0 ? "-" : "";
    const abs = Math.abs(totalMinutes);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return hours > 0 ? `${sign}${hours}h ${minutes}m` : `${sign}${minutes}m`;
  }
}
