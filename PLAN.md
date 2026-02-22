# Idea

I want to create a VS Code extension. That records all the files I save.
coft.smarttime should be the id of the extension.

## Status

✅ **Implementation Complete** - Core functionality implemented and tested.

### Completed Features

- ✅ Configuration management with validation
- ✅ Storage system with queue, batch, and backup directories
- ✅ File save hook that captures all saves in workspace
- ✅ Batch processing with timer-based execution
- ✅ OS-agnostic file locking mechanism
- ✅ Git integration for version control
- ✅ Time report view with webview UI
- ✅ Project mapping (branch to project, projects.json)
- ✅ Overview section with start/end of day, branch/project/time summary
- ✅ Unit tests for all modules (config, storage, batch, extension, git, lock, timeReport)
- ✅ In-memory view model for time report (eventual consistency with lazy saves)
- ✅ Deferred save operations in timereport view using FIFO memory queue
- ✅ Separate TimeReportViewModel class for UI state management
- ✅ Devcontainer with all dependencies
- ✅ Git bash aliases in devcontainer
- ✅ Auto-create COFT_ROOT directory on first use
- ✅ Path validation with fallback to default
- ✅ Commands registered before initialization (always available)
- ✅ MIT License
- ✅ VSIX packaging support
- ✅ UI extension kind (runs on host, works in dev containers)
- ✅ Repository pattern implementation for data access (TimeReportRepository, ProjectRepository, OperationRepository, GitRepository, QueueRepository)
- ✅ Edit button in timereport timetable to make branch field editable inline
- ✅ Time summary view with project-level aggregation and date filtering
- ✅ Clickable dates in time summary view to open time reports in new windows
- ✅ Clean architecture refactoring: logic/ → application/, services/ for business logic, repositories for data access
- ✅ File I/O encapsulation refactoring: All direct file writes moved to repository methods, ensuring data access is abstracted through CRUD operations with strong type safety
- ✅ Incremental project mapping updates: Replaced full projects.json writes with atomic ProjectChangeRequest operations for better concurrency
- ✅ Start of week configuration for time summary (auto, sunday, monday with culture default)
- ✅ Build linting that fails on unused variables, methods, classes, and imports

### Implementation Files

- `src/application/config.ts` - Configuration management
- `src/storage/storage.ts` - File storage operations
- `src/storage/lock.ts` - File locking mechanism
- `src/storage/git.ts` - Git operations
- `src/application/batchProcessor.ts` - Batch processing (writes ProcessBatchRequest)
- `src/storage/batchRepository.ts` - Batch file reading operations
- `src/services/batchService.ts` - Batch collection and merging business logic
- `src/application/operationQueueWriter.ts` - OperationQueueWriter for queuing operations
- `src/application/operationQueueProcessor.ts` - OperationQueueProcessor for processing operations
- `src/storage/queueRepository.ts` - Queue repository for queue operations
- `src/storage/timeReportRepository.ts` - Time report repository for reading saved reports
- `src/storage/projectRepository.ts` - Project repository for reading project mappings
- `src/storage/projectRepository.test.ts` - Project repository tests for incremental operations
- `src/storage/operationRepository.ts` - Operation repository for reading pending operations
- `src/storage/gitRepository.ts` - Git repository for file operations
- `src/services/gitService.ts` - Git export business logic
- `src/presentation/timeReport.ts` - Time report view
- `src/presentation/timeSummary.ts` - Time summary view
- `src/extension.ts` - Main extension entry point
- `src/application/config.test.ts` - Configuration tests
- `src/storage/storage.test.ts` - Storage tests
- `src/application/batchProcessor.test.ts` - Batch processing tests
- `src/storage/batchRepository.test.ts` - Batch repository tests
- `src/application/operationQueue.writer.test.ts` - Operation queue writer tests
- `src/application/operationQueue.processor.test.ts` - Operation queue processor tests
- `src/extension.test.ts` - Extension tests
- `src/storage/git.test.ts` - Git tests
- `src/storage/lock.test.ts` - Lock tests
- `src/presentation/timeReport.test.ts` - Time report tests

## Tools

