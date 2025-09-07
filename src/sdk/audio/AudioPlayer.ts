/* eslint-disable prefer-const */
import { AUDIO_QUALITY, CONFIG } from '../types/protocol.js';
import type { AudioChunk } from '../types/protocol.js';
// import { Logger } from '../utils/logger.js';

export class AudioPlayer {
    // private logger: Logger;
    private audioContext: AudioContext | null = null;
    // private audioDestination: MediaStreamAudioDestinationNode | null = null;
    private audioPlaybackBuffer: AudioChunk[] = [];
    private playbackTimer: number | null = null;
    private isPlaying: boolean = false;

    // 跨块音频处理状态
    private audioFilterState = {
        highPassPrevInput: 0,
        highPassPrevOutput: 0,
        noiseProfile: null as number | null,
        blockCount: 0
    };

    // 音频优化状态（全程使用）
    private audioOptimization = {
        isActive: false,
        rafId: null as number | null,
        fixedChunkBuffer: new Uint8Array(0),
        currentResponseId: null as string | null
    };

    // 音频播放调度状态
    private playbackScheduler = {
        nextPlayTime: 0,
        isScheduling: false
    };

    // 音频缓冲区合并状态
    private audioMergeBuffer = {
        rawBuffer: new Uint8Array(0),
        lastFlushTime: 0,
        flushTimer: null as number | null,
        totalSamples: 0
    };

    constructor(
        // logger: Logger
    ) {
        // this.logger = logger;
    }

