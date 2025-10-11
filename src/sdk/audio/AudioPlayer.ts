import { AUDIO_QUALITY } from '../protocol/ClientProtocol';
import { pcm16ToFloat32 } from './AudioUtils';

export class AudioPlayer {
    private audioContext: AudioContext | null = null;
    private isPlaying: boolean = false;
    private playbackNode: AudioWorkletNode | null = null;
    private workletReady: Promise<void> | null = null;
    private processorName: string;
    
    // 新增：智能打断控制
    private lastClearTime: number = 0;
    private lastResetTime: number = 0;
    private clearCount: number = 0;
    private resetCount: number = 0;
    private readonly MIN_CLEAR_INTERVAL: number = 100; // 最小清空间隔100ms
    private readonly MIN_RESET_INTERVAL: number = 500; // 最小重置间隔500ms
    private readonly MAX_CLEAR_COUNT: number = 5; // 最大连续清空次数
    private readonly MAX_RESET_COUNT: number = 3; // 最大连续重置次数

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
                    this.isPlaying = false;
                    this.clearCount = 0; // 用于调试的清空计数器
                    this.port.onmessage = (event) => {
                        const data = event.data;
                        if (!data) return;
                        if (data.type === 'push' && data.samples instanceof Float32Array) {
                            // 将一帧样本入队
                            console.log('[AudioWorklet] 音频数据入队，当前队列长度:', this.queue.length, '清空计数:', this.clearCount);
                            this.queue.push(data.samples);
                            this.isPlaying = true;
                        } else if (data.type === 'clear') {
                            // 清空队列 - 用于音频打断
                            const queueLength = this.queue.length;
                            this.clearCount++;
                            console.log('[AudioWorklet] 🔴 收到清空队列指令 #' + this.clearCount + '，当前队列长度:', queueLength);
                            this.queue = [];
                            this.current = null;
                            this.readIndex = 0;
                            this.isPlaying = false;
                            console.log('[AudioWorklet] 🔴 队列已清空，清空计数:', this.clearCount);
                        } else if (data.type === 'reset') {
                            // 重置播放器状态
                            console.log('[AudioWorklet] 🔴 收到重置指令');
                            this.queue = [];
                            this.current = null;
                            this.readIndex = 0;
                            this.isPlaying = false;
                            this.clearCount = 0;
                            console.log('[AudioWorklet] 🔴 播放器已重置');
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
            // 🔍 诊断日志1：检查音频流时序和队列状态
            const now = performance.now();
            console.log('[AudioPlayer] 🔍 音频流诊断:', {
                timestamp: now,
                dataSize: audioData.length,
                isPlaying: this.isPlaying,
                lastClearTime: this.lastClearTime,
                clearCount: this.clearCount,
                timeSinceLastClear: now - this.lastClearTime,
                potentialOverlap: this.isPlaying && (now - this.lastClearTime) < 100
            });

            // 调试：检查PCM数据质量
            if (audioData.length >= 4) {
                const dataView = new DataView(audioData.buffer, audioData.byteOffset, audioData.byteLength);
                const firstSample = dataView.getInt16(0, true); // 小端序
                const secondSample = dataView.getInt16(2, true); // 小端序
                console.debug('[AudioPlayer] 🔍 输入PCM样本检查:', {
                    dataSize: audioData.length,
                    sampleCount: audioData.length / 2,
                    firstSample,
                    secondSample,
                    firstSampleBigEndian: dataView.getInt16(0, false),
                    secondSampleBigEndian: dataView.getInt16(2, false),
                    byteOrder: 'little_endian_assumed'
                });
            }

            const floatData = pcm16ToFloat32(audioData);

            // 🔍 诊断日志2：检查Float32数据质量
            if (floatData.length >= 2) {
                const first100 = Array.from(floatData.slice(0, Math.min(100, floatData.length)));
                const floatRange = {
                    min: Math.min(...first100),
                    max: Math.max(...first100),
                    avg: first100.reduce((a, b) => a + b, 0) / first100.length,
                    zeroCount: first100.filter(x => Math.abs(x) < 0.001).length,
                    clipCount: first100.filter(x => Math.abs(x) > 0.99).length
                };
                
                console.log('[AudioPlayer] 🔍 音频质量诊断:', {
                    floatSize: floatData.length,
                    firstFloatSample: floatData[0],
                    secondFloatSample: floatData[1],
                    floatRange,
                    isInRange: floatData[0] >= -1 && floatData[0] <= 1,
                    potentialDistortion: floatRange.clipCount > 10 || floatRange.zeroCount > 80
                });
            }

            // 调试：检查AudioWorklet状态
            if (this.audioContext && this.playbackNode) {
                console.debug('[AudioPlayer] 🎛️ AudioWorklet状态检查:', {
                    contextState: this.audioContext.state,
                    sampleRate: this.audioContext.sampleRate,
                    currentTime: this.audioContext.currentTime,
                    workletProcessor: this.processorName,
                    nodeConnected: this.playbackNode.numberOfOutputs > 0,
                    destination: this.audioContext.destination ? 'available' : 'unavailable'
                });
            }

            // 将样本推送到播放队列，使用可转移对象减少拷贝
            if (this.playbackNode) {
                this.playbackNode.port.postMessage({ type: 'push', samples: floatData }, [floatData.buffer]);
                console.log('[AudioPlayer] 📤 音频数据已发送到AudioWorklet:', {
                    sampleCount: floatData.length,
                    bufferSize: floatData.buffer.byteLength,
                    transferable: true,
                    queueState: 'pending_push'
                });
            } else {
                console.warn('[AudioPlayer] ⚠️ AudioWorklet未初始化，无法播放音频');
            }

            this.isPlaying = true;
        } catch (error) {
            console.error('[AudioPlayer] ❌ 音频播放失败:', error);
            this.isPlaying = false;
        }
    }

