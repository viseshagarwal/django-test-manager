import * as vscode from "vscode";
import { TestDiscovery, TestNode } from "./testDiscovery";
import { TestStateManager } from "./testStateManager";

export class TestTreeDataProvider implements vscode.TreeDataProvider<TestItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<
		TestItem | undefined | null | void
	> = new vscode.EventEmitter<TestItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		TestItem | undefined | null | void
	> = this._onDidChangeTreeData.event;
	private discovery: TestDiscovery | undefined;
	private cachedRoots: TestNode[] | undefined;

	constructor(
		private workspaceRoot: string | undefined,
		discovery?: TestDiscovery
	) {
		if (workspaceRoot) {
			this.discovery = discovery || new TestDiscovery(workspaceRoot);
		}
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	refreshDiscovery(): void {
		this.cachedRoots = undefined;
		this._onDidChangeTreeData.fire();
	}

	async updateFile(uri: vscode.Uri): Promise<void> {
		if (this.discovery && this.cachedRoots) {
			this.cachedRoots = await this.discovery.updateFile(uri);
			this._onDidChangeTreeData.fire();
		}
	}

	async removeFile(uri: vscode.Uri): Promise<void> {
		if (this.discovery && this.cachedRoots) {
			this.cachedRoots = await this.discovery.removeFile(uri);
			this._onDidChangeTreeData.fire();
		}
	}

	getTreeItem(element: TestItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TestItem): Promise<TestItem[]> {
		if (!this.workspaceRoot || !this.discovery) {
			return [];
		}

		if (element) {
			return element.node.children?.map((child) => new TestItem(child)) || [];
		} else {
			if (!this.cachedRoots) {
				this.cachedRoots = await this.discovery.discover();
			}
			return this.cachedRoots.map((node) => new TestItem(node));
		}
	}

	getParent(element: TestItem): vscode.ProviderResult<TestItem> {
		if (element.node.parent) {
			return new TestItem(element.node.parent);
		}
		return null;
	}

	async findNode(dottedPath: string): Promise<TestNode | undefined> {
		if (!this.discovery) return undefined;

		if (!this.cachedRoots) {
			this.cachedRoots = await this.discovery.discover();
		}
		const roots = this.cachedRoots;

		const find = (nodes: TestNode[]): TestNode | undefined => {
			for (const node of nodes) {
				if (node.dottedPath === dottedPath) return node;
				if (node.children) {
					const found = find(node.children);
					if (found) return found;
				}
			}
			return undefined;
		};

		return find(roots);
	}
}

export class TestItem extends vscode.TreeItem {
	constructor(public readonly node: TestNode) {
		super(
			node.name,
			node.children && node.children.length > 0
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None
		);
		// Use composite ID to avoid collisions between folders and files with same dotted path
		this.id = node.dottedPath ? `${node.dottedPath}|${node.type}` : node.name;
		this.contextValue = node.type;

		if (node.uri) {
			this.resourceUri = node.uri;
			this.command = {
				command: "django-test-manager.openTestItem",
				title: "Open",
				arguments: [this],
			};
		}

		// Compute status
		const status = this.computeStatus(node);
		this.iconPath = this.getIcon(status);

		this.tooltip = `${node.name}\n${node.dottedPath || ""}`;
		this.description = this.formatStatus(status, node);
	}

	private formatStatus(status: string, node: TestNode): string {
		let text: string;
		switch (status) {
			case "running":
				text = "Running...";
				break;
			case "aborted":
				text = "Aborted";
				break;
			case "unknown":
				text = node.type;
				break;
			default:
				text = status.charAt(0).toUpperCase() + status.slice(1);
		}

		if (node.dottedPath) {
			const duration = TestStateManager.getInstance().getDuration(
				node.dottedPath
			);
			if (duration !== undefined && status !== "running") {
				if (duration >= 1000) {
					text += ` (${(duration / 1000).toFixed(2)}s)`;
				} else {
					text += ` (${Math.round(duration)}ms)`;
				}
			}
		}
		return text;
	}

	private computeStatus(node: TestNode): string {
		const directStatus = node.dottedPath
			? TestStateManager.getInstance().getStatus(node.dottedPath)
			: undefined;

		// If it's a leaf node (method) or has no children, look up its direct status
		if (!node.children || node.children.length === 0) {
			return directStatus || "unknown";
		}

		let hasFailed = false;
		let hasPending = false;
		let hasRunning = false;
		let hasPassed = false;
		let hasSkipped = false;
		let hasAborted = false;

		// Aggregate status from children
		for (const child of node.children) {
			const childStatus = this.computeStatus(child);
			if (childStatus === "failed") hasFailed = true;
			else if (childStatus === "pending") hasPending = true;
			else if (childStatus === "running") hasRunning = true;
			else if (childStatus === "passed") hasPassed = true;
			else if (childStatus === "skipped") hasSkipped = true;
			else if (childStatus === "aborted") hasAborted = true;
		}

		// Priority: Running > Pending > Failed > Passed > Aborted > Skipped

		// If any child is running, show as running (in progress)
		if (hasRunning) return "running";

		// If any child is pending, the node is pending (waiting to run)
		if (hasPending) return "pending";

		// If direct status is failed, it overrides everything else (e.g. setup failure)
		if (directStatus === "failed") {
			return "failed";
		}

		let result = "unknown";
		if (hasFailed) result = "failed";
		else if (hasPassed) result = "passed";
		else if (hasAborted) result = "aborted";
		else if (hasSkipped) result = "skipped";

		// If aggregation is inconclusive but we have a direct status, use it
		if (result === "unknown" && directStatus) {
			return directStatus;
		}

		return result;
	}

	private getIcon(status?: string): vscode.ThemeIcon | undefined {
		switch (status) {
			case "passed":
				return new vscode.ThemeIcon(
					"pass",
					new vscode.ThemeColor("testing.iconPassed")
				);
			case "failed":
				return new vscode.ThemeIcon(
					"error",
					new vscode.ThemeColor("testing.iconFailed")
				);
			case "skipped":
				return new vscode.ThemeIcon(
					"debug-step-over",
					new vscode.ThemeColor("testing.iconSkipped")
				);
			case "pending":
				return new vscode.ThemeIcon(
					"clock",
					new vscode.ThemeColor("testing.iconQueued")
				);
			case "running":
				return new vscode.ThemeIcon(
					"sync~spin",
					new vscode.ThemeColor("testing.iconQueued")
				);
			case "aborted":
				return new vscode.ThemeIcon(
					"circle-slash",
					new vscode.ThemeColor("testing.iconSkipped")
				);
			default:
				// Structural icons when no specific status
				switch (this.node.type) {
					case 'class':
						return new vscode.ThemeIcon('symbol-class');
					case 'method':
						return new vscode.ThemeIcon('symbol-method');
					case 'file':
					case 'folder':
					case 'app':
						// Return undefined to let VS Code use the user's active File Icon Theme
						return undefined;
					default:
						return undefined;
				}
		}
	}
}
