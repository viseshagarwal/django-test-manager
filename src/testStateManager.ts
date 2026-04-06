import * as vscode from 'vscode';

type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'aborted' | 'unknown';

export class TestStateManager {
    private static instance: TestStateManager;
    private statuses = new Map<string, TestStatus>();
    private failureMessages = new Map<string, string>();
    private durations = new Map<string, number>();
    private diffs = new Map<string, { expected: string; actual: string }>();
    private queryCounts = new Map<string, number>();
    private nplusOneWarnings = new Map<string, Array<{ count: number; sql: string }>>();

    private _onDidChangeStatus = new vscode.EventEmitter<void>();
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;

    // Debounce status change events
    private fireTimeout: NodeJS.Timeout | undefined;
    private readonly FIRE_DEBOUNCE_MS = 50;

    private constructor() { }

    public static getInstance(): TestStateManager {
        if (!TestStateManager.instance) {
            TestStateManager.instance = new TestStateManager();
        }
        return TestStateManager.instance;
    }

    /**
     * Set status with debounced event firing
     */
    public setStatus(dottedPath: string, status: TestStatus): void {
        this.statuses.set(dottedPath, status);
        this.debouncedFire();
    }

    /**
     * Set multiple statuses at once (more efficient for batch updates)
     */
    public setStatusBatch(updates: Array<{ path: string; status: TestStatus }>): void {
        for (const { path, status } of updates) {
            this.statuses.set(path, status);
        }
        this.debouncedFire();
    }

    private debouncedFire(): void {
        if (this.fireTimeout) {
            return; // Already scheduled
        }
        this.fireTimeout = setTimeout(() => {
            this.fireTimeout = undefined;
            this._onDidChangeStatus.fire();
        }, this.FIRE_DEBOUNCE_MS);
    }

    /**
     * Force immediate firing of status change event
     */
    public flushChanges(): void {
        if (this.fireTimeout) {
            clearTimeout(this.fireTimeout);
            this.fireTimeout = undefined;
        }
        this._onDidChangeStatus.fire();
    }

    public getStatus(dottedPath: string): TestStatus | undefined {
        return this.statuses.get(dottedPath);
    }

    public setFailureMessage(dottedPath: string, message: string): void {
        this.failureMessages.set(dottedPath, message);
    }

    public getFailureMessage(dottedPath: string): string | undefined {
        return this.failureMessages.get(dottedPath);
    }

    public clear(): void {
        this.statuses.clear();
        this.failureMessages.clear();
        this.durations.clear();
        this.diffs.clear();
        this.queryCounts.clear();
        this.nplusOneWarnings.clear();

        if (this.fireTimeout) {
            clearTimeout(this.fireTimeout);
            this.fireTimeout = undefined;
        }
        this._onDidChangeStatus.fire();
    }

    public getFailedTests(): string[] {
        const failed: string[] = [];
        for (const [path, status] of this.statuses) {
            if (status === 'failed') {
                failed.push(path);
            }
        }
        return failed;
    }

    public getAllKeys(): string[] {
        return Array.from(this.statuses.keys());
    }

    public setDiff(dottedPath: string, expected: string, actual: string): void {
        this.diffs.set(dottedPath, { expected, actual });
    }

    public getDiff(dottedPath: string): { expected: string; actual: string } | undefined {
        return this.diffs.get(dottedPath);
    }

    public clearDiff(dottedPath: string): void {
        this.diffs.delete(dottedPath);
    }

    public setDuration(dottedPath: string, duration: number): void {
        this.durations.set(dottedPath, duration);
    }

    public getDuration(dottedPath: string): number | undefined {
        return this.durations.get(dottedPath);
    }

    public getDurations(): Map<string, number> {
        return this.durations;
    }

    // ── Query count methods (N+1 detection) ────────────────

    public setQueryCount(dottedPath: string, count: number): void {
        this.queryCounts.set(dottedPath, count);
    }

    public getQueryCount(dottedPath: string): number | undefined {
        return this.queryCounts.get(dottedPath);
    }

    public getAllQueryCounts(): Map<string, number> {
        return this.queryCounts;
    }

    public addNPlusOneWarning(dottedPath: string, warning: { count: number; sql: string }): void {
        if (!this.nplusOneWarnings.has(dottedPath)) {
            this.nplusOneWarnings.set(dottedPath, []);
        }
        this.nplusOneWarnings.get(dottedPath)!.push(warning);
    }

    public getNPlusOneWarnings(dottedPath: string): Array<{ count: number; sql: string }> | undefined {
        return this.nplusOneWarnings.get(dottedPath);
    }

    public getAllNPlusOneWarnings(): Map<string, Array<{ count: number; sql: string }>> {
        return this.nplusOneWarnings;
    }

    /**
     * Get total counts for status bar display
     */
    public getCounts(): { passed: number; failed: number; skipped: number; pending: number; running: number; aborted: number; total: number } {
        let passed = 0, failed = 0, skipped = 0, pending = 0, running = 0, aborted = 0;

        for (const status of this.statuses.values()) {
            switch (status) {
                case 'passed': passed++; break;
                case 'failed': failed++; break;
                case 'skipped': skipped++; break;
                case 'pending': pending++; break;
                case 'running': running++; break;
                case 'aborted': aborted++; break;
            }
        }

        return { passed, failed, skipped, pending, running, aborted, total: this.statuses.size };
    }
}
