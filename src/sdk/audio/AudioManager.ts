import { EventEmitter } from '../utils/EventEmitter';
import { AUDIO_QUALITY } from "../protocol/ClientProtocol";
import { AudioChunker } from "./AudioChunker";
import { AudioPlayer } from "./AudioPlayer";
import { AudioRecorder } from "./AudioRecorder";
import { AudioManagerLogger as logger } from '../utils/GlobalLogger';

/**
 * 音频事件类型定义
 */
export interface AudioEvents {
    'speech:start': () => void;
    'speech:end': (speechAudio: Float32Array) => void;
    'speech:misfire': () => void;
    'audio:data': (audioData: Float32Array) => void;
    'audio:processed': (processedData: Uint8Array) => void;
    'vad:enabled': (enabled: boolean) => void;
    'vad:threshold': (threshold: number) => void;
    'error': (error: Error) => void;
}

/**
 * VAD配置选项
 */
export interface VADConfig {
    enabled: boolean;
    threshold: number;
    deviceId?: string;
}

/**
 * 音频处理模块配置
 */
export interface AudioModuleConfig {
    loopback?: boolean;
    uplink?: {
        chunkSize?: number;
        encoderType?: 'opus' | 'pcm';
        onChunkProcessed: (chunk: Uint8Array) => Promise<void>;
    };
}

/**
 * 优雅的音频管理器
 *
 * 设计原则：
 * 1. 事件驱动架构，避免回调地狱
 * 2. 单一职责，每个方法只做一件事
 * 3. 组合而非继承，模块化设计
 * 4. 类型安全，完善的TypeScript支持
 * 5. 简洁的API，易于使用和测试
 * 6. 支持依赖注入，提高可测试性和灵活性
 * 7. 统一的日志管理，便于调试和监控
 * 8. 改进的错误处理机制，提高健壮性
 */
export class AudioManager extends EventEmitter {
    private recorder: AudioRecorder;
    private player: AudioPlayer | null = null;
    private chunker: AudioChunker | null = null;

    private vadConfig: VADConfig = {
        enabled: false,
        threshold: 0.5
    };

    private moduleConfig: AudioModuleConfig = {};
    private isProcessing: boolean = false;

    /**
     * 构造函数
     * @param recorder 可选的 AudioRecorder 实例，用于依赖注入
     * @param player 可选的 AudioPlayer 实例，用于依赖注入
     * @param chunker 可选的 AudioChunker 实例，用于依赖注入
     */
    constructor(recorder?: AudioRecorder, player?: AudioPlayer, chunker?: AudioChunker) {
        super();
        this.recorder = recorder || new AudioRecorder();
        this.player = player || null;
        this.chunker = chunker || null;
        this.setupRecorderEvents();
        logger.info('Initialized with event-driven architecture');
    }

    /**
     * 设置录音器事件监听
     */
    private setupRecorderEvents(): void {
        this.recorder.setOnSpeechStartCallback(() => {
            console.log('[AudioManager] Speech start detected');
            this.emit('speech:start');
        });

        this.recorder.setOnSpeechEndCallback((speechAudio: Float32Array) => {
            console.log('[AudioManager] Speech end detected, audio length:', speechAudio.length);
            this.emit('speech:end', speechAudio);
        });

        this.recorder.setOnAudioDataCallback((audioData: Float32Array) => {
            this.emit('audio:data', audioData);
        });
    }

    /**
     * 配置VAD设置和音频模块
     * @param config 配置对象，可以包含VAD配置和音频模块配置
     */
    configure(config: Partial<VADConfig & AudioModuleConfig>): this {
        // 更新VAD配置
        if (config.enabled !== undefined) {
            this.vadConfig.enabled = config.enabled;
            this.recorder.enableVAD(config.enabled);
            this.emit('vad:enabled', config.enabled);
        }

        if (config.threshold !== undefined) {
            this.vadConfig.threshold = config.threshold;
            this.recorder.setVADThreshold(config.threshold);
            this.emit('vad:threshold', config.threshold);
        }

        if (config.deviceId !== undefined) {
            this.vadConfig.deviceId = config.deviceId;
        }

        // 更新模块配置
        if (config.loopback !== undefined) {
            this.moduleConfig.loopback = config.loopback;
        }

        if (config.uplink !== undefined) {
            this.moduleConfig.uplink = config.uplink;
        }

        console.log('[AudioManager] Configuration updated:', {
            vad: this.vadConfig,
            modules: this.moduleConfig
        });

        return this;
    }

