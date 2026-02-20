import * as vscode from 'vscode';
import { TestStateManager } from './testStateManager';

export class TriagePanel {
    public static createOrShow(_extensionUri: vscode.Uri) {
        const panel = vscode.window.createWebviewPanel(
            'testTriage',
            'Failed Tests Triage',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = this.getHtmlForWebview();

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            (message: any) => {
                switch (message.command) {
                    case 'openTest':
                        this.openTest(message.dottedPath);
                        return;
                    case 'copySummary':
                        vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage('Failure summary copied to clipboard!');
                        return;
                }
            }
        );
    }

    private static async openTest(dottedPath: string): Promise<void> {
        const parts = dottedPath.split('.');
        const query = parts[parts.length - 2] || parts[parts.length - 1];
        // Search test file directly with quick open
        await vscode.commands.executeCommand('workbench.action.quickOpen', query);
    }

    private static getHtmlForWebview(): string {
        const stateManager = TestStateManager.getInstance();
        const failedPaths = stateManager.getFailedTests();

        interface FailureGroup {
            signature: string;
            tests: string[];
            fullMessage: string;
        }

        const groups = new Map<string, FailureGroup>();

        for (const path of failedPaths) {
            const msg = stateManager.getFailureMessage(path) || '';

            // Extract exception type from traceback (best effort)
            const lines = msg.split('\n');
            let signature = "Unknown Error";
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                // Usually python trackebacks end with ExceptionType: specific details
                if (line && !line.startsWith('----------') && !line.startsWith('==========') && !line.startsWith('- ') && !line.startsWith('+ ') && !line.startsWith('Traceback')) {
                    signature = line;
                    break;
                }
            }

            if (!groups.has(signature)) {
                groups.set(signature, { signature, tests: [], fullMessage: msg });
            }
            groups.get(signature)!.tests.push(path);
        }

        const groupsArray = Array.from(groups.values());

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .group {
                    margin-bottom: 2rem;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 15px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                }
                .group-title {
                    font-weight: bold;
                    font-size: 1.2em;
                    margin-bottom: 10px;
                    color: var(--vscode-testing-iconFailed);
                }
                .test-list {
                    margin-bottom: 15px;
                    padding-left: 20px;
                }
                .test-item {
                    margin-bottom: 5px;
                }
                .traceback-block {
                    background: var(--vscode-editor-background);
                    padding: 10px;
                    border-radius: 4px;
                    font-family: var(--vscode-editor-font-family);
                    white-space: pre-wrap;
                    max-height: 200px;
                    overflow-y: auto;
                    border: 1px solid var(--vscode-panel-border);
                }
                .actions {
                    margin-top: 15px;
                    display: flex;
                    gap: 10px;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <h1>🐞 Failing Tests Triage</h1>
            <p>Grouped by exception signature (${groupsArray.length} groups total)</p>
            
            ${groupsArray.length === 0 ? '<p>No failed tests found.</p>' : ''}
            
            ${groupsArray.map((g, idx) => `
                <div class="group">
                    <div class="group-title">${escapeHtml(g.signature)} (${g.tests.length} tests)</div>
                    <ul class="test-list">
                        ${g.tests.map(t => `<li class="test-item"><code>${t}</code></li>`).join('')}
                    </ul>
                    <div class="traceback-block">${escapeHtml(g.fullMessage)}</div>
                    <div class="actions">
                        <button onclick="openFirstTest('${g.tests[0]}')">Open First Failing Test</button>
                        <button onclick="copySummary(${idx})">Copy Failure Summary</button>
                    </div>
                </div>
            `).join('')}

            <script>
                const vscode = acquireVsCodeApi();
                
                // Keep summaries in front-end context to copy
                const summaries = ${JSON.stringify(groupsArray.map(g => g.fullMessage))};

                function openFirstTest(dottedPath) {
                    vscode.postMessage({
                        command: 'openTest',
                        dottedPath: dottedPath
                    });
                }
                
                function copySummary(idx) {
                    vscode.postMessage({
                        command: 'copySummary',
                        text: summaries[idx]
                    });
                }
            </script>
        </body>
        </html>
        `;
        return html;
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
