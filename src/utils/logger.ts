import { spawn } from 'child_process';
import { createWriteStream, existsSync, WriteStream } from 'fs';
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
 *
 * Every captured line is tagged `[LOG]` rather than per-stream OUT/ERR: `ora`
 * draws its spinner (including success ticks) on stderr, so a stream-based
 * severity label would mark successes as errors. The line text itself carries
 * the meaning.
 */

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'console.txt');

// ESC (0x1B) and CSI (0x9B) introducers, built from char codes so no raw
// control byte ever lives in the source.
const ANSI_INTRODUCER = '[' + String.fromCharCode(0x1B, 0x9B) + ']';

// ANSI escape sequences (colours, cursor moves, spinner show/hide).
const ANSI_PATTERN = new RegExp(ANSI_INTRODUCER + '[[\\]()#;?]*(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[0-9A-PRZcf-nqry=><]|[A-Za-z])', 'g');

// CSI cursor-column (G) / erase-line (K) redraws. Normalising these to a
// carriage return lets us keep only a spinner line's final on-screen state.
const CURSOR_RESET_PATTERN = new RegExp(ANSI_INTRODUCER + '\\[\\d*[GK]', 'g');

// Severity markers written to the log file (built from code points so no raw
// multibyte emoji ever lives in the source).
const EMOJI_SUCCESS = String.fromCodePoint(0x2705);          // ✅
const EMOJI_ERROR = String.fromCodePoint(0x274C);            // ❌
const EMOJI_WARNING = String.fromCodePoint(0x26A0, 0xFE0F);  // ⚠️
const EMOJI_INFO = String.fromCodePoint(0x2139, 0xFE0F);     // ℹ️
const MARKER_PLAIN = '[LOG]';

// Leading glyphs that `ora` / `log-symbols` emit, mapped to a severity emoji.
// Covers both the Unicode glyphs (UTF-8 terminals) and the Windows fallbacks.
const SYMBOL_EMOJI: Record<string, string> = {
    [String.fromCharCode(0x2714)]: EMOJI_SUCCESS,  // ✔
    [String.fromCharCode(0x221A)]: EMOJI_SUCCESS,  // √ (Windows)
    [String.fromCharCode(0x2716)]: EMOJI_ERROR,    // ✖
    [String.fromCharCode(0x00D7)]: EMOJI_ERROR,    // × (Windows)
    [String.fromCharCode(0x26A0)]: EMOJI_WARNING,  // ⚠
    [String.fromCharCode(0x203C)]: EMOJI_WARNING,  // ‼ (Windows)
    [String.fromCharCode(0x2139)]: EMOJI_INFO      // ℹ
};

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
 * Picks a severity marker for a captured line and returns it alongside the
 * remaining text. A leading `ora` glyph wins; otherwise a few leading keywords
 * are recognised; everything else is plain.
 */
function classifyLine(line: string): { marker: string; text: string }
{
    const emoji = SYMBOL_EMOJI[line.charAt(0)];

    if(emoji)
    {
        // Drop the glyph, a trailing variation selector (U+FE0F), then spacing.
        let rest = line.slice(1);

        if(rest.charCodeAt(0) === 0xFE0F) rest = rest.slice(1);

        return { marker: emoji, text: rest.trimStart() };
    }

    if(/^(error|invalid|failed)\b/i.test(line)) return { marker: EMOJI_ERROR, text: line };
    if(/^warn(ing)?\b/i.test(line)) return { marker: EMOJI_WARNING, text: line };

    return { marker: MARKER_PLAIN, text: line };
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
 * Spinner frames are redrawn in place (cursor/erase escapes, normalised to a
 * carriage return above) with no trailing newline, so we only flush a log line
 * on `\n`. ANSI is stripped first, then we keep just the text after the final
 * `\r` — i.e. the line's final state — so transient frames don't spam the file.
 */
function patchStream(target: NodeJS.WriteStream): void
{
    // The bound original is the only path to the real terminal from here on.
    const original = target.write.bind(target) as (...args: unknown[]) => boolean;

    let pending = '';

    const patched = (chunk: unknown, ...rest: unknown[]): boolean =>
    {
        const raw = (typeof chunk === 'string') ? chunk : (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '');

        pending += raw.replace(CURSOR_RESET_PATTERN, '\r');

        let newlineIndex: number;

        while((newlineIndex = pending.indexOf('\n')) !== -1)
        {
            const rawLine = pending.slice(0, newlineIndex);
            pending = pending.slice(newlineIndex + 1);

            // Strip colours first so a carriage return can never land mid-escape
            // and leave a fragment (e.g. a stray "39m") behind.
            const stripped = stripAnsi(rawLine);
            const carriageIndex = stripped.lastIndexOf('\r');
            const finalState = (carriageIndex !== -1) ? stripped.slice(carriageIndex + 1) : stripped;
            const clean = finalState.replace(/\s+$/, '');

            if(clean.length)
            {
                const { marker, text } = classifyLine(clean);

                writeToFile(`[${ timestamp() }] ${ marker } ${ text }`);
            }
        }

        return original(chunk, ...rest);
    };

    target.write = patched as typeof target.write;
}

function patchStreams(): void
{
    patchStream(process.stdout);
    patchStream(process.stderr);
}

/**
 * Initialises the logging system. Idempotent: safe to call more than once.
 * Should be invoked as early as possible during startup.
 */
export function initLogger(): void
{
    if(initialized) return;

    ensureDirSync(LOG_DIR);

    // Append to the existing log; prepend a UTF-8 BOM on first creation so
    // editors (Notepad) reliably decode emojis and other multibyte content.
    const isNewFile = !existsSync(LOG_FILE);

    stream = createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
    initialized = true;

    if(isNewFile) stream.write(String.fromCharCode(0xFEFF));

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