- ✅ devcontainer - Configured with TypeScript, Node.js, and all VS Code test dependencies
- ✅ TypeScript - Best practice language for VS Code extensions
- ✅ xvfb - Headless testing support

## Properties

- COFT_ROOT - The root directory
- COFT_QUEUE - Subdir of COFT_ROOT
- COFT_QUEUE_BATCH - Subdir of COFT_ROOT
- COFT_QUEUE_BACKUP - Subdir of COFT_ROOT
- COFT_OPERATION_QUEUE - Subdir of COFT_ROOT
- COFT_OPERATION_QUEUE_BACKUP - Subdir of COFT_ROOT
- COFT_DATA - Subdir of COFT_ROOT
- COFT_BACKUP - Subdir of COFT_ROOT
- COFT_INTERVAL_SECONDS - How often the batch logic shall execute, default value: 60
- COFT_VIEW_GROUP_BY_MINUTES - How the view is grouped, default 15.
- COFT_EXPORT_DIR - Optional directory path for exporting time reports
- COFT_EXPORT_AGE_DAYS - How far back in time to export, default 90
- COFT_START_OF_WEEK - Start of week for time summary, default "auto" (culture default)

## Storage

### Folder Structure

```
root/
├── queue/             # Each saved file in VS code writes an entry here
├── queue_batch/       # A temp dir
├── queue_backup/      # A temp dir
├── operation_queue/   # All storage operations are queued here as OperationRequests
├── operation_queue_backup/ # Failed operations after max retries
├── data/              # A git repo that contains processed data from the queue
├── backup/            # A git bare repo
```

### Save Entry. A file

- Directory: project/workspace root # ITEM_DIR
- Filename: the relative file name. # ITEM_PATH
- GitBranch: <optional> # ITEM_BRANCH

### Batch Entry. A json file

Batches are stored in COFT_DATA/batches

```json
{
    "<ITEM_BRANCH>: {
        "<ITEM_DIR>": [
            {
                File: "<ITEM_PATH>",
                Timestamp: "<THE CREATED STAMP OF THE FILE>"
            }
        ]
    }
}
```

### Time report

- Timereports are saved by day in COFT_DATA/reports/year/month/day.
- Only user-editable fields are persisted; the full report is rebuilt from batch data on load.
- Manually added rows (from copy above/below) are also persisted and restored.

- ✅ An in-memory view model caches the loaded report per date.

- On write operations (save, copy row), the model is updated immediately; the disk write is queued via OperationRequest.
- On subsequent loads for the same date, the cached model is returned and only new batch files are merged incrementally.
- Date navigation resets the cache.
- Projects are also cached in memory; saves update the cache before queuing the write.

```json
{
  "date": "<UTC>",
  "startOfDay": "<optional, user-editable time string>",
  "endOfDay": "<optional, user-editable time string>",
  "entries": [
    {
      "key": "<HOUR+COFT_VIEW_GROUP_BY_MINUTES>",
      "branch": "<ITEM_BRANCH>",
      "directory": "<ITEM_DIR>",
      "comment": "<text>",
      "project": "<text>"
    }
  ]
}
```

### Project

- ✅ A mapping between branch and project, COFT_DATA/projects.json
- ✅ Dont save default branches like main or master.

```json
{
    "<ITEM_BRANCH>": {
        "<ITEM_DIR>: "<PROJECT>"
    },
}
```

## Logic

✅ **Implemented** - All logic components are complete and tested

### Init

- ✅ Validate configuration.
- ✅ If COFT_INTERVAL_SECONDS is out of range log that 60 seconds will be used.
- ✅ if COFT_ROOT is not a valid path, log warning and use default (~/.coft.smarttime).
- ✅ Auto-create COFT_ROOT directory if it does not exist.
- ✅ if COFT_VIEW_GROUP_BY_MINUTES is not a valid value use 15. X \* COFT_VIEW_GROUP_BY_MINUTES must equal to 60, it can't be negative, 0 or larger than 60.

### Save Hook

- ✅ Every saved file in VS code generates an entry in COFT_QUEUE

### Process Logic

- ✅ BatchProcessor runs on timer, every COFT_INTERVAL_SECONDS seconds.
- ✅ If queue files exist, writes a ProcessBatchRequest to the operation queue.

