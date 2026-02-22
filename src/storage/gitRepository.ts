import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../application/config";

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
}
