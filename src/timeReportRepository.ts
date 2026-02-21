import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";

interface SavedTimeEntry {
  key: string;
  branch: string;
  directory: string;
  comment: string;
  project: string;
  assignedBranch?: string;
}

interface SavedTimeReport {
  date: string;
  entries: SavedTimeEntry[];
  startOfDay?: string;
  endOfDay?: string;
}

export class TimeReportRepository {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
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
}
