import { AudioManager } from './sdk/audio/AudioManager';
import { VoiceChatCore } from './sdk/core/VoiceChatCore';
import { BINARY_MESSAGE, type ProtocolId, type SessionConfigPayload } from './sdk/protocol/ClientProtocol';
import { float32ToPcm16 } from './sdk/audio/AudioUtils';
import {
    LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY,
    LOCKED_SESSION_ID_STORAGE_KEY,
    DEFAULT_SESSION_LOCATION,
    VOICE_PRESET_STORAGE_KEY,
    type VoicePreset,
    voiceSettingForPreset,
} from './app/architectureDecisions';

export class RealTime {
    private voiceChatCore: VoiceChatCore;
    private audioManager = new AudioManager();
    private transmissionTimer: number | null = null;
    private nextSendAt: number | null = null;

    constructor() {
        const voicePreset: VoicePreset = (() => {
            try {
                const preset = localStorage.getItem(VOICE_PRESET_STORAGE_KEY);
                if (preset === 'soft' || preset === 'default') return preset;
                const legacy = localStorage.getItem(LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY);
                return (legacy === '1' || legacy === 'true') ? 'soft' : 'default';
            } catch {
                return 'default';
            }
        })();
        const lockedSessionId = (() => {
            try {
                const stored = localStorage.getItem(LOCKED_SESSION_ID_STORAGE_KEY)?.trim();
                if (!stored) return undefined;
                if (stored.length === BINARY_MESSAGE.NANOID_SIZE) return stored;
                localStorage.removeItem(LOCKED_SESSION_ID_STORAGE_KEY);
            } catch {
                // ignore
            }
            return undefined;
        })();

        const defaultConfig: Partial<SessionConfigPayload> = {
            asr_language: 'zh',
            mode: 'vad',
            timezone: 'Asia/Shanghai',
            location: DEFAULT_SESSION_LOCATION,
            voice_setting: voiceSettingForPreset(voicePreset)
        };
        this.voiceChatCore = new VoiceChatCore(defaultConfig, lockedSessionId);
    }

    getVoiceChatCore(): VoiceChatCore {
        return this.voiceChatCore;
    }

    getAudioManager(): AudioManager {
        return this.audioManager;
    }

    setSessionConfig(config: Partial<SessionConfigPayload>, protocolId?: ProtocolId): void {
        this.voiceChatCore.setSessionConfig(config, protocolId);
    }

    startSession(config?: Partial<SessionConfigPayload>, protocolId?: ProtocolId): void {
        this.voiceChatCore.startSession(config, protocolId);
    }

    startNewSession(config?: Partial<SessionConfigPayload>, protocolId?: ProtocolId): void {
        this.voiceChatCore.startNewSession(config, protocolId);
    }

    lockSessionId(sessionId?: string): string {
        return this.voiceChatCore.lockSessionId(sessionId);
    }

    unlockSessionId(): void {
        this.voiceChatCore.unlockSessionId();
    }

    stopSession(protocolId?: ProtocolId): void {
        this.voiceChatCore.stopSession(protocolId);
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
     * @param imageData 图像二进制数据
     * @param prompt 可选的提示词
     * @param protocolId 协议ID，默认为All
     */
    public sendImageData(imageData: Uint8Array, prompt?: string, protocolId?: ProtocolId): boolean {
        return this.voiceChatCore.sendImageData(imageData, prompt, protocolId);
    }
}
