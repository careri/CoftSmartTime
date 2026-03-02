import { PeriodType, SummaryData } from "./timeSummary";
import { DistributionRow } from "./timeSummaryDistribution";
import { DeltaAlgorithmType } from "./timeSummaryDeltaDistribution";

export class TimeSummaryHtmlBuilder {
  build(
    summary: SummaryData,
    currentPeriod: PeriodType,
    startDate: Date,
    endDate: Date,
    distributionRows: DistributionRow[],
    includedDates: string[],
    distributionStartDate: string,
    distributionEndDate: string,
    deltaAlgorithmType: DeltaAlgorithmType,
    deltaConfig: Record<string, string>,
  ): string {
    const startStr = startDate.toLocaleDateString();
    const endStr = endDate.toLocaleDateString();

    const summaryRows = summary.summaryEntries
      .map((entry) => {
        const timeStr = this.formatMinutes(entry.totalTime);
        return `<tr><td>${this.escapeHtml(entry.project)}</td><td>${timeStr}</td></tr>`;
      })
      .join("");

    const deltaColor = summary.grandDeltaMinutes >= 0 ? "#4caf50" : "#f44336";
    const deltaStr = this.formatMinutes(summary.grandDeltaMinutes);
    const grandTotalStr = this.formatMinutes(summary.grandTotalReportedMinutes);

    const dateRows = summary.dateEntries
      .map((entry) => {
        const timeStr = this.formatMinutes(entry.workTime);
        const normalHoursVal = (entry.normalHours / 60).toString();
        const checked = entry.include ? "checked" : "";
        return `<tr><td><input type="checkbox" ${checked} data-date="${entry.date}"></td><td><a href="#" onclick="openTimeReport('${entry.date}')">${entry.date}</a></td><td>${entry.dayOfWeek}</td><td>${timeStr}</td><td><input type="number" class="normal-hours-input" min="0" step="0.5" value="${normalHoursVal}" data-date="${entry.date}"></td></tr>`;
      })
      .join("");

    const startOptions = includedDates
      .map(
        (d) =>
          `<option value="${d}"${d === distributionStartDate ? " selected" : ""}>${d}</option>`,
      )
      .join("");
    const endOptions = includedDates
      .map(
        (d) =>
          `<option value="${d}"${d === distributionEndDate ? " selected" : ""}>${d}</option>`,
      )
      .join("");

    const distributionTableRows = distributionRows
      .map((row) => {
        const hoursStr = this.formatMinutes(row.hours);
        const totalStr = this.formatMinutes(row.totalDateHours);
        const deltaCell = row.delta ? "&#10003;" : "";
        return `<tr><td>${row.date}</td><td>${this.escapeHtml(row.project)}</td><td>${hoursStr}</td><td>${totalStr}</td><td>${deltaCell}</td></tr>`;
      })
      .join("");

    const deltaAlgorithmOptions = [
      { value: "EvenDistribution", label: "Even Distribution" },
      { value: "FillLastDays", label: "Fill Last Days" },
    ]
      .map(
        ({ value, label }) =>
          `<option value="${value}"${value === deltaAlgorithmType ? " selected" : ""}>${label}</option>`,
      )
      .join("");

    const deltaConfigRows = Object.entries(deltaConfig)
      .map(
        ([key, value]) =>
          `<tr><td>${this.escapeHtml(key)}</td><td><input type="text" class="delta-config-input" data-key="${this.escapeHtml(key)}" value="${this.escapeHtml(value)}"></td></tr>`,
      )
      .join("");

    const warningBanner = summary.configWarning
      ? `<div id="configWarning" style="background:#856404;color:#fff3cd;border:1px solid #856404;padding:10px 16px;margin-bottom:12px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;"><span>&#9888; <strong>coft.smarttime.working.hours</strong> is not configured. Defaulting to 8 hours/weekday.</span><button onclick="document.getElementById('configWarning').style.display='none'" style="background:transparent;color:#fff3cd;border:1px solid #fff3cd;padding:2px 8px;cursor:pointer;border-radius:3px;">&#x2715;</button></div>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>COFT Time Summary</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; margin-right: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        th { background-color: var(--vscode-editor-lineHighlightBackground); }
        .normal-hours-input { width: 60px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 4px; }
        .delta-config-input { width: 120px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 4px; }
        .footer-row td { border-top: 2px solid var(--vscode-panel-border); font-weight: bold; }
    </style>
</head>
<body>
    <h1>Time Summary: ${startStr} - ${endStr}</h1>
    ${warningBanner}
    <div>
        <select id="periodSelect">
            <option value="week"${currentPeriod === "week" ? " selected" : ""}>Week</option>
            <option value="month"${currentPeriod === "month" ? " selected" : ""}>Month</option>
        </select>
        <button id="back">←</button>
        <button id="forward">→</button>
        <button id="exportHtml">Export HTML</button>
    </div>
    <h2>Summary by Project</h2>
    <table id="summaryTable">
        <thead><tr><th>Project</th><th>Time</th></tr></thead>
        <tbody>${summaryRows}</tbody>
        <tfoot>
            <tr class="footer-row"><td>Time difference</td><td id="grandDelta" style="color:${deltaColor}">${deltaStr}</td></tr>
            <tr class="footer-row"><td>Grand total (reported)</td><td id="grandTotal">${grandTotalStr}</td></tr>
        </tfoot>
    </table>
    <h2>Dates</h2>
    <table>
        <thead><tr><th>Include</th><th>Date</th><th>Day</th><th>Work Time</th><th>Normal Hours</th></tr></thead>
        <tbody>${dateRows}</tbody>
    </table>
    <h2>Distribution</h2>
    <div>
        <label>Start: <select id="distStart">${startOptions}</select></label>
        &nbsp;
        <label>End: <select id="distEnd">${endOptions}</select></label>
        &nbsp;
        <label>Algorithm: <select id="distAlgorithm"><option value="FillByLargest" selected>Fill By Largest</option></select></label>
        &nbsp;
        <label>Delta: <select id="deltaAlgorithmSelect">${deltaAlgorithmOptions}</select></label>
        <button id="deltaConfigGear" title="Configure delta algorithm">&#9881;</button>
    </div>
    <div id="deltaConfigPanel" style="display:none; margin-top:10px; border:1px solid var(--vscode-panel-border); padding:10px;">
        <strong>Delta Algorithm Configuration</strong>
        <table>
            <tbody>${deltaConfigRows}</tbody>
        </table>
    </div>
    <table id="distributionTable">
        <thead><tr><th>Date</th><th>Project</th><th>Hours</th><th>Total Date Hours</th><th>Delta</th></tr></thead>
        <tbody>${distributionTableRows}</tbody>
    </table>
    <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateSummary') {
                updateSummaryTable(message.data);
            }
        });
        function formatMinutes(totalMinutes) {
            const sign = totalMinutes < 0 ? '-' : '';
            const abs = Math.abs(totalMinutes);
            const hours = Math.floor(abs / 60);
            const minutes = abs % 60;
            return hours > 0 ? sign + hours + 'h ' + minutes + 'm' : sign + minutes + 'm';
        }
        function updateSummaryTable(data) {
            const tbody = document.querySelector('#summaryTable tbody');
            tbody.innerHTML = data.summaryEntries.map(entry => {
                return '<tr><td>' + escapeHtml(entry.project) + '</td><td>' + formatMinutes(entry.totalTime) + '</td></tr>';
            }).join('');
            const delta = data.grandDeltaMinutes;
            const deltaEl = document.getElementById('grandDelta');
            deltaEl.textContent = formatMinutes(delta);
            deltaEl.style.color = delta >= 0 ? '#4caf50' : '#f44336';
            document.getElementById('grandTotal').textContent = formatMinutes(data.grandTotalReportedMinutes);
        }
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        function openTimeReport(date) {
            vscode.postMessage({ command: 'openTimeReport', date: date });
        }
        document.getElementById('periodSelect').addEventListener('change', (e) => vscode.postMessage({ command: 'setPeriod', period: e.target.value }));
        document.getElementById('back').addEventListener('click', () => vscode.postMessage({ command: 'back' }));
        document.getElementById('forward').addEventListener('click', () => vscode.postMessage({ command: 'forward' }));
        document.getElementById('exportHtml').addEventListener('click', () => vscode.postMessage({ command: 'exportSummaryHtml' }));
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'toggleInclude', date: e.target.dataset.date, include: e.target.checked });
            });
        });
        document.querySelectorAll('.normal-hours-input').forEach(input => {
            input.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateNormalHours', date: e.target.dataset.date, hours: e.target.value });
            });
        });
        document.getElementById('distStart').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateDistributionStart', date: e.target.value });
        });
        document.getElementById('distEnd').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateDistributionEnd', date: e.target.value });
        });
        document.getElementById('deltaAlgorithmSelect').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateDeltaAlgorithm', algorithm: e.target.value });
        });
        document.getElementById('deltaConfigGear').addEventListener('click', () => {
            const panel = document.getElementById('deltaConfigPanel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });
        document.querySelectorAll('.delta-config-input').forEach(input => {
            input.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateDeltaConfig', key: e.target.dataset.key, value: e.target.value });
            });
        });
    </script>
</body>
</html>`;
  }

  formatMinutes(totalMinutes: number): string {
    const sign = totalMinutes < 0 ? "-" : "";
    const abs = Math.abs(totalMinutes);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return hours > 0 ? `${sign}${hours}h ${minutes}m` : `${sign}${minutes}m`;
  }

  escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
