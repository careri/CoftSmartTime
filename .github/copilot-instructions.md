# COFT SmartTime – Copilot Context

## Purpose

COFT SmartTime (`coft-smarttime`) is a VS Code extension that passively tracks every file save and builds time reports from the recorded activity. It captures timestamps, directories, and git branches, then groups them into configurable time slots so the user can see what they worked on and for how long.

## Architecture

The extension follows a pipeline architecture with repository pattern for data access:

1. **Save Hook** → writes a queue entry per file save (`src/extension.ts`)
2. **BatchProcessor** → periodically collects queue entries into batch files (`src/batch.ts`)
3. **OperationQueue** → serialises all disk/git mutations through a locked queue (`src/operationQueue.ts`)
4. **Repositories** → encapsulate data access for different domains:
   - `BatchRepository` → reads and merges batch data into time reports (`src/batchRepository.ts`)
   - `TimeReportRepository` → reads saved time reports (`src/timeReportRepository.ts`)
   - `ProjectRepository` → reads project mappings (`src/projectRepository.ts`)
   - `OperationRepository` → reads pending operation requests (`src/operationRepository.ts`)
   - `GitRepository` → handles git-related file operations (`src/gitRepository.ts`)
5. **TimeReportProvider** → webview UI for viewing and editing reports (`src/timeReport.ts`)

All writes to `COFT_DATA` go through `OperationQueueWriter` (never direct). The queue processor acquires a file lock before processing, making it safe across multiple VS Code instances.

## Source Layout

```
src/
  config.ts            – Configuration management (reads VS Code settings)
  storage.ts           – Low-level file/queue operations, type definitions
  lock.ts              – OS-agnostic file locking
  git.ts               – Git init, commit, gc, push operations
  gitRepository.ts     – Repository for git-related file operations
  batch.ts             – BatchProcessor (timer-based queue → batch)
  batchRepository.ts   – Reads batch files, merges into TimeReport model
  operationQueue.ts    – OperationRequest types, writer, processor
  operationRepository.ts – Repository for reading operation requests
  timeReport.ts        – TimeReportProvider (webview panel, HTML generation)
  timeReportRepository.ts – Repository for reading saved time reports
  projectRepository.ts – Repository for reading project mappings
  extension.ts         – Extension entry point, activation, commands
  test/
    *.test.ts          – Mocha test suites (one per source module)
```

## Key Types

- **`TimeEntry`** – one time slot: `{ key: "09:15", branch, directory, files, fileDetails, comment, project, assignedBranch }`
- **`TimeReport`** – a day's report: `{ date, entries[], startOfDay?, endOfDay? }`
- **`CoftConfig`** – all resolved config paths and settings
- **`OperationRequest`** – union of `processBatch | timereport | projects | housekeeping`

## Data Storage (`COFT_ROOT`, default `~/.coft.smarttime`)

```
root/
  queue/                – raw save entries (one file per save)
  queue_batch/          – temp staging during batch processing
  queue_backup/         – temp staging for rollback
  operation_queue/      – pending OperationRequest JSON files
  operation_queue_backup/ – failed requests after max retries
  data/                 – git repo with processed data
    batches/            – hierarchical batch files (year/month/day.json)
    reports/            – saved time reports (year/month/day.json)
    projects.json       – branch → directory → project mappings
  backup/               – git bare repo (push target)
```

## Webview UI (in `timeReport.ts`)

The time report is a single webview panel with three sections:

1. **Overview** – project-grouped summary with start/end of day, total hours, editable project assignments
2. **Timetable** – one row per time slot showing branch, directory, comment, project. Rows with a time gap (not followed by the next expected slot) are highlighted with an orange background.
3. **Batch Items** – detail view showing individual file changes when a timetable row is selected

Communication between the webview and extension host uses `postMessage` / `onDidReceiveMessage`.

## Configuration Properties

| Setting                             | Default             | Description                             |
| ----------------------------------- | ------------------- | --------------------------------------- |
| `coft.smarttime.root`               | `~/.coft.smarttime` | Data root directory                     |
| `coft.smarttime.intervalSeconds`    | 60                  | Batch processing interval (60–300)      |
| `coft.smarttime.viewGroupByMinutes` | 15                  | Time slot size (must divide into 60)    |
| `coft.smarttime.branchTaskUrl`      | (empty)             | URL pattern with `{branch}` placeholder |
| `coft.smarttime.exportDir`          | (empty)             | Export directory for time reports       |
| `coft.smarttime.exportAgeDays`      | 90                  | How far back to export                  |

## Commands

- `COFT: Show Time Report` – opens the webview
- `COFT: Save Time Report` – saves (also bound to Ctrl+S when report is focused)
- `COFT: Backup` – triggers housekeeping (git gc, push, export)

## Development

- **Language**: TypeScript (strict, no `var`)
- **Test framework**: Mocha via `@vscode/test-cli` + `@vscode/test-electron`
- **Run tests**: `DISPLAY=:99 npm test` (requires Xvfb for headless VS Code)
- **Build**: `npm run compile`
- **Package**: `bash build.vsix.sh`
- **Dev container**: included, pre-configured with Node.js, TypeScript, Xvfb

## Code Conventions

- Always use curly brackets (no bracketless single-line blocks)
- Never use the `var` keyword
- All public methods that write to disk go through `OperationQueueWriter`
- Unit tests are created without asking; ask before changing non-test code
- Keep responses brief
