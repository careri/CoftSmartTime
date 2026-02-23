import * as vscode from "vscode";

export class Logger {
  private outputChannel: vscode.OutputChannel;
  private debugEnabled: boolean;

  constructor(outputChannel: vscode.OutputChannel, debugEnabled: boolean) {
    this.outputChannel = outputChannel;
    this.debugEnabled = debugEnabled;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toLocaleTimeString();
    return `[${timestamp}] ${level}: ${message}`;
  }

  info(message: string): void {
    this.outputChannel.appendLine(this.formatMessage("INFO", message));
  }

  debug(message: string): void {
    if (this.debugEnabled) {
      this.outputChannel.appendLine(this.formatMessage("DEBUG", message));
    }
  }

  error(message: string): void {
    this.outputChannel.appendLine(this.formatMessage("ERROR", message));
  }

  isDebugEnabled(): boolean {
    return this.debugEnabled;
  }
}
