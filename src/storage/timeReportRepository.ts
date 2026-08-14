import * as fs from "fs/promises";
import * as path from "path";
import { CoftConfig } from "../application/config";

export interface SavedTimeEntry {
  key: string;
  branch: string;
  directory: string;
  comment: string;
  project: string;
  assignedBranch?: string;
}

export interface SavedTimeReport {
  date: string;
  entries: SavedTimeEntry[];
  startOfDay?: string;
  endOfDay?: string;
}

export class TimeReportRepository {
  private config: CoftConfig;

  constructor(config: CoftConfig) {
    this.config = config;
  }

  async readReport(date: Date): Promise<SavedTimeReport | null> {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const reportPath = path.join(
      this.config.data,
      "reports",
      String(year),
      month,
      `${day}.json`,
    );

    try {
      const content = await fs.readFile(reportPath, "utf-8");
      const saved: SavedTimeReport = JSON.parse(content);
      return saved;
    } catch {
      return null;
    }
  }

  async saveReport(report: SavedTimeReport): Promise<void> {
    const [year, month, day] = report.date.split("-").map(Number);
    const reportPath = path.join(
      this.config.data,
      "reports",
      String(year),
      String(month).padStart(2, "0"),
      `${String(day).padStart(2, "0")}.json`,
    );
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }
}
