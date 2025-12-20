import * as vscode from 'vscode';
import * as path from 'path';
import { TestTreeDataProvider, TestItem } from './testTree';
import { TestRunner } from './testRunner';
import { DjangoTestCodeLensProvider, initCodeLensCache } from './testCodeLensProvider';
import { TestNode, TestDiscovery } from './testDiscovery';
import { ConfigurationPanel } from './configurationPanel';
import { TestDecorationProvider } from './testDecorations';
import { TestStatusBar } from './testStatusBar';
import { TestStateManager } from './testStateManager';
import { CoverageProvider } from './coverageProvider';
import { getMergedEnvironmentVariables, initTestUtilsCache, resolvePath } from './testUtils';
import { WatchModeManager } from './watchMode';
import { TestHistoryManager, TestHistoryTreeProvider } from './testHistory';
import { isTestClassFromLine } from './testUtils';
import { NativeTestController } from './nativeTestController';

export function activate(context: vscode.ExtensionContext) {
    console.log('Django Test Manager is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || vscode.workspace.rootPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder opened. Django Test Manager cannot activate.');
        return;
    }

    // Initialize performance caches
    context.subscriptions.push(initTestUtilsCache());
    initCodeLensCache(context);
    const config = vscode.workspace.getConfiguration('djangoTestManager');
    let resolvedWorkspaceRoot = config.get<string>('projectRoot') ?? '';

    // If projectRoot config is empty, use workspace root
    if (!resolvedWorkspaceRoot) {
        resolvedWorkspaceRoot = workspaceRoot;
    } else if (!path.isAbsolute(resolvedWorkspaceRoot)) {
        // If relative, resolve it relative to workspace root
        resolvedWorkspaceRoot = path.resolve(workspaceRoot, resolvedWorkspaceRoot);
    }

    const testDiscovery = new TestDiscovery(resolvedWorkspaceRoot);
    const testTreeDataProvider = new TestTreeDataProvider(resolvedWorkspaceRoot, testDiscovery);

    // Use createTreeView to get access to the view instance
    const treeView = vscode.window.createTreeView('djangoTestExplorer', {
        treeDataProvider: testTreeDataProvider
    });

    // Status Bar
    const statusBar = new TestStatusBar();
    context.subscriptions.push(statusBar);

    const coverageProvider = new CoverageProvider(workspaceRoot);
    // Load existing coverage if available
    coverageProvider.loadCoverage();
    const testRunner = new TestRunner(resolvedWorkspaceRoot, testTreeDataProvider, coverageProvider);

    // Initialize Watch Mode
    const watchModeManager = new WatchModeManager(resolvedWorkspaceRoot, testRunner);
    context.subscriptions.push({ dispose: () => watchModeManager.dispose() });

    // Initialize Test History
    const testHistoryManager = TestHistoryManager.getInstance(context);
    const testHistoryTreeProvider = new TestHistoryTreeProvider(testHistoryManager);

    // Initialize VS Code Native Test Controller (integrates with built-in Test Explorer)
    const nativeTestController = new NativeTestController(resolvedWorkspaceRoot, testDiscovery);
    context.subscriptions.push({ dispose: () => nativeTestController.dispose() });

    // Discover tests for native controller
    nativeTestController.discoverAllTests();

    context.subscriptions.push(
        treeView,
        vscode.commands.registerCommand('django-test-manager.refreshTests', () => testTreeDataProvider.refreshDiscovery()),
        vscode.commands.registerCommand('django-test-manager.runTest', (item: TestItem | TestNode | undefined) => {
            if (!item) {
                vscode.commands.executeCommand('django-test-manager.runCurrentFile');
                return;
            }
            if (item instanceof TestItem) {
                testRunner.runInTerminal(item.node);
            } else if ((item as TestNode).dottedPath) {
                testRunner.runInTerminal(item as TestNode);
            }
        }),
        vscode.commands.registerCommand('django-test-manager.debugTest', async (item: TestItem | TestNode) => {
            const node = item instanceof TestItem ? item.node : item;
            if (!node || !node.dottedPath) {
                vscode.window.showErrorMessage('Cannot debug this item: No dotted path found.');
                return;
            }

            const config = vscode.workspace.getConfiguration('djangoTestManager');
            const pythonPath = config.get<string>('pythonPath') || 'python';
            const managePyPathConfig = config.get<string>('managePyPath') || 'manage.py';
            const managePyPath = resolvePath(managePyPathConfig, resolvedWorkspaceRoot, 'manage.py');
            const env = await getMergedEnvironmentVariables(resolvedWorkspaceRoot);
            const rawTestArgs = config.get<string[]>('testArguments') || [];

            // Filter out arguments that interfere with debugging
            const testArgs: string[] = [];
            for (let i = 0; i < rawTestArgs.length; i++) {
                const arg = rawTestArgs[i];
                if (arg === '--parallel') {
                    // Skip value if present
                    if (i + 1 < rawTestArgs.length && !rawTestArgs[i + 1].startsWith('-')) {
                        i++;
                    }
                    continue;
                }
                if (arg.startsWith('--parallel=')) continue;
                if (arg === '--buffer' || arg === '-b') continue;
                testArgs.push(arg);
            }

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(managePyPath));
            } catch {
                vscode.window.showErrorMessage(`Cannot find manage.py at ${managePyPath}. Please check your configuration.`);
                return;
            }

            const debugConfigName = 'Django Test Manager: Debug';
            const debugConfig = {
                name: debugConfigName,
                type: 'debugpy',
                request: 'launch',
                program: managePyPath,
                args: ['test', node.dottedPath, '--noinput', ...testArgs],
                console: 'integratedTerminal',
                env: env,
                justMyCode: false,
                subProcess: true,
                django: true,
                cwd: resolvedWorkspaceRoot
            };
            // Start debugging using the configuration directly (more reliable than named config)
            await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], debugConfig);
        }),
        vscode.commands.registerCommand('django-test-manager.copyPath', (item: TestItem | TestNode) => {
            const node = item instanceof TestItem ? item.node : item;
            if (node && node.dottedPath) {
                vscode.env.clipboard.writeText(node.dottedPath);
                vscode.window.showInformationMessage(`Copied: ${node.dottedPath}`);
            }
        }),
        vscode.commands.registerCommand('django-test-manager.runInTerminal', (item: TestItem | TestNode) => {
            const node = item instanceof TestItem ? item.node : item;
            if (node) {
                testRunner.runInTerminal(node);
            }
        }),
        vscode.commands.registerCommand('django-test-manager.runFailedTests', () => testRunner.runFailedTests()),
        vscode.commands.registerCommand('django-test-manager.runCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showErrorMessage('No active Python file found.');
                return;
            }

            const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
            const dottedPath = relativePath.replace(/\.py$/, '').replace(/\//g, '.');

            const node: TestNode = {
                name: path.basename(editor.document.uri.fsPath),
                type: 'file',
                dottedPath: dottedPath
            };

            await testRunner.runInTerminal(node);
        }),
        vscode.commands.registerCommand('django-test-manager.runAllTests', async () => {
            const rootNode: TestNode = {
                name: 'All Tests',
                type: 'folder',
                dottedPath: ''
            };
            await testRunner.runInTerminal(rootNode);
        }),
        vscode.commands.registerCommand('django-test-manager.expandAll', async () => {
            const roots = await testTreeDataProvider.getChildren();
            const expandNodes = async (items: TestItem[]) => {
                for (const item of items) {
                    if (item.node.children && item.node.children.length > 0) {
                        try {
                            // Reveal the node itself to expand it
                            // Note: reveal takes the element (TestItem or TestNode depending on provider)
                            // Our provider returns TestItem, but getTreeItem returns TestItem.
                            // However, createTreeView is typed with <TestItem>.
                            await treeView.reveal(item, { expand: true, select: false, focus: false });
                        } catch (e) {
                            // Ignore
                        }
                        // Recurse
                        const children = item.node.children.map(c => new TestItem(c));
                        await expandNodes(children);
                    }
                }
            };
            await expandNodes(roots);
        }),
        vscode.commands.registerCommand('django-test-manager.collapseAll', async () => {
            // Use the correct command ID for collapsing all items in a tree view
            await vscode.commands.executeCommand('workbench.actions.treeView.djangoTestExplorer.collapseAll');
        }),

        // Register a command to handle item clicks
        vscode.commands.registerCommand('django-test-manager.openTestItem', async (item: TestItem) => {
            if (item.node.type === 'folder' || item.node.type === 'app') {
                // Toggle expansion for folders
                if (item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                    await treeView.reveal(item, { expand: true, select: true, focus: false });
                } else {
                    await treeView.reveal(item, { expand: false, select: true, focus: false });
                }
            } else if (item.node.uri) {
                // Open file for files/classes/methods
                await vscode.commands.executeCommand('vscode.open', item.node.uri, {
                    selection: item.node.range
                });
            }
        }),
        vscode.commands.registerCommand('django-test-manager.configure', () => {
            ConfigurationPanel.createOrShow(context.extensionUri);
        }),

        vscode.commands.registerCommand('django-test-manager.runRelatedTest', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showErrorMessage('No active Python file found.');
                return;
            }

            const uri = editor.document.uri;
            const fileName = path.basename(uri.fsPath);
            const EXACT_TEST_FILES = new Set([
                'test.py',
                'tests.py',
            ]);

            const isTestFile =
                EXACT_TEST_FILES.has(fileName) ||
                fileName.startsWith('test_') ||
                fileName.endsWith('_test.py');
            // If it's already a test file, just run it
            if (isTestFile) {
                vscode.commands.executeCommand('django-test-manager.runCurrentFile');
                return;
            }

            const nameWithoutExt = fileName.replace('.py', '');
            const testNames = [`test_${nameWithoutExt}.py`, `${nameWithoutExt}_test.py`];

            // Search for test files
            const files = await vscode.workspace.findFiles(`**/{tests/**/{${testNames.join(',')}},test.py,tests.py}`, '**/node_modules/**', 10);

            if (files.length === 0) {
                vscode.window.showErrorMessage(`No related test file found for ${fileName}.`);
                return;
            }

            // Sort by proximity
            const dirName = path.dirname(uri.fsPath);
            files.sort((a, b) => {
                const relA = path.relative(dirName, a.fsPath);
                const relB = path.relative(dirName, b.fsPath);
                return relA.length - relB.length;
            });

            const bestMatch = files[0];

            // Construct a TestNode for the file
            const relativePath = vscode.workspace.asRelativePath(bestMatch);
            const dottedPath = relativePath.replace(/\.py$/, '').replace(/\//g, '.');

            const node: TestNode = {
                name: path.basename(bestMatch.fsPath),
                type: 'file',
                dottedPath: dottedPath,
                uri: bestMatch
            };

            await testRunner.runInTerminal(node);
        }),
        vscode.commands.registerCommand('django-test-manager.searchTests', async () => {
            const stateManager = TestStateManager.getInstance();
            const allKeys = stateManager.getAllKeys();

            if (allKeys.length === 0) {
                vscode.window.showInformationMessage('No tests discovered yet. Try refreshing the test list.');
                return;
            }

            interface TestQuickPickItem extends vscode.QuickPickItem {
                dottedPath: string;
            }

            const items: TestQuickPickItem[] = allKeys.map((key: string) => {
                const status = stateManager.getStatus(key);
                let icon = '';
                if (status === 'passed') icon = '$(check) ';
                else if (status === 'failed') icon = '$(error) ';
                else if (status === 'skipped') icon = '$(dash) ';
                else icon = '$(circle-outline) ';

                return {
                    label: icon + key,
                    description: '',
                    dottedPath: key
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search for a test to run...',
                matchOnDetail: true
            });

            if (selected) {
                // Find the node for this path
                // Since we don't have direct access to the node tree here easily without traversing,
                // we can construct a temporary node or ask the runner to run by dotted path.
                // The runner expects a TestNode.
                const node: TestNode = {
                    name: selected.dottedPath.split('.').pop() || '',
                    type: 'method', // Assume method for simplicity, runner handles it
                    dottedPath: selected.dottedPath
                };

                // Ask user what to do
                const action = await vscode.window.showQuickPick(['Run', 'Debug', 'Go to File'], {
                    placeHolder: `Action for ${selected.dottedPath}`
                });

                if (action === 'Run') {
                    testRunner.runInTerminal(node);
                } else if (action === 'Debug') {
                    // We need the URI for debugging to work best, but let's try with just dotted path if possible
                    // Debugging usually requires a URI in the current implementation.
                    // Let's try to find the URI from discovery if possible, or just run it.
                    // For now, let's just run it as debug might fail without URI.
                    vscode.commands.executeCommand('django-test-manager.debugTest', node);
                } else if (action === 'Go to File') {
                    // We need to resolve the file.
                    // This is tricky without the node object.
                    // Let's try to find the file via workspace search
                    const parts = selected.dottedPath.split('.');
                    // Heuristic: last part is method, second last is class, rest is module
                    // But it could be just a file path.
                    // Let's search for the file corresponding to the module.
                    // This is a bit hacky, but "Go to Subject" logic might help or just simple search.
                    vscode.commands.executeCommand('workbench.action.quickOpen', parts[parts.length - 2] || parts[parts.length - 1]);
                }
            }
        }),
        vscode.commands.registerCommand('django-test-manager.viewDiff', async (item: TestItem | TestNode) => {
            const node = item instanceof TestItem ? item.node : item;
            if (!node || !node.dottedPath) return;

            const diff = TestStateManager.getInstance().getDiff(node.dottedPath);
            if (!diff) {
                vscode.window.showInformationMessage('No diff available for this test.');
                return;
            }

            try {
                const doc1 = await vscode.workspace.openTextDocument({ content: diff.expected, language: 'python' });
                const doc2 = await vscode.workspace.openTextDocument({ content: diff.actual, language: 'python' });

                // Add a title to describe the diff
                const title = `Expected vs Actual (${node.name})`;

                await vscode.commands.executeCommand('vscode.diff', doc1.uri, doc2.uri, title);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to open diff: ${e}`);
            }
        }),
        vscode.commands.registerCommand('django-test-manager.cancelTests', () => {
            testRunner.cancel();
        }),
        vscode.commands.registerCommand('django-test-manager.selectProfile', async () => {
            const config = vscode.workspace.getConfiguration('djangoTestManager');
            const profiles = config.get<{ [key: string]: string[] }>('testProfiles') || {};
            const activeProfile = config.get<string>('activeProfile') || 'Default';

            const items = Object.keys(profiles).map(label => ({
                label,
                description: profiles[label].join(' '),
                picked: label === activeProfile
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select Test Profile'
            });

            if (selected) {
                await config.update('activeProfile', selected.label, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Active Test Profile set to: ${selected.label}`);
            }
        }),

        // Watch Mode commands
        vscode.commands.registerCommand('django-test-manager.toggleWatchMode', () => {
            watchModeManager.toggle();
        }),

        // Test History commands
        vscode.commands.registerCommand('django-test-manager.viewTestHistory', async () => {
            const summary = testHistoryManager.getSummary();
            const slowestTests = testHistoryManager.getSlowestTests(5);
            const mostFailing = testHistoryManager.getMostFailingTests(5);

            const panel = vscode.window.createWebviewPanel(
                'testHistory',
                'Test History',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            panel.webview.html = generateTestHistoryHtml(summary, slowestTests, mostFailing);
        }),

        vscode.commands.registerCommand('django-test-manager.clearTestHistory', () => {
            testHistoryManager.clearHistory();
            vscode.window.showInformationMessage('Test history cleared.');
        }),

        vscode.commands.registerCommand('django-test-manager.exportTestHistory', async () => {
            const json = testHistoryManager.exportToJson();
            const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
            await vscode.window.showTextDocument(doc);
        }),

        // Run/Debug Test at Cursor
        vscode.commands.registerCommand('django-test-manager.runTestAtCursor', async () => {
            const testAtCursor = await getTestAtCursor(workspaceRoot);
            if (testAtCursor) {
                await testRunner.runInTerminal(testAtCursor);
            }
        }),

        vscode.commands.registerCommand('django-test-manager.debugTestAtCursor', async () => {
            const testAtCursor = await getTestAtCursor(workspaceRoot);
            if (testAtCursor) {
                vscode.commands.executeCommand('django-test-manager.debugTest', testAtCursor);
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [
                { language: 'python', scheme: 'file' },
                { language: 'python', scheme: 'untitled' }
            ],
            new DjangoTestCodeLensProvider(resolvedWorkspaceRoot)
        )
    );

    // Decorations
    const decorationProvider = new TestDecorationProvider();
    context.subscriptions.push(decorationProvider);

    const updateDecorations = async (editor: vscode.TextEditor | undefined) => {
        if (!editor || editor.document.languageId !== 'python') return;

        try {
            const node = await testDiscovery.parseFile(editor.document.uri);
            if (node && node.children) {
                decorationProvider.updateDecorations(editor, [node]);
            }
        } catch (e) {
            console.error('Error updating decorations:', e);
        }
    };

    // Update when tests finish (listen to tree data provider refresh)
    testTreeDataProvider.onDidChangeTreeData(() => {
        updateDecorations(vscode.window.activeTextEditor);
        coverageProvider.updateDecorations(vscode.window.activeTextEditor!);
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            updateDecorations(editor);
            coverageProvider.updateDecorations(editor);
        }
    }, null, context.subscriptions);

    // Initial update
    updateDecorations(vscode.window.activeTextEditor);

    // Auto-discover tests on file changes with debounce
    const watcher = vscode.workspace.createFileSystemWatcher('**/*test*.py');
    const debouncedUpdate = debounce((uri: vscode.Uri) => testTreeDataProvider.updateFile(uri), 500);

    watcher.onDidCreate((uri) => debouncedUpdate(uri));
    watcher.onDidChange((uri) => debouncedUpdate(uri));
    watcher.onDidDelete((uri) => testTreeDataProvider.removeFile(uri));

    context.subscriptions.push(watcher);
}

