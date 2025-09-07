import * as mod from '@evan/wasm/target/opus/deno.js';
import { AUDIO_QUALITY } from '../protocol/ClientProtocol';
import { float32ToPcm16 } from './AudioUtils';
// Removed unused Float32 conversion import to enforce 20ms PCM S16LE frame encoding
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
      if (this.encoder) {
        // 设置复杂度为2（服务端期望）
        this.encoder.ctl(4010, 2);  // OPUS_SET_COMPLEXITY

        // 设置比特率为32kbps（服务端期望）
        this.encoder.ctl(4002, 32000);  // OPUS_SET_BITRATE

        // 设置带宽为全带宽（服务端期望）
        this.encoder.ctl(4008, 1105);  // OPUS_SET_BANDWIDTH, OPUS_BANDWIDTH_FULLBAND
      }

      // 初始化Opus解码器
      this.decoder = new mod.Decoder({
        channels: 1,
        sample_rate: AUDIO_QUALITY.SAMPLE_RATE
      });

      console.warn('[AudioCodec] AudioProcessor initialized - Opus encoder/decoder @', AUDIO_QUALITY.SAMPLE_RATE, 'Hz, Channels: 1');
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
    // console.debug('[AudioCodec] Starting Opus encoding - Input size:', pcmData.length, 'bytes');

    // 检查输入数据是否为空
    if (!pcmData || pcmData.length === 0) {
      console.warn('[AudioCodec] Warning: Empty PCM data provided for Opus encoding');
      return new Uint8Array(0);
    }

    // 验证输入数据长度是否为偶数（16位PCM数据应该是成对字节）
    if (pcmData.length % 2 !== 0) {
      console.warn('[AudioCodec] Warning: PCM data length is not even, may cause issues - length:', pcmData.length);
      // 截断最后一个字节以保持偶数长度
      pcmData = pcmData.subarray(0, pcmData.length - 1);
    }

    // 计算每通道样本数（单声道）
    const samplesPerChannel = pcmData.length / 2; // 2字节一个样本
    const expectedSamplesPer20ms = 16000 * 0.02; // 320 samples

    // 强制要求20ms帧长度
    if (samplesPerChannel !== expectedSamplesPer20ms) {
      console.warn('[AudioCodec] Warning: Frame size is not 20ms. got:', samplesPerChannel, 'expected:', expectedSamplesPer20ms);
      if (samplesPerChannel < expectedSamplesPer20ms) {
        // 数据不足一个20ms帧，丢弃，等待聚齐
        return new Uint8Array(0);
      } else if (samplesPerChannel > expectedSamplesPer20ms) {
        // 大于一帧，仅编码前20ms，剩余部分应在上层切片
        pcmData = pcmData.subarray(0, expectedSamplesPer20ms * 2);
      }
    }

    if (!this.encoder) {
      console.error('[AudioCodec] Opus encoder not initialized');
      throw new Error('Opus encoder not initialized');
    }

    try {
      // 直接使用16位PCM字节喂给编码器，确保一帧=20ms（640字节，单声道）
      const encodedData = this.encoder.encode(pcmData);
      // console.debug('[AudioCodec] Raw Opus encoding completed - Encoded size:', encodedData.byteLength, 'bytes');

      if (!encodedData || encodedData.length === 0) {
        // console.warn('[AudioCodec] Warning: Opus encoding returned empty or invalid data');
        return new Uint8Array(0);
      }

      // console.debug('[AudioCodec] Final Opus encoding - Original:', pcmData.length, 'bytes, Encoded:', encodedData.length, 'bytes, Ratio:', (pcmData.length / encodedData.length).toFixed(2));
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
    // console.debug('[AudioCodec] Starting Opus decoding - Input size:', opusData.length, 'bytes');

    if (!this.decoder) {
      console.error('[AudioCodec] Opus decoder not initialized');
      return null;
    }

    try {
      // 执行Opus解码
      const decodedData = this.decoder.decode(opusData) as unknown;
      // console.debug('[AudioCodec] Raw Opus decoding completed');

      // 规范化输出为 S16LE 的 Uint8Array
      if (decodedData instanceof Uint8Array) {
        // console.debug('[AudioCodec] Decoder returned Uint8Array PCM');
        return decodedData;
      }
      if (decodedData instanceof Int16Array) {
        // console.debug('[AudioCodec] Decoder returned Int16Array PCM');
        // 注意保留视图偏移
        const bytes = new Uint8Array(decodedData.buffer, decodedData.byteOffset, decodedData.byteLength);
        return new Uint8Array(bytes); // 拷贝成独立缓冲
      }
      if (decodedData instanceof Float32Array) {
        // console.debug('[AudioCodec] Decoder returned Float32Array PCM, converting to S16LE');
        return float32ToPcm16(decodedData);
      }
      if (decodedData instanceof ArrayBuffer) {
        // console.debug('[AudioCodec] Decoder returned ArrayBuffer PCM');
        return new Uint8Array(decodedData);
      }

      // console.warn('[AudioCodec] Unexpected decoder output type, cannot normalize');
      return null;
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
    // console.debug('[AudioCodec] AudioProcessor destroyed');
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