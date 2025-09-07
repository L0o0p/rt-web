/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 统一日志管理器
 * 用于处理所有与音频相关的日志记录
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
    prefix?: string;
    level?: LogLevel;
}

export class Logger {
    private prefix: string;
    private level: LogLevel;

    private static LOG_LEVELS: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3
    };

    constructor(options: LoggerOptions = {}) {
        this.prefix = options.prefix || '';
        this.level = options.level || 'info';
    }

    private shouldLog(level: LogLevel): boolean {
        return Logger.LOG_LEVELS[level] >= Logger.LOG_LEVELS[this.level];
    }

    private formatMessage(message: string): string {
        return this.prefix ? `[${this.prefix}] ${message}` : message;
    }

    debug(message: string, ...optionalParams: any[]): void {
        if (this.shouldLog('debug')) {
            console.debug(this.formatMessage(message), ...optionalParams);
        }
    }

    info(message: string, ...optionalParams: any[]): void {
        if (this.shouldLog('info')) {
            console.info(this.formatMessage(message), ...optionalParams);
        }
    }

    warn(message: string, ...optionalParams: any[]): void {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage(message), ...optionalParams);
        }
    }

    error(message: string, ...optionalParams: any[]): void {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage(message), ...optionalParams);
        }
    }
}

// 创建预定义的日志管理器实例
export const AudioManagerLogger = new Logger({ prefix: 'AudioManager' });
export const AudioRecorderLogger = new Logger({ prefix: 'AudioRecorder' });
export const AudioPlayerLogger = new Logger({ prefix: 'AudioPlayer' });
export const AudioChunkerLogger = new Logger({ prefix: 'AudioChunker' });