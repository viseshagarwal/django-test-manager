import * as vscode from 'vscode';
import * as cp from 'child_process';

export class DjangoTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidClose: vscode.Event<number> = this.closeEmitter.event;

    private process: cp.ChildProcess | undefined;

    constructor() { }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('Django Test Terminal Ready\r\n');
    }

    close(): void {
        if (this.process) {
            this.process.kill();
        }
    }

    handleInput(data: string): void {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(data);
        }
    }

    public runCommand(
        cmd: string,
        args: string[],
        cwd: string,
        env: NodeJS.ProcessEnv,
        onData: (data: string) => void,
        onExit: (code: number) => void
    ) {
        if (this.process) {
            this.process.kill();
            this.writeEmitter.fire('\r\n--- Restarting Test Run ---\r\n');
        } else {
            this.writeEmitter.fire('\r\n--- Starting Test Run ---\r\n');
        }

        // Display the full command for user visibility
        const fullCmd = `${cmd} ${args.join(' ')}`;
        this.writeEmitter.fire(`Running: ${fullCmd}\r\n\r\n`);

        this.process = cp.spawn(cmd, args, {
            cwd: cwd,
            env: env,
            shell: false
        });

        const filterOutput = (data: string): string => {
            return data
                .replace(/^.* \.\.\. ok\r?\n/gm, '.')
                .replace(/^.* \.\.\. skipped.*\r?\n/gm, 's');
        };

        this.process.stdout?.on('data', (data) => {
            const str = data.toString();
            // Send to parser (raw)
            onData(str);
            // Send to terminal (filtered)
            this.writeEmitter.fire(filterOutput(str).replace(/\n/g, '\r\n'));
        });

        this.process.stderr?.on('data', (data) => {
            const str = data.toString();
            onData(str);
            this.writeEmitter.fire(filterOutput(str).replace(/\n/g, '\r\n'));
        });

        this.process.on('exit', (code) => {
            this.writeEmitter.fire(`\r\nProcess exited with code ${code}\r\n`);
            this.process = undefined;
            onExit(code || 0);
        });

        this.process.on('error', (err) => {
            this.writeEmitter.fire(`\r\nError: ${err.message}\r\n`);
            this.process = undefined;
            onExit(1);
        });
    }

    public sendSignal(signal: NodeJS.Signals = 'SIGINT') {
        if (this.process) {
            this.process.kill(signal);
        }
    }
}
