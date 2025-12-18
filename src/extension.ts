import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TestTreeDataProvider, TestItem } from './testTree';
import { TestRunner } from './testRunner';
import { DjangoTestCodeLensProvider } from './testCodeLensProvider';
import { TestNode, TestDiscovery } from './testDiscovery';
import { ConfigurationPanel } from './configurationPanel';
import { TestDecorationProvider } from './testDecorations';
import { TestStatusBar } from './testStatusBar';
import { TestStateManager } from './testStateManager';

/**
 * Reads and parses a .env file
 * @param envFilePath Path to the .env file
 * @returns Object with environment variables from the file
 */
async function readEnvFile(envFilePath: string): Promise<{ [key: string]: string }> {
    const envVars: { [key: string]: string } = {};
    
    try {
        if (!fs.existsSync(envFilePath)) {
            return envVars;
        }

        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(envFilePath));
        const lines = content.toString().split('\n');

        for (const line of lines) {
            // Remove leading/trailing whitespace
            const trimmed = line.trim();
            
            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Parse KEY=VALUE format
            const equalIndex = trimmed.indexOf('=');
            if (equalIndex === -1) {
                continue;
            }

            const key = trimmed.substring(0, equalIndex).trim();
            let value = trimmed.substring(equalIndex + 1).trim();

            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (key) {
                envVars[key] = value;
            }
        }
    } catch (error) {
        console.error(`Error reading .env file at ${envFilePath}:`, error);
    }

    return envVars;
}

/**
 * Merges environment variables from multiple sources in priority order:
 * 1. Process environment variables (lowest priority)
 * 2. .env file variables (middle priority)
 * 3. Configuration environmentVariables (highest priority)
 * @param workspaceRoot Root path of the workspace/project
 * @returns Merged environment variables object
 */
export async function getMergedEnvironmentVariables(workspaceRoot: string): Promise<{ [key: string]: string }> {
    const config = vscode.workspace.getConfiguration('djangoTestManager');
    const configEnv = config.get<{ [key: string]: string }>('environmentVariables') || {};
    const envFilePath = config.get<string>('envFilePath') || '.env';

    // Start with process environment variables (filter out undefined values)
    const mergedEnv: { [key: string]: string } = {};
    for (const key in process.env) {
        const value = process.env[key];
        if (value !== undefined) {
            mergedEnv[key] = value;
        }
    }

    // Load from .env file if path is specified
    if (envFilePath) {
        const fullEnvPath = resolvePath(envFilePath, workspaceRoot);
        const envFileVars = await readEnvFile(fullEnvPath);
        // Merge .env file variables (overrides process.env)
        Object.assign(mergedEnv, envFileVars);
    }

    // Merge configuration variables (overrides .env file and process.env)
    Object.assign(mergedEnv, configEnv);

    return mergedEnv;
}

/**
 * Resolves a path that may contain variable substitutions like ${workspaceFolder}
 * Supports:
 * - Variable substitution: ${workspaceFolder}/path/to/file
 * - Absolute paths: /absolute/path/to/file
 * - Relative paths: relative/path/to/file (resolved relative to workspaceRoot)
 * @param pathValue The path value from configuration
 * @param workspaceRoot The workspace root path
 * @returns Resolved absolute path
 */
export function resolvePath(pathValue: string, workspaceRoot: string, defaultPath?: string): string {
    if (!pathValue) {
        return defaultPath ? path.join(workspaceRoot, defaultPath) : workspaceRoot;
    }

    // Get workspace folder for variable substitution
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || vscode.workspace.rootPath || workspaceRoot;

    // Replace ${workspaceFolder} variable
    let resolvedPath = pathValue.replace(/\$\{workspaceFolder\}/g, workspaceFolder);

    // If it's already an absolute path, return it as-is
    if (path.isAbsolute(resolvedPath)) {
        return resolvedPath;
    }

    // Otherwise, resolve it relative to workspaceRoot
    return path.resolve(workspaceRoot, resolvedPath);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Django Test Manager is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || vscode.workspace.rootPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder opened. Django Test Manager cannot activate.');
        return;
    }
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

    const testRunner = new TestRunner(resolvedWorkspaceRoot, testTreeDataProvider);

    // Status Bar
    const statusBar = new TestStatusBar();
    context.subscriptions.push(statusBar);

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

            const managePyFull = managePyPath;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(managePyFull));
            } catch {
                vscode.window.showErrorMessage(`Cannot find manage.py at ${managePyFull}. Please check your configuration.`);
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

            // Update launch.json
            const launchConfig = vscode.workspace.getConfiguration('launch');
            const configurations = launchConfig.get<any[]>('configurations') || [];

            const index = configurations.findIndex(c => c.name === debugConfigName);
            if (index !== -1) {
                configurations[index] = debugConfig;
            } else {
                configurations.push(debugConfig);
            }

            await launchConfig.update('configurations', configurations, vscode.ConfigurationTarget.Workspace);

            // Start debugging using the named configuration
            await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], debugConfigName);
        }),
        vscode.debug.onDidTerminateDebugSession(async (session) => {
            if (session.name === 'Django Test Manager: Debug') {
                const launchConfig = vscode.workspace.getConfiguration('launch');
                const configurations = launchConfig.get<any[]>('configurations') || [];
                const newConfigs = configurations.filter(c => c.name !== 'Django Test Manager: Debug');

                if (newConfigs.length !== configurations.length) {
                    await launchConfig.update('configurations', newConfigs, vscode.ConfigurationTarget.Workspace);
                }

                if (newConfigs.length === 0) {
                    const vscodeDir = path.join(resolvedWorkspaceRoot, '.vscode');
                    const launchJsonPath = path.join(vscodeDir, 'launch.json');
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.file(launchJsonPath));
                    } catch (error) {
                        // Ignore error if file doesn't exist
                    }
                }
            }
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

            // Check if current file is a valid test file:
            // 1. File is in tests directory/package, OR
            // 2. File is named test.py or tests.py
            const currentFileRelativePath = vscode.workspace.asRelativePath(uri);
            const pathParts = currentFileRelativePath.split(path.sep);
            const isInTestsDirectory = pathParts.some(part => part === 'tests' || part === 'test');
            const isTestFile = fileName === 'test.py' || fileName === 'tests.py';
            
            // If it's already a test file, just run it
            if (isInTestsDirectory || isTestFile) {
                vscode.commands.executeCommand('django-test-manager.runCurrentFile');
                return;
            }

            const nameWithoutExt = fileName.replace('.py', '');
            const testNames = [`test_${nameWithoutExt}.py`, `${nameWithoutExt}_test.py`];

            // Search for test files in tests directory or named test.py/tests.py
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

    // Update on active editor change
    vscode.window.onDidChangeActiveTextEditor(updateDecorations, null, context.subscriptions);

    // Update when tests finish (listen to tree data provider refresh)
    testTreeDataProvider.onDidChangeTreeData(() => {
        updateDecorations(vscode.window.activeTextEditor);
    });

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

export function deactivate() { }
