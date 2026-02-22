import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../application/config";

export interface ProjectMap {
  [branch: string]: {
    [directory: string]: string;
  };
}

export class ProjectRepository {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  async readProjects(): Promise<ProjectMap> {
    const projectsPath = path.join(this.config.data, "projects.json");
    let result: ProjectMap = {};
    try {
      const content = await fs.readFile(projectsPath, "utf-8");
      const parsed = JSON.parse(content);
      // Validate new format: { branch: { directory: project }, _unbound: [...] }
      if (typeof parsed === "object" && parsed !== null) {
        let valid = true;
        for (const key of Object.keys(parsed)) {
          if (key === "_unbound") {
            if (!Array.isArray(parsed[key])) {
              this.outputChannel.appendLine(
                "projects.json _unbound is not an array, ignoring",
              );
              delete parsed[key];
            }
            continue;
          }
          if (typeof parsed[key] !== "object" || parsed[key] === null) {
            this.outputChannel.appendLine(
              "projects.json has unexpected format, treating as empty",
            );
            valid = false;
            break;
          }
        }
        if (valid) {
          result = parsed;
        }
      }
    } catch {
      // No projects file or invalid JSON
    }
    return result;
  }

  async saveProjects(projects: ProjectMap): Promise<void> {
    const projectsPath = path.join(this.config.data, "projects.json");
    await fs.mkdir(path.dirname(projectsPath), { recursive: true });
    await fs.writeFile(
      projectsPath,
      JSON.stringify(projects, null, 2),
      "utf-8",
    );
  }
}
