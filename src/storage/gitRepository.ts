import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../logic/config";

export class GitRepository {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  async writeGitignore(): Promise<void> {
    const gitignorePath = path.join(this.config.data, ".gitignore");
    await fs.writeFile(gitignorePath, ".lock\n.last-housekeeping\n", "utf-8");
  }

  async writeHousekeeping(date: string): Promise<void> {
    const housekeepingPath = path.join(this.config.data, ".last-housekeeping");
    await fs.writeFile(housekeepingPath, date, "utf-8");
  }

  async readLastHousekeeping(): Promise<string | null> {
    try {
      const housekeepingPath = path.join(
        this.config.data,
        ".last-housekeeping",
      );
      const lastDate = (await fs.readFile(housekeepingPath, "utf-8")).trim();
      return lastDate;
    } catch {
      return null;
    }
  }

  async exportTimeReports(): Promise<void> {
    if (!this.config.exportDir) {
      return;
    }

    this.outputChannel.appendLine("Exporting time reports...");

    try {
      await fs.mkdir(this.config.exportDir, { recursive: true });

      const reportsDir = path.join(this.config.data, "reports");
      try {
        await fs.access(reportsDir);
      } catch {
        this.outputChannel.appendLine(
          "No reports directory found, skipping export",
        );
        return;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.exportAgeDays);

      let exportedCount = 0;

      const years = await fs.readdir(reportsDir);
      for (const year of years) {
        const yearPath = path.join(reportsDir, year);
        const yearStat = await fs.stat(yearPath);
        if (!yearStat.isDirectory()) {
          continue;
        }

        const months = await fs.readdir(yearPath);
        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          const monthStat = await fs.stat(monthPath);
          if (!monthStat.isDirectory()) {
            continue;
          }

          const days = await fs.readdir(monthPath);
          for (const dayFile of days) {
            if (!dayFile.endsWith(".json")) {
              continue;
            }

            const day = dayFile.replace(".json", "");
            const reportDate = new Date(`${year}-${month}-${day}T00:00:00`);

            if (isNaN(reportDate.getTime()) || reportDate < cutoffDate) {
              continue;
            }

            const exportSubDir = path.join(this.config.exportDir, year, month);
            const exportPath = path.join(exportSubDir, dayFile);

            try {
              await fs.access(exportPath);
              // Already exists, skip
              continue;
            } catch {
              // Does not exist, export it
            }

            await fs.mkdir(exportSubDir, { recursive: true });
            const sourcePath = path.join(monthPath, dayFile);
            await fs.copyFile(sourcePath, exportPath);
            exportedCount++;
          }
        }
      }

      this.outputChannel.appendLine(`Exported ${exportedCount} time report(s)`);
    } catch (error) {
      this.outputChannel.appendLine(`Export failed: ${error}`);
      vscode.window.showWarningMessage(
        `COFT SmartTime: Failed to export time reports: ${error}`,
      );
    }
  }
}