    // 清空音频队列 - 用于音频打断（优化版本）
    clearQueue(): void {
        const now = Date.now();
        
        // 智能频率检查：防止过于频繁的清空操作
        if (now - this.lastClearTime < this.MIN_CLEAR_INTERVAL) {
            console.warn('[AudioPlayer] ⚠️ 清空操作过于频繁，跳过本次操作');
            console.log('[AudioPlayer] 📊 频率检查:', {
                lastClearTime: this.lastClearTime,
                currentTime: now,
                interval: now - this.lastClearTime,
                minInterval: this.MIN_CLEAR_INTERVAL,
                clearCount: this.clearCount
            });
            return;
        }
        
        // 智能状态检查：只有在真正需要时才清空
        if (!this.isPlaying) {
            console.log('[AudioPlayer] 🔍 播放器未活跃，跳过清空操作');
            return;
        }
        
        if (!this.playbackNode) {
            console.warn('[AudioPlayer] AudioWorklet未初始化，无法清空队列');
            return;
        }
        
        // 更新统计信息
        this.lastClearTime = now;
        this.clearCount++;
        
        console.log('[AudioPlayer] 🔴 执行智能音频队列清空');
        console.log('[AudioPlayer] 📊 清空统计:', {
            clearCount: this.clearCount,
            lastClearTime: this.lastClearTime,
            isPlaying: this.isPlaying,
            hasWorklet: !!this.playbackNode
        });
        
        // 发送清空指令
        this.playbackNode.port.postMessage({ type: 'clear' });
        
        // 立即更新播放状态
        this.isPlaying = false;
        console.log('[AudioPlayer] 🔴 播放状态已重置为false');
        
        // 如果清空次数过多，记录警告
        if (this.clearCount > this.MAX_CLEAR_COUNT) {
            console.warn('[AudioPlayer] 🚨 清空次数过多，可能存在异常:', {
                clearCount: this.clearCount,
                maxClearCount: this.MAX_CLEAR_COUNT,
                timeWindow: '最近一段时间'
            });
        }
    }

