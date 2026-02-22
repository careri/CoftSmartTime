# COFT SmartTime – Copilot Context

## Purpose

COFT SmartTime (`coft-smarttime`) is a VS Code extension that passively tracks every file save and builds time reports from the recorded activity. It captures timestamps, directories, and git branches, then groups them into configurable time slots so the user can see what they worked on and for how long.

## Architecture

The extension follows a pipeline architecture with repository pattern for data access and service layer for business logic:

1. **Save Hook** → writes a queue entry per file save (`src/extension.ts`)
2. **BatchProcessor** → periodically collects queue entries into batch files (`src/application/batchProcessor.ts`)
3. **OperationQueueWriter/Processor** → serialises all disk/git mutations through a locked queue (`src/application/operationQueueWriter.ts`, `src/application/operationQueueProcessor.ts`)
4. **Services** → encapsulate business logic:
   - `BatchService` → batch collection and merging operations (`src/services/batchService.ts`)
   - `GitService` → git export operations (`src/services/gitService.ts`)
5. **Repositories** → encapsulate data access for different domains:
   - `BatchRepository` → reads batch files (`src/storage/batchRepository.ts`)
   - `TimeReportRepository` → reads saved time reports (`src/storage/timeReportRepository.ts`)
   - `ProjectRepository` → reads project mappings (`src/storage/projectRepository.ts`)
   - `OperationRepository` → reads pending operation requests (`src/storage/operationRepository.ts`)
   - `GitRepository` → handles git-related file operations (`src/storage/gitRepository.ts`)
6. **TimeReportProvider and TimeReportViewModel** → webview UI and state management for viewing and editing reports (`src/presentation/timeReport.ts`, `src/presentation/timeReportViewModel.ts`)
7. **TimeSummaryProvider** → webview UI for time summary view with project aggregation and date filtering (`src/presentation/timeSummary.ts`)

All writes to `COFT_DATA` go through `OperationQueueWriter` (never direct). The queue processor acquires a file lock before processing, making it safe across multiple VS Code instances. File I/O is fully encapsulated through repository methods with strong type safety. Project mappings are updated incrementally via `ProjectChangeRequest` to avoid concurrency issues with full file rewrites.

## Source Layout

```
src/
  storage/
    batchRepository.ts   – Reads batch files
    gitRepository.ts     – Repository for git-related file operations
    operationRepository.ts – Repository for reading operation requests
    projectRepository.ts – Repository for reading project mappings
    timeReportRepository.ts – Repository for reading saved time reports
    storage.ts           – Low-level file/queue operations, type definitions
    git.ts               – Git init, commit, gc, push operations
    lock.ts              – OS-agnostic file locking
    projectRepository.test.ts – Tests for project repository incremental operations
  application/
    batchProcessor.ts    – BatchProcessor (timer-based queue → batch)
    operationQueueWriter.ts  – OperationQueueWriter (writes operation requests)
    operationQueueProcessor.ts – OperationQueueProcessor (processes operation requests)
    config.ts            – Configuration management (reads VS Code settings)
  services/
    batchService.ts      – Batch collection and merging business logic
    gitService.ts        – Git export business logic
  presentation/
    timeReport.ts        – TimeReportProvider (webview panel, HTML generation, and state management)
    timeReportViewModel.ts – TimeReportViewModel (state management for reports)
    timeSummary.ts       – TimeSummaryProvider (webview for time summary view)
  extension.ts           – Extension entry point, activation, commands
  test/
    extension.test.ts    – Test for extension
```

## Key Types

- **`TimeEntry`** – one time slot: `{ key: "09:15", branch, directory, files, fileDetails, comment, project, assignedBranch }`
- **`TimeReport`** – a day's report: `{ date, entries[], startOfDay?, endOfDay? }`
- **`CoftConfig`** – all resolved config paths and settings
- **`OperationRequest`** – union of `processBatch | timereport | projects | projectChange | housekeeping`

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
2. **Timetable** – one row per time slot with buttons to copy above/below and edit branch inline, showing branch (editable), directory, comment (editable), project. Rows with a time gap (not followed by the next expected slot) are highlighted with an orange background.
3. **Batch Items** – detail view showing individual file changes when a timetable row is selected

Communication between the webview and extension host uses `postMessage` / `onDidReceiveMessage`.

## Webview UI (in `timeSummary.ts`)

The time summary is a webview panel showing aggregated time data over a date range (week/month) with two tables:

1. **Summary Table** – project-level time totals, sorted by time descending
2. **Date Table** – per-date breakdown with include/exclude checkboxes (weekends excluded by default), showing date, day of week, and work time

Navigation buttons allow switching between current week/month and moving forward/backward. Toggling date inclusion updates the summary table dynamically.

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

- `COFT: Show Time Report` – opens the daily time report webview
- `COFT: Show Time Summary` – opens the time summary webview for week/month views
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
- Repositories are CRUD only; any business logic should go to the wrapper service
- Unit tests are created without asking; ask before changing non-test code
- Keep responses brief
