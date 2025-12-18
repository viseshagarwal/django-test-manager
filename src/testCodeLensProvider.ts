import * as vscode from 'vscode';
import * as path from 'path';

export class DjangoTestCodeLensProvider implements vscode.CodeLensProvider {
    constructor(private workspaceRoot: string) { }

    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Check if file is a valid test file:
        // 1. File is in tests directory/package, OR
        // 2. File is named test.py or tests.py
        const relativePath = path.relative(this.workspaceRoot, document.uri.fsPath);
        const pathParts = relativePath.split(path.sep);
        const fileName = path.basename(document.uri.fsPath);
        const isInTestsDirectory = pathParts.some(part => part === 'tests' || part === 'test');
        const isTestFile = fileName === 'test.py' || fileName === 'tests.py';
        
        if (!isInTestsDirectory && !isTestFile) {
            return codeLenses; // Not a test file, return empty
        }

        // Ensure we don't have leading dots if file is in root
        const cleanRelativePath = relativePath.startsWith(path.sep) ? relativePath.substring(1) : relativePath;
        const fileDottedPath = cleanRelativePath.replace(/\.py$/, '').split(path.sep).join('.');

        const classRegex = /^class\s+(\w+)/;

        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const methodPrefix = config.get<string>('testMethodPattern') || 'test_';
        const methodRegex = new RegExp(`^\\s+(?:async\\s+)?def\\s+(${methodPrefix}\\w+)`);

        let currentClassName: string | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip commented lines (basic check)
            if (line.trim().startsWith('#')) continue;

            const range = new vscode.Range(i, 0, i, line.length);

            const classMatch = line.match(classRegex);
            if (classMatch) {
                const className = classMatch[1];
                // Only show code lenses for classes that start with "Test"
                if (className.startsWith('Test')) {
                    currentClassName = className;
                    const dottedPath = `${fileDottedPath}.${currentClassName}`;
                    const runCmd = {
                        title: '$(play) Run Test Class',
                        command: 'django-test-manager.runTest',
                        arguments: [{
                            name: currentClassName,
                            type: 'class',
                            dottedPath: dottedPath,
                            uri: document.uri
                        }]
                    };
                    const debugCmd = {
                        title: '$(debug-alt) Debug Test Class',
                        command: 'django-test-manager.debugTest',
                        arguments: [{
                            name: currentClassName,
                            type: 'class',
                            dottedPath: dottedPath,
                            uri: document.uri
                        }]
                    };
                    codeLenses.push(new vscode.CodeLens(range, runCmd));
                    codeLenses.push(new vscode.CodeLens(range, debugCmd));
                } else {
                    currentClassName = null; // Reset if class doesn't start with Test
                }
                continue;
            }

            const methodMatch = line.match(methodRegex);
            if (methodMatch) {
                const methodName = methodMatch[1];
                if (currentClassName) {
                    // Method inside a Test class
                    const dottedPath = `${fileDottedPath}.${currentClassName}.${methodName}`;
                    const runCmd = {
                        title: '$(play) Run Test',
                        command: 'django-test-manager.runTest',
                        arguments: [{
                            name: methodName,
                            type: 'method',
                            dottedPath: dottedPath,
                            uri: document.uri
                        }]
                    };
                    const debugCmd = {
                        title: '$(debug-alt) Debug Test',
                        command: 'django-test-manager.debugTest',
                        arguments: [{
                            name: methodName,
                            type: 'method',
                            dottedPath: dottedPath,
                            uri: document.uri
                        }]
                    };
                    codeLenses.push(new vscode.CodeLens(range, runCmd));
                    codeLenses.push(new vscode.CodeLens(range, debugCmd));
                } else {
                    // Standalone test method (not in a class)
                    const dottedPath = `${fileDottedPath}.${methodName}`;
                    const runCmd = {
                        title: '$(play) Run Test',
                        command: 'django-test-manager.runTest',
                        arguments: [{
                            name: methodName,
                            type: 'method',
                            dottedPath: dottedPath,
                            uri: document.uri
                        }]
                    };
                    const debugCmd = {
                        title: '$(debug-alt) Debug Test',
                        command: 'django-test-manager.debugTest',
                        arguments: [{
                            name: methodName,
                            type: 'method',
                            dottedPath: dottedPath,
                            uri: document.uri
                        }]
                    };
                    codeLenses.push(new vscode.CodeLens(range, runCmd));
                    codeLenses.push(new vscode.CodeLens(range, debugCmd));
                }
            }
        }

        return codeLenses;
    }
}