function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;
    return (...args: Parameters<T>) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
}

/**
 * Get the test at the current cursor position
 */
async function getTestAtCursor(workspaceRoot: string): Promise<TestNode | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
        vscode.window.showErrorMessage('No active Python file found.');
        return null;
    }

    const document = editor.document;
    const position = editor.selection.active;
    const text = document.getText();
    const lines = text.split('\n');

    // Calculate file dotted path
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    const fileDottedPath = relativePath.replace(/\.py$/, '').replace(/\//g, '.').replace(/\\/g, '.');

    const config = vscode.workspace.getConfiguration('djangoTestManager');
    const methodPrefix = config.get<string>('testMethodPattern') || 'test_';

    const classRegex = /^class\s+(\w+)/;
    const methodRegex = new RegExp(`^\\s+(?:async\\s+)?def\\s+(${methodPrefix}\\w+)`);

    let currentClassName: string | null = null;
    let currentClassLine = -1;
    let foundMethod: string | null = null;
    let foundMethodLine = -1;

    // Find the class and method containing the cursor
    for (let i = 0; i <= position.line; i++) {
        const line = lines[i];

        const classMatch = line.match(classRegex);
        if (classMatch) {
            // Check if this is a test class
            if (isTestClassFromLine(classMatch[1], line)) {
                currentClassName = classMatch[1];
                currentClassLine = i;
                foundMethod = null; // Reset method when entering a new class
                foundMethodLine = -1;
            } else {
                currentClassName = null;
                currentClassLine = -1;
            }
        }

        const methodMatch = line.match(methodRegex);
        if (methodMatch && currentClassName) {
            foundMethod = methodMatch[1];
            foundMethodLine = i;
        }
    }

    // Determine what to run based on cursor position
    if (foundMethod && currentClassName && foundMethodLine >= 0) {
        // Cursor is on or after a test method
        const methodDottedPath = `${fileDottedPath}.${currentClassName}.${foundMethod}`;
        return {
            name: foundMethod,
            type: 'method',
            dottedPath: methodDottedPath,
            uri: document.uri,
            range: new vscode.Range(foundMethodLine, 0, foundMethodLine, lines[foundMethodLine].length)
        };
    } else if (currentClassName && currentClassLine >= 0) {
        // Cursor is on or after a test class but before any method
        const classDottedPath = `${fileDottedPath}.${currentClassName}`;
        return {
            name: currentClassName,
            type: 'class',
            dottedPath: classDottedPath,
            uri: document.uri,
            range: new vscode.Range(currentClassLine, 0, currentClassLine, lines[currentClassLine].length)
        };
    }

    vscode.window.showErrorMessage('No test found at cursor position.');
    return null;
}

