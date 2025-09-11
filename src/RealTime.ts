import { AudioManager } from './sdk/audio/AudioManager';
import { VoiceChatCore } from './sdk/core/VoiceChatCore';
import type { SessionConfigPayload } from './sdk/protocol/ClientProtocol';
import { ProtocolId } from './sdk/protocol/ClientProtocol';
import { float32ToPcm16 } from './sdk/audio/AudioUtils';

export class RealTime {
    private voiceChatCore: VoiceChatCore;
    private audioManager = new AudioManager();
    private transmissionTimer: number | null = null;
    private nextSendAt: number | null = null;

    constructor() {
        const defaultConfig: Partial<SessionConfigPayload> = {
            asr_language: 'zh',
            mode: 'vad',
            timezone: 'Asia/Shanghai',
            location: '中国'
        };
        this.voiceChatCore = new VoiceChatCore(defaultConfig);
    }

    getVoiceChatCore(): VoiceChatCore {
        return this.voiceChatCore;
    }

    getAudioManager(): AudioManager {
        return this.audioManager;
    }

    setSessionConfig(config: Partial<SessionConfigPayload>): void {
        this.voiceChatCore.setSessionConfig(config);
    }

    startSession(config?: Partial<SessionConfigPayload>): void {
        this.voiceChatCore.startSession(config);
    }

    connectToServer = async () => {
        await this.voiceChatCore.connect();
    };

    speak = async () => {
        this.audioManager.configure({ enabled: true });
        await this.audioManager.start();
    };

    stop = () => {
        this.audioManager.stop();
        if (this.transmissionTimer) {
            window.clearTimeout(this.transmissionTimer);
            this.transmissionTimer = null;
        }
        this.nextSendAt = null;
    };

    public startAudioTransmission(audioDataBuffer: Float32Array[]): void {
        if (this.transmissionTimer) return;
        const TICK_MS = 50; // 以更细粒度发送
        this.nextSendAt = performance.now();

        const tick = async () => {
            await this.transmitAudioData(audioDataBuffer);
            const now = performance.now();
            const next = (this.nextSendAt ?? now) + TICK_MS;
            this.nextSendAt = next;
            const delay = Math.max(0, next - now);
            this.transmissionTimer = window.setTimeout(tick, delay);
        };

        this.transmissionTimer = window.setTimeout(tick, 0);
    }

    public async transmitAudioData(audioDataBuffer: Float32Array[]): Promise<void> {
        if (audioDataBuffer.length === 0 || !this.voiceChatCore.isConnected) return;
        if (!this.voiceChatCore.isSessionCreated) return;

        const audioChunk = audioDataBuffer.shift();
        if (!audioChunk) return;
        const dataToSend = audioChunk.length > 60 ? audioChunk.slice(0, 60) : audioChunk;
        if (audioChunk.length > 60) {
            audioDataBuffer.unshift(audioChunk.slice(60));
        }
        const pcmBytes = float32ToPcm16(dataToSend);
        this.voiceChatCore.sendEncodedAudioData(pcmBytes);
    }

    /**
     * 发送图像数据
     */
    public sendImageData(imageData: Uint8Array, protocolId?: ProtocolId): boolean {
        return this.voiceChatCore.sendImageData(imageData, protocolId);
    }
}


