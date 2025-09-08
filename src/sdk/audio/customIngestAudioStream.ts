export const RECOMMENDED_AUDIO_CONSTRAINTS = Object.freeze({
    sampleRate: 16000,
    channelCount: 1,
    // WebRTC 内置音频处理功能 - 回声消除、噪声抑制、自动增益控制
    echoCancellation: true,        // 启用回声消除
    noiseSuppression: true,        // 启用噪声抑制
    autoGainControl: true,         // 启用自动增益控制
});

/**
 * 高级音频约束配置，提供更精细的控制
 */
export const ADVANCED_AUDIO_CONSTRAINTS = Object.freeze({
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: { exact: true },    // 强制启用回声消除
    noiseSuppression: { exact: true },    // 强制启用噪声抑制
    autoGainControl: { exact: true },     // 强制启用自动增益控制
    // 可选的高级设置
    // echoCancellationType: 'system',    // 'browser' | 'system' - 回声消除类型
    // latency: 0.01,                     // 低延迟设置（10ms）
});

/**
 * 自定义的 ingestAudioStream 实现，解决 Vite 中 AudioWorklet 模块加载问题
 */
/**
 * WebRTC 音频处理选项
 */
export interface WebRTCAudioOptions {
    gain?: number;
    channelId?: number;
    sampleRate?: number;
    // WebRTC 回声消除相关选项
    echoCancellation?: boolean | { exact: boolean };
    noiseSuppression?: boolean | { exact: boolean };
    autoGainControl?: boolean | { exact: boolean };
    // echoCancellationType?: 'browser' | 'system';
    enableAdvancedProcessing?: boolean;  // 是否使用高级音频约束
}

/**
 * 创建带有 WebRTC 回声消除功能的音频流
 * @param deviceId 音频设备ID
 * @param options WebRTC音频选项
 * @returns 处理后的音频流
 */
export async function createWebRTCAudioStream(
    deviceId?: string,
    options: WebRTCAudioOptions = {}
): Promise<{ mediaStream: MediaStream; audioStream: ReadableStream<Float32Array> }> {
    // 构建音频约束
    const audioConstraints = {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        ...(options.enableAdvancedProcessing ? ADVANCED_AUDIO_CONSTRAINTS : RECOMMENDED_AUDIO_CONSTRAINTS),
        // 允许通过选项覆盖默认设置
        ...(options.echoCancellation !== undefined && { echoCancellation: options.echoCancellation }),
        ...(options.noiseSuppression !== undefined && { noiseSuppression: options.noiseSuppression }),
        ...(options.autoGainControl !== undefined && { autoGainControl: options.autoGainControl }),
    };

    console.log('[WebRTC Audio] Creating audio stream with constraints:', audioConstraints);

    // 获取媒体流
    const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
    });

    // 验证约束是否被正确应用
    const audioTrack = mediaStream.getAudioTracks()[0];
    if (audioTrack) {
        const settings = audioTrack.getSettings();
        console.log('[WebRTC Audio] Applied audio settings:', {
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount
        });

        // 检查是否成功启用了回声消除
        if (settings.echoCancellation) {
            console.log('✅ [WebRTC Audio] Echo cancellation is ENABLED');
        } else {
            console.warn('⚠️ [WebRTC Audio] Echo cancellation is NOT enabled - this may affect audio quality');
        }
    }

    // 创建音频流
    const audioStream = await ingestAudioStream(mediaStream, options);

    return { mediaStream, audioStream };
}

export async function ingestAudioStream(
    mediaStream: MediaStream,
    options: {
        gain?: number;
        channelId?: number;
        sampleRate?: number;
    } = {}
): Promise<ReadableStream<Float32Array>> {
    if (!mediaStream.getAudioTracks().length) {
        throw new Error('MediaStream must contain at least one audio track');
    }

    let audioContext: AudioContext | null = null;
    let workletNode: AudioWorkletNode | null = null;

    const cleanup = () => {
        if (workletNode) {
            workletNode.disconnect();
            workletNode = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
    };

    return new ReadableStream<Float32Array>({
        start: async (controller) => {
            try {
                // 使用配置的采样率，默认16kHz
                audioContext = new AudioContext({ sampleRate: options.sampleRate ?? 16000 });

                // 使用包内的 AudioWorklet 模块（通过 Vite 插件提供）
                await audioContext.audioWorklet.addModule('/audio-processor.js');

                // 创建worklet节点，带有增益和通道ID参数
                workletNode = new AudioWorkletNode(audioContext, 'resampler-processor', {
                    processorOptions: {
                        gain: options.gain ?? 1.0,
                        channelId: options.channelId ?? 0,
                    },
                });

                // 监听处理后的音频数据
                workletNode.port.onmessage = event => {
                    if (event.data.type === 'audioData') {
                        try {
                            controller.enqueue(event.data.data);
                        } catch (e) {
                            console.error('Failed to enqueue audio data:', e);
                            // 流已关闭/取消，清理资源
                            cleanup();
                        }
                    }
                };

                // 连接MediaStream到worklet
                const source = audioContext.createMediaStreamSource(mediaStream);
                source.connect(workletNode);

                // 连接到destination以保持图形活跃
                workletNode.connect(audioContext.destination);
            } catch (error) {
                console.error('Failed to setup AudioWorklet:', error);
                throw new Error(`AudioWorklet setup failed: ${error instanceof Error ? error.message : error}`);
            }
        },
        cancel: () => {
            cleanup();
        },
    });
}
