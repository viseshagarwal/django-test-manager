import * as vscode from 'vscode';
import { TestStateManager } from './testStateManager';

export class TestStatusBar {
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        this.statusBarItem.command = 'django-test-manager.runFailedTests';
        this.update();

        TestStateManager.getInstance().onDidChangeStatus(() => {
            this.update();
        });
    }

    private updateTimeout: NodeJS.Timeout | undefined;

    public update() {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
            this._doUpdate();
            this.updateTimeout = undefined;
        }, 100);
    }

    private _doUpdate() {
        const stateManager = TestStateManager.getInstance();
        const allKeys = stateManager.getAllKeys();

        let passed = 0;
        let failed = 0;
        let skipped = 0;
        let pending = 0;
        let running = 0;
        let aborted = 0;

        allKeys.forEach(key => {
            const status = stateManager.getStatus(key);
            if (status === 'passed') passed++;
            else if (status === 'failed') failed++;
            else if (status === 'skipped') skipped++;
            else if (status === 'pending') pending++;
            else if (status === 'running') running++;
            else if (status === 'aborted') aborted++;
        });

        const total = allKeys.length;

        if (passed === 0 && failed === 0 && skipped === 0 && pending === 0 && running === 0 && aborted === 0) {
            this.statusBarItem.hide();
            return;
        }

        const parts: string[] = [];

        // Show running status with progress
        if (running > 0 || pending > 0) {
            const completed = passed + failed + skipped + aborted;
            parts.push(`$(sync~spin) ${completed}/${total}`);
            this.statusBarItem.backgroundColor = undefined;
        }

        // Show failure count prominently
        if (failed > 0) {
            parts.push(`$(error) ${failed}`);
            if (running === 0 && pending === 0) {
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            }
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }

        if (passed > 0) parts.push(`$(check) ${passed}`);
        if (skipped > 0) parts.push(`$(debug-step-over) ${skipped}`);
        if (aborted > 0) parts.push(`$(circle-slash) ${aborted}`);

        this.statusBarItem.text = `Django Tests: ${parts.join(' │ ')}`;

        // Set tooltip with detailed statistics
        const tooltipLines = [
            `Total: ${total}`,
            `Success: ${passed}`,
            `Failed: ${failed}`,
            `Skipped: ${skipped}`
        ];
        if (running > 0) {
            tooltipLines.push(`Running: ${running}`);
        }
        if (pending > 0) {
            tooltipLines.push(`Pending: ${pending}`);
        }
        if (aborted > 0) {
            tooltipLines.push(`Aborted: ${aborted}`);
        }
        this.statusBarItem.tooltip = tooltipLines.join('\n');

        this.statusBarItem.show();
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
