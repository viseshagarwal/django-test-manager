import * as vscode from 'vscode';

export class ConfigurationPanel {
    public static currentPanel: ConfigurationPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'saveSettings':
                        await this._saveSettings(message.settings);
                        vscode.window.showInformationMessage('Django Test Manager settings saved!');
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConfigurationPanel.currentPanel) {
            ConfigurationPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'djangoTestManagerConfig',
            'Django Test Configuration',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        ConfigurationPanel.currentPanel = new ConfigurationPanel(panel, extensionUri);
    }

    public dispose() {
        ConfigurationPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _saveSettings(settings: any) {
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        await config.update('pythonPath', settings.pythonPath, vscode.ConfigurationTarget.Workspace);
        await config.update('managePyPath', settings.managePyPath, vscode.ConfigurationTarget.Workspace);
        await config.update('testCommandTemplate', settings.testCommandTemplate, vscode.ConfigurationTarget.Workspace);
        await config.update('testFilePattern', settings.testFilePattern, vscode.ConfigurationTarget.Workspace);
        await config.update('testMethodPattern', settings.testMethodPattern, vscode.ConfigurationTarget.Workspace);

        // Handle array splitting for arguments
        const args = settings.testArguments.split(' ').filter((a: string) => a.length > 0);
        await config.update('testArguments', args, vscode.ConfigurationTarget.Workspace);

        // Handle env vars parsing (key=value\nkey2=value2)
        const envVars: { [key: string]: string } = {};
        settings.environmentVariables.split('\n').forEach((line: string) => {
            const [key, ...valParts] = line.split('=');
            if (key && valParts.length > 0) {
                envVars[key.trim()] = valParts.join('=').trim();
            }
        });
        await config.update('environmentVariables', envVars, vscode.ConfigurationTarget.Workspace);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('djangoTestManager');

        const pythonPath = config.get<string>('pythonPath') || 'python3';
        const managePyPath = config.get<string>('managePyPath') || 'manage.py';
        const testCommandTemplate = config.get<string>('testCommandTemplate') || '${pythonPath} ${managePyPath} test ${testPath} ${testArguments}';
        const testArguments = (config.get<string[]>('testArguments') || []).join(' ');
        const testFilePattern = config.get<string>('testFilePattern') || '**/{tests/**/*.py,test.py,tests.py}';
        const testMethodPattern = config.get<string>('testMethodPattern') || 'test_';

        const envMap = config.get<{ [key: string]: string }>('environmentVariables') || {};
        const environmentVariables = Object.entries(envMap)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');

        const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'icon.svg'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Django Test Configuration</title>
            <style>
                :root {
                    --input-radius: 2px;
                    --focus-border: var(--vscode-focusBorder);
                    --foreground: var(--vscode-foreground);
                    --secondary-foreground: var(--vscode-descriptionForeground);
                }

                body {
                    font-family: var(--vscode-font-family);
                    color: var(--foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 40px 20px;
                    margin: 0;
                    display: flex;
                    justify-content: center;
                }

                .container {
                    max-width: 550px;
                    width: 100%;
                }

                .header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 40px;
                }

                .logo {
                    width: 28px;
                    height: 28px;
                    opacity: 0.9;
                }

                h1 {
                    font-size: 16px;
                    font-weight: 500;
                    margin: 0;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                }

                .section {
                    margin-bottom: 35px;
                }

                .section-title {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: var(--secondary-foreground);
                    margin-bottom: 15px;
                    letter-spacing: 1px;
                    border-bottom: 1px solid var(--vscode-widget-border);
                    padding-bottom: 5px;
                }

                .form-group {
                    margin-bottom: 24px;
                }

                label {
                    display: block;
                    margin-bottom: 8px;
                    font-size: 13px;
                    font-weight: 500;
                }

                input[type="text"], textarea {
                    width: 100%;
                    padding: 8px 10px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: var(--input-radius);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    box-sizing: border-box;
                    transition: border-color 0.1s ease;
                }

                input[type="text"]:focus, textarea:focus {
                    outline: none;
                    border-color: var(--focus-border);
                }

                .help-text {
                    font-size: 12px;
                    color: var(--secondary-foreground);
                    margin-top: 6px;
                    line-height: 1.4;
                }

                .actions {
                    margin-top: 40px;
                    display: flex;
                    justify-content: flex-start;
                }

                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    font-size: 13px;
                    border-radius: 2px;
                    cursor: pointer;
                    transition: background-color 0.1s;
                }

                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                code {
                    font-family: var(--vscode-editor-font-family);
                    background: var(--vscode-textBlockQuote-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-size: 0.9em;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <img src="${iconUri}" class="logo" alt="" />
                    <h1>Configuration</h1>
                </div>
                
                <div class="section">
                    <div class="section-title">Environment</div>
                    <div class="form-group">
                        <label for="pythonPath">Python Path</label>
                        <input type="text" id="pythonPath" value="${pythonPath}" placeholder="e.g. python3">
                        <div class="help-text">Path to the Python interpreter.</div>
                    </div>

                    <div class="form-group">
                        <label for="managePyPath">Manage.py Path</label>
                        <input type="text" id="managePyPath" value="${managePyPath}" placeholder="e.g. manage.py">
                        <div class="help-text">Relative path to <code>manage.py</code> from workspace root.</div>
                    </div>

                    <div class="form-group">
                        <label for="environmentVariables">Environment Variables</label>
                        <textarea id="environmentVariables" rows="4" placeholder="KEY=VALUE">${environmentVariables}</textarea>
                        <div class="help-text">One variable per line.</div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Discovery</div>
                    <div class="form-group">
                        <label for="testFilePattern">Test File Pattern</label>
                        <input type="text" id="testFilePattern" value="${testFilePattern}" placeholder="e.g. **/{tests/**/*.py,test.py,tests.py}">
                        <div class="help-text">Glob pattern to find test files.</div>
                    </div>

                    <div class="form-group">
                        <label for="testMethodPattern">Test Method Pattern</label>
                        <input type="text" id="testMethodPattern" value="${testMethodPattern}" placeholder="e.g. test_">
                        <div class="help-text">Prefix for test methods.</div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Execution</div>
                    <div class="form-group">
                        <label for="testCommandTemplate">Test Command Template</label>
                        <input type="text" id="testCommandTemplate" value="${testCommandTemplate}">
                        <div class="help-text">
                            Variables: <code>\${pythonPath}</code>, <code>\${managePyPath}</code>, <code>\${testPath}</code>, <code>\${testArguments}</code>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="testArguments">Additional Arguments</label>
                        <input type="text" id="testArguments" value="${testArguments}" placeholder="e.g. --keepdb">
                        <div class="help-text">Appended to every test run.</div>
                    </div>
                </div>

                <div class="actions">
                    <button id="saveBtn">Save Changes</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                document.getElementById('saveBtn').addEventListener('click', () => {
                    const settings = {
                        pythonPath: document.getElementById('pythonPath').value,
                        managePyPath: document.getElementById('managePyPath').value,
                        testCommandTemplate: document.getElementById('testCommandTemplate').value,
                        testArguments: document.getElementById('testArguments').value,
                        testFilePattern: document.getElementById('testFilePattern').value,
                        testMethodPattern: document.getElementById('testMethodPattern').value,
                        environmentVariables: document.getElementById('environmentVariables').value
                    };
                    
                    vscode.postMessage({
                        command: 'saveSettings',
                        settings: settings
                    });
                });
            </script>
        </body>
        </html>`;
    }
}
