/**
 * 首选的音频采样率，按优先级排序
 * 16kHz 是首选，但如果设备不支持，会尝试其他接近的采样率
 */
export const PREFERRED_SAMPLE_RATES = Object.freeze([
    16000,  // 首选：16kHz
    48000,  // 备选：48kHz (常见的高质量采样率)
    44100,  // 备选：44.1kHz (CD质量)
    22050,  // 备选：22.05kHz
    8000,   // 备选：8kHz (最低质量但广泛支持)
]);

export const RECOMMENDED_AUDIO_CONSTRAINTS = Object.freeze({
    sampleRate: { ideal: 16000, min: 8000, max: 48000 },  // 灵活的采样率约束
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
    sampleRate: { ideal: 16000, min: 8000, max: 48000 },  // 灵活的采样率约束
    channelCount: 1,
    echoCancellation: { exact: true },    // 强制启用回声消除
    noiseSuppression: { exact: true },    // 强制启用噪声抑制
    autoGainControl: { exact: true },     // 强制启用自动增益控制
    // 可选的高级设置
    // echoCancellationType: 'system',    // 'browser' | 'system' - 回声消除类型
    // latency: 0.01,                     // 低延迟设置（10ms）
});

/**
 * 检测设备支持的最佳采样率
 * @param deviceId 音频设备ID
 * @returns 设备支持的最接近16kHz的采样率
 */
export async function detectBestSampleRate(deviceId?: string): Promise<number> {
    console.log('[Audio Detection] Detecting best sample rate for device...');

    // 检查基本的 API 支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[Audio Detection] MediaDevices API not supported');
        return 44100; // 最常见的默认值
    }

    // 尝试每个首选采样率，找到第一个支持的
    for (const sampleRate of PREFERRED_SAMPLE_RATES) {
        try {
            // 添加超时机制，防止移动设备上的长时间等待
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 5000)
            );

            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    sampleRate: { exact: sampleRate },
                    channelCount: 1
                }
            };

            const testStream = await Promise.race([
                navigator.mediaDevices.getUserMedia(constraints),
                timeoutPromise
            ]);

            const audioTrack = testStream.getAudioTracks()[0];
            const settings = audioTrack.getSettings();

            // 清理测试流
            testStream.getTracks().forEach(track => track.stop());

            if (settings.sampleRate === sampleRate) {
                console.log(`✅ [Audio Detection] Device supports ${sampleRate}Hz`);
                return sampleRate;
            }
        } catch (error) {
            console.log(`❌ [Audio Detection] Device does not support ${sampleRate}Hz:`, error instanceof Error ? error.message : error);
        }
    }

    // 如果所有首选采样率都不支持，使用浏览器的默认值
    console.warn('⚠️ [Audio Detection] No preferred sample rates supported, using browser default');
    try {
        const defaultStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                channelCount: 1
            }
        });
        const audioTrack = defaultStream.getAudioTracks()[0];
        const settings = audioTrack.getSettings();
        defaultStream.getTracks().forEach(track => track.stop());

        const detectedRate = settings.sampleRate || 44100; // fallback to 44.1kHz
        console.log(`📍 [Audio Detection] Using device default sample rate: ${detectedRate}Hz`);
        return detectedRate;
    } catch (error) {
        console.error('❌ [Audio Detection] Failed to detect any sample rate, falling back to 44100Hz');
        return 44100; // Last resort fallback
    }
}


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
    targetSampleRate?: number; // 目标输出采样率，用于重采样
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
    // 检测移动设备并调整配置
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        console.log('[WebRTC Audio] Mobile device detected, using optimized settings');
    }

    // 如果未指定采样率，先检测设备支持的最佳采样率
    let targetSampleRate = options.sampleRate;
    if (!targetSampleRate) {
        console.log('[WebRTC Audio] No sample rate specified, detecting best supported sample rate...');
        try {
            targetSampleRate = await detectBestSampleRate(deviceId);
            console.log(`[WebRTC Audio] Will use detected sample rate: ${targetSampleRate}Hz`);
        } catch (error) {
            console.error('[WebRTC Audio] Failed to detect sample rate, using fallback:', error);
            targetSampleRate = isMobile ? 44100 : 16000; // 移动设备使用更安全的44.1kHz
        }
    }

    // 构建音频约束，使用检测到的采样率
    const baseConstraints = options.enableAdvancedProcessing ? ADVANCED_AUDIO_CONSTRAINTS : RECOMMENDED_AUDIO_CONSTRAINTS;
    const audioConstraints = {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        ...baseConstraints,
        // 覆盖采样率为检测到的最佳值
        sampleRate: targetSampleRate,
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

        // 检查采样率是否符合预期
        if (settings.sampleRate !== targetSampleRate) {
            console.warn(`⚠️ [WebRTC Audio] Expected sample rate ${targetSampleRate}Hz, but got ${settings.sampleRate}Hz`);
        } else {
            console.log(`✅ [WebRTC Audio] Sample rate ${settings.sampleRate}Hz successfully applied`);
        }

        // 检查是否成功启用了回声消除
        if (settings.echoCancellation) {
            console.log('✅ [WebRTC Audio] Echo cancellation is ENABLED');
        } else {
            console.warn('⚠️ [WebRTC Audio] Echo cancellation is NOT enabled - this may affect audio quality');
        }
    }

    // 创建音频流，传递实际使用的采样率和目标采样率
    const actualSampleRate = audioTrack?.getSettings().sampleRate || targetSampleRate;
    const outputSampleRate = options.targetSampleRate || actualSampleRate;

    if (actualSampleRate !== outputSampleRate) {
        console.log(`[WebRTC Audio] Will resample from ${actualSampleRate}Hz to ${outputSampleRate}Hz`);
    }

    const audioStream = await ingestAudioStream(mediaStream, {
        ...options,
        sampleRate: actualSampleRate,
        targetSampleRate: outputSampleRate
    });

    return { mediaStream, audioStream };
}

