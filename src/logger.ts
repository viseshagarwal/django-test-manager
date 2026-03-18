import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

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
        const formattedMessage = `[${timestamp}] [${level}] ${message}`;
        this.outputChannel.appendLine(formattedMessage);

        this.sendToCloud(level, message, timestamp);
    }

    private sendToCloud(level: string, message: string, timestamp: string): void {
        const config = vscode.workspace.getConfiguration('djangoTestManager');
        const cloudLogEnable = config.get<boolean>('cloudLogEnable') || false;
        const cloudLogEndpoint = config.get<string>('cloudLogEndpoint') || '';

        if (!cloudLogEnable || !cloudLogEndpoint) {
            return;
        }

        try {
            const url = new URL(cloudLogEndpoint);
            const payload = JSON.stringify({
                timestamp,
                level,
                message,
                source: 'django-test-manager'
            });

            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const reqModule = url.protocol === 'https:' ? https : http;

            const req = reqModule.request(options, (res) => {
                // Ignore response, we just want to send the log
                res.on('data', () => {});
                res.on('end', () => {});
            });

            req.on('error', (_e) => {
                // Silently ignore cloud logging errors to avoid spamming the local log
                // if the cloud endpoint is down.
            });

            req.write(payload);
            req.end();
        } catch {
            // Silently ignore URL parsing errors, etc.
        }
    }
}

export const logger = Logger.getInstance();
