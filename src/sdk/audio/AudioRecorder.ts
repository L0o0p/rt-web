import { speechFilter, preloadModel } from '@steelbrain/media-speech-detection-web';
import { ingestAudioStream, RECOMMENDED_AUDIO_CONSTRAINTS } from './customIngestAudioStream';

export class AudioRecorder {
    private mediaStream: MediaStream | null = null;
    private audioStream: ReadableStream<Float32Array> | null = null;
    private vadTransform: TransformStream<Float32Array, Float32Array> | null = null;
    private speechProcessor: WritableStream<Float32Array> | null = null;

    // VAD控制相关属性
    private vadEnabled: boolean = false;
    private onSpeechStartCallback: (() => void) | null = null;
    private onSpeechEndCallback: ((speechAudio: Float32Array) => void) | null = null;
    private vadThreshold: number = 0.5;  // 使用推荐的阈值

    // 音频数据回调，供外部收集音频
    private onAudioDataCallback: ((audioData: Float32Array) => void) | null = null;

    constructor() {
        // 预加载VAD模型（在后台进行）
        console.log("[VAD MODEL] Preloading VAD model...");
        preloadModel().then(() => {
            console.log("[VAD MODEL] VAD model preloaded successfully");
        }).catch(error => {
            console.error('[VAD MODEL] Failed to preload VAD model:', error);
        });
    }

    /**
     * 启用或禁用VAD功能
     * @param enable 是否启用VAD
     */
    enableVAD(enable: boolean): void {
        this.vadEnabled = enable;
    }

    /**
     * 设置VAD阈值
     * @param threshold 阈值 (0-1)
     */
    setVADThreshold(threshold: number): void {
        this.vadThreshold = threshold;
    }

    /**
     * 设置VAD语音开始事件回调
     * @param callback 回调函数
     */
    setOnSpeechStartCallback(callback: (() => void) | null): void {
        console.log("AudioRecorder: Setting onSpeechStartCallback");
        this.onSpeechStartCallback = callback;
    }

    /**
     * 设置VAD语音结束事件回调
     * @param callback 回调函数
     */
    setOnSpeechEndCallback(callback: ((speechAudio: Float32Array) => void) | null): void {
        console.log("AudioRecorder: Setting onSpeechEndCallback");
        this.onSpeechEndCallback = callback;
    }

    /**
     * 设置音频数据回调，用于外部收集原始音频数据
     * @param callback 回调函数
     */
    setOnAudioDataCallback(callback: ((audioData: Float32Array) => void) | null): void {
        console.log("AudioRecorder: Setting onAudioDataCallback");
        this.onAudioDataCallback = callback;
    }

    /**
     * 获取音频流用于VAD处理
     * @param deviceId 可选的设备ID
     * @returns 音频流
     */
    async getAudioStream(deviceId?: string): Promise<ReadableStream<Float32Array>> {
        // 检查是否支持mediaDevices API
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('浏览器不支持getUserMedia API');
        }