    // 初始化音频播放器
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async initialize(_deviceId?: string): Promise<void> {
        // eslint-disable-next-line no-useless-catch
        try {
            // 确保音频上下文存在
            if (!this.audioContext) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                    sampleRate: AUDIO_QUALITY.SAMPLE_RATE
                });
                // this.logger.info('✅ 音频上下文创建成功');
            }

            // 恢复音频上下文（如果被暂停）
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                // this.logger.info('音频上下文已恢复');
            }

            // 创建音频输出目标
            // this.audioDestination = this.audioContext.createMediaStreamDestination();

            // this.logger.info('音频播放器初始化完成');
        } catch (error) {
            // this.logger.error(`初始化音频播放器失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    // 处理流式音频数据
    handleStreamingAudio(base64AudioData: string, messageInfo?: any): void {
        try {
            // this.logger.info('🎵 开始处理流式音频数据');
            // this.logger.debug(`📊 base64长度: ${base64AudioData.length} 字符`);

            // 确保音频上下文已初始化并处于运行状态
            if (!this.audioContext) {
                // this.logger.warning('⚠️ 音频上下文未初始化，正在自动初始化...');
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                this.initialize().catch(error => {
                    // this.logger.error(`自动初始化音频播放器失败: ${error}`);
                });
                return;
            }

            if (this.audioContext.state === 'suspended') {
                // this.logger.warning('⚠️ 音频上下文被暂停，正在恢复...');
                this.audioContext.resume().then(() => {
                    // this.logger.info('✅ 音频上下文已恢复');
                    // 重新处理音频数据
                    this.handleStreamingAudio(base64AudioData, messageInfo);
                }).catch(error => {
                    // this.logger.error(`恢复音频上下文失败: ${error}`);
                });
                return;
            }

            // 解码base64音频数据
            const binaryString = atob(base64AudioData);
            const audioData = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                audioData[i] = binaryString.charCodeAt(i);
            }

            // this.logger.info(`✅ base64解码成功: ${audioData.length} 字节`);

            // 诊断音频数据
            this.diagnoseAudioData(audioData);

            // 检查是否是新的响应开始
            const responseId = messageInfo?.response_id;
            if (responseId && responseId !== this.audioOptimization.currentResponseId) {
                this.startOptimizedPlayback(responseId);
            }

            // 全程使用固定分片优化
            this.handleOptimizedAudioChunk(audioData, messageInfo);

            // this.logger.info(`🎵 音频已加入播放队列，当前队列长度: ${this.audioPlaybackBuffer.length}`);

            // 显示音频播放指示器
            this.showAudioPlayingIndicator(messageInfo);

        } catch (error) {
            // this.logger.error(`❌ 处理流式音频数据失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // 诊断音频数据
    private diagnoseAudioData(audioData: Uint8Array): void {
        if (audioData.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const firstBytes = Array.from(audioData.slice(0, 16))
                .map(b => b.toString(16).padStart(2, '0')).join(' ');
            // this.logger.info(`🔍 音频数据前16字节: ${firstBytes}`);

            // 字节序诊断
            if (audioData.length >= 8) {
                // this.logger.info('🧪 字节序诊断分析:');
                for (let i = 0; i < Math.min(4, Math.floor(audioData.length / 2)); i++) {
                    const byte1 = audioData[i * 2];
                    const byte2 = audioData[i * 2 + 1];

                    const littleEndian = byte1 | (byte2 << 8);
                    const bigEndian = (byte1 << 8) | byte2;

                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const leSigned = littleEndian > 32767 ? littleEndian - 65536 : littleEndian;
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const beSigned = bigEndian > 32767 ? bigEndian - 65536 : bigEndian;

                    // this.logger.info(`   样本${i}: [${byte1.toString(16).padStart(2, '0')} ${byte2.toString(16).padStart(2, '0')}] → 小端序:${leSigned} 大端序:${beSigned}`);
                }
            }

            // 数据统计
            let zeroCount = 0;
            let maxVal = 0;
            let minVal = 255;
            for (let i = 0; i < Math.min(audioData.length, 1000); i++) {
                if (audioData[i] === 0) zeroCount++;
                maxVal = Math.max(maxVal, audioData[i]);
                minVal = Math.min(minVal, audioData[i]);
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const zeroRatio = (zeroCount / Math.min(audioData.length, 1000) * 100).toFixed(1);
            // this.logger.info(`📊 数据分析: ${zeroRatio}% 零值, 范围 ${minVal}-${maxVal}`);
        }
    }

    // 启动优化播放
    private startOptimizedPlayback(responseId: string): void {
        // this.logger.info('🚀 启动全程音频优化');

        // 停止之前的优化
        this.stopOptimizedPlayback();

        // 重置播放调度状态（新响应开始）
        this.playbackScheduler.nextPlayTime = 0;
        this.playbackScheduler.isScheduling = false;

        this.audioOptimization = {
            isActive: true,
            rafId: null,
            fixedChunkBuffer: new Uint8Array(0),
            currentResponseId: responseId
        };
    }

    // 停止优化播放
    private stopOptimizedPlayback(): void {
        if (this.audioOptimization.rafId) {
            cancelAnimationFrame(this.audioOptimization.rafId);
        }

        this.audioOptimization.isActive = false;
        this.audioOptimization.rafId = null;
        // this.logger.info('⏹️ 音频优化已停止');
    }

    // 处理优化音频块（全程使用）
    private handleOptimizedAudioChunk(audioData: Uint8Array, messageInfo?: any): void {
        // 将新音频数据添加到固定分片缓冲区
        const newBuffer = new Uint8Array(this.audioOptimization.fixedChunkBuffer.length + audioData.length);
        newBuffer.set(this.audioOptimization.fixedChunkBuffer);
        newBuffer.set(audioData, this.audioOptimization.fixedChunkBuffer.length);
        this.audioOptimization.fixedChunkBuffer = newBuffer;

        // this.logger.info(`🔧 音频优化缓冲: ${this.audioOptimization.fixedChunkBuffer.length} 字节`);

        // 处理固定大小的分片
        this.processFixedChunks(messageInfo);

        // 如果这是第一次处理，启动RAF播放循环
        if (!this.audioOptimization.rafId) {
            this.startRAFPlayback();
        }
    }

    // 处理固定大小的分片
    private processFixedChunks(messageInfo?: any): void {
        const chunkSize = AUDIO_QUALITY.FIXED_CHUNK_SIZE;

        while (this.audioOptimization.fixedChunkBuffer.length >= chunkSize) {
            // 提取固定大小的分片
            const chunk = this.audioOptimization.fixedChunkBuffer.slice(0, chunkSize);

            // 移除已处理的数据
            this.audioOptimization.fixedChunkBuffer = this.audioOptimization.fixedChunkBuffer.slice(chunkSize);

            // 将固定分片添加到合并缓冲区而不是直接播放
            this.addToMergeBuffer(chunk, messageInfo);

            // this.logger.debug(`✂️ 处理固定分片: ${chunkSize} 字节`);
        }
    }

    // 启动requestAnimationFrame播放循环
    private startRAFPlayback(): void {
        // this.logger.info('🎬 启动RAF高精度播放循环（全程优化）');

        let lastPlayTime = 0;
        const targetInterval = CONFIG.PLAYBACK_INTERVAL; // 毫秒

        const rafPlaybackLoop = (currentTime: number) => {
            // 检查是否应该播放音频
            if (currentTime - lastPlayTime >= targetInterval) {
                this.playAudioDataRAF();
                lastPlayTime = currentTime;
            }

            // 持续循环，直到音频优化停止
            if (this.audioOptimization.isActive) {
                this.audioOptimization.rafId = requestAnimationFrame(rafPlaybackLoop);
            } else {
                // 优化停止，确保剩余音频处理
                this.handleOptimizationEnd();
            }
        };

        this.audioOptimization.rafId = requestAnimationFrame(rafPlaybackLoop);
    }

    // RAF播放音频数据
    private playAudioDataRAF(): void {
        if (this.audioPlaybackBuffer.length > 0 && this.audioContext) {
            // 使用与常规播放相同的逻辑，但通过RAF调用
            this.playAudioData();
        }
    }

    // 处理优化结束
    private handleOptimizationEnd(): void {
        // this.logger.info('🔄 音频优化结束，处理剩余数据');

        // 处理剩余的固定分片缓冲数据
        if (this.audioOptimization.fixedChunkBuffer.length > 0) {
            // 将剩余数据添加到合并缓冲区
            this.addToMergeBuffer(this.audioOptimization.fixedChunkBuffer, {
                response_id: this.audioOptimization.currentResponseId
            });

            // this.logger.debug(`📦 处理剩余固定分片缓冲数据: ${this.audioOptimization.fixedChunkBuffer.length} 字节`);
        }

        // 立即刷新合并缓冲区，确保音频能够播放
        if (this.audioMergeBuffer.rawBuffer.length > 0) {
            this.flushMergeBuffer({
                response_id: this.audioOptimization.currentResponseId
            });
        }
    }

    // 添加音频数据到合并缓冲区
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private addToMergeBuffer(audioData: Uint8Array, messageInfo?: any): void {
        // 将新音频数据添加到原始缓冲区
        const newBuffer = new Uint8Array(this.audioMergeBuffer.rawBuffer.length + audioData.length);
        newBuffer.set(this.audioMergeBuffer.rawBuffer);
        newBuffer.set(audioData, this.audioMergeBuffer.rawBuffer.length);
        this.audioMergeBuffer.rawBuffer = newBuffer;

        // 更新样本数（假设16位PCM）
        this.audioMergeBuffer.totalSamples = Math.floor(this.audioMergeBuffer.rawBuffer.length / 2);

        // this.logger.debug(`🔄 合并缓冲区更新: ${this.audioMergeBuffer.rawBuffer.length} 字节, ${this.audioMergeBuffer.totalSamples} 样本`);

        // 检查是否达到合并条件
        if (this.shouldFlushMergeBuffer()) {
            this.flushMergeBuffer(messageInfo);
        } else {
            // 设置超时刷新定时器
            this.setMergeBufferTimeout(messageInfo);
        }
    }

    // 检查是否应该刷新合并缓冲区
    private shouldFlushMergeBuffer(): boolean {
        // 条件1: 缓冲区大小达到配置的最小样本数
        const hasEnoughSamples = this.audioMergeBuffer.totalSamples >= AUDIO_QUALITY.MERGE_BUFFER_MIN_SAMPLES;

        // 条件2: 缓冲区字节数达到配置大小
        const hasEnoughBytes = this.audioMergeBuffer.rawBuffer.length >= AUDIO_QUALITY.MERGE_BUFFER_SIZE;

        // 条件3: 距离上次刷新时间超过超时阈值
        const isTimeout = Date.now() - this.audioMergeBuffer.lastFlushTime > AUDIO_QUALITY.MERGE_BUFFER_TIMEOUT_MS;

        return hasEnoughSamples || hasEnoughBytes || (isTimeout && this.audioMergeBuffer.rawBuffer.length > 0);
    }

    // 设置合并缓冲区超时定时器
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private setMergeBufferTimeout(messageInfo?: any): void {
        // 清除现有定时器
        if (this.audioMergeBuffer.flushTimer) {
            clearTimeout(this.audioMergeBuffer.flushTimer);
        }

        // 设置新的超时定时器
        this.audioMergeBuffer.flushTimer = window.setTimeout(() => {
            if (this.audioMergeBuffer.rawBuffer.length > 0) {
                // this.logger.debug('⏰ 合并缓冲区超时，强制刷新');
                this.flushMergeBuffer(messageInfo);
            }
        }, AUDIO_QUALITY.MERGE_BUFFER_TIMEOUT_MS);
    }

    // 刷新合并缓冲区，将合并的音频添加到播放队列
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private flushMergeBuffer(messageInfo?: any): void {
        if (this.audioMergeBuffer.rawBuffer.length === 0) {
            return;
        }

        // 清除超时定时器
        if (this.audioMergeBuffer.flushTimer) {
            clearTimeout(this.audioMergeBuffer.flushTimer);
            this.audioMergeBuffer.flushTimer = null;
        }

        // 创建合并后的音频块
        const mergedAudioData = new Uint8Array(this.audioMergeBuffer.rawBuffer);

        // this.logger.info(`🎯 刷新合并缓冲区: ${mergedAudioData.length} 字节, ${this.audioMergeBuffer.totalSamples} 样本`);

        // 添加到播放缓冲区
        this.audioPlaybackBuffer.push({
            data: mergedAudioData,
            timestamp: Date.now(),
            processed: false,
            responseId: messageInfo?.response_id,
            itemId: messageInfo?.item_id
        });

        // 控制播放缓冲区大小
        while (this.audioPlaybackBuffer.length > AUDIO_QUALITY.MAX_BUFFER_SIZE) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const removed = this.audioPlaybackBuffer.shift();
            // this.logger.debug(`🗑️ 音频播放缓冲区已满，移除旧数据: ${removed?.data.length} 字节`);
        }

        // 重置合并缓冲区
        this.audioMergeBuffer.rawBuffer = new Uint8Array(0);
        this.audioMergeBuffer.totalSamples = 0;
        this.audioMergeBuffer.lastFlushTime = Date.now();

        // 自动启动播放
        if (!this.playbackTimer && this.audioPlaybackBuffer.length > 0) {
            this.startPlayback();
        }
    }

    // 清空合并缓冲区
    private clearMergeBuffer(): void {
        if (this.audioMergeBuffer.flushTimer) {
            clearTimeout(this.audioMergeBuffer.flushTimer);
            this.audioMergeBuffer.flushTimer = null;
        }

        this.audioMergeBuffer.rawBuffer = new Uint8Array(0);
        this.audioMergeBuffer.totalSamples = 0;
        this.audioMergeBuffer.lastFlushTime = 0;

        // this.logger.debug('🧹 合并缓冲区已清空');
    }

    // 启动音频播放（现在主要由RAF控制）
    private async startPlayback(): Promise<void> {
        // 确保音频上下文初始化
        if (!this.audioContext) {
            await this.initialize();
        }

        // 如果优化播放已激活，不需要额外的定时器
        if (this.audioOptimization.isActive) {
            // this.logger.debug('RAF播放已激活，无需启动额外定时器');
            this.isPlaying = true;
            return;
        }

        // 如果优化未激活，启动备用播放定时器
        if (!this.playbackTimer) {
            this.playbackTimer = window.setInterval(() => this.playAudioData(), CONFIG.PLAYBACK_INTERVAL);
            // this.logger.info('🎵 备用音频播放定时器已启动');
            this.isPlaying = true;
        }
    }

    // 播放音频数据
    private playAudioData(): void {
        if (this.audioPlaybackBuffer.length > 0 && this.audioContext) {
            // 检查音频上下文状态
            if (this.audioContext.state === 'suspended') {
                // this.logger.warning('⚠️ 音频上下文在播放时被暂停，尝试恢复...');
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                this.audioContext.resume().catch(error => {
                    // this.logger.error(`播放时恢复音频上下文失败: ${error}`);
                });
                return;
            }

            try {
                // 从缓冲区取出最旧的数据
                const audioChunk = this.audioPlaybackBuffer.shift();

                if (!audioChunk || !audioChunk.data || audioChunk.data.length === 0) {
                    // this.logger.debug('跳过空音频块');
                    return;
                }

                // 检测音频数据格式并转换
                const processedAudio = this.processAudioChunk(audioChunk.data);
                if (!processedAudio || processedAudio.length === 0) {
                    // this.logger.warning('音频数据处理失败，跳过此块');
                    return;
                }

                // 创建音频缓冲区
                let samplesCount = processedAudio.length;

                // 如果是16位PCM数据，需要除以2
                if (processedAudio instanceof Uint8Array && processedAudio.length > 2) {
                    samplesCount = Math.floor(processedAudio.length / 2);
                }

                if (samplesCount <= 0) {
                    // this.logger.warning('⚠️ 音频样本数量为0，跳过播放');
                    return;
                }

                const buffer = this.audioContext.createBuffer(1, samplesCount, AUDIO_QUALITY.SAMPLE_RATE);
                const channelData = buffer.getChannelData(0);

                // 填充音频数据到缓冲区
                this.fillAudioBuffer(channelData, processedAudio);

                // 验证填充后的音频数据
                let nonZeroSamples = 0;
                let maxAmplitude = 0;
                for (let i = 0; i < Math.min(channelData.length, 100); i++) {
                    const amplitude = Math.abs(channelData[i]);
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    if (amplitude > 0.001) nonZeroSamples++;
                    if (amplitude > maxAmplitude) maxAmplitude = amplitude;
                }
                // this.logger.debug(`🎵 音频缓冲区验证: ${nonZeroSamples}/100 有效样本, 最大振幅: ${maxAmplitude.toFixed(4)}`);

                // 创建源节点并连接到输出
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                // 直接连接到音频上下文的destination，确保声音能播放出来
                source.connect(this.audioContext.destination);

                // 添加播放完成回调
                source.onended = () => {
                    // this.logger.debug(`音频块播放完成: ${samplesCount}样本`);
                };

                // 使用调度播放确保连续性
                const currentTime = this.audioContext.currentTime;
                let startTime = currentTime;

                // 如果有下一个播放时间且在未来，使用调度时间
                if (this.playbackScheduler.nextPlayTime > currentTime) {
                    startTime = this.playbackScheduler.nextPlayTime;
                } else {
                    // 否则使用当前时间，但稍微延后避免立即播放造成的问题
                    startTime = currentTime + 0.01;
                }

                // 计算这个音频块的持续时间
                const duration = samplesCount / AUDIO_QUALITY.SAMPLE_RATE;

                // 更新下一个播放时间，确保连续性
                this.playbackScheduler.nextPlayTime = startTime + duration;
                this.playbackScheduler.isScheduling = true;

                source.start(startTime);

                // this.logger.info(`🔊 播放音频块: ${processedAudio.length}字节 -> ${samplesCount}样本, 调度时间: ${startTime.toFixed(3)}s, 持续: ${duration.toFixed(3)}s`);
                // this.logger.debug(`🎚️ 下次播放时间: ${this.playbackScheduler.nextPlayTime.toFixed(3)}s`);

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
                // this.logger.error(`播放音频数据时出错: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        // 如果缓冲区为空，停止播放定时器
        if (this.audioPlaybackBuffer.length === 0 && this.playbackTimer) {
            clearInterval(this.playbackTimer);
            this.playbackTimer = null;
            this.isPlaying = false;
            // this.logger.info('🎵 音频播放定时器已停止 - 缓冲区为空');
        }
    }

    // 处理音频块数据
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private processAudioChunk(rawData: any): Uint8Array | null {
        try {
            // 如果是字符串（可能是base64），先转换为字节数组
            if (typeof rawData === 'string') {
                // this.logger.warning('音频数据仍为字符串格式，尝试解码...');
                const binaryString = atob(rawData);
                const uint8Array = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    uint8Array[i] = binaryString.charCodeAt(i);
                }
                return uint8Array;
            }

            // 如果是ArrayBuffer，转换为Uint8Array
            if (rawData instanceof ArrayBuffer) {
                return new Uint8Array(rawData);
            }

            // 如果已经是Uint8Array，直接返回
            if (rawData instanceof Uint8Array) {
                return rawData;
            }

            // 如果是其他TypedArray，转换为Uint8Array
            if (ArrayBuffer.isView(rawData)) {
                return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
            }

            // this.logger.warning(`未知的音频数据类型: ${typeof rawData}`);
            return null;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            // this.logger.error(`处理音频块失败: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    // 填充音频缓冲区 - 专门优化16位小端序PCM 16kHz
    private fillAudioBuffer(channelData: Float32Array, audioData: Uint8Array | Float32Array): void {
        try {
            if (audioData instanceof Float32Array) {
                // 如果已经是Float32格式，直接复制
                for (let i = 0; i < Math.min(channelData.length, audioData.length); i++) {
                    channelData[i] = Math.max(-1.0, Math.min(1.0, audioData[i]));
                }
                // this.logger.debug(`✅ Float32音频数据填充完成: ${Math.min(channelData.length, audioData.length)} 样本`);
            } else if (audioData instanceof Uint8Array) {
                // 专门处理16位小端序PCM
                const sampleCount = Math.min(channelData.length, Math.floor(audioData.length / 2));
                let validSamples = 0;
                let maxAmplitude = 0;

                // 第一遍：解码并收集统计信息
                const rawSamples = new Float32Array(sampleCount);
                let totalEnergy = 0;

                for (let i = 0; i < sampleCount; i++) {
                    const low = audioData[i * 2];
                    const high = audioData[i * 2 + 1];

                    // 小端序解码
                    const int16Value = low | (high << 8);
                    const signedValue = int16Value > 32767 ? int16Value - 65536 : int16Value;

                    // 精确归一化到 [-1, 1] 范围
                    let normalizedValue = signedValue / 32768.0;

                    rawSamples[i] = normalizedValue;
                    totalEnergy += normalizedValue * normalizedValue;

                    const amplitude = Math.abs(normalizedValue);
                    if (amplitude > maxAmplitude) {
                        maxAmplitude = amplitude;
                    }

                    if (amplitude > 0.001) {
                        validSamples++;
                    }
                }

                // 音频处理和噪声抑制
                this.applyAudioProcessing(rawSamples, channelData, sampleCount, totalEnergy, maxAmplitude);

                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const validRatio = sampleCount > 0 ? (validSamples / sampleCount * 100).toFixed(1) : 0;
                // this.logger.debug(`✅ 16位小端序PCM解码: ${sampleCount} 样本, ${validSamples} 有效 (${validRatio}%), 最大振幅: ${maxAmplitude.toFixed(3)}`);
            } else {
                // this.logger.error(`不支持的音频数据格式: ${typeof audioData}`);
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            // this.logger.error(`填充音频缓冲区失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // 应用音频处理和噪声抑制
    private applyAudioProcessing(rawSamples: Float32Array, channelData: Float32Array, sampleCount: number, totalEnergy: number, maxAmplitude: number): void {
        // 计算噪声门限
        const averageEnergy = totalEnergy / sampleCount;

        // 建立噪音配置文件
        if (this.audioFilterState.blockCount < 5) {
            if (!this.audioFilterState.noiseProfile) {
                this.audioFilterState.noiseProfile = averageEnergy;
            } else {
                this.audioFilterState.noiseProfile = this.audioFilterState.noiseProfile * 0.8 + averageEnergy * 0.2;
            }
        }

        const baseThreshold = this.audioFilterState.noiseProfile ? this.audioFilterState.noiseProfile * 0.1 : averageEnergy * 0.08;
        const noiseThreshold = Math.min(0.015, Math.max(0.002, baseThreshold));

        this.audioFilterState.blockCount++;

        // 噪音抑制和音频清理
        for (let i = 0; i < sampleCount; i++) {
            let sample = rawSamples[i];

            // 动态噪声门控
            if (Math.abs(sample) < noiseThreshold) {
                sample = 0;
            }

            // 轻微的平滑处理
            if (i > 0 && i < sampleCount - 1) {
                const prev = rawSamples[i - 1];
                const next = rawSamples[i + 1];

                const prevDiff = Math.abs(sample - prev);
                const nextDiff = Math.abs(sample - next);

                // 突变检测和平滑
                if (prevDiff > 0.05 && nextDiff > 0.05) {
                    sample = sample * 0.5 + (prev + next) * 0.25;
                }

                // 尖峰抑制
                if (prevDiff > 0.2 || nextDiff > 0.2) {
                    sample = (prev + next) * 0.5;
                }
            }

            // 软削波
            if (Math.abs(sample) > 0.8) {
                sample = sample > 0 ? 0.8 : -0.8;
            }

            channelData[i] = sample;
        }

        // 高通滤波
        if (sampleCount > 0) {
            const alpha = 0.98;
            let prevInput = this.audioFilterState.highPassPrevInput;
            let prevOutput = this.audioFilterState.highPassPrevOutput;

            for (let i = 0; i < sampleCount; i++) {
                const currentInput = channelData[i];
                const output = alpha * (prevOutput + currentInput - prevInput);
                channelData[i] = output;

                prevInput = currentInput;
                prevOutput = output;
            }

            this.audioFilterState.highPassPrevInput = prevInput;
            this.audioFilterState.highPassPrevOutput = prevOutput;
        }

        // 音量提升
        if (maxAmplitude > 0 && maxAmplitude < 0.1) {
            const boost = Math.min(2.0, 0.1 / maxAmplitude);
            for (let i = 0; i < sampleCount; i++) {
                channelData[i] *= boost;
                channelData[i] = Math.max(-0.95, Math.min(0.95, channelData[i]));
            }
            // this.logger.debug(`🔊 音量提升: ${boost.toFixed(2)}倍`);
        }
    }

    // 显示音频播放指示器
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    private showAudioPlayingIndicator(_messageInfo?: any): void {
        // 检查是否已存在指示器
        let indicator = document.querySelector('.audio-playing-indicator') as HTMLElement;
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'audio-playing-indicator';
            indicator.innerHTML = `
                <span>🎵</span>
                <span>AI 语音播放中</span>
                <div style="display: flex; align-items: center;">
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                </div>
            `;
            document.body.appendChild(indicator);
        }

        // 3秒后隐藏指示器
        setTimeout(() => {
            if (indicator && this.audioPlaybackBuffer.length === 0) {
                indicator.style.animation = 'slideInRight 0.3s ease-out reverse';
                setTimeout(() => {
                    if (indicator.parentNode) {
                        indicator.parentNode.removeChild(indicator);
                    }
                }, 300);
            }
        }, 3000);
    }

    // 播放录制的音频
    async playRecordedAudio(audioChunks: AudioChunk[]): Promise<void> {
        if (audioChunks.length === 0) {
            // this.logger.warning('没有录音数据可播放');
            return;
        }

        try {
            // 确保音频上下文初始化
            if (!this.audioContext) {
                await this.initialize();
            }

            // this.logger.info(`开始播放录音 - 共 ${audioChunks.length} 个音频块`);

            for (let i = 0; i < audioChunks.length; i++) {
                const audioChunk = audioChunks[i];

                // 创建音频缓冲区
                const buffer = this.audioContext!.createBuffer(1, audioChunk.data.length, AUDIO_QUALITY.SAMPLE_RATE);
                const channelData = buffer.getChannelData(0);
                channelData.set(audioChunk.data as Float32Array);

                // 创建源节点并播放
                const source = this.audioContext!.createBufferSource();
                source.buffer = buffer;
                source.connect(this.audioContext!.destination);

                source.start();

                // 等待播放完成
                await new Promise(resolve => {
                    source.onended = resolve;
                });
            }

            // this.logger.info('录音播放完成');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            // this.logger.error(`播放录音失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // 停止播放
    stopPlayback(): void {
        // 停止播放定时器
        if (this.playbackTimer) {
            clearInterval(this.playbackTimer);
            this.playbackTimer = null;
        }

        // 停止音频优化
        this.stopOptimizedPlayback();

        // 清空合并缓冲区
        this.clearMergeBuffer();

        // 重置播放调度状态
        this.playbackScheduler.nextPlayTime = 0;
        this.playbackScheduler.isScheduling = false;

        // 清空音频播放缓冲区
        this.audioPlaybackBuffer = [];
        this.isPlaying = false;

        // this.logger.info('停止播放');
    }

    // 获取播放状态
    get isPlaybackActive(): boolean {
        return this.isPlaying;
    }

    // 获取缓冲区状态
    getBufferStatus(): { length: number; latency: number } {
        return {
            length: this.audioPlaybackBuffer.length,
            latency: this.audioPlaybackBuffer.length * CONFIG.PLAYBACK_INTERVAL
        };
    }

    // 测试音频播放 - 播放一个简单的测试音
    async testAudioPlayback(): Promise<void> {
        // eslint-disable-next-line no-useless-catch
        try {
            // 确保音频上下文初始化
            if (!this.audioContext) {
                await this.initialize();
            }

            if (this.audioContext!.state === 'suspended') {
                await this.audioContext!.resume();
            }

            // 创建一个简单的测试音频 - 440Hz正弦波，持续0.5秒
            const sampleRate = AUDIO_QUALITY.SAMPLE_RATE;
            const duration = 0.5;
            const frequency = 440;
            const samples = Math.floor(sampleRate * duration);

            const buffer = this.audioContext!.createBuffer(1, samples, sampleRate);
            const channelData = buffer.getChannelData(0);

            // 生成正弦波
            for (let i = 0; i < samples; i++) {
                channelData[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3;
            }

            // 播放测试音
            const source = this.audioContext!.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext!.destination);
            source.start();

            // this.logger.info('🔊 播放测试音频 - 440Hz正弦波，0.5秒');

            return new Promise((resolve) => {
                source.onended = () => {
                    // this.logger.info('✅ 测试音频播放完成');
                    resolve();
                };
            });

        } catch (error) {
            // this.logger.error(`测试音频播放失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
