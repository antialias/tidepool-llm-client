import type { StreamMiddleware } from "../middleware.js";
/**
 * Options for the persistence middleware.
 */
export interface PersistenceOptions {
    /**
     * Interval between snapshots in milliseconds.
     * @default 3000
     */
    snapshotIntervalMs?: number;
    /**
     * Called on each reasoning event (for transient emission).
     * @param text - The reasoning text (delta or full)
     * @param isDelta - Whether this is a delta (partial) or complete text
     * @param accumulated - The full accumulated reasoning text so far
     */
    onReasoning?: (text: string, isDelta: boolean, accumulated: string) => void;
    /**
     * Called on each output_delta event (for transient emission).
     * @param text - The output delta text
     * @param accumulated - The full accumulated output text so far
     */
    onOutputDelta?: (text: string, accumulated: string) => void;
    /**
     * Called periodically with accumulated reasoning (for persistence).
     * @param text - The full accumulated reasoning text
     */
    onReasoningSnapshot?: (text: string) => void | Promise<void>;
    /**
     * Called periodically with accumulated output (for persistence).
     * @param text - The full accumulated output text
     */
    onOutputSnapshot?: (text: string) => void | Promise<void>;
}
/**
 * Create a middleware that accumulates streaming text and triggers callbacks.
 *
 * This middleware:
 * - Accumulates reasoning and output text as events flow through
 * - Calls per-event callbacks (for transient Socket.IO emission)
 * - Periodically calls snapshot callbacks (for DB persistence)
 * - Calls final snapshot on stream completion
 *
 * @example
 * ```typescript
 * const middleware = createPersistenceMiddleware({
 *   snapshotIntervalMs: 3000,
 *   onReasoning: (text, isDelta, accumulated) => {
 *     socket.emit('reasoning', { text, isDelta })
 *   },
 *   onReasoningSnapshot: async (text) => {
 *     await db.update({ reasoningText: text })
 *   },
 * })
 *
 * const clientWithPersistence = client.with(middleware)
 * ```
 */
export declare function createPersistenceMiddleware(options: PersistenceOptions): StreamMiddleware;
//# sourceMappingURL=persistence.d.ts.map