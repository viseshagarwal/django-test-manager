import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import { TestNode } from "./testDiscovery";
import { TestTreeDataProvider } from "./testTree";
import { TestStateManager } from "./testStateManager";
import { DjangoTerminal } from "./djangoTerminal";
import { getMergedEnvironmentVariables, resolvePath } from "./extension";

export class TestRunner {
    private outputChannel: vscode.OutputChannel;

    private djangoTerminal: DjangoTerminal | undefined;
    private terminal: vscode.Terminal | undefined;
    private refreshTimeout: NodeJS.Timeout | undefined;
    private lastRefreshTime: number = 0;
    private readonly REFRESH_INTERVAL = 200;

    constructor(
        private workspaceRoot: string,
        private treeDataProvider: TestTreeDataProvider
    ) {
        this.outputChannel =
            vscode.window.createOutputChannel("Django Test Runner");
        vscode.window.onDidCloseTerminal((t) => {
            if (t === this.terminal) {
                this.terminal = undefined;
                this.djangoTerminal = undefined;
            }
        });
    }

    async run(node: TestNode): Promise<void> {
        const testPath = node.dottedPath;
        if (!testPath) {
            vscode.window.showErrorMessage("Could not determine test path");
            return;
        }

        // Reset status
        this.setNodeStatus(node, "pending");
        this.outputChannel.clear();
        this.outputChannel.show();

        const { cmd, args } = this.buildTestCommandParts(testPath);

        // Build display command string responsibly
        const fullCmd = `${cmd} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
        this.outputChannel.appendLine(`Running: ${fullCmd}`);

        const env = await getMergedEnvironmentVariables(this.workspaceRoot);

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Running tests for ${node.name}...`,
                cancellable: true,
            },
            (progress, token) => {
                return new Promise<void>((resolve) => {
                    const child = cp.spawn(
                        cmd,
                        args,
                        {
                            cwd: this.workspaceRoot,
                            env: env,
                            shell: false
                        }
                    );

                    let buffer = "";

                    child.stdout.on('data', (data) => {
                        const str = data.toString();
                        this.outputChannel.append(str);
                        if (buffer.length < 1024 * 1024) { // Cap memory buffer at 1MB
                            buffer += str;
                        }
                    });

                    child.stderr.on('data', (data) => {
                        const str = data.toString();
                        this.outputChannel.append(str);
                        if (buffer.length < 1024 * 1024) { // Cap memory buffer at 1MB
                            buffer += str;
                        }
                    });

                    child.on('error', (err) => {
                        this.outputChannel.appendLine(`\nError: ${err.message}`);
                    });

                    child.on('close', (code) => {
                        if (code !== 0) {
                            this.outputChannel.appendLine(
                                `\nProcess exited with code: ${code}`
                            );
                        }
                        this.parseResults(node, buffer);
                        resolve();
                    });

                    token.onCancellationRequested(() => {
                        child.kill();
                        resolve();
                    });
                });
            }
        );
    }

    private setNodeStatus(
        node: TestNode,
        status: "pending" | "passed" | "failed" | "skipped" | "unknown",
        recursive: boolean = true
    ) {
        this.updateStatusRecursive(node, status, recursive);
        this.triggerRefresh();
    }

    private updateStatusRecursive(
        node: TestNode,
        status: "pending" | "passed" | "failed" | "skipped" | "unknown",
        recursive: boolean
    ) {
        if (node.dottedPath) {
            TestStateManager.getInstance().setStatus(node.dottedPath, status);
        }
        if (recursive && node.children) {
            node.children.forEach((c) => this.updateStatusRecursive(c, status, true));
        }
    }

    private triggerRefresh() {
        const now = Date.now();
        if (now - this.lastRefreshTime > this.REFRESH_INTERVAL) {
            this.treeDataProvider.refresh();
            this.lastRefreshTime = now;
            if (this.refreshTimeout) {
                clearTimeout(this.refreshTimeout);
                this.refreshTimeout = undefined;
            }
        } else {
            if (!this.refreshTimeout) {
                this.refreshTimeout = setTimeout(() => {
                    this.treeDataProvider.refresh();
                    this.lastRefreshTime = Date.now();
                    this.refreshTimeout = undefined;
                }, this.REFRESH_INTERVAL);
            }
        }
    }

    private parsingBuffer: string = "";
    private parsingTestPath: string | null = null;
    private testStartTimes: Map<string, number> = new Map();

    async runInTerminal(node: TestNode): Promise<void> {
        const testPath = node.dottedPath;
        if (testPath === undefined || testPath === null) {
            vscode.window.showErrorMessage("Could not determine test path");
            return;
        }

        // Reset parsing state
        this.parsingBuffer = "";
        this.parsingTestPath = null;

        // Reset status
        const setPendingRecursive = (n: TestNode) => {
            if (n.dottedPath) {
                TestStateManager.getInstance().setStatus(n.dottedPath, "pending");
            }
            if (n.children) {
                n.children.forEach(setPendingRecursive);
            }
        };

        let effectiveNode = node;

        if (!node.dottedPath) {
            // Run All case: Set everything to pending
            const roots = await this.treeDataProvider.getChildren();
            roots.forEach((rootItem) => setPendingRecursive(rootItem.node));

            // Create effective node for watcher
            effectiveNode = {
                name: "All Tests",
                type: "folder",
                dottedPath: "",
                children: roots.map((r) => r.node),
            };
        } else {
            // Specific node case
            const realNode = await this.treeDataProvider.findNode(node.dottedPath);
            const nodeToUpdate = realNode || node;
            setPendingRecursive(nodeToUpdate);
            effectiveNode = nodeToUpdate;
        }

        this.treeDataProvider.refresh();

        const { cmd, args } = this.buildTestCommandParts(testPath);
        await this.executeCommandInTerminal(cmd, args, effectiveNode);
    }

    async runFailedTests(): Promise<void> {
        const failedTests = TestStateManager.getInstance().getFailedTests();
        if (failedTests.length === 0) {
            vscode.window.showInformationMessage("No failed tests to run.");
            return;
        }

        // Reset parsing state
        this.parsingBuffer = "";
        this.parsingTestPath = null;

        // Set status to pending for failed tests
        failedTests.forEach((path: string) => {
            TestStateManager.getInstance().setStatus(path, "pending");
        });
        this.treeDataProvider.refresh();

        const testPaths = failedTests.join(" ");
        const { cmd, args } = this.buildTestCommandParts(testPaths);

        // Create a dummy node for the watcher
        const effectiveNode: TestNode = {
            name: "Failed Tests",
            type: "folder",
            dottedPath: "", // Dummy
            children: [], // We don't have a tree structure for arbitrary list of failed tests easily
        };

        await this.executeCommandInTerminal(cmd, args, effectiveNode);
    }

    private buildTestCommandParts(testPaths: string): { cmd: string, args: string[] } {
        const config = vscode.workspace.getConfiguration("djangoTestManager");
        let pythonPath = config.get<string>("pythonPath") || "python3";
        const managePyPathConfig = config.get<string>("managePyPath") || "manage.py";
        const managePyPath = resolvePath(managePyPathConfig, this.workspaceRoot, 'manage.py');

        // Auto-detect venv
        if (pythonPath === "python3" || pythonPath === "python") {
            const venvPath = path.join(this.workspaceRoot, ".venv", "bin", "python");
            const venvPath2 = path.join(this.workspaceRoot, "venv", "bin", "python");
            const fs = require("fs");
            if (fs.existsSync(venvPath)) {
                pythonPath = venvPath;
            } else if (fs.existsSync(venvPath2)) {
                pythonPath = venvPath2;
            }
        }

        const activeProfile = config.get<string>("activeProfile") || "Default";
        const profiles =
            config.get<{ [key: string]: string[] }>("testProfiles") || {};
        // Get arguments from the new configuration page (string array)
        const configArgs = config.get<string[]>("testArguments") || [];

        // Combine profile args with config args (append config args to profile args)
        const profileArgs = profiles[activeProfile] || [];
        const extraArgs = config.get<string[]>("testArguments") || [];
        const rawTestArgs = [...profileArgs, ...extraArgs];

        const testArgs: string[] = [];
        for (let i = 0; i < rawTestArgs.length; i++) {
            const arg = rawTestArgs[i];
            if (arg === "--buffer" || arg === "-b") continue;
            testArgs.push(arg);
        }

        // Ensure verbose output is enabled for parsing
        if (!testArgs.includes("-v") && !testArgs.includes("--verbose")) {
            testArgs.push("-v", "2");
        }
        // Ensure --noinput is passed to avoid blocking on database creation prompts
        if (!testArgs.includes("--noinput") && !testArgs.includes("--no-input")) {
            testArgs.push("--noinput");
        }

        const commandTemplate =
            config.get<string>("testCommandTemplate") ||
            "${pythonPath} ${managePyPath} test ${testPath} ${testArguments}";

        // Tokenize by splitting on spaces
        const tokens = commandTemplate.split(' ');
        const finalArgs: string[] = [];

        tokens.forEach(token => {
            if (token === '${pythonPath}') {
                finalArgs.push(pythonPath);
            } else if (token === '${managePyPath}') {
                finalArgs.push(managePyPath);
            } else if (token === '${testPath}') {
                // If testPaths contains spaces (multiple tests), we might need to split it if it came from a join...
                // But generally testPaths is "path1 path2", so let's stick to simple split for now or pass as single arg if it is one path.
                // However, testPaths variable here is a space-joined string from failed tests or a single path.
                // Security-wise: this is data from *our* extension (dotted paths), not user input.
                // But better to treat it as a list properly.
                // For now, let's assume it space separated.
                if (testPaths.trim().length > 0) {
                    finalArgs.push(...testPaths.split(' '));
                }
            } else if (token === '${testArguments}') {
                finalArgs.push(...testArgs);
            } else if (token.trim().length > 0) {
                finalArgs.push(token);
            }
        });

        if (finalArgs.length === 0) {
            return { cmd: 'echo', args: ['Error: Empty command'] };
        }

        const cmd = finalArgs[0];
        const args = finalArgs.slice(1);

        return { cmd, args };
    }

    private parsingInterval: NodeJS.Timeout | undefined;
    private isParsing: boolean = false;
    private currentProcess: any = null; // Store reference to current process

    public cancel() {
        if (this.djangoTerminal) {
            this.djangoTerminal.sendSignal("SIGINT");
            // Send again to be sure if first one just interrupted a sub-process
            setTimeout(() => {
                if (this.isParsing && this.djangoTerminal) {
                    this.djangoTerminal.sendSignal("SIGINT");
                }
            }, 500);

            vscode.window.showInformationMessage("Cancelling tests...");

            // Reset any pending tests to 'skipped' so they show as not run
            const stateManager = TestStateManager.getInstance();
            const allKeys = stateManager.getAllKeys();
            allKeys.forEach((key) => {
                if (stateManager.getStatus(key) === "pending") {
                    stateManager.setStatus(key, "skipped");
                }
            });
            this.treeDataProvider.refresh();
            vscode.commands.executeCommand(
                "setContext",
                "djangoTestManager.isRunning",
                false
            );
        }
    }

    private async executeCommandInTerminal(cmd: string, args: string[], nodeToWatch: TestNode) {
        vscode.commands.executeCommand(
            "setContext",
            "djangoTestManager.isRunning",
            true
        );
        if (!this.djangoTerminal) {
            this.djangoTerminal = new DjangoTerminal();
        }

        if (!this.terminal) {
            this.terminal = vscode.window.createTerminal({
                name: "Django Test Terminal",
                pty: this.djangoTerminal,
            });
        }

        this.terminal.show();

        // Reset parsing state
        this.parsingBuffer = "";
        this.parsingTestPath = null;

        // Start parsing loop
        if (this.parsingInterval) {
            clearInterval(this.parsingInterval);
        }
        this.parsingInterval = setInterval(() => {
            this.processParsingBuffer(nodeToWatch);
        }, 200); // Process buffer every 200ms

        const env = await getMergedEnvironmentVariables(this.workspaceRoot);
        this.djangoTerminal.runCommand(
            cmd,
            args,
            this.workspaceRoot,
            env,
            (data: string) => {
                // Just accumulate data, don't parse immediately
                this.parsingBuffer += data;
            },
            (code) => {
                this.isParsing = false;
                if (this.parsingInterval) {
                    clearInterval(this.parsingInterval);
                }

                // Final parse to catch any remaining output
                this.processParsingBuffer(nodeToWatch); // Keep original logic for processing remaining buffer
                this.finalizeNodeStatus(nodeToWatch, code === 0);
                this.printTestDurationReport();
                this.treeDataProvider.refresh();
                vscode.commands.executeCommand(
                    "setContext",
                    "djangoTestManager.isRunning",
                    false
                );
            }
        );
    }

    private printTestDurationReport() {
        const durations = TestStateManager.getInstance().getDurations();
        if (durations.size === 0) {
            return;
        }

        const sorted = Array.from(durations.entries()).sort((a, b) => b[1] - a[1]);

        if (sorted.length > 0) {
            this.outputChannel.appendLine(
                "\n----------------------------------------------------------------------"
            );
            this.outputChannel.appendLine("Test Duration Report:");
            sorted.forEach(([testPath, duration]) => {
                const durationStr = (duration / 1000).toFixed(3) + "s";
                this.outputChannel.appendLine(
                    `${durationStr} (${duration}ms) ${testPath}`
                );
            });
            this.outputChannel.appendLine(
                "----------------------------------------------------------------------"
            );
        }
    }

    private processParsingBuffer(nodeToWatch: TestNode) {
        if (this.isParsing || this.parsingBuffer.length === 0) return;

        this.isParsing = true;
        try {
            // Find last newline to process only complete lines
            const lastNewlineIndex = this.parsingBuffer.lastIndexOf("\n");
            if (lastNewlineIndex !== -1) {
                const completeLines = this.parsingBuffer.substring(
                    0,
                    lastNewlineIndex + 1
                );
                this.parsingBuffer = this.parsingBuffer.substring(lastNewlineIndex + 1);
                this.parseResults(nodeToWatch, completeLines);
            }
        } catch (e) {
            console.error("Error parsing test output:", e);
        } finally {
            this.isParsing = false;
        }
    }

    private finalizeNodeStatus(node: TestNode, success: boolean) {
        // If we have children, recurse
        if (node.children && node.children.length > 0) {
            node.children.forEach((c) => this.finalizeNodeStatus(c, success));
        }

        // Check if we are in failfast mode
        const config = vscode.workspace.getConfiguration("djangoTestManager");
        const activeProfile = config.get<string>("activeProfile") || "Default";
        const profiles =
            config.get<{ [key: string]: string[] }>("testProfiles") || {};
        const args =
            profiles[activeProfile] || config.get<string[]>("testArguments") || [];
        const isFailFast = args.includes("--failfast");

        if (node.dottedPath) {
            const stateManager = TestStateManager.getInstance();
            const currentStatus = stateManager.getStatus(node.dottedPath);

            // Only update if still pending
            if (currentStatus === "pending") {
                if (success) {
                    // If process exited successfully, assume pending tests passed
                    // (unless they were skipped, but we should have caught that in parsing)
                    stateManager.setStatus(node.dottedPath, "passed");
                } else {
                    // Process failed (exit code != 0)
                    // This node was pending, meaning we didn't see a specific result for it.

                    if (isFailFast) {
                        // In failfast, subsequent tests are skipped
                        stateManager.setStatus(node.dottedPath, "skipped");
                    } else {
                        stateManager.setStatus(node.dottedPath, "unknown");
                    }
                }
            }
        }
    }

    private parseResults(node: TestNode, output: string) {
        // Strip ANSI codes
        const cleanOutput = output.replace(/\u001b\[\d+m/g, "");
        const lines = cleanOutput.split("\n");
        let shouldRefresh = false;

        lines.forEach((line) => {
            // Check for start of a test: test_method (path.to.test)
            // Relaxed regex: remove ^ anchor to handle potential prefix text
            const testStartMatch = line.match(/(\w+)\s+\(([\w\.]+)\)/);
            if (testStartMatch) {
                const methodName = testStartMatch[1];
                const pathInParens = testStartMatch[2];

                // Construct full dotted path: ensure it ends with method name
                if (
                    pathInParens.endsWith(`.${methodName}`) ||
                    pathInParens === methodName
                ) {
                    this.parsingTestPath = pathInParens;
                } else {
                    this.parsingTestPath = `${pathInParens}.${methodName}`;
                }
                this.testStartTimes.set(this.parsingTestPath, Date.now());
            }

            // Check for result on the same line or subsequent lines
            // Matches "... ok", "... skipped", "... FAIL", "... ERROR"
            const resultMatch = line.match(/\.\.\.\s+(ok|skipped|FAIL|ERROR)/);
            if (resultMatch && this.parsingTestPath) {
                const result = resultMatch[1];
                let status: "passed" | "failed" | "skipped" = "passed";

                if (result === "skipped") {
                    status = "skipped";
                    shouldRefresh = true;
                } else if (result === "FAIL" || result === "ERROR") {
                    status = "failed";
                    shouldRefresh = true;
                    // TODO: Capture actual error message from output
                    TestStateManager.getInstance().setFailureMessage(
                        this.parsingTestPath,
                        "Test Failed. Check terminal for details."
                    );
                }

                const startTime = this.testStartTimes.get(this.parsingTestPath);
                if (startTime) {
                    const duration = Date.now() - startTime;
                    TestStateManager.getInstance().setDuration(
                        this.parsingTestPath,
                        duration
                    );
                }

                TestStateManager.getInstance().setStatus(this.parsingTestPath, status);
                this.parsingTestPath = null; // Reset
                return;
            }

            // Failure Summary Block (Catch-all for detailed failures at the end)
            // ERROR: test_method (path.to.test)
            const summaryMatch = line.match(/(FAIL|ERROR):\s+(\w+)\s+\((.+)\)/);
            if (summaryMatch) {
                const methodName = summaryMatch[2];
                const pathInParens = summaryMatch[3];
                let fullPath = pathInParens;

                if (!fullPath.endsWith(`.${methodName}`) && fullPath !== methodName) {
                    fullPath = `${pathInParens}.${methodName}`;
                }

                TestStateManager.getInstance().setStatus(fullPath, "failed");
                shouldRefresh = true;
                return;
            }
        });

        // Update the root node status based on summary ONLY if it's a leaf node.
        // If it's a folder, let the children determine the status.
        if (!node.children || node.children.length === 0) {
            if (
                cleanOutput.includes("FAILED (failures=") ||
                cleanOutput.includes("FAILED (errors=")
            ) {
                if (node.dottedPath) {
                    TestStateManager.getInstance().setStatus(node.dottedPath, "failed");
                    shouldRefresh = true;
                }
            } else if (cleanOutput.includes("OK")) {
                if (node.dottedPath) {
                    TestStateManager.getInstance().setStatus(node.dottedPath, "passed");
                }
            }
        }

        if (shouldRefresh) {
            this.triggerRefresh();
        }
    }
}
