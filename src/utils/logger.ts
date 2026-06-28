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
 *  - Mirror EVERYTHING written to stdout/stderr into that file while leaving
 *    terminal output untouched. Intercepting at the stream level (rather than
 *    `console.*`) means `ora` spinner ticks, success marks and any third-party
 *    direct writes are captured too — not just `console` calls.
 *  - Capture stdout/stderr/exit-code of any spawned subprocess (PowerShell or
 *    otherwise) in a structured, greppable format.
 *
 * The file is a separate WriteStream (its own fd), so mirroring never loops
 * back through the patched stdout/stderr writers — no recursion.
 */

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'console.txt');

// CSI cursor-column (G) and erase-line (K) sequences used by spinner redraws;
// normalising these to a carriage return lets us keep only a frame's final state.
// eslint-disable-next-line no-control-regex
const CURSOR_RESET_PATTERN = new RegExp('[\u001B\u009B]\[\d*[GK]', 'g');

// Matches ANSI escape sequences (colours, cursor moves, spinner show/hide).
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = new RegExp('[\u001B\u009B][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-PRZcf-nqry=><]|[A-Za-z])', 'g');

let stream: WriteStream | null = null;
let initialized = false;

function timestamp(): string
{
    return new Date().toISOString();
}

function stripAnsi(value: string): string
{
    return value.replace(ANSI_PATTERN, '');
}

/**
 * Writes a pre-formatted line straight to the log file's own stream. This is
 * the single low-level sink; it never touches stdout/stderr, so the patched
 * writers below can't recurse into it.
 */
function writeToFile(line: string): void
{
    if(!stream) return;

    stream.write(line.endsWith('\n') ? line : `${ line }\n`);
}

/**
 * Wraps a writable stream's `write` so the terminal still receives the exact
 * original bytes, while a cleaned, line-buffered copy is appended to the log.
 *
 * Spinner frames are redrawn in place using carriage returns with no trailing
 * newline, so we only flush a log line when a `\n` is seen and keep just the
 * text after the final `\r` — i.e. the line's final on-screen state. Transient
 * intermediate frames are therefore collapsed instead of spamming the file.
 */
function patchStream(target: NodeJS.WriteStream, label: string): void
{
    // The bound original is the only path to the real terminal from here on.
    const original = target.write.bind(target) as (...args: unknown[]) => boolean;

    let pending = '';

    const patched = (chunk: unknown, ...rest: unknown[]): boolean =>
    {
        const raw = (typeof chunk === 'string') ? chunk : (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '');

        // Spinners redraw in place with "cursor to column" (CSI G) and
        // "erase line" (CSI K) escapes rather than carriage returns. Treat
        // those as a carriage return so only the line's final state is logged.
        const text = raw.replace(CURSOR_RESET_PATTERN, '\r');

        pending += text;

        let newlineIndex: number;

        while((newlineIndex = pending.indexOf('\n')) !== -1)
        {
            let line = pending.slice(0, newlineIndex);
            pending = pending.slice(newlineIndex + 1);

            const carriageIndex = line.lastIndexOf('\r');

            if(carriageIndex !== -1) line = line.slice(carriageIndex + 1);

            const clean = stripAnsi(line).replace(/\s+$/, '');

            if(clean.length) writeToFile(`[${ timestamp() }] [${ label }] ${ clean }`);
        }

        return original(chunk, ...rest);
    };

    target.write = patched as typeof target.write;
}

function patchStreams(): void
{
    patchStream(process.stdout, 'OUT');
    patchStream(process.stderr, 'ERR');
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

    patchStreams();
    filterDeprecationWarnings();

    writeToFile(`\n[${ timestamp() }] [START] Program started (argv: ${ process.argv.slice(2).join(' ') || 'none' })`);

    // Make sure unexpected crashes still land in the log with a stack trace.
    process.on('uncaughtException', (error) => writeToFile(`[${ timestamp() }] [FATAL] ${ format(error) }`));
    process.on('unhandledRejection', (reason) => writeToFile(`[${ timestamp() }] [FATAL] Unhandled rejection: ${ format(reason) }`));
}

/**
 * Deprecation warning codes emitted by abandoned transitive dependencies that
 * we cannot upgrade. These are harmless noise; we swallow exactly these and
 * still surface every other warning.
 *
 *  - DEP0060: `util._extend` -> used by `proxying-agent` (via `tinify`).
 */
const SUPPRESSED_WARNING_CODES = new Set<string>([ 'DEP0060' ]);

/**
 * Replaces Node's default `warning` handler with one that drops a small
 * allow-list of known-harmless deprecation codes and logs everything else
 * through `console.warn` (so it still lands in the log file).
 */
function filterDeprecationWarnings(): void
{
    // Removing the internal listener stops Node printing every warning twice.
    process.removeAllListeners('warning');

    process.on('warning', (warning: Error & { code?: string }) =>
    {
        if(warning.code && SUPPRESSED_WARNING_CODES.has(warning.code)) return;

        console.warn(warning.stack ?? warning.message);
    });
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
 * (already patched) stdout/stderr.
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
