import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../application/config";
import { OperationRequest } from "../types/operation";

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
        // Treat invalid JSON as an invalid request that will fail processing
        operations.push({ file, request: { type: "invalid" } });
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

  async addOperation(request: OperationRequest): Promise<void> {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const fileName = `${timestamp}_${random}.json`;
    const filePath = path.join(this.config.operationQueue, fileName);
    await fs.mkdir(this.config.operationQueue, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), "utf-8");
  }
}