/**
 * Generate HTML for test history panel
 */
function generateTestHistoryHtml(
    summary: {
        totalSessions: number;
        totalTests: number;
        totalPassed: number;
        totalFailed: number;
        totalSkipped: number;
        avgSessionDuration: number;
        avgTestDuration: number;
    },
    slowestTests: Array<{ dottedPath: string; duration: number }>,
    mostFailing: Array<{ dottedPath: string; failureRate: number; totalRuns: number }>
): string {
    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${Math.round(ms)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    };

    const passRate = summary.totalTests > 0
        ? ((summary.totalPassed / summary.totalTests) * 100).toFixed(1)
        : '0';

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
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        h1 {
            margin: 0;
            font-size: 24px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }
        .stat-value {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .stat-label {
            font-size: 12px;
            opacity: 0.8;
        }
        .passed { color: var(--vscode-testing-iconPassed); }
        .failed { color: var(--vscode-testing-iconFailed); }
        .skipped { color: var(--vscode-testing-iconSkipped); }
        .section {
            margin-bottom: 30px;
        }
        h2 {
            font-size: 18px;
            margin-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            opacity: 0.7;
            font-weight: normal;
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--vscode-testing-iconPassed);
            border-radius: 4px;
        }
        .failure-bar {
            background: var(--vscode-testing-iconFailed);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Test History</h1>
        <span>${summary.totalSessions} sessions analyzed</span>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">${summary.totalTests}</div>
            <div class="stat-label">Total Tests Run</div>
        </div>
        <div class="stat-card">
            <div class="stat-value passed">${summary.totalPassed}</div>
            <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value failed">${summary.totalFailed}</div>
            <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value skipped">${summary.totalSkipped}</div>
            <div class="stat-label">Skipped</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${passRate}%</div>
            <div class="stat-label">Pass Rate</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${formatDuration(summary.avgTestDuration)}</div>
            <div class="stat-label">Avg Test Duration</div>
        </div>
    </div>

    <div class="section">
        <h2>🐌 Slowest Tests</h2>
        <table>
            <tr>
                <th>Test</th>
                <th>Avg Duration</th>
            </tr>
            ${slowestTests.map(test => `
                <tr>
                    <td><code>${test.dottedPath}</code></td>
                    <td>${formatDuration(test.duration)}</td>
                </tr>
            `).join('')}
            ${slowestTests.length === 0 ? '<tr><td colspan="2">No data yet</td></tr>' : ''}
        </table>
    </div>

    <div class="section">
        <h2>❌ Most Failing Tests</h2>
        <table>
            <tr>
                <th>Test</th>
                <th>Failure Rate</th>
                <th>Total Runs</th>
            </tr>
            ${mostFailing.map(test => `
                <tr>
                    <td><code>${test.dottedPath}</code></td>
                    <td>
                        <div class="progress-bar">
                            <div class="progress-fill failure-bar" style="width: ${(test.failureRate * 100).toFixed(0)}%"></div>
                        </div>
                        ${(test.failureRate * 100).toFixed(1)}%
                    </td>
                    <td>${test.totalRuns}</td>
                </tr>
            `).join('')}
            ${mostFailing.length === 0 ? '<tr><td colspan="3">No failures recorded</td></tr>' : ''}
        </table>
    </div>
</body>
</html>
    `;
}

export function deactivate() { }

