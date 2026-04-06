import * as vscode from 'vscode';

/**
 * Represents a single test run in history
 */
export interface TestRunRecord {
    id: string;
    timestamp: Date;
    dottedPath: string;
    testName: string;
    status: 'passed' | 'failed' | 'skipped' | 'error';
    duration: number; // milliseconds
    errorMessage?: string;
}

/**
 * Represents a test session (one invocation of test runner)
 */
export interface TestSession {
    id: string;
    startTime: Date;
    endTime?: Date;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number; // milliseconds
    tests: TestRunRecord[];
}

/**
 * Manages test history and provides analytics
 */
export class TestHistoryManager {
    private static instance: TestHistoryManager;
    private sessions: TestSession[] = [];
    private currentSession: TestSession | null = null;
    private readonly MAX_SESSIONS = 50;
    private readonly MAX_TESTS_PER_SESSION = 1000;

    private _onDidUpdateHistory = new vscode.EventEmitter<void>();
    public readonly onDidUpdateHistory = this._onDidUpdateHistory.event;

    private constructor(private context: vscode.ExtensionContext) {
        this.loadHistory();
    }

    public static getInstance(context?: vscode.ExtensionContext): TestHistoryManager {
        if (!TestHistoryManager.instance) {
            if (!context) {
                throw new Error('TestHistoryManager must be initialized with ExtensionContext');
            }
            TestHistoryManager.instance = new TestHistoryManager(context);
        }
        return TestHistoryManager.instance;
    }

    /**
     * Start a new test session
     */
    public startSession(): string {
        const id = this.generateId();
        this.currentSession = {
            id,
            startTime: new Date(),
            totalTests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0,
            tests: []
        };
        return id;
    }

    /**
     * End the current test session
     */
    public endSession(): void {
        if (!this.currentSession) return;

        this.currentSession.endTime = new Date();
        this.currentSession.duration =
            this.currentSession.endTime.getTime() - this.currentSession.startTime.getTime();

        // Add to sessions list
        this.sessions.unshift(this.currentSession);

        // Trim old sessions
        if (this.sessions.length > this.MAX_SESSIONS) {
            this.sessions = this.sessions.slice(0, this.MAX_SESSIONS);
        }

        this.currentSession = null;
        this.saveHistory();
        this._onDidUpdateHistory.fire();
    }

    /**
     * Record a test result
     */
    public recordTest(
        dottedPath: string,
        testName: string,
        status: 'passed' | 'failed' | 'skipped' | 'error',
        duration: number,
        errorMessage?: string
    ): void {
        if (!this.currentSession) {
            this.startSession();
        }

        const record: TestRunRecord = {
            id: this.generateId(),
            timestamp: new Date(),
            dottedPath,
            testName,
            status,
            duration,
            errorMessage
        };

        this.currentSession!.tests.push(record);
        this.currentSession!.totalTests++;

        switch (status) {
            case 'passed':
                this.currentSession!.passed++;
                break;
            case 'failed':
            case 'error':
                this.currentSession!.failed++;
                break;
            case 'skipped':
                this.currentSession!.skipped++;
                break;
        }

        // Trim tests if too many
        if (this.currentSession!.tests.length > this.MAX_TESTS_PER_SESSION) {
            this.currentSession!.tests = this.currentSession!.tests.slice(-this.MAX_TESTS_PER_SESSION);
        }
    }

    /**
     * Get all sessions
     */
    public getSessions(): TestSession[] {
        return this.sessions;
    }

    /**
     * Get the most recent session
     */
    public getLastSession(): TestSession | undefined {
        return this.sessions[0];
    }

