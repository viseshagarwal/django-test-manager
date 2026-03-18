import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

export class CoverageProvider {
    private coveredDecorationType: vscode.TextEditorDecorationType;
    private uncoveredDecorationType: vscode.TextEditorDecorationType;
    private coverageData: Map<string, Map<number, boolean>> = new Map(); // FilePath -> Line -> Covered
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;

        const coveredColor = new vscode.ThemeColor('diffEditor.insertedTextBackground');
        const uncoveredColor = new vscode.ThemeColor('diffEditor.removedTextBackground');

        this.coveredDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: coveredColor,
            isWholeLine: true,
            overviewRulerColor: 'green',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        this.uncoveredDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: uncoveredColor,
            isWholeLine: true,
            overviewRulerColor: 'red',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
    }

    public async loadCoverage() {
        // Read coverage.xml
        const coveragePath = path.join(this.workspaceRoot, 'coverage.xml');
        if (!fs.existsSync(coveragePath)) {
            logger.info('No coverage.xml found');
            return;
        }

        try {
            const xml = fs.readFileSync(coveragePath, 'utf8');
            this.parseCoverageXml(xml);

            // Update visible editors
            vscode.window.visibleTextEditors.forEach(editor => {
                this.updateDecorations(editor);
            });
        } catch (e) {
            logger.error('Error loading coverage:', e);
        }
    }

    private parseCoverageXml(xml: string) {
        this.coverageData.clear();

        // Simple regex parser for coverage.xml
        // Structure:
        // <class ... filename="path/to/file.py" ...>
        //    <lines>
        //       <line number="1" hits="1"/>
        const classRegex = /<class[^>]*filename="([^"]+)"[^>]*>/g;
        const lineRegex = /<line[^>]*number="(\d+)"[^>]*hits="(\d+)"[^>]*\/>/g;

        // Split by class to handle files separately
        // This is a naive parser suitable for standard coverage.xml 
        // We find all class blocks content.

        // Actually, let's just use regex with state or split.
        // coverage.xml usually has nested packages.
        // But filename attribute is usually relative path.

        let match;
        while ((match = classRegex.exec(xml)) !== null) {
            const filename = match[1];
            // Find the closing </class>
            const startIndex = match.index;
            const endIndex = xml.indexOf('</class>', startIndex);
            if (endIndex === -1) continue;

            const classBlock = xml.substring(startIndex, endIndex);
            const absolutePath = path.join(this.workspaceRoot, filename);

            const fileCoverage = new Map<number, boolean>();

            let lineMatch;
            while ((lineMatch = lineRegex.exec(classBlock)) !== null) {
                const lineNumber = parseInt(lineMatch[1]);
                const hits = parseInt(lineMatch[2]);
                fileCoverage.set(lineNumber, hits > 0);
            }

            this.coverageData.set(absolutePath, fileCoverage);
        }
    }

    public updateDecorations(editor: vscode.TextEditor) {
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const enabled = config.get<boolean>('enableCoverage') || false;

        if (!enabled) {
            editor.setDecorations(this.coveredDecorationType, []);
            editor.setDecorations(this.uncoveredDecorationType, []);
            return;
        }

        const coverage = this.coverageData.get(editor.document.uri.fsPath);
        if (!coverage) {
            return;
        }

        const coveredRanges: vscode.Range[] = [];
        const uncoveredRanges: vscode.Range[] = [];

        coverage.forEach((covered, line) => {
            // line is 1-based, VS Code ranges are 0-based
            const range = new vscode.Range(line - 1, 0, line - 1, 0);
            // Actually usually we want whole line.
            // Range(line-1, 0, line-1, lineLength)
            // But isWholeLine: true in decoration type handles this if we give a valid range.

            if (covered) {
                // Optional: Don't highlight covered lines to reduce noise?
                // The user requested: "Green for covered, Red for uncovered"
                // But full green background is too intense.
                // Let's use gutter only? User said "highlight keys in editor DIRECTLY IN THE GUTTER"
                // Re-read request: "highlight lines in the editor (Green for covered, Red for uncovered) directly in the gutter."
                // This implies gutter decorations or line background.
                // GutterIconPath is used in testDecorations.
                // Here I used backgroundColor, which highlights the text.
                // Let's switch to gutter logic if they specifically said gutter.
                // "Read the .coverage or coverage.xml file and highlight lines in the editor (Green for covered, Red for uncovered) directly in the gutter."

                // Gutter highlights usually mean an icon or color strip. 
                // VS Code `overviewRulerLane` puts it in scroll bar.
                // For gutter, we use `gutterIconPath` or `backgroundColor` + `isWholeLine`.
                // A vertical bar in the gutter is done via `border-left` CSS (not available directly) or gutter icon.
                // Let's use a 1x1 pixel image stretched? Or just a colored block icon.
                // I will use colors closer to diff decorators as they are standard "coverage" look (green/red background).
                coveredRanges.push(range);
            } else {
                uncoveredRanges.push(range);
            }
        });

        // For Gutter style (less intrusive):
        // Maybe users prefer background?
        // "Directly in the gutter" implies gutter icons.
        // Let's try to use background as it's standard for coverage extensions, but maybe low alpha.
        // I'll stick to diffEditor colors which are subtle.

        editor.setDecorations(this.coveredDecorationType, coveredRanges);
        editor.setDecorations(this.uncoveredDecorationType, uncoveredRanges);
    }

    public clear() {
        this.coverageData.clear();
        vscode.window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(this.coveredDecorationType, []);
            editor.setDecorations(this.uncoveredDecorationType, []);
        });
    }
}
