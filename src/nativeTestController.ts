import * as vscode from 'vscode';
import * as path from 'path';
import { TestDiscovery, TestNode } from './testDiscovery';
import { TestStateManager } from './testStateManager';
import { TestHistoryManager } from './testHistory';

/**
 * VS Code Native Test API Integration
 * This integrates Django tests with VS Code's built-in test explorer
 */
export class NativeTestController {
    private controller: vscode.TestController;
    private testItems = new Map<string, vscode.TestItem>();
    private runProfiles: vscode.TestRunProfile[] = [];

    constructor(
        private workspaceRoot: string,
        private testDiscovery: TestDiscovery
    ) {
        // Create the test controller
        this.controller = vscode.tests.createTestController(
            'djangoTestController',
            'Django Tests'
        );

        // Create run profiles
        this.runProfiles.push(
            this.controller.createRunProfile(
                'Run',
                vscode.TestRunProfileKind.Run,
                this.runHandler.bind(this),
                true // isDefault
            )
        );

        this.runProfiles.push(
            this.controller.createRunProfile(
                'Debug',
                vscode.TestRunProfileKind.Debug,
                this.debugHandler.bind(this),
                false
            )
        );

        // Set up test resolution
        this.controller.resolveHandler = async (item) => {
            if (!item) {
                // Resolve root - discover all tests
                await this.discoverAllTests();
            } else {
                // Resolve specific item - could load children on demand
                await this.resolveTestItem(item);
            }
        };

        // Refresh button
        this.controller.refreshHandler = async (_token) => {
            await this.discoverAllTests();
        };
    }

    /**
     * Discover all tests and populate the test controller
     */
    public async discoverAllTests(): Promise<void> {
        const nodes = await this.testDiscovery.discover();

        // Clear existing items
        this.testItems.clear();
        this.controller.items.replace([]);

        // Add new items
        for (const node of nodes) {
            const item = this.createTestItem(node);
            this.controller.items.add(item);
        }
    }

    /**
     * Create a VS Code TestItem from a TestNode
     */
    private createTestItem(node: TestNode, _parent?: vscode.TestItem): vscode.TestItem {
        const id = node.dottedPath || node.name;
        const uri = node.uri;

        const item = this.controller.createTestItem(id, node.name, uri);

        // Set range for navigation
        if (node.range) {
            item.range = node.range;
        }

        // Set tags based on type
        item.tags = [new vscode.TestTag(node.type)];

        // Add description
        if (node.type === 'file') {
            item.description = node.dottedPath;
        }

        // Set can resolve children flag
        if (node.children && node.children.length > 0) {
            item.canResolveChildren = true;

            // Add children
            for (const child of node.children) {
                const childItem = this.createTestItem(child, item);
                item.children.add(childItem);
            }
        }

        // Store reference
        this.testItems.set(id, item);

        return item;
    }

    /**
     * Resolve children of a test item
     */
    private async resolveTestItem(_item: vscode.TestItem): Promise<void> {
        // Children are already resolved during creation
        // This could be used for lazy loading in the future
    }

    /**
     * Run handler for test execution
     */
    private async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        const stateManager = TestStateManager.getInstance();

        // Get tests to run
        const testsToRun = request.include || this.getAllTestItems();

        // Start history session
        let historyManager: TestHistoryManager | undefined;
        try {
            historyManager = TestHistoryManager.getInstance();
            historyManager.startSession();
        } catch {
            // History manager might not be initialized
        }

