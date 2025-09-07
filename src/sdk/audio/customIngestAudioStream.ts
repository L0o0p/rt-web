export const RECOMMENDED_AUDIO_CONSTRAINTS = Object.freeze({
    sampleRate: 16000,
    channelCount: 1,
});

/**
 * 自定义的 ingestAudioStream 实现，解决 Vite 中 AudioWorklet 模块加载问题
 */
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
