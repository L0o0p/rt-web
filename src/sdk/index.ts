import { CONFIG } from './types/protocol.js';
import { AudioProcessor } from "./audio/AudioProcessor";
import { AudioPlayer } from "./audio/AudioPlayer";
import { WebSocketManager } from "./connection/WebSocketManager";
import type { VADResult, AudioChunk } from "./types/protocol";
import { BinaryMessage } from './protocol/BinaryMessage';

export class RealTime {
    private websocketManager = new WebSocketManager();
    private audioProcessor = new AudioProcessor();
    private audioPlayer = new AudioPlayer();
    private audioDataBuffer: Float32Array[] = [];
    private recordedAudioData: AudioChunk[] = []; // 存储录制的音频数据
    // private recordingTimer: number | null = null;
    private transmissionTimer: number | null = null;


    connectToServer = async () => {
        await this.websocketManager.connect({

        });
    }

    speak = async () => {
        // 清空之前录制的数据
        this.recordedAudioData = [];
        
        await this.audioProcessor.startRecording(undefined, (audioData, vadResult: VADResult) => {
            // 处理实时音频数据
            this.handleRealtimeAudioData(audioData, vadResult);
        });

        // 录音计时器
        // this.startRecordingTimer()
        // 开始传输音频数据
        this.startAudioTransmission();
    }

    stop = () => {
        this.audioProcessor.stopRecording();
    }

    // 处理实时音频数据
    private handleRealtimeAudioData(audioData: Float32Array, vadResult: VADResult): void {
        // 始终保存录制的音频数据用于回放
        this.recordedAudioData.push({
            data: audioData,
            timestamp: Date.now()
        });
        
        // 只有当VAD检测到语音活动且WebSocket连接时，才添加到传输缓冲区
        if (this.websocketManager.isConnected && vadResult.isActive) {
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
        }, CONFIG.TRANSMISSION_INTERVAL);

    }
    
    // 播放录制的音频
    playRecordedAudio = async () => {
        console.log("播放录制的音频，共", this.recordedAudioData.length, "段");
        if (this.recordedAudioData.length > 0) {
            try {
                // 使用AudioPlayer播放录制的音频
                await this.audioPlayer.playRecordedAudio(this.recordedAudioData);
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