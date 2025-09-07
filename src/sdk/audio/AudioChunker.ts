import { AUDIO_QUALITY } from '../types/protocol';
import { audioProcessor } from './AudioCodec';

export class AudioChunker {
    // 固定分片缓冲区
    private fixedChunkBuffer: Uint8Array = new Uint8Array(0);
    private audioChunkSize: number = AUDIO_QUALITY.FIXED_CHUNK_SIZE; // 固定分片大小（字节）
    private onChunkProcessed: (chunk: Uint8Array) => Promise<void>;
    private encodeOpus: boolean = true; // 是否进行Opus编码

    constructor(onChunkProcessed: (chunk: Uint8Array) => Promise<void>, audioChunkSize: number = AUDIO_QUALITY.FIXED_CHUNK_SIZE, encodeOpus: boolean = true) {
        this.audioChunkSize = audioChunkSize;
        this.encodeOpus = encodeOpus;

        this.onChunkProcessed = onChunkProcessed;
        
        console.log('[AudioChunker] Initialized with chunk size:', this.audioChunkSize, 'and Opus encoding:', this.encodeOpus);
    }

    setEncodeOpus(encodeOpus: boolean) {
        this.encodeOpus = encodeOpus;
        console.log('[AudioChunker] Opus encoding set to:', encodeOpus);
    }

    /**
     * 添加新的音频数据到处理流程
     * @param audioData 原始音频数据
     */
    addAudioData(audioData: Uint8Array): void {
        console.log('[AudioChunker] Adding audio data with length:', audioData.length, 'bytes');
        
        // 将新音频数据添加到固定分片缓冲区
        const newBuffer = new Uint8Array(this.fixedChunkBuffer.length + audioData.length);
        newBuffer.set(this.fixedChunkBuffer);
        newBuffer.set(audioData, this.fixedChunkBuffer.length);
        
        console.log('[AudioChunker] Buffer updated, total length:', newBuffer.length, 'bytes');
        
        let position = 0;
        let chunkCount = 0;
        
        if (this.encodeOpus) {
            console.log('[AudioChunker] Processing with Opus encoding');
            
            while (position + this.audioChunkSize <= newBuffer.length) {
                const end = Math.min(position + this.audioChunkSize, newBuffer.length);
                const chunk = newBuffer.slice(position, end);
                
                console.log('[AudioChunker] Processing chunk', chunkCount, 'with size:', chunk.length, 'bytes');
                
                try {
                    const encoded_data = audioProcessor.encodeOpus(chunk);
                    console.log('[AudioChunker] Opus encoding completed for chunk', chunkCount, '- Original size:', chunk.length, 'bytes, Encoded size:', encoded_data.length, 'bytes');
                    
                    this.onChunkProcessed(encoded_data);
                    console.log('[AudioChunker] Processed chunk', chunkCount, 'sent to handler');
                } catch (error) {
                    console.error('[AudioChunker] Opus encoding failed for chunk', chunkCount, ':', error);
                }
                
                // 提取固定大小的分片并记录游标
                position += this.audioChunkSize;
                chunkCount++;
            }
        } else {
            console.log('[AudioChunker] Processing without encoding (raw PCM)');
            
            while (position + this.audioChunkSize <= newBuffer.length) {
                const end = Math.min(position + this.audioChunkSize, newBuffer.length);
                const chunk = newBuffer.slice(position, end);
                
                console.log('[AudioChunker] Processing raw chunk', chunkCount, 'with size:', chunk.length, 'bytes');
                
                this.onChunkProcessed(chunk);
                console.log('[AudioChunker] Processed raw chunk', chunkCount, 'sent to handler');
                
                // 提取固定大小的分片并记录游标
                position += this.audioChunkSize;
                chunkCount++;
            }
        }
        
        const remain = newBuffer.slice(position);
        this.fixedChunkBuffer = remain;
        
        console.log('[AudioChunker] Processing completed. Processed', chunkCount, 'chunks. Remaining buffer size:', remain.length, 'bytes');
    }

    stop(): void {
        console.log('[AudioChunker] Stopped');
    }
}