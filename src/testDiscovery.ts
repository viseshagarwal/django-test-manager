import * as vscode from 'vscode';
import * as path from 'path';
import { TestStateManager } from './testStateManager';
import { isTestClass } from './testUtils';
import { logger } from './logger';

export interface TestNode {
    name: string;
    type: 'app' | 'folder' | 'file' | 'class' | 'method';
    children?: TestNode[];
    uri?: vscode.Uri;
    range?: vscode.Range;
    dottedPath?: string;
    status?: 'pending' | 'passed' | 'failed' | 'skipped' | 'unknown';
    parent?: TestNode;
}

export class TestDiscovery {
    private classRegex = /^class\s+(\w+)(?:\(([^)]+)\))?/;
    private methodRegex: RegExp | null = null;
    private methodPrefix: string | null = null;
    private pathSepRegex: RegExp;

    constructor(private workspaceRoot: string) {
        // Pre-compile path separator regex once
        this.pathSepRegex = new RegExp(path.sep.replace(/\\/g, '\\\\'), 'g');
    }

    private fileNodes = new Map<string, TestNode>();

    // Cache for file dotted paths to avoid repeated calculations
    private dottedPathCache = new Map<string, string>();

    private getFileDottedPath(uri: vscode.Uri): string {
        const key = uri.fsPath;
        let dottedPath = this.dottedPathCache.get(key);
        if (!dottedPath) {
            const relativePath = path.relative(this.workspaceRoot, key);
            dottedPath = relativePath.replace(/\.py$/, '').replace(this.pathSepRegex, '.');
            this.dottedPathCache.set(key, dottedPath);
        }
        return dottedPath;
    }

    async discover(): Promise<TestNode[]> {
        // Find all python files that might contain tests
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const filePattern = config.get<string>('testFilePattern') || '**/*test*.py';
        const pattern = new vscode.RelativePattern(this.workspaceRoot, filePattern);
        const excludePattern = '**/{node_modules,venv,.venv,env,.env,__pycache__,.git,.tox,dist,build}/**';
        const files = await vscode.workspace.findFiles(pattern, excludePattern);

        if (files.length === 0) {
            vscode.window.showInformationMessage('No Django tests found. Make sure your test files match the pattern *test*.py');
            return [];
        }

        // Clear existing caches on full discover
        this.fileNodes.clear();
        this.dottedPathCache.clear();

        // Process files in batches for better memory management
        const BATCH_SIZE = 50;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(file => this.parseFile(file)));

            for (const fileNode of results) {
                if (fileNode?.uri) {
                    this.fileNodes.set(fileNode.uri.toString(), fileNode);
                }
            }
        }

        return this.structureTests(Array.from(this.fileNodes.values()));
    }

    public async updateFile(uri: vscode.Uri): Promise<TestNode[]> {
        // Clear dotted path cache for this file
        this.dottedPathCache.delete(uri.fsPath);

        const node = await this.parseFile(uri);
        if (node) {
            this.fileNodes.set(uri.toString(), node);
        } else {
            this.fileNodes.delete(uri.toString());
        }
        return this.structureTests(Array.from(this.fileNodes.values()));
    }

    public removeFile(uri: vscode.Uri): Promise<TestNode[]> {
        this.fileNodes.delete(uri.toString());
        this.dottedPathCache.delete(uri.fsPath);
        return Promise.resolve(this.structureTests(Array.from(this.fileNodes.values())));
    }

    public async parseFile(uri: vscode.Uri): Promise<TestNode | null> {
        try {
            const content = (await vscode.workspace.fs.readFile(uri)).toString();

            // Quick check: if no 'class' keyword, skip entirely
            if (!content.includes('class ')) {
                return null;
            }

            const lines = content.split('\n');

            const config = vscode.workspace.getConfiguration('djangoTestManager');
            const currentPrefix = config.get<string>('testMethodPattern') || 'test_';

            // Cache method regex if prefix hasn't changed
            if (this.methodPrefix !== currentPrefix || !this.methodRegex) {
                this.methodPrefix = currentPrefix;
                this.methodRegex = new RegExp(`^\\s+(?:async\\s+)?def\\s+(${currentPrefix}\\w+)`);
            }

            const fileDottedPath = this.getFileDottedPath(uri);

            const fileNode: TestNode = {
                name: path.basename(uri.fsPath),
                type: 'file',
                uri: uri,
                children: [],
                dottedPath: fileDottedPath
            };

            let currentClass: TestNode | null = null;
            const lineCount = lines.length;

            for (let i = 0; i < lineCount; i++) {
                const line = lines[i];
                const lineLength = line.length;

                // Skip empty lines quickly
                if (lineLength === 0) continue;

                const trimmed = line.trimStart();
                const trimmedLength = trimmed.length;

                // Skip empty/comment lines
                if (trimmedLength === 0 || trimmed[0] === '#') continue;

                // Check for class definition
                if (trimmed.startsWith('class ')) {
                    const classMatch = this.classRegex.exec(line);
                    if (classMatch) {
                        const className = classMatch[1];
                        const baseClasses = classMatch[2];

                        // Only add test classes
                        if (!isTestClass(className, baseClasses)) {
                            currentClass = null;
                            continue;
                        }

                        currentClass = {
                            name: className,
                            type: 'class',
                            children: [],
                            uri: uri,
                            range: new vscode.Range(i, 0, i, lineLength),
                            dottedPath: `${fileDottedPath}.${className}`,
                            parent: fileNode
                        };
                        fileNode.children!.push(currentClass);
                    }
                    continue;
                }

                // Check for method definition (only if inside a test class)
                if (currentClass && (trimmed.startsWith('def ') || trimmed.startsWith('async def '))) {
                    const methodMatch = this.methodRegex!.exec(line);
                    if (methodMatch) {
                        const methodName = methodMatch[1];
                        currentClass.children!.push({
                            name: methodName,
                            type: 'method',
                            uri: uri,
                            range: new vscode.Range(i, 0, i, lineLength),
                            dottedPath: `${currentClass.dottedPath}.${methodName}`,
                            parent: currentClass
                        });
                    }
                }
            }

            return fileNode.children && fileNode.children.length > 0 ? fileNode : null;
        } catch (e) {
            logger.error(`Error parsing file ${uri.fsPath}:`, e);
            return null;
        }
    }

    private structureTests(nodes: TestNode[]): TestNode[] {
        const rootNodes: TestNode[] = [];
        // Use a Map for O(1) folder lookup instead of array.find()
        const folderCache = new Map<string, TestNode>();

        for (const node of nodes) {
            if (!node.uri) continue;

            const relativePath = path.relative(this.workspaceRoot, node.uri.fsPath);
            const parts = relativePath.split(path.sep);

            let currentLevel = rootNodes;
            let currentPath = '';
            let parentNode: TestNode | undefined = undefined;

            // Iterate over directories (exclude filename)
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                currentPath = currentPath ? `${currentPath}${path.sep}${part}` : part;

                // Use cache for O(1) lookup
                const cacheKey = `${currentPath}|${currentLevel === rootNodes ? 'root' : parentNode?.dottedPath}`;
                let folderNode = folderCache.get(cacheKey);

                if (!folderNode) {
                    // Check in current level
                    folderNode = currentLevel.find(n => n.name === part && n.type === 'folder');

                    if (!folderNode) {
                        folderNode = {
                            name: part,
                            type: 'folder',
                            children: [],
                            uri: vscode.Uri.file(path.join(this.workspaceRoot, currentPath)),
                            dottedPath: currentPath.replace(this.pathSepRegex, '.'),
                            parent: parentNode
                        };
                        currentLevel.push(folderNode);
                    }
                    folderCache.set(cacheKey, folderNode);
                }

                if (!folderNode.children) {
                    folderNode.children = [];
                }
                currentLevel = folderNode.children;
                parentNode = folderNode;
            }

            node.parent = parentNode;
            currentLevel.push(node);

            // Register discovered node in state manager if not already there
            if (node.dottedPath) {
                const stateManager = TestStateManager.getInstance();
                if (!stateManager.getStatus(node.dottedPath)) {
                    stateManager.setStatus(node.dottedPath, 'unknown');
                }
            }
        }

        // Sort nodes recursively
        this.sortNodes(rootNodes);
        return rootNodes;
    }

    private sortNodes(nodes: TestNode[]): void {
        // Use a stable sort with pre-computed type priorities
        nodes.sort((a, b) => {
            // Folders first, then files
            const aIsFolder = a.type === 'folder' ? 0 : 1;
            const bIsFolder = b.type === 'folder' ? 0 : 1;
            if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
            return a.name.localeCompare(b.name);
        });

        for (const node of nodes) {
            if (node.children && node.children.length > 0) {
                this.sortNodes(node.children);
            }
        }
    }

    public getNodeByDottedPath(_dottedPath: string): TestNode | undefined {
        return undefined;
    }
}
