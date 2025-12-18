import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TestStateManager } from './testStateManager';

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
    private methodRegex: RegExp | undefined;
    private methodPrefix: string | undefined;

    constructor(private workspaceRoot: string) { }

    private fileNodes = new Map<string, TestNode>();

    async discover(): Promise<TestNode[]> {
        // Find all python files that might contain tests
        // Tests can be in tests package/directory OR files named test.py/tests.py
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const filePattern = config.get<string>('testFilePattern') || '**/{tests/**/*.py,test.py,tests.py}';
        const pattern = new vscode.RelativePattern(this.workspaceRoot, filePattern);
        const excludePattern = '**/{node_modules,venv,.venv,env,.env}/**';
        const files = await vscode.workspace.findFiles(pattern, excludePattern);

        if (files.length === 0) {
            vscode.window.showInformationMessage('No Django tests found. Make sure your test files are in a tests directory or named test.py/tests.py');
        }

        // Clear existing cache on full discover
        this.fileNodes.clear();

        // Parallel processing of files
        const filePromises = files.map(file => this.parseFile(file));
        const results = await Promise.all(filePromises);

        for (const fileNode of results) {
            if (fileNode && fileNode.uri) {
                this.fileNodes.set(fileNode.uri.toString(), fileNode);
            }
        }

        return this.structureTests(Array.from(this.fileNodes.values()));
    }

    public async updateFile(uri: vscode.Uri): Promise<TestNode[]> {
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
        return Promise.resolve(this.structureTests(Array.from(this.fileNodes.values())));
    }

    public async parseFile(uri: vscode.Uri): Promise<TestNode | null> {
        try {
            // Check if file is a valid test file:
            // 1. File is in tests directory/package, OR
            // 2. File is named test.py or tests.py
            const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
            const pathParts = relativePath.split(path.sep);
            const fileName = path.basename(uri.fsPath);
            const isInTestsDirectory = pathParts.some(part => part === 'tests' || part === 'test');
            const isTestFile = fileName === 'test.py' || fileName === 'tests.py';
            
            if (!isInTestsDirectory && !isTestFile) {
                return null; // Not a test file
            }

            const content = (await vscode.workspace.fs.readFile(uri)).toString();
            const lines = content.split('\n');

            const config = vscode.workspace.getConfiguration('djangoTestManager');
            const currentPrefix = config.get<string>('testMethodPattern') || 'test_';

            // Cache method regex if prefix hasn't changed
            if (this.methodPrefix !== currentPrefix || !this.methodRegex) {
                this.methodPrefix = currentPrefix;
                this.methodRegex = new RegExp(`^\\s+(?:async\\s+)?def\\s+(${currentPrefix}\\w+)`);
            }

            const fileDottedPath = relativePath.replace(/\.py$/, '').replace(new RegExp(path.sep.replace(/\\/g, '\\\\'), 'g'), '.');

            const fileNode: TestNode = {
                name: path.basename(uri.fsPath),
                type: 'file',
                uri: uri,
                children: [],
                dottedPath: fileDottedPath
            };

            let currentClass: TestNode | null = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Optimization: check start of string before running regex
                const trimmed = line.trimStart();
                if (trimmed.startsWith('class ')) {
                    const classMatch = line.match(this.classRegex);
                    if (classMatch) {
                        const className = classMatch[1];
                        // Only detect classes that start with "Test" (e.g., TestCase, TestMyClass)
                        if (className.startsWith('Test')) {
                            currentClass = {
                                name: className,
                                type: 'class',
                                children: [],
                                uri: uri,
                                range: new vscode.Range(i, 0, i, line.length),
                                dottedPath: `${fileDottedPath}.${className}`,
                                parent: fileNode
                            };
                            fileNode.children?.push(currentClass);
                        } else {
                            currentClass = null; // Reset if class doesn't start with Test
                        }
                        continue;
                    }
                }

                // Detect test methods: either inside Test classes or standalone methods starting with test_
                if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
                    const methodMatch = this.methodRegex ? line.match(this.methodRegex) : null;
                    if (methodMatch) {
                        const methodName = methodMatch[1];
                        if (currentClass) {
                            // Method inside a Test class
                            currentClass.children?.push({
                                name: methodName,
                                type: 'method',
                                uri: uri,
                                range: new vscode.Range(i, 0, i, line.length),
                                dottedPath: `${currentClass.dottedPath}.${methodName}`,
                                parent: currentClass
                            });
                        } else {
                            // Standalone test method (not in a class) - add directly to file
                            if (!fileNode.children) {
                                fileNode.children = [];
                            }
                            fileNode.children.push({
                                name: methodName,
                                type: 'method',
                                uri: uri,
                                range: new vscode.Range(i, 0, i, line.length),
                                dottedPath: `${fileDottedPath}.${methodName}`,
                                parent: fileNode
                            });
                        }
                    }
                }
            }

            return fileNode.children && fileNode.children.length > 0 ? fileNode : null;
        } catch (e) {
            console.error(`Error parsing file ${uri.fsPath}:`, e);
            return null;
        }
    }

    private structureTests(nodes: TestNode[]): TestNode[] {
        const rootNodes: TestNode[] = [];

        for (const node of nodes) {
            if (!node.uri) { continue; }

            const relativePath = path.relative(this.workspaceRoot, node.uri.fsPath);
            const parts = relativePath.split(path.sep);

            let currentLevel = rootNodes;
            let currentPath = '';
            let parentNode: TestNode | undefined = undefined;

            // Iterate over directories (exclude filename)
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                currentPath = currentPath ? path.join(currentPath, part) : part;

                let folderNode = currentLevel.find(n => n.name === part && n.type === 'folder');

                if (!folderNode) {
                    // Double check if it really doesn't exist (paranoid check against race conditions or duplicates)
                    const existing = currentLevel.find(n => n.name === part && n.type === 'folder');
                    if (existing) {
                        folderNode = existing;
                    } else {
                        folderNode = {
                            name: part,
                            type: 'folder',
                            children: [],
                            uri: vscode.Uri.file(path.join(this.workspaceRoot, currentPath)),
                            dottedPath: currentPath.replace(new RegExp(path.sep.replace(/\\/g, '\\\\'), 'g'), '.'),
                            parent: parentNode
                        };
                        currentLevel.push(folderNode);
                    }
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

    private sortNodes(nodes: TestNode[]) {
        nodes.sort((a, b) => {
            // Folders first, then files
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });

        nodes.forEach(node => {
            if (node.children) {
                this.sortNodes(node.children);
            }
        });
    }

    public getNodeByDottedPath(dottedPath: string): TestNode | undefined {
        // we might need to rely on the caller to have the nodes or re-discover.
        // However, TestDiscovery doesn't store state.
        // Let's rely on TestTreeDataProvider to pass the root nodes.
        return undefined;
    }
}
