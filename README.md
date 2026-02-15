# COFT SmartTime

A VS Code extension that automatically tracks your file saves and helps you generate time reports based on your work activity.

## Features

- **Automatic Tracking**: Records every file save with timestamp, directory, and git branch information
- **Batch Processing**: Periodically processes saved files and commits them to a git repository
- **Time Reports**: View and annotate your work activity grouped by time intervals
- **Project Mapping**: Map branches to projects with persistent project assignments
- **Git Backup**: Daily housekeeping with automatic push to a local bare repo backup
- **Multi-Instance Safe**: All writes go through a serialized operation queue with file locking
- **Configurable**: Customize tracking intervals, time grouping, and task URL patterns
- **Dev Container Support**: Runs on the host side, so data persists even when using dev containers

## Requirements

- Git must be installed and available in your PATH

## Extension Settings

- `coft.smarttime.root`: Root directory for COFT data storage. Leave empty to use default (`~/.coft.smarttime`). If set to an invalid path, the default is used.
- `coft.smarttime.intervalSeconds`: Interval in seconds for batch processing (60-300, default: 60)
- `coft.smarttime.viewGroupByMinutes`: Time grouping in minutes for time report view (must divide evenly into 60, default: 15)
- `coft.smarttime.branchTaskUrl`: Optional URL pattern for linking branches to tasks. Use `{branch}` as placeholder (e.g. `https://jira.example.com/browse/{branch}`)

## Getting Started

1. Install the extension
2. Start working! The extension will automatically create `~/.coft.smarttime` and begin tracking file saves
3. Use the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and search for "COFT: Show Time Report" to view your activity

## How It Works

### Storage Structure

The extension creates the following directory structure:

```
root/
├── queue/                  # Each file save creates an entry here
├── queue_batch/            # Temporary batch processing directory
├── queue_backup/           # Backup for failed processing
├── operation_queue/        # Serialized write operations
├── operation_queue_backup/ # Failed operations after max retries
├── data/                   # Git repository with processed data
│   ├── batches/            # Batch entries grouped by date
│   ├── reports/            # Time reports organized by year/month/day
│   └── projects.json       # Branch-to-project mapping
└── backup/                 # Git bare repo (local backup)
```

### Workflow

1. **Save Hook**: Every file save creates an entry in the queue
2. **Batch Processing**: At configured intervals, queued entries are submitted as an operation request
3. **Operation Queue**: A processor acquires a file lock, writes data, and commits to git
4. **Housekeeping**: On the first commit each day, runs `git gc` and pushes to the backup repo
5. **Time Reports**: View and annotate your work history by day, with project assignments and editable start/end times

## Commands

- `COFT: Show Time Report`: Open the time report view for the current day
- `COFT: Backup`: Manually run housekeeping (git gc + push to backup)

## Development

### Dev Container

The project includes a dev container based on `mcr.microsoft.com/devcontainers/typescript-node:1-20-bookworm`. Opening the project in VS Code with the Dev Containers extension will automatically set up the development environment with:

- TypeScript, Node.js, and Git
- ESLint and Prettier extensions
- VS Code test dependencies (Electron/Chromium libraries)
- Git bash aliases (e.g. `gs`, `gitcm`, `gap`)
- `yo`, `generator-code`, and `@vscode/vsce` for extension scaffolding and packaging

### Xvfb (X Virtual Framebuffer)

VS Code extension tests require a display server because they launch a real VS Code (Electron) instance. The dev container starts **Xvfb** automatically on `:99` via `postStartCommand` and sets `DISPLAY=:99` so tests can run headlessly.

Tests are executed with:

```bash
npm test
```

This runs `xvfb-run -a npx vscode-test` under the hood, which ensures a virtual display is available even if the background Xvfb process isn't running.

### Building a VSIX

```bash
./build.vsix.sh
```

## License

[MIT](LICENSE.md)
