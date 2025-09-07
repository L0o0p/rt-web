import { AUDIO_QUALITY } from '../types/protocol.js';
import { pcm16ToFloat32 } from './AudioUtils.js';

export class AudioPlayer {
    private audioContext: AudioContext | null = null;
    private isPlaying: boolean = false;

    constructor() {
        // 初始化音频上下文
        this.initAudioContext();
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

    // 播放音频分片
    async playAudioChunk(audioData: Uint8Array): Promise<void> {
        // 确保音频上下文已初始化
        if (!this.audioContext) {
            this.initAudioContext();

            // 如果仍然无法初始化，直接返回
            if (!this.audioContext) {
                console.warn('Audio context is not available');
                return;
            }
        }

        // 恢复音频上下文（如果被暂停）
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        try {
            // 转换16位PCM数据到Float32Array
            const floatData = pcm16ToFloat32(audioData);

            // 创建音频缓冲区
            const buffer = this.audioContext.createBuffer(1, floatData.length, AUDIO_QUALITY.SAMPLE_RATE);
            buffer.getChannelData(0).set(floatData);

            // 创建源节点并连接到输出
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);

            // 播放音频
            source.start();

            // 设置播放状态
            this.isPlaying = true;

            // 播放完成后重置状态
            source.onended = () => {
                this.isPlaying = false;
            };

        } catch (error) {
            console.error('Error playing audio chunk:', error);
            this.isPlaying = false;
        }
    }

    // 停止播放
    stopPlayback(): void {
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