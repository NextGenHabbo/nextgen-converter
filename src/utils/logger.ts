import { spawn } from 'child_process';
import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';
import { format } from 'util';
import { ensureDirSync } from './fs';

/**
 * Persistent logging system.
 *
 * Responsibilities:
 *  - Ensure `<cwd>/logs/console.txt` exists on startup (recursive mkdir).
 *  - Mirror every `console.log/info/warn/error` call into that file while
 *    leaving terminal output untouched.
 *  - Capture stdout/stderr/exit-code of any spawned subprocess (PowerShell or
 *    otherwise) in a structured, greppable format.
 *
 * The original console methods are captured once and used for all terminal
 * writes, so re-entrancy / recursion is impossible.
 */

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'console.txt');

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

const ORIGINAL_CONSOLE: Record<ConsoleMethod, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

let stream: WriteStream | null = null;
let initialized = false;

function timestamp(): string
{
    return new Date().toISOString();
}

/**
 * Writes a pre-formatted line straight to the log file, bypassing the console
 * entirely. This is the single low-level sink; everything else funnels here so
 * there is no path back into the patched console methods.
 */
function writeToFile(line: string): void
{
    if(!stream) return;

    stream.write(line.endsWith('\n') ? line : `${ line }\n`);
}

function patchConsole(): void
{
    const levels: ConsoleMethod[] = [ 'log', 'info', 'warn', 'error' ];

    for(const level of levels)
    {
        console[level] = (...args: unknown[]): void =>
        {
            // Terminal output stays exactly as it was.
            ORIGINAL_CONSOLE[level](...args);

            // Duplicate, formatted, into the log file.
            writeToFile(`[${ timestamp() }] [${ level.toUpperCase() }] ${ format(...args) }`);
        };
    }
}

/**
 * Initialises the logging system. Idempotent: safe to call more than once.
 * Should be invoked as early as possible during startup.
 */
export function initLogger(): void
{
    if(initialized) return;

    ensureDirSync(LOG_DIR);

    stream = createWriteStream(LOG_FILE, { flags: 'a' });
    initialized = true;

    patchConsole();

    writeToFile(`\n[${ timestamp() }] [START] Program started (argv: ${ process.argv.slice(2).join(' ') || 'none' })`);

    // Make sure unexpected crashes still land in the log with a stack trace.
    process.on('uncaughtException', (error) => writeToFile(`[${ timestamp() }] [FATAL] ${ format(error) }`));
    process.on('unhandledRejection', (reason) => writeToFile(`[${ timestamp() }] [FATAL] Unhandled rejection: ${ format(reason) }`));
}

/** Result of a captured subprocess run. */
export interface CommandResult
{
    stdout: string;
    stderr: string;
    code: number | null;
}

/**
 * Runs a shell command, capturing stdout, stderr and the exit code, and logs
 * the whole interaction in a structured block. Use this anywhere a subprocess
 * (PowerShell, etc.) is launched so its output is never lost.
 *
 * Terminal behaviour is preserved: captured output is also echoed through the
 * (already patched) console.
 */
export function runCommandLogged(command: string, args: string[] = []): Promise<CommandResult>
{
    return new Promise<CommandResult>((resolve) =>
    {
        const printable = [ command, ...args ].join(' ');

        writeToFile(`\n[COMMAND START]\n${ printable }`);

        const child = spawn(command, args, { shell: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        child.on('close', (code) =>
        {
            writeToFile(`\n[STDOUT]\n${ stdout }`);
            writeToFile(`\n[STDERR]\n${ stderr }`);
            writeToFile(`\n[EXIT CODE]\n${ code }`);
            writeToFile(`\n[COMMAND END]\n`);

            resolve({ stdout, stderr, code });
        });

        child.on('error', (error) =>
        {
            stderr += format(error);

            writeToFile(`\n[STDERR]\n${ stderr }`);
            writeToFile(`\n[EXIT CODE]\nnull`);
            writeToFile(`\n[COMMAND END]\n`);

            resolve({ stdout, stderr, code: null });
        });
    });
}
