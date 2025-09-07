import { AUDIO_QUALITY } from '../types/protocol.js';
import type { AudioChunk, VADResult } from '../types/protocol.js';
// import { Logger } from '../utils/logger.js';

export class AudioProcessor {
    // private logger: Logger;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private audioProcessor: ScriptProcessorNode | null = null;
    private isRecording: boolean = false;
    private recordedAudioData: AudioChunk[] = [];
    private recordingStartTime: number = 0;
    private onAudioDataCallback?: (data: Float32Array, vadResult: VADResult) => void;

    // 跨块音频处理状态 (暂未使用，为未来扩展保留)
    // private _audioFilterState = {
    //     highPassPrevInput: 0,
    //     highPassPrevOutput: 0,
    //     noiseProfile: null as number | null,
    //     blockCount: 0
    // };

    constructor(
        // logger: Logger
    ) {
        // // this.logger = logger;
    }

    // 开始录音
    async startRecording(deviceId?: string, onAudioData?: (data: Float32Array, vadResult: VADResult) => void): Promise<void> {
        try {
            // 检查是否支持mediaDevices API
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('浏览器不支持getUserMedia API');
            }

            this.onAudioDataCallback = onAudioData;

            // 获取选定的麦克风设备ID
            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: AUDIO_QUALITY.SAMPLE_RATE,
                    sampleSize: 16
                }
            };

            // 获取媒体流
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            // // this.logger.info('成功获取麦克风访问权限');

            // 创建音频上下文
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContext) {
                throw new Error('当前浏览器不支持Web Audio API');
            }
            this.audioContext = new AudioContext({
                sampleRate: AUDIO_QUALITY.SAMPLE_RATE
            });

            // 创建音频源
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // 创建脚本处理器
            this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

            // 连接节点
            source.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination);

            // 设置音频处理回调
            this.audioProcessor.onaudioprocess = (event) => this.handleAudioProcess(event);

            // 更新状态
            this.isRecording = true;
            this.recordedAudioData = [];
            this.recordingStartTime = Date.now();

            // this.logger.info('开始录音 - 数据将存储在内存中');
        } catch (error) {
            // this.logger.error(`开始录音失败: ${error instanceof Error ? error.message : String(error)}`);
            this.isRecording = false;
            throw error;
        }
    }

    // 停止录音
    stopRecording(): void {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isRecording = false;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const recordingDuration = (Date.now() - this.recordingStartTime) / 1000;

        // this.logger.info(`停止录音 - 已录制 ${recordingDuration.toFixed(1)} 秒，${this.recordedAudioData.length} 个音频块`);
    }

    // 处理音频数据
    private handleAudioProcess(event: AudioProcessingEvent): void {
        // 获取输入音频数据
        const inputData = event.inputBuffer.getChannelData(0);

        // 执行VAD检测
        const vadResult = this.performVAD(inputData);

        // 应用噪声抑制
        const processedData = this.applyNoiseSuppression(inputData);

        // 存储音频数据
        this.recordedAudioData.push({
            data: new Float32Array(processedData),
            timestamp: Date.now(),
            vadActive: vadResult.isActive,
            energy: vadResult.energy
        });

        // 调用回调函数
        if (this.onAudioDataCallback) {
            this.onAudioDataCallback(processedData, vadResult);
        }
    }

    // 语音活动检测(VAD)
    private performVAD(audioData: Float32Array): VADResult {
        // 计算音频数据的均方根(RMS)值作为能量指标
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);

        // 计算过零率
        let zeroCrossings = 0;
        for (let i = 1; i < audioData.length; i++) {
            if ((audioData[i] > 0) !== (audioData[i - 1] > 0)) {
                zeroCrossings++;
            }
        }
        const zeroCrossingRate = zeroCrossings / audioData.length;

        // 更宽松的阈值设定，提高语音检测敏感度
        const energyThreshold = 0.005;
        // const zeroCrossingThreshold = 0.3; // 暂未使用

        // 结合能量和过零率判断语音活动
        const hasEnergy = rms > energyThreshold;
        // const hasCorrectZeroCrossingRate = zeroCrossingRate < zeroCrossingThreshold; // 暂未使用

        // 更宽松的语音检测：只要有足够的能量就认为是语音
        const isActive = hasEnergy;

        return {
            isActive: isActive,
            energy: rms,
            zeroCrossingRate: zeroCrossingRate
        };
    }

    // 噪声抑制
    private applyNoiseSuppression(audioData: Float32Array): Float32Array {
        // 创建输出数组
        const output = new Float32Array(audioData.length);

        // 估计噪声水平（使用前100个样本）
        let noiseEstimate = 0;
        const noiseSampleSize = Math.min(100, audioData.length);
        for (let i = 0; i < noiseSampleSize; i++) {
            noiseEstimate += Math.abs(audioData[i]);
        }
        noiseEstimate /= noiseSampleSize;

        // 噪声抑制参数
        const noiseFactor = 2.0;
        const noiseThreshold = noiseEstimate * noiseFactor;
        const gainFactor = 1.5;

        for (let i = 0; i < audioData.length; i++) {
            const amplitude = Math.abs(audioData[i]);

            // 如果幅度小于噪声阈值，则应用噪声抑制
            if (amplitude < noiseThreshold) {
                // 应用软限幅噪声抑制
                const suppressionFactor = amplitude / noiseThreshold;
                output[i] = audioData[i] * suppressionFactor * suppressionFactor;
            } else {
                // 应用轻微的增益以增强语音信号
                output[i] = audioData[i] * gainFactor;

                // 限制最大幅度以防止削波
                if (output[i] > 0.9) output[i] = 0.9;
                if (output[i] < -0.9) output[i] = -0.9;
            }
        }

        return output;
    }

    // 获取录制的音频数据
    getRecordedAudioData(): AudioChunk[] {
        return this.recordedAudioData;
    }

    // 清除录制的音频数据
    clearRecordedAudioData(): void {
        this.recordedAudioData = [];
    }

    // 获取录音时长
    getRecordingDuration(): number {
        if (this.isRecording) {
            return (Date.now() - this.recordingStartTime) / 1000;
        }
        return 0;
    }

    // 获取录音大小估算
    getRecordingSize(): number {
        const totalSamples = this.recordedAudioData.reduce((sum, chunk) => sum + chunk.data.length, 0);
        return (totalSamples * 4 / 1024); // Float32Array每个元素4字节，转换为KB
    }

    // 检查是否正在录音
    get isRecordingActive(): boolean {
        return this.isRecording;
    }

    // 将Float32Array转换为16位PCM WAV格式
    convertToWAV(audioData: Float32Array[]): ArrayBuffer {
        // 合并所有音频数据
        const totalSamples = audioData.reduce((sum, chunk) => sum + chunk.length, 0);
        const mergedData = new Float32Array(totalSamples);

        let offset = 0;
        for (const chunk of audioData) {
            mergedData.set(chunk, offset);
            offset += chunk.length;
        }

        // 创建WAV文件
        const buffer = new ArrayBuffer(44 + mergedData.length * 2);
        const view = new DataView(buffer);

        // WAV文件头
        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + mergedData.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, AUDIO_QUALITY.SAMPLE_RATE, true);
        view.setUint32(28, AUDIO_QUALITY.SAMPLE_RATE * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, mergedData.length * 2, true);

        // 转换音频数据
        let offset2 = 44;
        for (let i = 0; i < mergedData.length; i++) {
            const sample = Math.max(-1, Math.min(1, mergedData[i]));
            view.setInt16(offset2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset2 += 2;
        }

        return buffer;
    }
}
