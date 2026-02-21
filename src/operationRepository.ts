import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";

export interface ProcessBatchRequest {
  type: "processBatch";
}

export interface WriteTimeReportRequest {
  type: "timereport";
  file: string;
  body: any;
}

export interface UpdateProjectsRequest {
  type: "projects";
  file: string;
  body: any;
}

export interface HousekeepingRequest {
  type: "housekeeping";
}

export type OperationRequest =
  | ProcessBatchRequest
  | WriteTimeReportRequest
  | UpdateProjectsRequest
  | HousekeepingRequest;

export class OperationRepository {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  async readPendingOperations(): Promise<
    { file: string; request: OperationRequest }[]
  > {
    let files: string[];
    try {
      files = await fs.readdir(this.config.operationQueue);
    } catch {
      return [];
    }

    const requestFiles = files.filter((f) => f.endsWith(".json")).sort();
    const operations: { file: string; request: OperationRequest }[] = [];

    for (const file of requestFiles) {
      const filePath = path.join(this.config.operationQueue, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const request: OperationRequest = JSON.parse(content);
        operations.push({ file, request });
      } catch (error) {
        this.outputChannel.appendLine(
          `Error reading operation request ${file}: ${error}`,
        );
      }
    }

    return operations;
  }

  async deleteOperation(file: string): Promise<void> {
    const filePath = path.join(this.config.operationQueue, file);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      this.outputChannel.appendLine(
        `Error deleting operation request ${file}: ${error}`,
      );
    }
  }
}
