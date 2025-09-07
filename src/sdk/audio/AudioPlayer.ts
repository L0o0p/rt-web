import { AUDIO_QUALITY } from '../protocol/ClientProtocol';
import { pcm16ToFloat32 } from './AudioUtils';

export class AudioPlayer {
    private audioContext: AudioContext | null = null;
    private isPlaying: boolean = false;
    private playbackNode: AudioWorkletNode | null = null;
    private workletReady: Promise<void> | null = null;
    private processorName: string;

    constructor() {
        this.initAudioContext();
        // 随机化处理器名称，允许多个 player 共存
        this.processorName = `pcm-player-processor-` + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    // 初始化音频上下文
    private initAudioContext(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: AUDIO_QUALITY.SAMPLE_RATE
            });
        } catch (error) {
            console.error('Failed to create audio context:', error);
        }
    }

    // 内联注册播放用的 AudioWorkletProcessor，避免新增文件
    private async ensurePlaybackWorklet(): Promise<void> {
        if (!this.audioContext) {
            this.initAudioContext();
        }
        if (!this.audioContext) return;

        // 防并发：已有初始化中的 Promise 时直接复用
        if (this.workletReady) return this.workletReady;

        const workletCode = `
            class PCMPlayerProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.queue = [];
                    this.readIndex = 0;
                    this.current = null;
                    this.port.onmessage = (event) => {
                        const data = event.data;
                        if (!data) return;
                        if (data.type === 'push' && data.samples instanceof Float32Array) {
                            // 将一帧样本入队
                            this.queue.push(data.samples);
                        }
                    };
                }
                process(_inputs, outputs) {
                    const output = outputs[0];
                    const channel = output[0];
                    const framesNeeded = channel.length;
                    let offset = 0;

                    while (offset < framesNeeded) {
                        if (!this.current) {
                            if (this.queue.length > 0) {
                                this.current = this.queue.shift();
                                this.readIndex = 0;
                            } else {
                                // 缺帧填充静音，避免爆音
                                for (let i = offset; i < framesNeeded; i++) channel[i] = 0;
                                break;
                            }
                        }

                        const remainingInCurrent = this.current.length - this.readIndex;
                        const remainingInOutput = framesNeeded - offset;
                        const toCopy = remainingInOutput < remainingInCurrent ? remainingInOutput : remainingInCurrent;

                        channel.set(this.current.subarray(this.readIndex, this.readIndex + toCopy), offset);
                        offset += toCopy;
                        this.readIndex += toCopy;

                        if (this.readIndex >= this.current.length) {
                            this.current = null;
                            this.readIndex = 0;
                        }
                    }

                    return true;
                }
            }
            registerProcessor('${this.processorName}', PCMPlayerProcessor);
        `;

        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        this.workletReady = (async (): Promise<void> => {
            await this.audioContext!.audioWorklet.addModule(url);
            this.playbackNode = new AudioWorkletNode(this.audioContext!, this.processorName, {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });
            this.playbackNode.connect(this.audioContext!.destination);
        })();

        await this.workletReady;
        URL.revokeObjectURL(url);
    }

    // 播放音频分片（通过 AudioWorklet 精确拉流播放）
    async playAudioChunk(audioData: Uint8Array): Promise<void> {
        if (!this.audioContext) {
            this.initAudioContext();
            if (!this.audioContext) {
                console.warn('Audio context is not available');
                return;
            }
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        await this.ensurePlaybackWorklet();

        try {
            const floatData = pcm16ToFloat32(audioData);

            // 将样本推送到播放队列，使用可转移对象减少拷贝
            if (this.playbackNode) {
                this.playbackNode.port.postMessage({ type: 'push', samples: floatData }, [floatData.buffer]);
            }

            this.isPlaying = true;
        } catch (error) {
            console.error('Error playing audio chunk via worklet:', error);
            this.isPlaying = false;
        }
    }

    // 停止播放
    stopPlayback(): void {
        if (this.playbackNode) {
            try {
                this.playbackNode.disconnect();
            } catch (_) { /* noop */ }
        }
        this.playbackNode = null;
        this.workletReady = null;

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(error => {
                console.warn('Failed to close audio context:', error);
            });
        }

        this.audioContext = null;
        this.isPlaying = false;
    }

    // 获取播放状态
    get isPlaybackActive(): boolean {
        return this.isPlaying;
    }
}