import * as vscode from 'vscode';
import { TestStateManager } from './testStateManager';

/**
 * WebView panel displaying N+1 query detection results.
 * Shows per-test query counts, flags high-query tests,
 * and lists duplicate query patterns (N+1 candidates).
 */
export class NPlusOnePanel {
    public static createOrShow(_extensionUri: vscode.Uri) {
        const panel = vscode.window.createWebviewPanel(
            'nplusoneResults',
            'N+1 Query Detection',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = this.getHtmlForWebview();

        panel.webview.onDidReceiveMessage(
            (message: any) => {
                switch (message.command) {
                    case 'openTest':
                        this.openTest(message.dottedPath);
                        return;
                    case 'copySummary':
                        vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage('N+1 summary copied to clipboard!');
                        return;
                }
            }
        );
    }

    private static async openTest(dottedPath: string): Promise<void> {
        const parts = dottedPath.split('.');
        const query = parts[parts.length - 2] || parts[parts.length - 1];
        await vscode.commands.executeCommand('workbench.action.quickOpen', query);
    }

    private static getHtmlForWebview(): string {
        const stateManager = TestStateManager.getInstance();
        const allQueryCounts = stateManager.getAllQueryCounts();
        const allWarnings = stateManager.getAllNPlusOneWarnings();

        // Build sorted list of tests by query count (descending)
        const queryEntries = Array.from(allQueryCounts.entries())
            .sort((a, b) => b[1] - a[1]);

        const totalTests = queryEntries.length;
        const totalQueries = queryEntries.reduce((sum, [, count]) => sum + count, 0);
        const testsWithNPlusOne = Array.from(allWarnings.entries())
            .filter(([, warnings]) => warnings.length > 0);
        const nplusOneCount = testsWithNPlusOne.length;

        // Config thresholds for display
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const queryThreshold = config.get<number>('queryCountThreshold') || 50;

        // ── N+1 warnings section ────────────────────────────────
        const nplusOneSections = testsWithNPlusOne.map(([testPath, warnings]) => {
            const warningsHtml = warnings.map(w => `
                <div class="query-row">
                    <span class="repeat-badge">${w.count}×</span>
                    <code class="sql-text">${escapeHtml(w.sql)}</code>
                </div>
            `).join('');

            const queryCount = allQueryCounts.get(testPath) || 0;
            const markdownSummary = `**${testPath}** (${queryCount} queries)\\n` +
                warnings.map(w => `- ${w.count}× ${w.sql}`).join('\\n');

            return `
                <div class="group nplusone-group">
                    <div class="group-header">
                        <div class="group-title">
                            <span class="nplusone-badge">N+1</span>
                            <code class="test-path" onclick="openTest('${testPath}')">${escapeHtml(testPath)}</code>
                        </div>
                        <span class="query-count-badge">${queryCount} queries</span>
                    </div>
                    <div class="warnings-list">
                        ${warningsHtml}
                    </div>
                    <div class="actions">
                        <button onclick="openTest('${testPath}')">Open Test</button>
                        <button onclick="copySummary('${escapeHtml(markdownSummary)}')">Copy Summary</button>
                    </div>
                </div>
            `;
        }).join('');

        // ── All tests by query count ─────────────────────────────
        const queryTableRows = queryEntries.map(([testPath, count]) => {
            const hasNPlusOne = allWarnings.has(testPath) && (allWarnings.get(testPath)?.length || 0) > 0;
            const overThreshold = count >= queryThreshold;
            const rowClass = hasNPlusOne ? 'row-nplusone' : overThreshold ? 'row-warning' : '';
            const badges = [
                hasNPlusOne ? '<span class="nplusone-badge small">N+1</span>' : '',
                overThreshold ? '<span class="threshold-badge">⚠️</span>' : '',
            ].filter(Boolean).join(' ');

            return `
                <tr class="${rowClass}">
                    <td>
                        <code class="test-path" onclick="openTest('${testPath}')">${escapeHtml(testPath)}</code>
                    </td>
                    <td class="count-cell">${count}</td>
                    <td>${badges}</td>
                </tr>
            `;
        }).join('');

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    line-height: 1.5;
                }
                h1 { margin: 0 0 5px 0; font-size: 22px; }
                .subtitle { opacity: 0.7; margin-bottom: 24px; font-size: 13px; }

                /* ── Stat cards ─────────────────────────── */
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                    gap: 12px;
                    margin-bottom: 28px;
                }
                .stat-card {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 8px;
                    padding: 14px;
                    text-align: center;
                }
                .stat-value {
                    font-size: 26px;
                    font-weight: bold;
                    margin-bottom: 4px;
                }
                .stat-label { font-size: 11px; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.5px; }
                .stat-ok { color: var(--vscode-testing-iconPassed); }
                .stat-warn { color: #e8a317; }
                .stat-danger { color: var(--vscode-testing-iconFailed); }

                /* ── Section headers ────────────────────── */
                .section { margin-bottom: 28px; }
                .section h2 {
                    font-size: 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 6px;
                    margin-bottom: 12px;
                }

                /* ── N+1 warning groups ─────────────────── */
                .group {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 14px;
                    margin-bottom: 14px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                }
                .nplusone-group {
                    border-left: 3px solid var(--vscode-testing-iconFailed);
                }
                .group-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .group-title { display: flex; align-items: center; gap: 8px; }
                .nplusone-badge {
                    background: var(--vscode-testing-iconFailed);
                    color: #fff;
                    font-size: 10px;
                    font-weight: bold;
                    padding: 2px 6px;
                    border-radius: 3px;
                    letter-spacing: 0.5px;
                }
                .nplusone-badge.small { font-size: 9px; padding: 1px 4px; }
                .query-count-badge {
                    opacity: 0.7;
                    font-size: 12px;
                }
                .test-path {
                    cursor: pointer;
                    color: var(--vscode-textLink-foreground);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                }
                .test-path:hover {
                    color: var(--vscode-textLink-activeForeground);
                }

                /* ── Query rows ─────────────────────────── */
                .warnings-list { margin-bottom: 10px; }
                .query-row {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    padding: 6px 8px;
                    border-radius: 4px;
                    margin-bottom: 4px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                }
                .repeat-badge {
                    background: var(--vscode-testing-iconFailed);
                    color: #fff;
                    font-size: 11px;
                    font-weight: bold;
                    padding: 1px 6px;
                    border-radius: 10px;
                    white-space: nowrap;
                    flex-shrink: 0;
                }
                .sql-text {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    word-break: break-all;
                    opacity: 0.85;
                }
                .threshold-badge { font-size: 14px; }

                /* ── Query count table ──────────────────── */
                table { width: 100%; border-collapse: collapse; }
                th, td {
                    text-align: left;
                    padding: 8px 10px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                th { opacity: 0.6; font-weight: normal; font-size: 12px; text-transform: uppercase; }
                .count-cell { font-variant-numeric: tabular-nums; font-weight: 600; }
                .row-nplusone { background: rgba(255, 80, 80, 0.08); }
                .row-warning  { background: rgba(232, 163, 23, 0.06); }

                /* ── Buttons ────────────────────────────── */
                .actions { display: flex; gap: 8px; }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 5px 12px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 12px;
                }
                button:hover { background-color: var(--vscode-button-hoverBackground); }

                .empty-state {
                    text-align: center;
                    padding: 40px;
                    opacity: 0.6;
                }
                .empty-state .icon { font-size: 40px; margin-bottom: 10px; }
            </style>
        </head>
        <body>
            <h1>🔍 N+1 Query Detection</h1>
            <p class="subtitle">Database query analysis from the last test run</p>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${totalTests}</div>
                    <div class="stat-label">Tests Analyzed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${totalQueries.toLocaleString()}</div>
                    <div class="stat-label">Total Queries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value ${nplusOneCount > 0 ? 'stat-danger' : 'stat-ok'}">${nplusOneCount}</div>
                    <div class="stat-label">N+1 Patterns</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value ${queryEntries.filter(([, c]) => c >= queryThreshold).length > 0 ? 'stat-warn' : 'stat-ok'}">${queryEntries.filter(([, c]) => c >= queryThreshold).length}</div>
                    <div class="stat-label">Over ${queryThreshold}q Threshold</div>
                </div>
            </div>

            ${nplusOneCount > 0 ? `
                <div class="section">
                    <h2>🔴 N+1 Query Patterns (${nplusOneCount} tests)</h2>
                    ${nplusOneSections}
                </div>
            ` : ''}

            <div class="section">
                <h2>📊 All Tests by Query Count</h2>
                ${totalTests === 0 ? `
                    <div class="empty-state">
                        <div class="icon">🔍</div>
                        <p>No query data available yet.</p>
                        <p>Enable "Detect N+1" in settings and run your tests.</p>
                    </div>
                ` : `
                    <table>
                        <tr>
                            <th>Test</th>
                            <th>Queries</th>
                            <th>Flags</th>
                        </tr>
                        ${queryTableRows}
                    </table>
                `}
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function openTest(dottedPath) {
                    vscode.postMessage({ command: 'openTest', dottedPath: dottedPath });
                }

                function copySummary(text) {
                    vscode.postMessage({ command: 'copySummary', text: text.replace(/\\\\n/g, '\\n') });
                }
            </script>
        </body>
        </html>
        `;
    }
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
