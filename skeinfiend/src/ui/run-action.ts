/**
 * Runs what a click started, where nothing waits on the result: a failure
 * (the browser's storage refusing a write, say) is logged, not lost.
 */
export function runAction(action: () => Promise<unknown>): void {
  action().catch((error: unknown) => console.error(error))
}
