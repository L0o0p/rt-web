import * as mod from '@evan/wasm/target/opus/deno.js';
import { AUDIO_QUALITY } from '../types/protocol';
import { pcm16ToFloat32 } from './AudioUtils';
export class AudioProcessor {
  private encoder: mod.Encoder | null = null;
  private decoder: mod.Decoder | null = null;

  constructor() {
    try {
      // 初始化Opus编码器
      // 注意：Opus通常使用48kHz采样率，但项目中使用16kHz
      // 我们需要根据实际需求选择合适的采样率
      this.encoder = new mod.Encoder({
        channels: 1,
        sample_rate: AUDIO_QUALITY.SAMPLE_RATE,
        application: 'voip'
      });

      // 配置Opus编码器
      // 设置复杂度为10（最高质量）
      this.encoder.ctl(4010, 10);  // OPUS_SET_COMPLEXITY

      // 设置比特率为24kbps
      this.encoder.ctl(4002, 24000);  // OPUS_SET_BITRATE

      // 设置带宽为全带宽
      this.encoder.ctl(4008, 1105);  // OPUS_SET_BANDWIDTH, OPUS_BANDWIDTH_FULLBAND

      // 初始化Opus解码器
      this.decoder = new mod.Decoder({
        channels: 1,
        sample_rate: AUDIO_QUALITY.SAMPLE_RATE
      });

      console.log('[AudioCodec] AudioProcessor initialized with Opus encoder/decoder - Sample rate:', AUDIO_QUALITY.SAMPLE_RATE, 'Channels: 1');
    } catch (error) {
      console.error('[AudioCodec] Failed to initialize Opus encoder/decoder:', error);
    }
  }
  /**
   * Opus编码PCM音频数据
   * @param pcmData 16位PCM音频数据 (Uint8Array)
   * @returns Opus编码后的数据
   */
  encodeOpus(pcmData: Uint8Array): Uint8Array {
    console.log('[AudioCodec] Starting Opus encoding - Input data size:', pcmData.length, 'bytes');

    if (!this.encoder) {
      console.error('[AudioCodec] Opus encoder not initialized');
      throw new Error('Opus encoder not initialized');
    }

    try {
      // 将16位PCM数据转换为Float32Array格式供Opus编码器使用
      const floatData = pcm16ToFloat32(pcmData);
      console.log('[AudioCodec] Converted PCM to Float32 - Samples count:', floatData.length);

      // 执行Opus编码
      const encodedData = this.encoder.encode(floatData);
      console.log('[AudioCodec] Raw Opus encoding completed - Encoded data size:', encodedData.byteLength, 'bytes');

      console.log('[AudioCodec] Final Opus encoding completed - Original size:', pcmData.length, 'bytes, Encoded size:', encodedData.length, 'bytes, Compression ratio:', (pcmData.length / encodedData.length).toFixed(2));

      return encodedData;
    } catch (error) {
      console.error('[AudioCodec] Opus encoding failed:', error);
      throw error;
    }
  }

  /**
   * Opus解码数据到PCM
   * @param opusData Opus编码的数据
   * @returns 解码后的16位PCM数据
   */
  decodeOpus(opusData: Uint8Array): Uint8Array | null {
    console.log('[AudioCodec] Starting Opus decoding - Input data size:', opusData.length, 'bytes');

    if (!this.decoder) {
      console.error('[AudioCodec] Opus decoder not initialized');
      return null;
    }

    try {
      // 执行Opus解码
      const decodedData = this.decoder.decode(opusData);
      console.log('[AudioCodec] Raw Opus decoding completed');

      // 转换为16位PCM格式
      // 注意：这里假设 decodedData 是 Float32Array 格式，我们需要将其转换为16位PCM
      // 但实际上 decodedData 应该是 Uint8Array，所以我们先尝试直接使用
      const pcmData = decodedData;
      console.log('[AudioCodec] PCM data returned - Original size:', opusData.length, 'bytes, Decoded size:', pcmData.length, 'bytes');
      return pcmData;
    } catch (error) {
      console.error('[AudioCodec] Opus decoding failed:', error);
      return null;
    }
  }

  /**
   * 释放资源
   */
  destroy(): void {
    if (this.encoder) {
      this.encoder.drop();
      this.encoder = null;
    }

    if (this.decoder) {
      this.decoder.drop();
      this.decoder = null;
    }
    console.log('[AudioCodec] AudioProcessor destroyed');
  }
}

export class AudioProcessorSingleton {
  private static instance: AudioProcessor | null = null;

  constructor() { }
  static getInstance(): AudioProcessor {
    if (!AudioProcessorSingleton.instance) {
      AudioProcessorSingleton.instance = new AudioProcessor();
    }
    return AudioProcessorSingleton.instance;
  }
}

export const audioProcessor = AudioProcessorSingleton.getInstance();