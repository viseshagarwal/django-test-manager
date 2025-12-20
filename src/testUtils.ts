import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Default known Django/Python test base classes
 */
const DEFAULT_TEST_BASE_CLASSES = [
    // Django
    'TestCase',
    'TransactionTestCase',
    'SimpleTestCase',
    'LiveServerTestCase',
    'StaticLiveServerTestCase',
    // Django REST Framework
    'APITestCase',
    'APISimpleTestCase',
    'APITransactionTestCase',
    // Python unittest/asyncio
    'AsyncTestCase',
    'IsolatedAsyncioTestCase',
    'unittest.TestCase',
    // pytest (common patterns)
    'TestSuite',
];

/**
 * Cached test base classes set - invalidated on configuration change
 */
let cachedTestBaseClasses: Set<string> | null = null;
let configListener: vscode.Disposable | null = null;

/**
 * Initialize configuration change listener for cache invalidation
 */
export function initTestUtilsCache(): vscode.Disposable {
    if (!configListener) {
        configListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('djangoTestManager.testBaseClasses')) {
                cachedTestBaseClasses = null;
            }
        });
    }
    return configListener;
}

/**
 * Get the set of test base classes, including user-configured ones.
 * Results are cached until configuration changes.
 */
export function getTestBaseClasses(): Set<string> {
    if (cachedTestBaseClasses) {
        return cachedTestBaseClasses;
    }

    const config = vscode.workspace.getConfiguration('djangoTestManager');
    const customBaseClasses = config.get<string[]>('testBaseClasses') || [];

    cachedTestBaseClasses = new Set([...DEFAULT_TEST_BASE_CLASSES, ...customBaseClasses]);
    return cachedTestBaseClasses;
}

/**
 * Pre-compiled regex for extracting base classes - more efficient than creating new regex each time
 */
const BASE_CLASS_REGEX = /class\s+\w+\s*\(([^)]+)\)/;

/**
 * Check if a class is a test class based on:
 * 1. Class name starts with "Test"
 * 2. Class inherits from a known test base class
 *
 * @param className The name of the class
 * @param baseClasses Optional comma-separated string of base classes or an array
 * @returns true if the class is a test class
 */
export function isTestClass(className: string, baseClasses?: string | string[]): boolean {
    // Fast path: Check if class name starts with "Test"
    if (className.length >= 4 && className[0] === 'T' && className[1] === 'e' &&
        className[2] === 's' && className[3] === 't') {
        return true;
    }

    // Check inheritance
    if (baseClasses) {
        const testBaseClasses = getTestBaseClasses();
        const bases = typeof baseClasses === 'string'
            ? baseClasses.split(',')
            : baseClasses;

        for (let i = 0; i < bases.length; i++) {
            const baseClass = bases[i].trim();
            // Extract the class name from qualified names (e.g., "django.test.TestCase" -> "TestCase")
            const lastDotIndex = baseClass.lastIndexOf('.');
            const baseClassName = lastDotIndex >= 0 ? baseClass.substring(lastDotIndex + 1) : baseClass;

            if (testBaseClasses.has(baseClassName)) {
                return true;
            }

            // Also check if base class starts with "Test" (e.g., TestMixin, TestBase)
            if (baseClassName.length >= 4 && baseClassName[0] === 'T' && baseClassName[1] === 'e' &&
                baseClassName[2] === 's' && baseClassName[3] === 't') {
                return true;
            }
        }
    }

    return false;
}

/**
 * Extract base classes from a Python class definition line
 *
 * @param line The line containing the class definition
 * @returns Array of base class names, or undefined if no inheritance found
 */
export function extractBaseClasses(line: string): string[] | undefined {
    const inheritanceMatch = BASE_CLASS_REGEX.exec(line);
    if (inheritanceMatch) {
        return inheritanceMatch[1].split(',');
    }
    return undefined;
}

/**
 * Check if a class definition line represents a test class
 *
 * @param className The name of the class
 * @param line The full line containing the class definition
 * @returns true if the class is a test class
 */