### Operation Queue

- ✅ OperationQueueProcessor runs on a 10s timer.
- ✅ Acquires a global lock on COFT_DATA before processing any requests.
- ✅ All storage mutations go through OperationRequests. No direct file writes.
- ✅ Four request types:

- **ProcessBatchRequest** (`type: "processBatch"`) - Moves queue files to batch, groups them, writes batch entry to COFT_DATA, commits to git, deletes batch files.
- **WriteTimeReportRequest** (`type: "timereport"`) - Writes a time report file to COFT_DATA, commits to git.
- **UpdateProjectsRequest** (`type: "projects"`) - Writes projects.json to COFT_DATA, commits to git.
- **ProjectChangeRequest** (`type: "projectChange"`) - Applies incremental changes to projects.json (add/update/delete project mappings), commits to git.
- **HousekeepingRequest** (`type: "housekeeping"`) - Runs git gc, pushes to backup, exports time reports. Checks `.last-housekeeping` date to skip if already done today.

- ✅ Failed requests are retried up to 5 times, then moved to COFT_OPERATION_QUEUE_BACKUP.

## Configuration

✅ **Implemented** - All configuration properties are implemented in package.json

- Configure COFT_ROOT where the file entries will be saved, default should be <home>/.coft.smarttime
- Configure COFT_INTERVAL_SECONDS, inform the user of valid range 60 to 300
- Configure COFT_VIEW_GROUP_BY_MINUTES, valid values: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60
- Configure COFT_BRANCH_TASK_URL, optional. If set it should be a url where the branch can be injected. E.g. https://ctek-jira.atlassian.net/browse/{branch}
- Configure COFT_EXPORT_DIR, optional. Must be a valid parsable path. If set, time reports are exported during housekeeping.
- Configure COFT_EXPORT_AGE_DAYS, optional. Defines how far back in time to export. Default 90.

## VS Code Commands

- ✅ **Implemented** - Command available in command palette
- ✅ Command to run the house keeping routing. Call it backup
- ✅ Save time report command with Ctrl+S / Cmd+S keybinding when time report has focus

### Show time report

✅ **Implemented** - Webview with interactive UI

#### Logic

- ✅ A timereport is derived from the batches that was committed to git on that day.
- ✅ If a timereport exists for that day, load it.
- ✅ If new batches have been committed for that day after the report is created, add them.

#### Layout

##### Controls

- ✅ Buttons to go back and forward in dates. Show today by default.
- ✅ Save button at the top. Saves timereport via OperationQueue (WriteTimeReportRequest).
- ✅ Button to update projects on branches based on the saved information in projects.json

##### Date Time

- ✅ Dates are shown in user locale.

##### Parts

###### Overview

- ✅ At the top show a project view. Load projects.json
- ✅ Collect TIME_SLOTS by COMPOSITE_KEY and map to existing values in projects. If not found check if branch is bound in another directory.
- ✅ Show start of day and end of day. First and last changed file.
- ✅ If COFT_BRANCH_TASK_URL is configured convert the branch column into a link using that pattern
- ✅ You should be able to assign a project for default branches (main/master etc). But the mapping between default branch and project shouldn't be saved to projects.
- ✅ Make the start and end of day editable, save them in the time report
- ✅ Group the branches by project. When a project is assigned to a branch move it to that project.
- ✅ Show a sum of time on the project level
- ✅ When opening a date that has no timereport saved. Auto assigned projects to branches.
- ✅ When opening a date that has a timereport saved. Don't auto assigned projects to branches.
- ✅ On the same row as start and stop time show a sum of the worked hours (sum of timeslots) to the right edge
- ✅ Show a table:

- ✅ branch
- ✅ project (list control with value selected if available)
- ✅ time (sum of TIME_SLOT)

###### Timetable

- ✅ Show a view of the files that were changed today. each line is a TIME_SLOT
- ✅ Assign the TIME_SLOT to the branch with most changed files
- ✅ Show the info for the assigned branch on the row. including readonly project (should update if changed in the overview)
- ✅ Highlight timeslot gaps with orange background when a slot is not followed by the next expected time in the series

