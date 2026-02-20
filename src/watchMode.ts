import * as vscode from 'vscode';
import * as path from 'path';
import { TestRunner } from './testRunner';
import { TestNode } from './testDiscovery';

/**
 * Watch Mode - Automatically runs tests when files change
 */
export class WatchModeManager {
    private watcher: vscode.FileSystemWatcher | undefined;
    private isEnabled = false;
    private debounceTimer: NodeJS.Timeout | undefined;
    private changedFiles = new Set<string>();
    private statusBarItem: vscode.StatusBarItem;
    private testRunner: TestRunner;
    private workspaceRoot: string;

    constructor(workspaceRoot: string, testRunner: TestRunner) {
        this.workspaceRoot = workspaceRoot;
        this.testRunner = testRunner;

        // Create status bar item for watch mode indicator
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        this.statusBarItem.command = 'django-test-manager.toggleWatchMode';
        this.updateStatusBar();
    }

    /**
     * Toggle watch mode on/off
     */
    public toggle(): void {
        if (this.isEnabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    /**
     * Enable watch mode
     */
    public enable(): void {
        if (this.isEnabled) return;

        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const watchPattern = config.get<string>('watchPattern') || '**/*.py';

        // Create file watcher
        this.watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, watchPattern)
        );

        // Watch for file changes
        this.watcher.onDidChange(this.onFileChange.bind(this));
        this.watcher.onDidCreate(this.onFileChange.bind(this));
        this.watcher.onDidDelete(this.onFileChange.bind(this));

        this.isEnabled = true;
        this.updateStatusBar();

        // Update configuration
        config.update('watchMode', true, vscode.ConfigurationTarget.Workspace);

        vscode.window.showInformationMessage(
            '👁️ Watch Mode enabled. Tests will run automatically on file changes.'
        );

        // Set context for conditional UI
        vscode.commands.executeCommand('setContext', 'djangoTestManager.watchMode', true);
    }

    /**
     * Disable watch mode
     */
    public disable(): void {
        if (!this.isEnabled) return;

        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }

        this.changedFiles.clear();
        this.isEnabled = false;
        this.updateStatusBar();

        // Update configuration
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        config.update('watchMode', false, vscode.ConfigurationTarget.Workspace);

        vscode.window.showInformationMessage('Watch Mode disabled.');

        // Set context for conditional UI
        vscode.commands.executeCommand('setContext', 'djangoTestManager.watchMode', false);
    }

    /**
     * Handle file change events
     */
    private onFileChange(uri: vscode.Uri): void {
        // Skip if file is in excluded directories
        const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
        if (this.isExcluded(relativePath)) {
            return;
        }

        // Add to changed files set
        this.changedFiles.add(uri.fsPath);

        // Debounce test runs
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const debounceMs = config.get<number>('watchDebounceMs') || 1000;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.runTestsForChangedFiles();
        }, debounceMs);
    }

    /**
     * Check if file path should be excluded
     */
    private isExcluded(relativePath: string): boolean {
        const excludePatterns = [
            '__pycache__',
            '.venv',
            'venv',
            '.git',
            'migrations',
            '.pyc',
            '__init__.py',
        ];

        return excludePatterns.some(pattern => relativePath.includes(pattern));
    }

    /**
     * Run tests for changed files
     */
    private async runTestsForChangedFiles(): Promise<void> {
        if (this.changedFiles.size === 0) return;

        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const runAffectedOnly = config.get<boolean>('watchRunAffectedOnly') ?? true;
        const changedFilesList = Array.from(this.changedFiles);
        this.changedFiles.clear();

        // Show which files changed
        const fileNames = changedFilesList.map(f => path.basename(f)).join(', ');
        vscode.window.setStatusBarMessage(`🔄 Running tests for: ${fileNames}`, 3000);

        if (runAffectedOnly) {
            // Run only affected tests
            await this.runAffectedTests(changedFilesList);
        } else {
            // Run all tests
            const rootNode: TestNode = {
                name: 'All Tests',
                type: 'folder',
                dottedPath: ''
            };
            await this.testRunner.runInTerminal(rootNode);
        }

        // Show notification when done
        const showNotifications = config.get<boolean>('showNotifications') ?? true;
        if (showNotifications) {
            const stateManager = await import('./testStateManager').then(m => m.TestStateManager.getInstance());
            const counts = stateManager.getCounts();

            if (counts.failed > 0) {
                vscode.window.showErrorMessage(
                    `❌ Tests failed: ${counts.failed} failed, ${counts.passed} passed`
                );
            } else if (counts.passed > 0) {
                vscode.window.showInformationMessage(
                    `✅ All tests passed: ${counts.passed} passed`
                );
            }
        }
    }

    /**
     * Run tests affected by the changed files
     */
    private async runAffectedTests(changedFiles: string[]): Promise<void> {
        for (const filePath of changedFiles) {
            const fileName = path.basename(filePath);
            const fileNameNoExt = fileName.replace('.py', '');

            // If it's a test file, run it directly
            if (fileName.startsWith('test_') || fileName.includes('_test') || fileName === 'tests.py') {
                const relativePath = path.relative(this.workspaceRoot, filePath);
                const dottedPath = relativePath.replace(/\.py$/, '').replace(/\//g, '.').replace(/\\/g, '.');

                const node: TestNode = {
                    name: fileName,
                    type: 'file',
                    dottedPath: dottedPath,
                    uri: vscode.Uri.file(filePath)
                };

                await this.testRunner.runInTerminal(node);
            } else {
                // Try to find related test file
                const testFileNames = [
                    `test_${fileNameNoExt}.py`,
                    `${fileNameNoExt}_test.py`,
                    'tests.py'
                ];

                const dirPath = path.dirname(filePath);
                const testFiles = await vscode.workspace.findFiles(
                    `**/{${testFileNames.join(',')}}`,
                    '**/{node_modules,venv,.venv,env,.env,__pycache__,.git,.tox,dist,build}/**',
                    10
                );

                if (testFiles.length > 0) {
                    // Sort by proximity to changed file
                    testFiles.sort((a, b) => {
                        const relA = path.relative(dirPath, a.fsPath);
                        const relB = path.relative(dirPath, b.fsPath);
                        return relA.length - relB.length;
                    });

                    const testFile = testFiles[0];
                    const relativePath = path.relative(this.workspaceRoot, testFile.fsPath);
                    const dottedPath = relativePath.replace(/\.py$/, '').replace(/\//g, '.').replace(/\\/g, '.');

                    const node: TestNode = {
                        name: path.basename(testFile.fsPath),
                        type: 'file',
                        dottedPath: dottedPath,
                        uri: testFile
                    };

                    await this.testRunner.runInTerminal(node);
                }
            }
        }
    }

    /**
     * Update status bar item
     */
    private updateStatusBar(): void {
        if (this.isEnabled) {
            this.statusBarItem.text = '$(eye) Watch Mode';
            this.statusBarItem.tooltip = 'Watch Mode is ON. Click to disable.';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.text = '$(eye-closed) Watch Mode';
            this.statusBarItem.tooltip = 'Watch Mode is OFF. Click to enable.';
            this.statusBarItem.backgroundColor = undefined;
        }
        this.statusBarItem.show();
    }

    /**
     * Check if watch mode is currently enabled
     */
    public isWatchModeEnabled(): boolean {
        return this.isEnabled;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        if (this.watcher) {
            this.watcher.dispose();
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.statusBarItem.dispose();
    }
}
