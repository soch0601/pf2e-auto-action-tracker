import { logError, logInfo } from "./logger.ts";

// string is the combatant ID.
const _queues = new Map<string, Promise<void>>();

export function enqueueAction(combatantId: string, actionFn: () => Promise<void>): Promise<void> {
    const existingPromise = _queues.get(combatantId);

    const startPromise = existingPromise || Promise.resolve();

    const newPromise = startPromise.then(async () => {
        try {
            const start = performance.now();
            await actionFn();
            const end = performance.now();

            // LOGGING: Performance check - also useful stat to know if people still have trouble with this
            if ((end - start) > 100) {
                logInfo(`Action Tracker | Slow Operation: ${combatantId} took ${Math.round(end - start)}ms`);
            }
        } catch (err) {
            logError("Action Tracker | Queue Error:", err);
        } finally {
            // Drop the entry once it settles, but only if no later enqueueAction has replaced the head.
            // Without this, the map accumulates one resolved Promise per combatant ever queued, growing
            // unboundedly across long sessions.
            if (_queues.get(combatantId) === newPromise) {
                _queues.delete(combatantId);
            }
        }
    });

    _queues.set(combatantId, newPromise);

    return newPromise;
}

export async function waitForQueue(combatantId: string) {
    const existingPromise = _queues.get(combatantId);
    if (existingPromise) await existingPromise;
}
