import type { LogLevel, LoggingConfig } from "./types.js";
/**
 * Internal logger that respects configuration
 */
export declare class Logger {
    private readonly config;
    private readonly logger;
    private readonly minLevelPriority;
    constructor(config?: LoggingConfig);
    /**
     * Check if logging is enabled
     */
    get enabled(): boolean;
    /**
     * Create a child logger with override for enabled state
     * Used for per-request debug overrides
     */
    withEnabled(enabled: boolean | undefined): Logger;
    /**
     * Log a message if logging is enabled and level is at or above minimum
     */
    log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
    /** Log at debug level */
    debug(message: string, data?: Record<string, unknown>): void;
    /** Log at info level */
    info(message: string, data?: Record<string, unknown>): void;
    /** Log at warn level */
    warn(message: string, data?: Record<string, unknown>): void;
    /** Log at error level */
    error(message: string, data?: Record<string, unknown>): void;
}
//# sourceMappingURL=logger.d.ts.map