    /**
     * Get test history for a specific test
     */
    public getTestHistory(dottedPath: string): TestRunRecord[] {
        const history: TestRunRecord[] = [];

        for (const session of this.sessions) {
            for (const test of session.tests) {
                if (test.dottedPath === dottedPath) {
                    history.push(test);
                }
            }
        }

        return history.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public getAverageTestDuration(dottedPath: string): number | undefined {
        const history = this.getTestHistory(dottedPath);
        if (history.length === 0) return undefined;

        const total = history.reduce((sum, record) => sum + record.duration, 0);
        return total / history.length;
    }

    /**
     * Calculate flakiness for a test (percentage of times it failed/passed inconsistently)
     */
    public getTestFlakiness(dottedPath: string): number {
        const history = this.getTestHistory(dottedPath);
        if (history.length < 3) return 0; // Need at least 3 runs to detect flakiness

        let transitions = 0;
        for (let i = 1; i < history.length; i++) {
            const prevStatus = history[i - 1].status === 'passed' ? 'passed' : 'failed';
            const currStatus = history[i].status === 'passed' ? 'passed' : 'failed';
            if (prevStatus !== currStatus) {
                transitions++;
            }
        }

        return transitions / (history.length - 1);
    }

    /**
     * Get slowest tests across all sessions
     */
    public getSlowestTests(limit: number = 10): TestRunRecord[] {
        const allTests: TestRunRecord[] = [];

        for (const session of this.sessions) {
            allTests.push(...session.tests);
        }

        // Group by dottedPath and get average duration
        const avgDurations = new Map<string, { total: number; count: number; record: TestRunRecord }>();

        for (const test of allTests) {
            const existing = avgDurations.get(test.dottedPath);
            if (existing) {
                existing.total += test.duration;
                existing.count++;
                // Keep the most recent record
                if (test.timestamp > existing.record.timestamp) {
                    existing.record = test;
                }
            } else {
                avgDurations.set(test.dottedPath, {
                    total: test.duration,
                    count: 1,
                    record: test
                });
            }
        }

        return Array.from(avgDurations.values())
            .sort((a, b) => (b.total / b.count) - (a.total / a.count))
            .slice(0, limit)
            .map(item => ({
                ...item.record,
                duration: Math.round(item.total / item.count) // Average duration
            }));
    }

    /**
     * Get most frequently failing tests
     */
    public getMostFailingTests(limit: number = 10): Array<{ dottedPath: string; failureRate: number; totalRuns: number }> {
        const testStats = new Map<string, { failures: number; total: number }>();

        for (const session of this.sessions) {
            for (const test of session.tests) {
                const existing = testStats.get(test.dottedPath) || { failures: 0, total: 0 };
                existing.total++;
                if (test.status === 'failed' || test.status === 'error') {
                    existing.failures++;
                }
                testStats.set(test.dottedPath, existing);
            }
        }

        return Array.from(testStats.entries())
            .filter(([, stats]) => stats.failures > 0)
            .map(([dottedPath, stats]) => ({
                dottedPath,
                failureRate: stats.failures / stats.total,
                totalRuns: stats.total
            }))
            .sort((a, b) => b.failureRate - a.failureRate)
            .slice(0, limit);
    }

    /**
     * Get summary statistics
     */
    public getSummary(): {
        totalSessions: number;
        totalTests: number;
        totalPassed: number;
        totalFailed: number;
        totalSkipped: number;
        avgSessionDuration: number;
        avgTestDuration: number;
    } {
        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;
        let totalSkipped = 0;
        let totalDuration = 0;
        let totalTestDuration = 0;

        for (const session of this.sessions) {
            totalTests += session.totalTests;
            totalPassed += session.passed;
            totalFailed += session.failed;
            totalSkipped += session.skipped;
            totalDuration += session.duration;

            for (const test of session.tests) {
                totalTestDuration += test.duration;
            }
        }

        return {
            totalSessions: this.sessions.length,
            totalTests,
            totalPassed,
            totalFailed,
            totalSkipped,
            avgSessionDuration: this.sessions.length > 0 ? totalDuration / this.sessions.length : 0,
            avgTestDuration: totalTests > 0 ? totalTestDuration / totalTests : 0
        };
    }

    /**
     * Clear all history
     */
    public clearHistory(): void {
        this.sessions = [];
        this.currentSession = null;
        this.saveHistory();
        this._onDidUpdateHistory.fire();
    }

    /**
     * Save history to extension storage
     */
    private saveHistory(): void {
        // Convert dates to ISO strings for serialization
        const serializable = this.sessions.map(session => ({
            ...session,
            startTime: session.startTime.toISOString(),
            endTime: session.endTime?.toISOString(),
            tests: session.tests.map(test => ({
                ...test,
                timestamp: test.timestamp.toISOString()
            }))
        }));

        this.context.globalState.update('testHistory', serializable);
    }

    /**
     * Load history from extension storage
     */
    private loadHistory(): void {
        const stored = this.context.globalState.get<any[]>('testHistory');

        if (stored) {
            this.sessions = stored.map(session => ({
                ...session,
                startTime: new Date(session.startTime),
                endTime: session.endTime ? new Date(session.endTime) : undefined,
                tests: session.tests.map((test: any) => ({
                    ...test,
                    timestamp: new Date(test.timestamp)
                }))
            }));
        }
    }

    /**
     * Generate a unique ID
     */
    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export history to JSON
     */
    public exportToJson(): string {
        return JSON.stringify({
            exportDate: new Date().toISOString(),
            summary: this.getSummary(),
            sessions: this.sessions
        }, null, 2);
    }
}

/**
 * Tree data provider for test history view
 */
export class TestHistoryTreeProvider implements vscode.TreeDataProvider<HistoryTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<HistoryTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private historyManager: TestHistoryManager) {
        historyManager.onDidUpdateHistory(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: HistoryTreeItem): HistoryTreeItem[] {
        if (!element) {
            // Root level - show sessions
            return this.historyManager.getSessions().slice(0, 20).map(session => {
                const icon = session.failed > 0 ? 'error' : 'check';
                const date = session.startTime.toLocaleString();
                const duration = this.formatDuration(session.duration);

                return new HistoryTreeItem(
                    `${date} (${session.totalTests} tests, ${duration})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    session.id,
                    'session',
                    new vscode.ThemeIcon(icon, session.failed > 0
                        ? new vscode.ThemeColor('testing.iconFailed')
                        : new vscode.ThemeColor('testing.iconPassed')
                    ),
                    `Passed: ${session.passed}, Failed: ${session.failed}, Skipped: ${session.skipped}`
                );
            });
        }

        if (element.itemType === 'session') {
            // Show tests in session
            const session = this.historyManager.getSessions().find(s => s.id === element.itemId);
            if (!session) return [];

            return session.tests.map(test => {
                const icon = test.status === 'passed' ? 'check'
                    : test.status === 'skipped' ? 'dash'
                        : 'error';
                const color = test.status === 'passed'
                    ? new vscode.ThemeColor('testing.iconPassed')
                    : test.status === 'skipped'
                        ? new vscode.ThemeColor('testing.iconSkipped')
                        : new vscode.ThemeColor('testing.iconFailed');

                return new HistoryTreeItem(
                    test.testName,
                    vscode.TreeItemCollapsibleState.None,
                    test.id,
                    'test',
                    new vscode.ThemeIcon(icon, color),
                    `${test.dottedPath} (${test.duration}ms)`
                );
            });
        }

        return [];
    }

    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    }
}

class HistoryTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemId: string,
        public readonly itemType: 'session' | 'test',
        iconPath?: vscode.ThemeIcon,
        tooltip?: string
    ) {
        super(label, collapsibleState);
        this.iconPath = iconPath;
        this.tooltip = tooltip;
        this.contextValue = itemType;
    }
}