    /**
     * 启动音频处理
     * @returns 返回一个 Promise，解析为当前实例
     */
    async start(): Promise<this> {
        if (this.isProcessing) {
            console.warn('[AudioManager] Already processing, ignoring start request');
            return this;
        }

        try {
            console.log('[AudioManager] Starting audio processing');
            this.isProcessing = true;

            // 启动VAD处理
            await this.recorder.startVADProcessing(
                this.vadConfig.deviceId,
                (audioData: Uint8Array) => {
                    this.emit('audio:processed', audioData);
                    this.handleProcessedAudio(audioData);
                }
            );

            // 启动配置的模块
            if (this.moduleConfig.loopback) {
                this.startLoopback();
            }

            if (this.moduleConfig.uplink) {
                this.startUplink(this.moduleConfig.uplink);
            }

            console.log('[AudioManager] Audio processing started successfully');
            return this;

        } catch (error) {
            this.isProcessing = false;
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[AudioManager] Failed to start audio processing:', err);
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * 停止音频处理
     * @returns 返回一个 Promise，解析为当前实例
     */
    async stop(): Promise<this> {
        if (!this.isProcessing) {
            console.warn('[AudioManager] Not processing, ignoring stop request');
            return this;
        }

        try {
            console.log('[AudioManager] Stopping audio processing');

            // 停止各个模块
            this.stopLoopback();
            this.stopUplink();

            // 延迟停止VAD以确保事件完成
            await new Promise(resolve => {
                setTimeout(() => {
                    this.recorder.stopVADProcessing();
                    this.isProcessing = false;
                    resolve(void 0);
                }, 100);
            });

            console.log('[AudioManager] Audio processing stopped successfully');
            return this;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[AudioManager] Error stopping audio processing:', err);
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * 处理已处理的音频数据
     */
    private handleProcessedAudio(audioData: Uint8Array): void {
        // 音频回环播放
        if (this.moduleConfig.loopback && this.player) {
            this.player.playAudioChunk(audioData);
        }

        // 音频上传处理
        if (this.moduleConfig.uplink && this.chunker) {
            console.log('[AudioManager] Sending audio data to uplink chunker, data size:', audioData.length, 'bytes');
            this.chunker.addAudioData(audioData);
        }
    }

    /**
     * 启动音频回环播放
     */
    private startLoopback(): void {
        if (!this.player) {
            this.player = new AudioPlayer();
            logger.info('Audio loopback started');
        }
    }

    /**
     * 停止音频回环播放
     */
    private stopLoopback(): void {
        if (this.player) {
            this.player.stopPlayback();
            this.player = null;
            console.log('[AudioManager] Audio loopback stopped');
        }
    }

    /**
     * 启动音频上传处理
     */
    private startUplink(config: NonNullable<AudioModuleConfig['uplink']>): void {
        if (!this.chunker) {
            const encodeOpus = config.encoderType !== 'pcm'; // 默认使用opus编码，除非明确指定pcm
            const chunkSize = config.chunkSize || AUDIO_QUALITY.FIXED_CHUNK_SIZE;

            console.log('[AudioManager] Starting audio uplink with configuration:', {
                encoderType: config.encoderType || 'opus', // 默认显示opus
                encodeOpus: encodeOpus,
                chunkSize: chunkSize,
                hasChunkProcessor: !!config.onChunkProcessed
            });

            this.chunker = new AudioChunker(
                config.onChunkProcessed,
                chunkSize,
                encodeOpus
            );
            logger.info('Audio uplink started');
        }
    }

    /**
     * 停止音频上传处理
     */
    private stopUplink(): void {
        if (this.chunker) {
            this.chunker.stop();
            this.chunker = null;
            console.log('[AudioManager] Audio uplink stopped');
        }
    }

    /**
     * 获取当前状态
     * @returns 返回一个包含当前状态信息的对象
     */
    getStatus() {
        return {
            isProcessing: this.isProcessing,
            vadConfig: { ...this.vadConfig },
            moduleConfig: { ...this.moduleConfig },
            hasPlayer: !!this.player,
            hasChunker: !!this.chunker
        };
    }

    /**
     * 设置Opus编码
     * @param enabled 是否启用Opus编码
     * @returns 返回当前实例，支持链式调用
     */
    setOpusEncoding(enabled: boolean): this {
        this.chunker?.setEncodeOpus(enabled);
        console.log('[AudioManager] Opus encoding set to:', enabled);
        return this;
    }

    /**
     * 销毁音频管理器
     * 清理所有资源并停止音频处理
     */
    destroy(): void {
        logger.info('Destroying audio manager');

        if (this.isProcessing) {
            this.stop().catch(err =>
                logger.error('Error during destruction:', err)
            );
        }

        this.stopLoopback();
        this.stopUplink();
        this.removeAllListeners();

        logger.info('Audio manager destroyed');
    }
}

// 类型安全的事件监听器
export interface TypedAudioManager {
    on<K extends keyof AudioEvents>(event: K, listener: AudioEvents[K]): this;
    off<K extends keyof AudioEvents>(event: K, listener: AudioEvents[K]): this;
    emit<K extends keyof AudioEvents>(event: K, ...args: Parameters<AudioEvents[K]>): boolean;
}
