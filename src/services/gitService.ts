import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../application/config";
import { Logger } from "../utils/logger";

export class GitService {
  private config: CoftConfig;
  private logger: Logger;

  constructor(config: CoftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async exportTimeReports(): Promise<void> {
    if (!this.config.exportDir) {
      return;
    }

    this.logger.info("Exporting time reports...");

    try {
      await fs.mkdir(this.config.exportDir, { recursive: true });

      const reportsDir = path.join(this.config.data, "reports");
      try {
        await fs.access(reportsDir);
      } catch {
        this.logger.info("No reports directory found, skipping export");
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

      this.logger.info(`Exported ${exportedCount} time report(s)`);
    } catch (error) {
      this.logger.error(`Export failed: ${error}`);
      vscode.window.showWarningMessage(
        `COFT SmartTime: Failed to export time reports: ${error}`,
      );
    }
  }
}
