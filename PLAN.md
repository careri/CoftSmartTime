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
- ✅ Devcontainer with all dependencies
- ✅ Git bash aliases in devcontainer
- ✅ Auto-create COFT_ROOT directory on first use
- ✅ Path validation with fallback to default
- ✅ Commands registered before initialization (always available)
- ✅ MIT License
- ✅ VSIX packaging support
- ✅ UI extension kind (runs on host, works in dev containers)

### Implementation Files

- `src/config.ts` - Configuration management
- `src/storage.ts` - File storage operations
- `src/lock.ts` - File locking mechanism
- `src/git.ts` - Git operations
- `src/batch.ts` - Batch processing logic
- `src/timeReport.ts` - Time report view
- `src/extension.ts` - Main extension entry point
- `src/test/config.test.ts` - Configuration tests
- `src/test/storage.test.ts` - Storage tests
- `src/test/batch.test.ts` - Batch processing tests
- `src/test/extension.test.ts` - Extension tests
- `src/test/git.test.ts` - Git tests
- `src/test/lock.test.ts` - Lock tests
- `src/test/timeReport.test.ts` - Time report tests

## Tools

- ✅ devcontainer - Configured with TypeScript, Node.js, and all VS Code test dependencies
- ✅ TypeScript - Best practice language for VS Code extensions
- ✅ xvfb - Headless testing support

## Properties

COFT_ROOT - The root directory
COFT_QUEUE - Subdir of COFT_ROOT
COFT_QUEUE_BATCH - Subdir of COFT_ROOT
COFT_QUEUE_BACKUP - Subdir of COFT_ROOT
COFT_DATA - Subdir of COFT_ROOT
COFT_INTERVAL_SECONDS - How often the batch logic shall execute, default value: 60
COFT_VIEW_GROUP_BY_MINUTES - How the view is grouped, default 15.

## Storage

### Folder Structure

```
root/
├── queue/             # Each saved file in VS code writes an entry here
├── queue_batch/       # A temp dir
├── queue_backup/       # A temp dir
├── data/              # A git repo that contains processed data from the queue
```

### Save Entry. A file

Directory: project/workspace root # ITEM_DIR
Filename: the relative file name. # ITEM_PATH
GitBranch: <optional> # ITEM_BRANCH

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

Timereports are saved by day in COFT_DATA/reports/year/month/day

```json
{
    "Date": <UTC>,
    "Entries: {
        "Key": <HOUR+COFT_VIEW_GROUP_BY_MINUTES>,
        "Comment": <text>,
        "Project": <text>
    }
}
```

### Project

✅ A mapping between branch and project, COFT_DATA/projects.json
✅ Dont save default branches like main or master.

```json
{
    "<ITEM_BRANCH>": {
        "<ITEM_DIR>: "<PROJECT>"
    },
}


## Logic

✅ **Implemented** - All logic components are complete and tested

### Init

✅ Validate configuration.
✅ If COFT_INTERVAL_SECONDS is out of range log that 60 seconds will be used.
✅ if COFT_ROOT is not a valid path, log warning and use default (~/.coft.smarttime).
✅ Auto-create COFT_ROOT directory if it does not exist.
✅ if COFT_VIEW_GROUP_BY_MINUTES is not a valid value use 15. X \* COFT_VIEW_GROUP_BY_MINUTES must equal to 60, it can't be negative, 0 or larger than 60.

### Save Hook

✅ Every saved file in VS code generates an entry in COFT_QUEUE

### Process Logic

✅ This logic executes on timer, every COFT_INTERVAL_SECONDS seconds.
✅ Uses logging with debug level for all steps.

1. ✅ Get a global lock on the COFT_DATA dir. OS agnostic with stale lock detection. Tries for 1 second
2. ✅ If failed to get lock, exit the loop.
3. ✅ Move all files in COFT_QUEUE into COFT_QUEUE_BATCH.
4. ✅ Generate a Batch Entry in COFT_DATA from the files in COFT_QUEUE_BATCH.
5. ✅ Make a git commit. Message: <extension version>
6. ✅ DELETE the files in COFT_QUEUE_BATCH.
7. ✅ Release the global lock.

#### Storage handling

When saving a file make sure the target directory exists.

#### Git handling

If COFT_DATA isn't a git repo, do git init. Set user name and email. Derive from username and computer name

#### Error handling

✅ If the batch generator or git commit fails move the files in COFT_QUEUE_BATCH back to COFT_QUEUE.
✅ If the batch generator fails many times in a row (5 failures) move the items in COFT_QUEUE_BATCH to COFT_QUEUE_BACKUP

## Configuration

✅ **Implemented** - All configuration properties are implemented in package.json

Configure COFT_ROOT where the file entries will be saved, default should be <home>/.coft.smarttime
Configure COFT_INTERVAL_SECONDS, inform the user of valid range 60 to 300
Configure COFT_VIEW_GROUP_BY_MINUTES, valid values: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60
Configure COFT_BRANCH_TASK_URL, optional. If set it should be a url where the branch can be injected. E.g. https://ctek-jira.atlassian.net/browse/{branch}

## VS Code Commands

✅ **Implemented** - Command available in command palette

### Show time report

✅ **Implemented** - Webview with interactive UI

#### Logic

✅ A timereport is derived from the batches that was committed to git on that day.
✅ If a timereport exists for that day, load it.
✅ If new batches have been committed for that day after the report is created, add them.

#### Layout

##### Controls

✅ Buttons to go back and forward in dates. Show today by default.
✅ Save button. Saves timereport to git.

##### Date Time

✅ Dates are shown in user locale.

##### Parts

###### Overview

✅ At the top show a project view. Load projects.json
✅ Collect TIME_SLOTS by COMPOSITE_KEY and map to existing values in projects. If not found check if branch is bound in another directory.

✅ Show start of day and end of day. First and last changed file.
[ ] If COFT_BRANCH_TASK_URL is configured convert the branch column into a link using that pattern
[ ] You should be able to assign a project for default branches (main/master etc). But the mapping between default branch and project shouldn't be saved to projects.

✅ Show a table:
- ✅ branch
- ✅ project (list control with value selected if available)
- ✅ time (sum of TIME_SLOT)

###### Timetable

✅ Show a view of the files that were changed today. each line is a TIME_SLOT
✅ Assign the TIME_SLOT to the branch with most changed files
✅ Show the info for the assigned branch on the row. including readonly project (should update if changed in the overview)

Group them by:

- ✅ COFT_VIEW_GROUP_BY_MINUTES <readonly>
- ✅ Composite key of ITEM_BRANCH and ITEM_DIR <readonly> (COMPOSITE_KEY)


##### Batch Items

✅ If a row is selected show the items within the batch in another grid at the bottom.

## Next Steps

- Test the extension in real-world usage
- Consider adding filtering/search in time report view
- Add export functionality for reports
- Consider adding statistics/summary views
```