Group them by:

- ✅ COFT_VIEW_GROUP_BY_MINUTES <readonly>
- ✅ Composite key of ITEM_BRANCH and ITEM_DIR <readonly> (COMPOSITE_KEY)

####### Buttons

- ✅ For each row add buttons on the left

- ✅ Copy above, make a copy of the row and decrease the time with one TIME_SLOT
- ✅ Copy below, make a copy of the row and increase the time with one TIME_SLOT
- ✅ Copied rows are persisted and update start/end of day

##### Batch Items

- ✅ If a row is selected show the items within the batch in another grid at the bottom.

## Errors

- ✅ Show a notification in VS Code if save fails
- ✅ Ensure target directories exist before write operations

## Git handling

- ✅ Ensure git repo exists before operations
- ✅ If git repo is broken, rename to backup with timestamp suffix and reinitialize

### Backup

- Use a git bare repo in the COFT_BACKUP.
- Add COFT_BACKUP as origin for COFT_DATA

### House keeping

✅ Runs as a HousekeepingRequest through the OperationQueue. Auto-queued after first commit each day (tracked via `.last-housekeeping`). Skipped if already done today (safe with multiple VS Code instances).

1. git gc in COFT_DATA
2. git push to COFT_BACKUP
3. ✅ If COFT_EXPORT_DIR is defined, export all timereports younger than COFT_EXPORT_AGE_DAYS that don't already exist in the export directory

## Next Steps

- Consider adding filtering/search in time report view
- Consider adding statistics/summary views

## Restructuring Plan

### When to Group Classes

Small, Related Models: When classes are highly cohesive (e.g., small DTOs or related state shapes).
Circular Dependencies: Putting classes that reference each other in the same file can sometimes resolve import-loop issues.
Encapsulation: If a class is only a helper for another class and shouldn't be used elsewhere, keeping it private in the same file is cleaner.

### Best Practices & Downsides

Maintainability: Large files (over ~400 lines) are harder to navigate. Most developers prefer a one-class-per-file structure for better organization.
ESLint Rules: Many teams use the ESLint max-classes-per-file rule to enforce a single-class limit (often set to 1 by default).
Alternative (Barrel Files): Instead of one giant file, use an index.ts (a "barrel file") to re-export multiple classes from separate files, allowing you to import them from a single location.

### Specific Changes Needed for COFT SmartTime Codebase

#### File Size Issues

- `src/presentation/timeReport.ts` (1512 lines): Contains `TimeReportViewModel` (67 lines) and `TimeReportProvider` (1445 lines). Split `TimeReportProvider` into multiple files or extract helper functions/classes.
- `src/presentation/timeReport.test.ts` (1491 lines): Large test file; consider splitting into multiple test files based on functionality.
- `src/application/operationQueue.writer.test.ts` (test lines): Tests for `OperationQueueWriter`.
- `src/application/operationQueue.processor.test.ts` (test lines): Tests for `OperationQueueProcessor`.
- `src/storage/git.test.ts` (439 lines): Split if testing multiple aspects.

#### Multiple Classes per File

- `src/presentation/timeReport.ts`: Has 2 classes. Move `TimeReportViewModel` to a separate file `src/presentation/timeReportViewModel.ts`.
- `src/application/operationQueueWriter.ts`: Single class.
- `src/application/operationQueueProcessor.ts`: Single class.

#### Duplicated Interfaces/Types

- Operation request interfaces (`ProcessBatchRequest`, `WriteTimeReportRequest`, etc.) moved to shared types file `src/types/operation.ts`.

#### Barrel Files

- ✅ Create `src/storage/index.ts` to re-export all repository classes for cleaner imports.
- ✅ Create `src/application/index.ts` for application classes.
- ✅ Create `src/presentation/index.ts` for presentation classes.
- ✅ Create `src/services/index.ts` for service classes.

#### Other Considerations

- No ESLint `max-classes-per-file` rule currently set; consider adding if desired.
- Check for circular dependencies: None apparent from imports, but monitor as restructuring occurs.
- Small repository classes (e.g., `ProjectRepository` 57 lines) are fine separate; no need to group unless related helpers exist.

```

```
