import { mkdirSync } from 'fs';
import { mkdir } from 'fs/promises';

/**
 * Modern fs helpers used across the project. Thin wrappers over the built-in
 * Node `fs` APIs so call sites stay consistent and avoid deprecated patterns.
 */

/**
 * Ensures a directory exists, creating it (and any missing parents)
 * synchronously. Safe to call repeatedly. Used during startup where async is
 * not yet available (e.g. logger bootstrap).
 */
export function ensureDirSync(path: string): void
{
    mkdirSync(path, { recursive: true });
}

/**
 * Async variant of {@link ensureDirSync}. Returns the resolved path of the
 * first created directory, or `undefined` if it already existed.
 */
export async function ensureDir(path: string): Promise<string | undefined>
{
    return mkdir(path, { recursive: true });
}