        // 获取媒体流
        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                ...RECOMMENDED_AUDIO_CONSTRAINTS
            }
        };
        this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

        // 使用推荐的ingestAudioStream创建16kHz音频流
        console.log("[AUDIO STREAM] Creating audio stream using ingestAudioStream");
        this.audioStream = await ingestAudioStream(this.mediaStream);
        console.log("[AUDIO STREAM] Audio stream created successfully using ingestAudioStream");
        return this.audioStream!;
    }

    /**
     * 创建VAD过滤器转换流
     * @param options VAD选项
     * @returns 转换流
     */
    createVADTransform(options: {
        onSpeechStart?: () => void,
        onSpeechEnd?: (speechAudio: Float32Array) => void,
        onMisfire?: () => void,
        threshold?: number,
        noEmit?: boolean
    }): TransformStream<Float32Array, Float32Array> {
        console.log("[VAD TRANSFORM] Creating VAD transform with options:", {
            threshold: options.threshold || 0.5,
            noEmit: options.noEmit !== undefined ? options.noEmit : false,
            hasOnSpeechStart: !!options.onSpeechStart,
            hasOnSpeechEnd: !!options.onSpeechEnd,
            hasOnMisfire: !!options.onMisfire
        });

        // 包装回调函数以增加调试信息
        const wrappedCallbacks = {
            onSpeechStart: () => {
                console.log("========== RAW VAD EVENT - SPEECH START TRIGGERED ==========");
                console.log("[VAD TRANSFORM] Raw speech start event triggered");

                if (options.onSpeechStart) {
                    console.log("[VAD TRANSFORM] Calling user-provided onSpeechStart callback");
                    options.onSpeechStart();
                } else {
                    console.log("[VAD TRANSFORM] No user onSpeechStart callback provided");
                }
            },
            onSpeechEnd: (speechAudio: Float32Array) => {
                console.log("========== RAW VAD EVENT - SPEECH END TRIGGERED ==========");
                console.log("[VAD TRANSFORM] Raw speech end event triggered, audio length:", speechAudio.length);

                if (options.onSpeechEnd) {
                    console.log("[VAD TRANSFORM] Calling user-provided onSpeechEnd callback");
                    options.onSpeechEnd(speechAudio);
                } else {
                    console.log("[VAD TRANSFORM] No user onSpeechEnd callback provided");
                }
            },
            onMisfire: () => {
                console.log("========== RAW VAD EVENT - MISFIRE TRIGGERED ==========");
                console.log("[VAD TRANSFORM] Raw misfire event triggered");

                if (options.onMisfire) {
                    console.log("[VAD TRANSFORM] Calling user-provided onMisfire callback");
                    options.onMisfire();
                } else {
                    console.log("[VAD TRANSFORM] No user onMisfire callback provided");
                }
            }
        };

        console.log("[VAD TRANSFORM] Calling speechFilter with wrapped callbacks");
        console.log("[VAD TRANSFORM] Threshold value:", options.threshold || 0.5);
        console.log("[VAD TRANSFORM] noEmit value:", options.noEmit !== undefined ? options.noEmit : false);

        const result = speechFilter({
            onSpeechStart: wrappedCallbacks.onSpeechStart,
            onSpeechEnd: wrappedCallbacks.onSpeechEnd,
            onMisfire: wrappedCallbacks.onMisfire,
            threshold: options.threshold || 0.5,
            noEmit: options.noEmit !== undefined ? options.noEmit : false
        });
        console.log("[VAD TRANSFORM] speechFilter returned transform stream:", {
            readable: result.readable instanceof ReadableStream,
            writable: result.writable instanceof WritableStream
        });

        return result;
    }

    /**
     * 开始VAD音频处理
     * @param deviceId 可选的设备ID
     * @param audioDataHandler 音频数据处理回调
     */
    async startVADProcessing(
        deviceId: string | undefined,
        audioDataHandler: (audioData: Uint8Array) => void
    ): Promise<void> {
        console.log("startVADProcessing called, vadEnabled:", this.vadEnabled);
        if (!this.vadEnabled) {
            console.warn("VAD is not enabled");
            return;
        }

        console.log("[VAD SETUP] Getting audio stream for device:", deviceId || "default");
        // 获取音频流
        const audioStream = await this.getAudioStream(deviceId);
        console.log("[VAD SETUP] Got audio stream. Stream details:", {
            readable: audioStream instanceof ReadableStream,
            locked: audioStream.locked
        });

        // 创建单一的VAD转换流
        console.log("[VAD SETUP] Creating VAD transform with threshold:", this.vadThreshold);
        console.log("[VAD SETUP] Explicitly setting noEmit to false for speech collection");
        this.vadTransform = this.createVADTransform({
            onSpeechStart: this.onSpeechStartCallback || undefined,
            onSpeechEnd: this.onSpeechEndCallback || undefined,
            onMisfire: () => console.log('[VAD EVENT] ⚠️ Short speech segment filtered'),
            threshold: this.vadThreshold,
            noEmit: false  // 必须为false才能收集语音片段
        });
        console.log("[VAD SETUP] VAD transform created:", {
            readable: this.vadTransform.readable instanceof ReadableStream,
            writable: this.vadTransform.writable instanceof WritableStream
        });

        console.log("Created VAD transforms, creating speech processor");

        // 创建处理函数
        let audioChunkCount = 0;
        this.speechProcessor = new WritableStream({
            write: (audioData: Float32Array) => {
                audioChunkCount++;
                console.log("[VAD DEBUG] VAD speech processor write called with audio data length:", audioData.length);

                // 通知外部有音频数据（用于外部收集）
                if (this.onAudioDataCallback) {
                    // 创建副本以避免引用问题
                    const audioCopy = new Float32Array(audioData);
                    this.onAudioDataCallback(audioCopy);
                }

                // 每处理10个音频块就输出一次心跳日志
                if (audioChunkCount % 10 === 0) {
                    console.log("[VAD HEARTBEAT] Processed", audioChunkCount, "audio chunks so far");
                }

                // 转换为Int16Array
                const int16Data = new Int16Array(audioData.length);
                for (let i = 0; i < audioData.length; i++) {
                    const s = Math.max(-1, Math.min(1, audioData[i]));
                    int16Data[i] = s * 0x7FFF;
                }

                // 转换为Uint8Array格式
                const uint8Data = new Uint8Array(int16Data.buffer);
                console.log("Converted audio data to Uint8Array with length:", uint8Data.length);

                // 调用音频数据处理回调
                audioDataHandler(uint8Data);
            }
        });

        console.log("[VAD PIPELINE] Piping audio stream through VAD transform to speech processor");
        console.log("[VAD PIPELINE] Audio stream details:", {
            readable: audioStream instanceof ReadableStream,
            locked: audioStream.locked
        });
        console.log("[VAD PIPELINE] VAD transform details:", {
            readable: this.vadTransform?.readable instanceof ReadableStream,
            writable: this.vadTransform?.writable instanceof WritableStream
        });
        console.log("[VAD PIPELINE] Speech processor details:", {
            writable: this.speechProcessor instanceof WritableStream
        });

        // 直接将音频流通过VAD转换流管道传输到处理函数
        audioStream
            .pipeThrough(this.vadTransform)
            .pipeTo(this.speechProcessor)
            .catch(error => {
                console.error('[VAD PIPELINE] Error in VAD pipeline:', error);
            });
        console.log("[VAD PIPELINE] Started VAD pipeline");
    }

    /**
     * 停止VAD音频处理
     */
    stopVADProcessing(): void {
        console.log("[VAD STOP] Stopping VAD processing");

        // 首先停止媒体轨道以停止数据流
        if (this.mediaStream) {
            console.log("[VAD STOP] Stopping media tracks");
            this.mediaStream.getTracks().forEach(track => {
                try {
                    console.log("[VAD STOP] Stopping track:", track.kind);
                    track.stop();
                } catch (error) {
                    console.warn('[VAD STOP] Failed to stop media track:', error);
                }
            });
            this.mediaStream = null;
        }

        // 清理流引用，让它们自然关闭
        if (this.speechProcessor) {
            console.log("[VAD STOP] Clearing speech processor reference");
            // 不调用abort()，因为流可能已被锁定，让GC处理
            this.speechProcessor = null;
        }

        this.audioStream = null;
        this.vadTransform = null;

        console.log("[VAD STOP] VAD processing stopped");
    }
}