        try {
            for (const testItem of testsToRun) {
                if (token.isCancellationRequested) {
                    run.skipped(testItem);
                    continue;
                }

                await this.runSingleTest(run, testItem, stateManager, historyManager, token);
            }
        } finally {
            historyManager?.endSession();
            run.end();
        }
    }

    /**
     * Debug handler for test debugging
     */
    private async debugHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const testsToRun = request.include || this.getAllTestItems();

        for (const testItem of testsToRun) {
            if (token.isCancellationRequested) {
                break;
            }

            // Use the existing debug command
            const node: TestNode = {
                name: testItem.label,
                type: this.getNodeType(testItem),
                dottedPath: testItem.id,
                uri: testItem.uri
            };

            await vscode.commands.executeCommand('django-test-manager.debugTest', node);
        }
    }

    /**
     * Run a single test item
     */
    private async runSingleTest(
        run: vscode.TestRun,
        testItem: vscode.TestItem,
        stateManager: TestStateManager,
        historyManager: TestHistoryManager | undefined,
        token: vscode.CancellationToken
    ): Promise<void> {
        const startTime = Date.now();
        run.started(testItem);

        try {
            // Build and execute test command
            const result = await this.executeTest(testItem, token);
            const duration = Date.now() - startTime;

            if (result.status === 'passed') {
                run.passed(testItem, duration);
                stateManager.setStatus(testItem.id, 'passed');
                stateManager.setDuration(testItem.id, duration);
                historyManager?.recordTest(testItem.id, testItem.label, 'passed', duration);
            } else if (result.status === 'failed') {
                const message = new vscode.TestMessage(result.message || 'Test failed');
                if (testItem.uri && testItem.range) {
                    message.location = new vscode.Location(testItem.uri, testItem.range);
                }
                run.failed(testItem, message, duration);
                stateManager.setStatus(testItem.id, 'failed');
                stateManager.setFailureMessage(testItem.id, result.message || 'Test failed');
                stateManager.setDuration(testItem.id, duration);
                historyManager?.recordTest(testItem.id, testItem.label, 'failed', duration, result.message);
            } else if (result.status === 'skipped') {
                run.skipped(testItem);
                stateManager.setStatus(testItem.id, 'skipped');
                historyManager?.recordTest(testItem.id, testItem.label, 'skipped', duration);
            }

            // Handle children results
            if (result.childResults) {
                for (const [childId, childResult] of Object.entries(result.childResults)) {
                    const childItem = this.testItems.get(childId);
                    if (childItem) {
                        const childDuration = childResult.duration || 0;
                        if (childResult.status === 'passed') {
                            run.passed(childItem, childDuration);
                        } else if (childResult.status === 'failed') {
                            run.failed(childItem, new vscode.TestMessage(childResult.message || 'Failed'), childDuration);
                        } else if (childResult.status === 'skipped') {
                            run.skipped(childItem);
                        }
                    }
                }
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            run.errored(testItem, new vscode.TestMessage(errorMessage), duration);
            stateManager.setStatus(testItem.id, 'failed');
            historyManager?.recordTest(testItem.id, testItem.label, 'error', duration, errorMessage);
        }
    }

    /**
     * Execute a test and return the result
     */
    private async executeTest(
        testItem: vscode.TestItem,
        token: vscode.CancellationToken
    ): Promise<{
        status: 'passed' | 'failed' | 'skipped' | 'error';
        message?: string;
        duration?: number;
        childResults?: { [id: string]: { status: string; message?: string; duration?: number } };
    }> {
        return new Promise((resolve) => {
            const config = vscode.workspace.getConfiguration('djangoTestManager');

            // Build command
            let pythonPath = config.get<string>('pythonPath') || 'python3';
            const managePyPath = config.get<string>('managePyPath') || 'manage.py';
            const activeProfile = config.get<string>('activeProfile') || 'Default';
            const profiles = config.get<{ [key: string]: string[] }>('testProfiles') || {};
            const profileArgs = profiles[activeProfile] || [];
            const configEnv = config.get<{ [key: string]: string }>('environmentVariables') || {};

            // Auto-detect venv
            const fs = require('fs');
            const venvPath = path.join(this.workspaceRoot, '.venv', 'bin', 'python');
            const venvPath2 = path.join(this.workspaceRoot, 'venv', 'bin', 'python');
            if (fs.existsSync(venvPath)) pythonPath = venvPath;
            else if (fs.existsSync(venvPath2)) pythonPath = venvPath2;

            const args = [
                managePyPath,
                'test',
                testItem.id,
                '-v', '2', // Verbose output for parsing
                ...profileArgs.filter(a => a !== '--parallel') // Remove parallel for accurate results
            ];

            const cp = require('child_process');
            let stdout = '';
            let stderr = '';
            const childResults: { [id: string]: { status: string; message?: string; duration?: number } } = {};

            const child = cp.spawn(pythonPath, args, {
                cwd: this.workspaceRoot,
                env: { ...process.env, ...configEnv }
            });

            child.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            token.onCancellationRequested(() => {
                child.kill();
                resolve({ status: 'skipped', message: 'Test cancelled' });
            });

            child.on('close', (code: number) => {
                // Parse output for individual test results
                const output = stdout + stderr;

                // Parse test results from Django output
                const testResultRegex = /(\w+)\s+\(([\w.]+)\)\s+\.\.\.\s+(ok|skipped|FAIL|ERROR)/g;
                let match;

                while ((match = testResultRegex.exec(output)) !== null) {
                    const methodName = match[1];
                    const testPath = match[2];
                    const result = match[3];

                    const fullPath = testPath.endsWith(`.${methodName}`) ? testPath : `${testPath}.${methodName}`;

                    childResults[fullPath] = {
                        status: result === 'ok' ? 'passed' : result === 'skipped' ? 'skipped' : 'failed',
                        message: result === 'FAIL' || result === 'ERROR' ? `Test ${result}` : undefined
                    };
                }

                // Determine overall status
                if (code === 0) {
                    resolve({ status: 'passed', childResults });
                } else {
                    // Extract error message
                    const errorMatch = output.match(/FAILED \(.*\)/);
                    const message = errorMatch ? errorMatch[0] : 'Test failed';
                    resolve({ status: 'failed', message, childResults });
                }
            });

            child.on('error', (err: Error) => {
                resolve({ status: 'error', message: err.message });
            });
        });
    }

    /**
     * Get all test items that are runnable (methods)
     */
    private getAllTestItems(): vscode.TestItem[] {
        const items: vscode.TestItem[] = [];

        const collectItems = (collection: vscode.TestItemCollection) => {
            collection.forEach(item => {
                // Include items with no children (leaf nodes = actual tests)
                if (item.children.size === 0) {
                    items.push(item);
                } else {
                    collectItems(item.children);
                }
            });
        };

        collectItems(this.controller.items);
        return items;
    }

    /**
     * Get node type from test item
     */
    private getNodeType(item: vscode.TestItem): 'app' | 'folder' | 'file' | 'class' | 'method' {
        const tags = item.tags;
        for (const tag of tags) {
            if (['app', 'folder', 'file', 'class', 'method'].includes(tag.id)) {
                return tag.id as 'app' | 'folder' | 'file' | 'class' | 'method';
            }
        }
        return item.children.size > 0 ? 'class' : 'method';
    }

    /**
     * Update a single test item's state
     */
    public updateTestItemState(dottedPath: string, status: 'passed' | 'failed' | 'skipped'): void {
        const item = this.testItems.get(dottedPath);
        if (item) {
            // Create a test run to update state
            const run = this.controller.createTestRun(
                new vscode.TestRunRequest([item]),
                `State update: ${dottedPath}`,
                false
            );

            switch (status) {
                case 'passed':
                    run.passed(item);
                    break;
                case 'failed':
                    run.failed(item, new vscode.TestMessage('Test failed'));
                    break;
                case 'skipped':
                    run.skipped(item);
                    break;
            }

            run.end();
        }
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.controller.dispose();
        this.runProfiles.forEach(p => p.dispose());
    }
}

/**
 * Create and return a native test controller instance
 */
export function createNativeTestController(
    workspaceRoot: string,
    testDiscovery: TestDiscovery
): NativeTestController {
    return new NativeTestController(workspaceRoot, testDiscovery);
}
