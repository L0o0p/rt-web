import { AUDIO_QUALITY } from '../types/protocol.js';
import { audioProcessor } from './AudioCodec.js';

export class AudioChunker {
    // 固定分片缓冲区
    private fixedChunkBuffer: Uint8Array = new Uint8Array(0);
    private audioChunkSize: number = AUDIO_QUALITY.FIXED_CHUNK_SIZE; // 固定分片大小（字节）
    private onChunkProcessed: (chunk: Uint8Array) => Promise<void>;
    private encodeOpus: boolean = false; // 是否进行Opus编码

    constructor(onChunkProcessed: (chunk: Uint8Array) => Promise<void>, audioChunkSize: number = AUDIO_QUALITY.FIXED_CHUNK_SIZE, encodeOpus: boolean = false) {
        this.audioChunkSize = audioChunkSize;
        this.encodeOpus = encodeOpus;

        this.onChunkProcessed = onChunkProcessed;
    }

    setEncodeOpus(encodeOpus: boolean) {
        this.encodeOpus = encodeOpus;
        console.debug("encodeOpus", encodeOpus);
    }

    /**
     * 添加新的音频数据到处理流程
     * @param audioData 原始音频数据
     */
    addAudioData(audioData: Uint8Array): void {
        // 将新音频数据添加到固定分片缓冲区
        const newBuffer = new Uint8Array(this.fixedChunkBuffer.length + audioData.length);
        newBuffer.set(this.fixedChunkBuffer);
        newBuffer.set(audioData, this.fixedChunkBuffer.length);
        let position = 0
        if (this.encodeOpus) {
            while (position + this.audioChunkSize <= newBuffer.length) {
                const end = Math.min(position + this.audioChunkSize, newBuffer.length)
                const chunk = newBuffer.slice(position, end);
                const encoded_data = audioProcessor.encodeOpus(chunk)
                this.onChunkProcessed(encoded_data);
                // 提取固定大小的分片并记录游标
                position += this.audioChunkSize
            }
        }
        else {
            while (position + this.audioChunkSize <= newBuffer.length) {
                const end = Math.min(position + this.audioChunkSize, newBuffer.length)
                const chunk = newBuffer.slice(position, end);
                this.onChunkProcessed(chunk);
                // 提取固定大小的分片并记录游标
                position += this.audioChunkSize
            }
        }
        const remain = newBuffer.slice(position)
        this.fixedChunkBuffer = remain;
    }

    stop(): void {
    }
}