import * as vscode from 'vscode';
import { TestStateManager } from './testStateManager';
import { TestTreeDataProvider } from './testTree';

/**
 * Common Django error patterns and actionable tips.
 * Shown as toasts when navigating to failing tests.
 */
const DJANGO_ERROR_TIPS: Array<{ pattern: RegExp; tip: string }> = [
    {
        pattern: /IntegrityError.*UNIQUE constraint failed/i,
        tip: '💡 Duplicate data in factory/fixture. Use unique values or get_or_create().'
    },
    {
        pattern: /IntegrityError.*NOT NULL constraint failed/i,
        tip: '💡 A required field is missing. Check your test data setup.'
    },
    {
        pattern: /IntegrityError.*violates foreign key constraint/i,
        tip: '💡 Referencing a non-existent record. Ensure related objects are created first.'
    },
    {
        pattern: /NoReverseMatch/i,
        tip: '💡 URL name or namespace mismatch. Check urlpatterns and url(..., name="...").'
    },
    {
        pattern: /AppRegistryNotReady/i,
        tip: '💡 Django setup not loaded. Ensure django.setup() is called or use a proper test base class.'
    },
    {
        pattern: /OperationalError.*no such table/i,
        tip: '💡 Missing migration. Run manage.py migrate or consider TransactionTestCase.'
    },
    {
        pattern: /OperationalError.*does not exist/i,
        tip: '💡 Table or column does not exist. Check migrations are up to date.'
    },
    {
        pattern: /DoesNotExist/i,
        tip: '💡 Object not found in DB. Check that your test fixtures create the expected objects.'
    },
    {
        pattern: /AssertionError.*[Ee]xpected.*got\s+403/i,
        tip: '💡 Permission denied. Check authentication/authorization setup in your test.'
    },
    {
        pattern: /AssertionError.*[Ee]xpected.*got\s+302/i,
        tip: '💡 Redirect instead of expected response. Check login_required or auth middleware.'
    },
    {
        pattern: /AssertionError.*[Ee]xpected.*got\s+404/i,
        tip: '💡 Page not found. Check URL pattern, view name, or object lookup.'
    },
    {
        pattern: /TransactionManagementError/i,
        tip: '💡 Use TransactionTestCase instead of TestCase when testing raw transactions.'
    },
    {
        pattern: /ConnectionResetError|ConnectionRefusedError/i,
        tip: '💡 External service unavailable. Consider mocking HTTP calls in your test.'
    },
    {
        pattern: /ImproperlyConfigured/i,
        tip: '💡 Django configuration error. Check INSTALLED_APPS, DATABASES, or middleware settings.'
    },
    {
        pattern: /TemplateDoesNotExist/i,
        tip: '💡 Template not found. Check TEMPLATES dirs, app_directories, and template name spelling.'
    },
    {
        pattern: /ValidationError/i,
        tip: '💡 Model/form validation failed. Check required fields and validators.'
    },
    {
        pattern: /PermissionDenied/i,
        tip: '💡 Django raised PermissionDenied. Check view permissions and user roles in test setup.'
    },
    {
        pattern: /AssertionError.*!=|AssertionError.*not equal/i,
        tip: '💡 Value mismatch. Compare expected vs actual carefully — check types and formatting.'
    },
];

/**
 * Manages navigation between failing tests.
 * Tracks a cursor index into the sorted list of failed tests.
 */
export class FailureNavigator {
    private currentIndex = -1;

    constructor(
        private treeDataProvider: TestTreeDataProvider
    ) { }

    /**
     * Navigate to the first failing test.
     */
    async openFirstFailing(): Promise<void> {
        const failedTests = this.getFailedTestsSorted();
        if (failedTests.length === 0) {
            vscode.window.showInformationMessage('No failed tests found.');
            return;
        }

        this.currentIndex = 0;
        await this.navigateTo(failedTests[0]);
    }

    /**
     * Navigate to the next failing test (wraps around).
     */
    async openNextFailing(): Promise<void> {
        const failedTests = this.getFailedTestsSorted();
        if (failedTests.length === 0) {
            vscode.window.showInformationMessage('No failed tests found.');
            return;
        }

        this.currentIndex = (this.currentIndex + 1) % failedTests.length;
        await this.navigateTo(failedTests[this.currentIndex]);
    }

    /**
     * Navigate to the previous failing test (wraps around).
     */
    async openPreviousFailing(): Promise<void> {
        const failedTests = this.getFailedTestsSorted();
        if (failedTests.length === 0) {
            vscode.window.showInformationMessage('No failed tests found.');
            return;
        }

        this.currentIndex = this.currentIndex <= 0
            ? failedTests.length - 1
            : this.currentIndex - 1;
        await this.navigateTo(failedTests[this.currentIndex]);
    }

    /**
     * Get sorted list of failed test dotted paths.
     */
    private getFailedTestsSorted(): string[] {
        return TestStateManager.getInstance().getFailedTests().sort();
    }

    /**
     * Navigate to a specific failed test by dotted path.
     * Opens the file, shows a status toast, and optionally displays a Django error tip.
     */
    private async navigateTo(dottedPath: string): Promise<void> {
        const failedTests = this.getFailedTestsSorted();
        const position = this.currentIndex + 1;
        const total = failedTests.length;

        // Toast: show position
        const testName = dottedPath.split('.').pop() || dottedPath;
        vscode.window.showInformationMessage(
            `🐛 Failing test ${position}/${total}: ${testName}`
        );

        // Try to open the file via the tree node (best — has URI + range)
        const node = await this.treeDataProvider.findNode(dottedPath);
        if (node?.uri) {
            const doc = await vscode.workspace.openTextDocument(node.uri);
            const editor = await vscode.window.showTextDocument(doc, {
                selection: node.range,
                preserveFocus: false,
            });
            // Reveal the range in the editor
            if (node.range) {
                editor.revealRange(node.range, vscode.TextEditorRevealType.InCenter);
            }
        } else {
            // Fallback: use quick-open to search for the test
            const parts = dottedPath.split('.');
            const searchQuery = parts[parts.length - 2] || parts[parts.length - 1];
            await vscode.commands.executeCommand('workbench.action.quickOpen', searchQuery);
        }

        // Show Django error tip if we recognise the failure
        this.showErrorTip(dottedPath);
    }

    /**
     * Check the failure message against known Django patterns
     * and show a helpful tip toast.
     */
    private showErrorTip(dottedPath: string): void {
        const stateManager = TestStateManager.getInstance();
        const failureMessage = stateManager.getFailureMessage(dottedPath);
        if (!failureMessage) return;

        for (const { pattern, tip } of DJANGO_ERROR_TIPS) {
            if (pattern.test(failureMessage)) {
                // Small delay so it doesn't overlap with the position toast
                setTimeout(() => {
                    vscode.window.showInformationMessage(tip);
                }, 800);
                return;
            }
        }
    }
}
