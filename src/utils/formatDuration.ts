/**
 * Formats a millisecond duration into a compact, human-readable string.
 *
 * Rules:
 *  - >= 1 hour   -> `Xh Ym Zs`
 *  - >= 1 minute -> `Xm Ys`
 *  - <  1 minute -> `Xs`
 *  - <  1 second -> `0s`
 *
 * Examples:
 *  - formatDuration(7509000) === '2h 5m 9s'
 *  - formatDuration(252000)  === '4m 12s'
 *  - formatDuration(45000)   === '45s'
 *  - formatDuration(0)       === '0s'
 */
export function formatDuration(ms: number): string
{
    if(!Number.isFinite(ms) || ms < 0) ms = 0;

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if(hours >= 1) return `${ hours }h ${ minutes }m ${ seconds }s`;
    if(minutes >= 1) return `${ minutes }m ${ seconds }s`;

    return `${ seconds }s`;
}
