import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { TestNode } from "./testDiscovery";
import { TestTreeDataProvider } from "./testTree";
import { TestStateManager } from "./testStateManager";
import { DjangoTerminal } from "./djangoTerminal";
import { CoverageProvider } from "./coverageProvider";
import { TestHistoryManager } from "./testHistory";
import { getMergedEnvironmentVariables, resolvePath } from "./testUtils";

export class TestRunner {
    private outputChannel: vscode.OutputChannel;

    private djangoTerminal: DjangoTerminal | undefined;
    private terminal: vscode.Terminal | undefined;
    private refreshTimeout: NodeJS.Timeout | undefined;
    private lastRefreshTime: number = 0;
    private readonly REFRESH_INTERVAL = 200;
    private dtmOutputFile: string | undefined;

    constructor(
        private workspaceRoot: string,
        private treeDataProvider: TestTreeDataProvider,
        private coverageProvider?: CoverageProvider,
        private extensionPath?: string
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

        // Clear previous test state to ensure accurate counts for this run
        TestStateManager.getInstance().clear();

        // Reset status
        this.setNodeStatus(node, "pending");
        this.outputChannel.clear();
        this.outputChannel.show();

        const { cmd, args } = this.buildTestCommandParts(testPath);

        // Build display command string responsibly
        const fullCmd = `${cmd} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
        this.outputChannel.appendLine(`Running: ${fullCmd}`);

        const env = await getMergedEnvironmentVariables(this.workspaceRoot);

        // Configure N+1 env vars (PYTHONPATH + DTM_OUTPUT_FILE) for the run() path too
        this.applyNPlusOneEnv(env);

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
                        // Load N+1 results from the JSON file (works in all modes)
                        this.loadNPlusOneResultsFromFile();
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
        status: "pending" | "running" | "passed" | "failed" | "skipped" | "aborted" | "unknown",
        recursive: boolean = true
    ) {
        this.updateStatusRecursive(node, status, recursive);
        this.triggerRefresh();
    }

    private updateStatusRecursive(
        node: TestNode,
        status: "pending" | "running" | "passed" | "failed" | "skipped" | "aborted" | "unknown",
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
    private parsingFailureForPath: string | null = null;
    private failureBlock: string[] = [];
    private testStartTimes: Map<string, number> = new Map();

    async runInTerminal(node: TestNode): Promise<void> {
        const testPath = node.dottedPath;
        if (testPath === undefined || testPath === null) {
            vscode.window.showErrorMessage("Could not determine test path");
            return;
        }

        // Clear previous test state to ensure accurate counts for this run
        TestStateManager.getInstance().clear();

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

        const enableCoverage = config.get<boolean>("enableCoverage") || false;
        const coverageCommand = config.get<string>("coverageCommand") || "coverage";

        let finalPythonParts: string[] = [pythonPath];
        if (enableCoverage) {
            if (coverageCommand === 'coverage' && pythonPath.includes('bin/python')) {
                finalPythonParts = [pythonPath, "-m", "coverage", "run", "--source=."];
            } else {
                finalPythonParts = [...coverageCommand.split(' '), "run", "--source=."];
            }
        }

        const activeProfile = config.get<string>("activeProfile") || "Default";
        const profiles =
            config.get<{ [key: string]: string[] }>("testProfiles") || {};

        // Combine profile args with config args (append config args to profile args)
        const profileArgs = profiles[activeProfile] || [];
        const testArguments = config.get<string[]>("testArguments") || [];
        const rawTestArgs = [...profileArgs, ...testArguments];

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

        // Inject custom test runner for N+1 query detection
        const detectNPlusOne = config.get<boolean>("detectNPlusOne") || false;
        if (detectNPlusOne && !testArgs.includes("--testrunner")) {
            testArgs.push("--testrunner", "dtm_query_counter.DTMQueryCountingRunner");
            this.outputChannel.appendLine(`[N+1] Injected --testrunner dtm_query_counter.DTMQueryCountingRunner`);
        } else if (!detectNPlusOne) {
            this.outputChannel.appendLine(`[N+1] detectNPlusOne setting is OFF — skipping query detection.`);
        }

        const commandTemplate =
            config.get<string>("testCommandTemplate") ||
            "${pythonPath} ${managePyPath} test ${testPath} ${testArguments}";

        // Tokenize by splitting on spaces
        const tokens = commandTemplate.split(' ');
        const finalArgs: string[] = [];

        tokens.forEach(token => {
            if (token === '${pythonPath}') {
                if (enableCoverage) {
                    finalArgs.push(...finalPythonParts);
                } else {
                    finalArgs.push(pythonPath);
                }
            } else if (token === '${managePyPath}') {
                finalArgs.push(managePyPath);
            } else if (token === '${testPath}') {
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

            // Mark any pending or running tests as 'aborted' so they show as cancelled
            const stateManager = TestStateManager.getInstance();
            const allKeys = stateManager.getAllKeys();
            allKeys.forEach((key) => {
                const status = stateManager.getStatus(key);
                if (status === "pending" || status === "running") {
                    stateManager.setStatus(key, "aborted");
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

        // Start a new test history session
        const historyManager = TestHistoryManager.getInstance();
        historyManager.startSession();

        // Start parsing loop
        if (this.parsingInterval) {
            clearInterval(this.parsingInterval);
        }
        this.parsingInterval = setInterval(() => {
            this.processParsingBuffer(nodeToWatch);
        }, 200); // Process buffer every 200ms

        const env = await getMergedEnvironmentVariables(this.workspaceRoot);
        this.applyNPlusOneEnv(env);

        const config = vscode.workspace.getConfiguration("djangoTestManager");
        const detectNPlusOne = config.get<boolean>("detectNPlusOne") || false;
        if (detectNPlusOne) {
            this.djangoTerminal.write('\r\n\x1b[36m[Django Test Manager] 🔍 N+1 Query Detection is ENABLED.\r\n');
            this.djangoTerminal.write(`PYTHONPATH includes: ${env['PYTHONPATH'] || '(not set)'}\r\n`);
            this.djangoTerminal.write(`DTM_OUTPUT_FILE: ${env['DTM_OUTPUT_FILE'] || '(not set)'}\r\n`);
            this.djangoTerminal.write('Results will appear in the test tree and the N+1 panel after the run.\x1b[0m\r\n\r\n');
        } else {
            this.djangoTerminal.write('\r\n\x1b[33m[Django Test Manager] N+1 detection is OFF. Enable it in Settings > djangoTestManager.detectNPlusOne\x1b[0m\r\n');
        }

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

                // Load N+1 results from the JSON file (primary data channel, works with parallel)
                this.loadNPlusOneResultsFromFile();
                this.printNPlusOneSummary();

                // End the test history session
                const historyManager = TestHistoryManager.getInstance();
                historyManager.endSession();

                // Handle Coverage
                const config = vscode.workspace.getConfiguration("djangoTestManager");
                const enableCoverage = config.get<boolean>("enableCoverage") || false;
                if (enableCoverage && this.coverageProvider) {
                    this.generateCoverageReport();
                }

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

            // If the test is still running when the process exits, it means we missed the result
            // (e.g. parsing error) or the process crashed.
            if (currentStatus === "running") {
                if (success) {
                    stateManager.setStatus(node.dottedPath, "passed");
                } else {
                    stateManager.setStatus(node.dottedPath, "failed");
                    if (!stateManager.getFailureMessage(node.dottedPath)) {
                        stateManager.setFailureMessage(
                            node.dottedPath,
                            "Test run terminated unexpectedly while this test was running."
                        );
                    }
                }
            }

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

    // Pre-compiled regex patterns for parsing
    // eslint-disable-next-line no-control-regex
    private static readonly ANSI_CODE_REGEX = /\u001b\[\d+m/g;
    private static readonly TEST_START_REGEX = /(\w+)\s+\(([\w.]+)\)/;
    private static readonly RESULT_REGEX = /\.\.\.\s+(ok|skipped|FAIL|ERROR)(?:\s+\(([\d.]+)s\))?/;
    private static readonly SUMMARY_REGEX = /(FAIL|ERROR):\s+(\w+)\s+\((.+?)\)/;
    private static readonly SEPARATOR_LINE = '----------------------------------------------------------------------';

    // N+1 query detection markers
    private static readonly DTM_QUERIES_REGEX = /\[DTM:QUERIES\]\s+([\w.]+):\s+(\d+)/;
    private static readonly DTM_NPLUSONE_REGEX = /\[DTM:NPLUSONE\]\s+([\w.]+)\s+\|\s+(\d+)\s+\|\s+(.+)/;

    private parseResults(node: TestNode, output: string) {
        // Strip ANSI codes
        const cleanOutput = output.replace(TestRunner.ANSI_CODE_REGEX, "");
        const lines = cleanOutput.split("\n");
        let shouldRefresh = false;

        // Cache state manager instance for this batch
        const stateManager = TestStateManager.getInstance();
        const lineCount = lines.length;

        for (let i = 0; i < lineCount; i++) {
            const line = lines[i];

            // Skip empty lines quickly
            if (line.length === 0) continue;

            // ── N+1 query detection markers ──────────────────────
            const queryMatch = TestRunner.DTM_QUERIES_REGEX.exec(line);
            if (queryMatch) {
                const testPath = queryMatch[1];
                const queryCount = parseInt(queryMatch[2], 10);
                stateManager.setQueryCount(testPath, queryCount);
                continue;
            }

            const nplusoneMatch = TestRunner.DTM_NPLUSONE_REGEX.exec(line);
            if (nplusoneMatch) {
                const testPath = nplusoneMatch[1];
                const count = parseInt(nplusoneMatch[2], 10);
                const sql = nplusoneMatch[3].trim();
                stateManager.addNPlusOneWarning(testPath, { count, sql });
                continue;
            }

            // Check for start of a test: test_method (path.to.test)
            const testStartMatch = TestRunner.TEST_START_REGEX.exec(line);
            if (testStartMatch) {
                const methodName = testStartMatch[1];
                const pathInParens = testStartMatch[2];

                // Construct full dotted path: ensure it ends with method name
                if (pathInParens.endsWith(`.${methodName}`) || pathInParens === methodName) {
                    this.parsingTestPath = pathInParens;
                } else {
                    this.parsingTestPath = `${pathInParens}.${methodName}`;
                }

                // Set status to 'running' for live feedback
                stateManager.setStatus(this.parsingTestPath, 'running');
                this.testStartTimes.set(this.parsingTestPath, Date.now());
                shouldRefresh = true;
            }

            // Check for result on the same line or subsequent lines
            if (this.parsingTestPath) {
                const resultMatch = TestRunner.RESULT_REGEX.exec(line);
                if (resultMatch) {
                    const result = resultMatch[1];
                    let status: "passed" | "failed" | "skipped" = "passed";
                    let errorMessage: string | undefined;

                    if (result === "skipped") {
                        status = "skipped";
                        shouldRefresh = true;
                    } else if (result === "FAIL" || result === "ERROR") {
                        status = "failed";
                        shouldRefresh = true;
                        errorMessage = "Test Failed. Check terminal for details.";
                        stateManager.setFailureMessage(
                            this.parsingTestPath,
                            errorMessage
                        );
                    }

                    let duration = 0;
                    if (resultMatch[2]) {
                        // Use reported duration from Django runner
                        const durationSec = parseFloat(resultMatch[2]);
                        duration = durationSec * 1000;
                        stateManager.setDuration(this.parsingTestPath, duration);
                    } else {
                        // Fallback to calculated duration
                        const startTime = this.testStartTimes.get(this.parsingTestPath);
                        if (startTime) {
                            duration = Date.now() - startTime;
                            stateManager.setDuration(this.parsingTestPath, duration);
                        }
                    }

                    stateManager.setStatus(this.parsingTestPath, status);

                    // Record to test history
                    const historyManager = TestHistoryManager.getInstance();
                    const testName = this.parsingTestPath.split('.').pop() || this.parsingTestPath;
                    historyManager.recordTest(
                        this.parsingTestPath,
                        testName,
                        status === "failed" ? "failed" : status,
                        duration,
                        errorMessage
                    );

                    this.parsingTestPath = null;
                    continue;
                }
            }

            // Failure Summary Block (Catch-all for detailed failures at the end)
            const summaryMatch = TestRunner.SUMMARY_REGEX.exec(line);
            if (summaryMatch) {
                const methodName = summaryMatch[2];
                const pathInParens = summaryMatch[3];
                let fullPath = pathInParens;

                if (!fullPath.endsWith(`.${methodName}`) && fullPath !== methodName) {
                    fullPath = `${pathInParens}.${methodName}`;
                }

                stateManager.setStatus(fullPath, "failed");
                this.parsingFailureForPath = fullPath;
                this.failureBlock = [];
                shouldRefresh = true;
                continue;
            }

            if (this.parsingFailureForPath) {
                if (line.startsWith(TestRunner.SEPARATOR_LINE)) {
                    this.processFailureBlock(this.parsingFailureForPath, this.failureBlock);
                    this.parsingFailureForPath = null;
                    this.failureBlock = [];
                } else {
                    this.failureBlock.push(line);
                }
            }
        }

        // Update the root node status based on summary ONLY if it's a leaf node.
        if (!node.children || node.children.length === 0) {
            if (cleanOutput.includes("FAILED (failures=") || cleanOutput.includes("FAILED (errors=")) {
                if (node.dottedPath) {
                    stateManager.setStatus(node.dottedPath, "failed");
                    shouldRefresh = true;
                }
            } else if (cleanOutput.includes("OK")) {
                if (node.dottedPath) {
                    stateManager.setStatus(node.dottedPath, "passed");
                }
            }
        }

        if (shouldRefresh) {
            this.triggerRefresh();
        }
    }

    private processFailureBlock(testPath: string, lines: string[]) {
        // Simple heuristic to extract diff
        // Look for lines starting with - and +
        let expected = "";
        let actual = "";
        let hasDiff = false;

        lines.forEach(line => {
            if (line.startsWith("- ")) {
                expected += line.substring(2) + "\n";
                hasDiff = true;
            } else if (line.startsWith("+ ")) {
                actual += line.substring(2) + "\n";
                hasDiff = true;
            }
        });

        if (hasDiff) {
            TestStateManager.getInstance().setDiff(testPath, expected, actual);
        }

        // Store the full failure message/traceback
        const fullMessage = lines.join('\n').trim();
        if (fullMessage) {
            TestStateManager.getInstance().setFailureMessage(testPath, fullMessage);
        }
    }

    private printNPlusOneSummary() {
        const stateManager = TestStateManager.getInstance();
        const allWarnings = stateManager.getAllNPlusOneWarnings();
        const allQueryCounts = stateManager.getAllQueryCounts();

        if (allQueryCounts.size === 0) {
            return;
        }

        const config = vscode.workspace.getConfiguration("djangoTestManager");
        const queryThreshold = config.get<number>("queryCountThreshold") || 50;

        // Collect tests over the threshold
        const overThreshold = Array.from(allQueryCounts.entries())
            .filter(([, count]) => count >= queryThreshold)
            .sort((a, b) => b[1] - a[1]);

        // Collect N+1 tests
        const nplusOneTests = Array.from(allWarnings.entries())
            .filter(([, warnings]) => warnings.length > 0);

        if (overThreshold.length === 0 && nplusOneTests.length === 0) {
            this.outputChannel.appendLine(
                "\n----------------------------------------------------------------------"
            );
            this.outputChannel.appendLine("N+1 Query Report: All clear! ✅");
            this.outputChannel.appendLine(
                "----------------------------------------------------------------------"
            );
            return;
        }

        this.outputChannel.appendLine(
            "\n----------------------------------------------------------------------"
        );
        this.outputChannel.appendLine("🔍 N+1 Query Detection Report:");

        if (nplusOneTests.length > 0) {
            this.outputChannel.appendLine(`\n  🔴 N+1 Patterns Found in ${nplusOneTests.length} test(s):`);
            for (const [testPath, warnings] of nplusOneTests) {
                const queryCount = allQueryCounts.get(testPath) || 0;
                this.outputChannel.appendLine(`\n    ${testPath} (${queryCount} queries)`);
                for (const w of warnings) {
                    this.outputChannel.appendLine(`      ${w.count}× ${w.sql.substring(0, 120)}`);
                }
            }
        }

        if (overThreshold.length > 0) {
            this.outputChannel.appendLine(`\n  ⚠️  High Query Count (≥${queryThreshold}):`);
            for (const [testPath, count] of overThreshold) {
                this.outputChannel.appendLine(`    ${count}q  ${testPath}`);
            }
        }

        this.outputChannel.appendLine(
            "----------------------------------------------------------------------"
        );
    }

    /**
     * Set N+1-related environment variables on the given env object.
     * Used by BOTH the run() and runInTerminal() code paths.
     */
    private applyNPlusOneEnv(env: NodeJS.ProcessEnv): void {
        const config = vscode.workspace.getConfiguration("djangoTestManager");
        const detectNPlusOne = config.get<boolean>("detectNPlusOne") || false;

        if (!detectNPlusOne) {
            this.outputChannel.appendLine(`[N+1] applyNPlusOneEnv: detectNPlusOne is OFF, skipping.`);
            return;
        }
        if (!this.extensionPath) {
            this.outputChannel.appendLine(`[N+1] applyNPlusOneEnv: extensionPath is undefined! Cannot find resources/dtm_query_counter.py`);
            return;
        }
        this.outputChannel.appendLine(`[N+1] applyNPlusOneEnv: extensionPath=${this.extensionPath}`);

        // Add resources/ to PYTHONPATH so dtm_query_counter is importable
        const resourcesDir = path.join(this.extensionPath, 'resources');
        const existing = env['PYTHONPATH'] || '';
        env['PYTHONPATH'] = existing
            ? `${resourcesDir}${path.delimiter}${existing}`
            : resourcesDir;

        // Thresholds
        env['DTM_QUERY_THRESHOLD'] = String(config.get<number>('queryCountThreshold') || 50);
        env['DTM_NPLUSONE_THRESHOLD'] = String(config.get<number>('nplusoneThreshold') || 3);

        // JSON output file — primary data channel, works with parallel execution
        this.dtmOutputFile = path.join(os.tmpdir(), `dtm_queries_${Date.now()}.json`);
        env['DTM_OUTPUT_FILE'] = this.dtmOutputFile;
    }

    /**
     * Read N+1 query results from the JSON file written by dtm_query_counter.py.
     * This is the PRIMARY data channel — it works in ALL modes including parallel.
     * Falls back gracefully if the file doesn't exist (e.g., setting not enabled).
     */
    private loadNPlusOneResultsFromFile(): void {
        if (!this.dtmOutputFile) {
            this.outputChannel.appendLine(`[N+1] loadResults: no dtmOutputFile configured (N+1 detection was not active).`);
            return;
        }

        this.outputChannel.appendLine(`[N+1] loadResults: checking for ${this.dtmOutputFile}`);

        try {
            if (!fs.existsSync(this.dtmOutputFile)) {
                this.outputChannel.appendLine(`[N+1] loadResults: file NOT found - the Python runner may not have written it. Check for import errors in the terminal.`);
                return;
            }

            const raw = fs.readFileSync(this.dtmOutputFile, 'utf-8');
            // JSONL format: one JSON object per line (each worker appends lines)
            const stateManager = TestStateManager.getInstance();
            const lines = raw.split('\n').filter(l => l.trim());
            let loadedCount = 0;

            for (const line of lines) {
                try {
                    const obj: Record<string, { count: number; nplusone: Array<{ count: number; sql: string }> }> = JSON.parse(line);
                    for (const [testPath, result] of Object.entries(obj)) {
                        stateManager.setQueryCount(testPath, result.count);
                        if (result.nplusone) {
                            for (const warning of result.nplusone) {
                                stateManager.addNPlusOneWarning(testPath, warning);
                            }
                        }
                        loadedCount++;
                    }
                } catch (_lineErr) {
                    // skip malformed lines
                }
            }

            this.outputChannel.appendLine(
                `\n[N+1] Loaded query data for ${loadedCount} tests from results file (${lines.length} lines).`
            );

            // Clean up
            try {
                fs.unlinkSync(this.dtmOutputFile);
            } catch (_e) {
                // ignore cleanup errors
            }
        } catch (e) {
            this.outputChannel.appendLine(`[N+1] Could not read results file: ${e}`);
        } finally {
            this.dtmOutputFile = undefined;
        }
    }

    private async generateCoverageReport() {
        if (!this.coverageProvider) return;

        // Run coverage xml
        // We need to run this command in the same environment/cwd
        const config = vscode.workspace.getConfiguration("djangoTestManager");
        const coverageCommand = config.get<string>("coverageCommand") || "coverage";

        let cmd = coverageCommand;
        let args = ["xml"];

        // If we used pythonPath -m coverage, we should do the same here
        let pythonPath = config.get<string>("pythonPath") || "python3";

        // Auto-detect venv
        const venvPath = path.join(this.workspaceRoot, ".venv", "bin", "python");
        const venvPath2 = path.join(this.workspaceRoot, "venv", "bin", "python");
        const fs = require("fs");
        if (fs.existsSync(venvPath)) pythonPath = venvPath;
        else if (fs.existsSync(venvPath2)) pythonPath = venvPath2;

        if (coverageCommand === 'coverage' && pythonPath.includes('bin/python')) {
            cmd = pythonPath;
            args = ["-m", "coverage", "xml"];
        }

        // Use merged environment variables for consistency
        const env = await getMergedEnvironmentVariables(this.workspaceRoot);

        this.outputChannel.appendLine(`Generating coverage report: ${cmd} ${args.join(' ')}`);

        const child = cp.spawn(cmd, args, { cwd: this.workspaceRoot, env: env });

        child.on('close', (code) => {
            if (code === 0) {
                this.outputChannel.appendLine(`Coverage report generated.`);
                this.coverageProvider?.loadCoverage();
            } else {
                this.outputChannel.appendLine(`Failed to generate coverage report. Exit code: ${code}`);
            }
        });
    }
}