    // 强制重置播放器 - 用于彻底的音频打断（优化版本）
    forceReset(): void {
        const now = Date.now();
        
        // 智能频率检查：防止过于频繁的重置操作
        if (now - this.lastResetTime < this.MIN_RESET_INTERVAL) {
            console.warn('[AudioPlayer] ⚠️ 强制重置操作过于频繁，跳过本次操作');
            console.log('[AudioPlayer] 📊 频率检查:', {
                lastResetTime: this.lastResetTime,
                currentTime: now,
                interval: now - this.lastResetTime,
                minInterval: this.MIN_RESET_INTERVAL,
                resetCount: this.resetCount
            });
            return;
        }
        
        // 智能状态检查：只有在真正需要时才重置
        if (!this.isPlaying && !this.playbackNode) {
            console.log('[AudioPlayer] 🔍 播放器未活跃且未初始化，跳过强制重置');
            return;
        }
        
        // 更新统计信息
        this.lastResetTime = now;
        this.resetCount++;
        
        console.log('[AudioPlayer] 🔴 执行智能强制重置播放器');
        console.log('[AudioPlayer] 🚨 强制重置影响分析:');
        console.log('  - AudioWorklet时序基准将丢失');
        console.log('  - 后续音频播放可能短暂错乱');
        console.log('  - PCM数据与AudioContext需要重新同步');
        console.log('[AudioPlayer] 📊 重置统计:', {
            resetCount: this.resetCount,
            lastResetTime: this.lastResetTime,
            isPlaying: this.isPlaying,
            hasWorklet: !!this.playbackNode
        });
        
        if (this.playbackNode) {
            console.log('[AudioPlayer] 🔴 发送重置指令到AudioWorklet');
            this.playbackNode.port.postMessage({ type: 'reset' });
        }
        
        // 重置本地状态
        this.isPlaying = false;
        console.log('[AudioPlayer] 🔴 播放器已强制重置');
        
        // 如果重置次数过多，记录警告
        if (this.resetCount > this.MAX_RESET_COUNT) {
            console.warn('[AudioPlayer] 🚨 重置次数过多，可能存在异常:', {
                resetCount: this.resetCount,
                maxResetCount: this.MAX_RESET_COUNT,
                timeWindow: '最近一段时间'
            });
        }
    }

    // 检查播放器是否处于活跃状态
    get isPlaybackActive(): boolean {
        return this.isPlaying;
    }

    // 获取队列状态信息（用于调试和智能判断）
    getQueueStatus(): {
        isPlaying: boolean;
        hasWorklet: boolean;
        clearCount: number;
        resetCount: number;
        lastClearTime: number;
        lastResetTime: number;
    } {
        return {
            isPlaying: this.isPlaying,
            hasWorklet: !!this.playbackNode,
            clearCount: this.clearCount,
            resetCount: this.resetCount,
            lastClearTime: this.lastClearTime,
            lastResetTime: this.lastResetTime
        };
    }
    
    // 重置统计信息（用于调试或重置异常状态）
    resetStatistics(): void {
        this.clearCount = 0;
        this.resetCount = 0;
        this.lastClearTime = 0;
        this.lastResetTime = 0;
        console.log('[AudioPlayer] 📊 统计信息已重置');
    }

    // 停止播放
    stopPlayback(): void {
        console.log('[AudioPlayer] 🔴 停止播放被调用 - 开始完整清理');
        console.log('[AudioPlayer] 🔴 停止前状态:', {
            isPlaying: this.isPlaying,
            hasWorklet: !!this.playbackNode,
            hasContext: !!this.audioContext,
            contextState: this.audioContext?.state,
            clearCount: this.clearCount,
            resetCount: this.resetCount
        });
        
        // 先清空队列
        this.clearQueue();
        
        if (this.playbackNode) {
            try {
                console.log('[AudioPlayer] 🔴 断开AudioWorklet节点连接');
                this.playbackNode.disconnect();
            } catch (error) {
                console.warn('[AudioPlayer] 断开AudioWorklet连接时出错:', error);
            }
        }
        this.playbackNode = null;
        this.workletReady = null;

        if (this.audioContext && this.audioContext.state !== 'closed') {
            console.log('[AudioPlayer] 🔴 关闭AudioContext');
            this.audioContext.close().catch(error => {
                console.warn('Failed to close audio context:', error);
            });
        }

        this.audioContext = null;
        this.isPlaying = false;
        
        console.log('[AudioPlayer] 🔴 停止播放完成 - 全部资源已清理');
        console.log('[AudioPlayer] 🔴 停止后状态:', {
            isPlaying: this.isPlaying,
            hasWorklet: !!this.playbackNode,
            hasContext: !!this.audioContext
        });
    }
}