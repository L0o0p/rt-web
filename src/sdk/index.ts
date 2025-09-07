import { CONFIG } from './types/protocol.js';
import { AudioManager } from "./audio/AudioManager";
import { AudioPlayer } from "./audio/AudioPlayer";
import { WebSocketManager } from "./connection/WebSocketManager";
import type { VADResult } from "./types/protocol";
import { BinaryMessage } from './protocol/BinaryMessage';

export class RealTime {
    private websocketManager = new WebSocketManager();
    private audioManager = new AudioManager();
    private audioPlayer = new AudioPlayer();
    private audioDataBuffer: Float32Array[] = [];
    private recordedAudioData: any[] = []; // 存储录制的音频数据
    // private recordingTimer: number | null = null;
    private transmissionTimer: number | null = null;

    constructor() {
        // 设置VAD事件回调
        this.audioManager.on('speech:start', () => {
            console.log('Speech started');
        });
        
        this.audioManager.on('speech:end', (speechAudio: Float32Array) => {
            console.log('Speech ended');
        });
    }

    /**
     * 获取RealTime实例中的AudioManager
     * @returns AudioManager实例
     */
    getAudioManager(): AudioManager {
        return this.audioManager;
    }

    connectToServer = async () => {
        await this.websocketManager.connect({
        });
    }

    speak = async () => {
        // 清空之前录制的数据
        this.recordedAudioData = [];
        
        // 启用VAD
        this.audioManager.configure({ enabled: true });
        
        // 开始VAD音频处理
        await this.audioManager.start();
        
        // 开始传输音频数据
        this.startAudioTransmission();
    }

    stop = () => {
        this.audioManager.stop();
    }

    // 处理实时音频数据
    private handleRealtimeAudioData(audioData: Float32Array, vadResult: VADResult): void {
        // 始终保存录制的音频数据用于回放
        this.recordedAudioData.push({
            data: audioData,
            timestamp: Date.now()
        });
        
        // 只有当VAD检测到语音活动且WebSocket连接时，才添加到传输缓冲区
        // 注意：这里的VAD检测逻辑需要根据AudioManager的实际实现进行调整
        if (this.websocketManager.isConnected) {
            this.audioDataBuffer.push(audioData);

            // 控制缓冲区大小
            const MAX_BUFFER_SIZE = 5;
            while (this.audioDataBuffer.length > MAX_BUFFER_SIZE) {
                this.audioDataBuffer.shift();
            }
        }
    }

    // // 启动录音计时器
    // private startRecordingTimer(): void {
    //     this.recordingTimer = window.setInterval(() => {
    //         this.updateRecordingInfo();
    //     }, 100);
    // }

    private startAudioTransmission(): void {
        if (this.transmissionTimer) {
            return;
        }
        // 计时分片传输
        this.transmissionTimer = window.setInterval(async () => {
            await this.transmitAudioData();
        }, 100); // 使用固定的100ms间隔，或者从CONFIG中获取合适的值

    }
    
    // 播放录制的音频
    playRecordedAudio = async () => {
        console.log("播放录制的音频，共", this.recordedAudioData.length, "段");
        if (this.recordedAudioData.length > 0) {
            try {
                // 使用AudioPlayer播放录制的音频
                // 注意：这里需要根据AudioPlayer的实际接口进行调整
                console.log("录音播放完成");
            } catch (error) {
                console.error("播放录音失败:", error);
            }
        } else {
            console.log("没有录制的音频数据可播放");
        }
    }

    // 传输音频数据 （从内存获取、切片）
    private async transmitAudioData(): Promise<void> {
        if (this.audioDataBuffer.length > 0 && this.websocketManager.isConnected) {
            // 检查会话状态，如果会话未创建则不发送数据
            if (!this.websocketManager.isSessionCreated) {
                console.log('实时传输: 会话未创建，暂不发送数据');
                return;
            }

            // 获取会话ID
            const sessionId = this.websocketManager.currentSessionId;
            if (!sessionId) {
                console.log('实时传输: 会话ID缺失，无法发送音频数据');
                return;
            }

            // 从缓冲区中取出一块数据进行发送
            const audioChunk = this.audioDataBuffer.shift();
            if (!audioChunk) {
                return;
            }

            // 限制单次发送的数据大小为60个样本，与模拟传输保持一致
            let dataToSend: Float32Array;
            if (audioChunk.length > 60) {
                // 如果数据块太大，只取前60个样本
                dataToSend = audioChunk.slice(0, 60);
                // 将剩余部分放回缓冲区
                if (audioChunk.length > 60) {
                    this.audioDataBuffer.unshift(audioChunk.slice(60));
                }
            } else {
                // 数据块大小合适，直接使用
                dataToSend = audioChunk;
            }

            // 将浮点数数组转换为S16LE格式的字节数组
            const audioDataBytes = new Uint8Array(dataToSend.length * 2);
            for (let i = 0; i < dataToSend.length; i++) {
                const int16Value = Math.max(-32768, Math.min(32767, Math.round(dataToSend[i] * 32768)));
                audioDataBytes[i * 2] = int16Value & 0xFF;         // 低字节
                audioDataBytes[i * 2 + 1] = (int16Value >> 8) & 0xFF; // 高字节
            }

            // 创建并发送二进制音频数据消息
            const audioMessage = BinaryMessage.createAudioChunk(sessionId, audioDataBytes);
            this.websocketManager.sendBinaryMessage(audioMessage);
        }
    }
}