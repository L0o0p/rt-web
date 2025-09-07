import * as mod from '@evan/wasm/target/opus/deno.js';
import { AUDIO_QUALITY } from '../types/protocol.js';
import { pcm16ToFloat32, float32ToPcm16 } from './AudioUtils';
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
        sample_rate: AUDIO_QUALITY.SAMPLE_RATE
      });

      // 初始化Opus解码器
      this.decoder = new mod.Decoder({
        channels: 1,
        sample_rate: AUDIO_QUALITY.SAMPLE_RATE
      });

      console.log('AudioProcessor initialized with Opus encoder/decoder');
    } catch (error) {
      console.error('Failed to initialize Opus encoder/decoder:', error);
    }
  }
  /**
   * Opus编码PCM音频数据
   * @param pcmData 16位PCM音频数据 (Uint8Array)
   * @returns Opus编码后的数据
   */
  encodeOpus(pcmData: Uint8Array): Uint8Array {
    if (!this.encoder) {
      console.error('Opus encoder not initialized');
      throw new Error('Opus encoder not initialized');
    }

    try {
      // 将16位PCM数据转换为Float32Array格式供Opus编码器使用
      const floatData = pcm16ToFloat32(pcmData);

      // 执行Opus编码
      const encodedData = this.encoder.encode(floatData);

      // 转换为Uint8Array格式返回
      return new Uint8Array(encodedData.buffer);
    } catch (error) {
      console.error('Opus encoding failed:', error);
      throw error;
    }
  }

  /**
   * Opus解码数据到PCM
   * @param opusData Opus编码的数据
   * @returns 解码后的16位PCM数据
   */
  decodeOpus(opusData: Uint8Array): Uint8Array | null {
    if (!this.decoder) {
      console.error('Opus decoder not initialized');
      return null;
    }

    try {
      // 执行Opus解码
      // 注意：decoder.decode可能直接返回PCM数据而不是Float32Array
      // 需要根据实际库的行为进行调整
      const decodedData = this.decoder.decode(opusData);

      // 如果返回的是Float32Array，则转换为16位PCM格式
      if (decodedData instanceof Float32Array) {
        return float32ToPcm16(decodedData);
      }

      // 如果已经是PCM格式则直接返回
      return decodedData as Uint8Array;
    } catch (error) {
      console.error('Opus decoding failed:', error);
      return null;
    }
  }

  /**
   * 释放资源
   */
  destroy(): void {
    if (this.encoder) {
      // 如果库提供了销毁方法，这里调用它
      this.encoder = null;
    }

    if (this.decoder) {
      // 如果库提供了销毁方法，这里调用它
      this.decoder = null;
    }
    console.log('AudioProcessor destroyed');
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