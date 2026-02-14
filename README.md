# COFT SmartTime

A VS Code extension that automatically tracks your file saves and helps you generate time reports based on your work activity.

## Features

- **Automatic Tracking**: Records every file save with timestamp, directory, and git branch information
- **Batch Processing**: Periodically processes saved files and commits them to a git repository
- **Time Reports**: View and annotate your work activity grouped by time intervals
- **Configurable**: Customize tracking intervals and time grouping
- **Dev Container Support**: Runs on the host side, so data persists even when using dev containers

## Requirements

- Git must be installed and available in your PATH

## Extension Settings

- `coft.smarttime.root`: Root directory for COFT data storage. Leave empty to use default (`~/.coft.smarttime`). If set to an invalid path, the default is used.
- `coft.smarttime.intervalSeconds`: Interval in seconds for batch processing (60-300, default: 60)
- `coft.smarttime.viewGroupByMinutes`: Time grouping in minutes for time report view (must divide evenly into 60, default: 15)

## Getting Started

1. Install the extension
2. Start working! The extension will automatically create `~/.coft.smarttime` and begin tracking file saves
3. Use the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and search for "COFT: Show Time Report" to view your activity

## How It Works

### Storage Structure

The extension creates the following directory structure:

```
root/
├── queue/             # Temporary queue for saved files
├── queue_batch/       # Temporary batch processing directory
├── queue_backup/      # Backup for failed processing
├── data/              # Git repository with processed data
    ├── batches/       # Batch entries
    └── reports/       # Time reports organized by year/month/day
```

### Workflow

1. **Save Hook**: Every file save creates an entry in the queue
2. **Batch Processing**: At configured intervals, the extension processes queued entries
3. **Git Commits**: Processed batches are committed to the data repository
4. **Time Reports**: View and annotate your work history by day

## Commands

- `COFT: Show Time Report`: Open the time report view for the current day

## Release Notes

### 0.0.2

- Auto-create root directory on first use
- Path validation with fallback to default
- Commands always available even if initialization fails
- Runs as UI extension for dev container compatibility

### 0.0.1

Initial release:

- Automatic file save tracking
- Batch processing with configurable intervals
- Time report view with navigation
- Git-based storage

## License

[MIT](LICENSE.md)
