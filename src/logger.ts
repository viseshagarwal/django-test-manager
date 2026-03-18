import * as vscode from 'vscode';

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Django Test Manager Log');
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public info(message: string): void {
        this.log('INFO', message);
    }

    public warn(message: string): void {
        this.log('WARN', message);
    }

    public error(message: string, error?: any): void {
        if (error) {
            this.log('ERROR', `${message} ${error instanceof Error ? error.stack || error.message : JSON.stringify(error)}`);
        } else {
            this.log('ERROR', message);
        }
    }

    public debug(message: string): void {
        this.log('DEBUG', message);
    }

    public show(): void {
        this.outputChannel.show();
    }

    private log(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }
}

export const logger = Logger.getInstance();