export function isTestClassFromLine(className: string, line: string): boolean {
    // Fast path: Check if class name starts with "Test"
    if (className.length >= 4 && className[0] === 'T' && className[1] === 'e' &&
        className[2] === 's' && className[3] === 't') {
        return true;
    }

    const baseClasses = extractBaseClasses(line);
    return isTestClass(className, baseClasses);
}

/**
 * Clear all caches - useful for testing or manual refresh
 */
export function clearTestUtilsCache(): void {
    cachedTestBaseClasses = null;
}

/**
 * Reads and parses a .env file
 * @param envFilePath Path to the .env file
 * @returns Object with environment variables from the file
 */
async function readEnvFile(envFilePath: string): Promise<{ [key: string]: string }> {
    const envVars: { [key: string]: string } = {};

    try {
        if (!fs.existsSync(envFilePath)) {
            return envVars;
        }

        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(envFilePath));
        const lines = content.toString().split('\n');

        for (const line of lines) {
            // Remove leading/trailing whitespace
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Parse KEY=VALUE format
            const equalIndex = trimmed.indexOf('=');
            if (equalIndex === -1) {
                continue;
            }

            const key = trimmed.substring(0, equalIndex).trim();
            let value = trimmed.substring(equalIndex + 1).trim();

            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (key) {
                envVars[key] = value;
            }
        }
    } catch (error) {
        console.error(`Error reading .env file at ${envFilePath}:`, error);
    }

    return envVars;
}

/**
 * Merges environment variables from multiple sources in priority order:
 * 1. Process environment variables (lowest priority)
 * 2. .env file variables (middle priority)
 * 3. Configuration environmentVariables (highest priority)
 * @param workspaceRoot Root path of the workspace/project
 * @returns Merged environment variables object
 */
export async function getMergedEnvironmentVariables(workspaceRoot: string): Promise<{ [key: string]: string }> {
    const config = vscode.workspace.getConfiguration('djangoTestManager');
    const configEnv = config.get<{ [key: string]: string }>('environmentVariables') || {};
    const envFilePath = config.get<string>('envFilePath') || '.env';

    // Start with process environment variables (filter out undefined values)
    const mergedEnv: { [key: string]: string } = {};
    for (const key in process.env) {
        const value = process.env[key];
        if (value !== undefined) {
            mergedEnv[key] = value;
        }
    }

    // Load from .env file if path is specified
    if (envFilePath) {
        const fullEnvPath = resolvePath(envFilePath, workspaceRoot);
        const envFileVars = await readEnvFile(fullEnvPath);
        // Merge .env file variables (overrides process.env)
        Object.assign(mergedEnv, envFileVars);
    }

    // Merge configuration variables (overrides .env file and process.env)
    Object.assign(mergedEnv, configEnv);

    return mergedEnv;
}

/**
 * Resolves a path that may contain variable substitutions like ${workspaceFolder}
 * Supports:
 * - Variable substitution: ${workspaceFolder}/path/to/file
 * - Absolute paths: /absolute/path/to/file
 * - Relative paths: relative/path/to/file (resolved relative to workspaceRoot)
 * @param pathValue The path value from configuration
 * @param workspaceRoot The workspace root path
 * @returns Resolved absolute path
 */
export function resolvePath(pathValue: string, workspaceRoot: string, defaultPath?: string): string {
    if (!pathValue) {
        return defaultPath ? path.join(workspaceRoot, defaultPath) : workspaceRoot;
    }

    // Get workspace folder for variable substitution
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || vscode.workspace.rootPath || workspaceRoot;

    // Replace ${workspaceFolder} variable
    let resolvedPath = pathValue.replace(/\$\{workspaceFolder\}/g, workspaceFolder);

    // If it's already an absolute path, return it as-is
    if (path.isAbsolute(resolvedPath)) {
        return resolvedPath;
    }

    // Otherwise, resolve it relative to workspaceRoot
    return path.resolve(workspaceRoot, resolvedPath);
}