export async function ingestAudioStream(
    mediaStream: MediaStream,
    options: {
        gain?: number;
        channelId?: number;
        sampleRate?: number;
        targetSampleRate?: number;
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
                console.log('[Audio Worklet] Creating AudioContext with sample rate:', options.sampleRate ?? 16000);
                audioContext = new AudioContext({ sampleRate: options.sampleRate ?? 16000 });
                console.log('[Audio Worklet] AudioContext created, state:', audioContext.state);

                // 使用包内的 AudioWorklet 模块（通过 Vite 插件提供）
                console.log('[Audio Worklet] Loading audio-processor.js module...');
                try {
                    await audioContext.audioWorklet.addModule('/audio-processor.js');
                    console.log('[Audio Worklet] ✅ audio-processor.js loaded successfully');
                } catch (moduleError) {
                    console.error('[Audio Worklet] ❌ Failed to load audio-processor.js:', moduleError);
                    throw new Error(`Failed to load AudioWorklet module: ${moduleError instanceof Error ? moduleError.message : moduleError}`);
                }

                // 准备worklet参数
                const inputSampleRate = options.sampleRate ?? 16000;
                const outputSampleRate = options.targetSampleRate ?? inputSampleRate;
                const targetBufferSize = 1024; // 固定使用1024样本缓冲区

                // 创建worklet节点，传递所有必要参数
                console.log('[Audio Worklet] Creating AudioWorkletNode...');
                workletNode = new AudioWorkletNode(audioContext, 'resampler-processor', {
                    processorOptions: {
                        gain: options.gain ?? 1.0,
                        channelId: options.channelId ?? 0,
                        inputSampleRate: inputSampleRate,
                        targetSampleRate: outputSampleRate,
                        targetBufferSize: targetBufferSize,
                    },
                });
                console.log('[Audio Worklet] ✅ AudioWorkletNode created');

                // 监听来自worklet的消息
                let processedChunkCount = 0;
                const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const logInterval = isMobile ? 50 : 20; // 移动设备减少日志频率

                workletNode.port.onmessage = event => {
                    const { type, data } = event.data;

                    if (type === 'init') {
                        // Worklet初始化完成
                        console.log('[Audio Worklet] ✅ Processor initialized:', {
                            inputSampleRate: data.inputSampleRate || event.data.inputSampleRate,
                            targetSampleRate: data.targetSampleRate || event.data.targetSampleRate,
                            targetBufferSize: data.targetBufferSize || event.data.targetBufferSize,
                            needsResampling: data.needsResampling || event.data.needsResampling
                        });
                    } else if (type === 'audioData') {
                        // 接收处理好的音频数据
                        processedChunkCount++;

                        if (processedChunkCount <= 3 || processedChunkCount % logInterval === 0) {
                            console.log(`[Audio Worklet] Received processed chunk #${processedChunkCount}, size: ${data.length} samples`);
                        }

                        try {
                            // 直接将处理好的数据发送到流
                            controller.enqueue(data);
                        } catch (e) {
                            console.error('[Audio Worklet] Failed to enqueue processed audio data:', e);
                            cleanup();
                        }
                    }
                };

                // 连接MediaStream到worklet
                console.log('[Audio Worklet] Creating MediaStreamSource...');
                const source = audioContext.createMediaStreamSource(mediaStream);
                console.log('[Audio Worklet] Connecting source to worklet...');
                source.connect(workletNode);

                // 连接到destination以保持图形活跃
                console.log('[Audio Worklet] Connecting to destination...');
                workletNode.connect(audioContext.destination);
                console.log('[Audio Worklet] ✅ Audio pipeline connected successfully');
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
