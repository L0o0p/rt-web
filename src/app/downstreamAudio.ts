import { audioProcessor } from '../sdk/audio/AudioCodec';

type DownstreamAudioSource = 'binary' | 'json';

interface DecodeDownstreamAudioOptions {
  bytes: Uint8Array;
  itemId?: unknown;
  responseId?: unknown;
  source: DownstreamAudioSource;
}

const toHex = (bytes: Uint8Array): string =>
  (Array.from(bytes) as number[]).map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

const buildAudioQualityCheck = (pcmBytes: Uint8Array) => {
  if (pcmBytes.length < 4) return null;

  const dataView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const samples = [];
  for (let index = 0; index < Math.min(10, pcmBytes.length / 2); index += 1) {
    samples.push(dataView.getInt16(index * 2, true));
  }
  const maxSample = Math.max(...samples.map(Math.abs));
  const avgSample = samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length;

  return {
    maxAbsSample: maxSample,
    avgAbsSample: avgSample,
    isReasonableRange: maxSample <= 32767 && avgSample > 10,
    sampleValues: samples.slice(0, 5),
  };
};

const logPcmProbe = (label: string, pcmBytes: Uint8Array) => {
  if (pcmBytes.length < 4) return;

  const dataView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const firstSampleLE = dataView.getInt16(0, true);
  const firstSampleBE = dataView.getInt16(0, false);
  console.debug(`[APP] 🔊 ${label}直接PCM样本值对比:`, {
    firstSampleLittleEndian: firstSampleLE,
    firstSampleBigEndian: firstSampleBE,
    sampleDifference: Math.abs(firstSampleLE - firstSampleBE),
    isLittleEndianReasonable: Math.abs(firstSampleLE) < 32768 && Math.abs(firstSampleLE) > 100,
    isBigEndianReasonable: Math.abs(firstSampleBE) < 32768 && Math.abs(firstSampleBE) > 100,
  });
};

export const decodeDownstreamAudio = ({
  bytes,
  itemId,
  responseId,
  source,
}: DecodeDownstreamAudioOptions): Uint8Array | null => {
  const label = source === 'binary' ? '二进制' : 'JSON协议';
  const shortLabel = source === 'binary' ? '二进制' : 'JSON';
  const slice16 = bytes.slice(0, 16);
  const slice100 = bytes.slice(0, 100);
  const slice100Array = Array.from(slice100) as number[];

  console.debug(`[APP] 🔍 ${label}音频数据详情:`, {
    dataSize: bytes.length,
    responseId,
    itemId,
    firstFewBytes: Array.from(slice16),
    firstFewBytesHex: toHex(slice16),
    possibleOpusSignature: toHex(bytes.slice(0, 8)),
    minByteValue: Math.min(...slice100Array),
    maxByteValue: Math.max(...slice100Array),
    avgByteValue: slice100Array.reduce((sum: number, byte: number) => sum + byte, 0) / 100,
  });

  let pcmBytes: Uint8Array;
  let decodingMethod = '';

  try {
    console.debug(`[APP] 🎵 尝试对${label}音频数据进行Opus解码...`);
    const decoded = audioProcessor.decodeOpus(bytes);
    if (!decoded) {
      throw new Error('Opus解码返回null');
    }

    pcmBytes = decoded;
    decodingMethod = 'opus_decoded';
    console.debug(`[APP] ✅ ${shortLabel} Opus解码成功，PCM数据大小:`, pcmBytes.length);

    if (pcmBytes.length > 0) {
      const dataView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
      console.debug(`[APP] 🔊 ${shortLabel}解码后PCM样本值 (小端序):`, {
        firstSample: dataView.getInt16(0, true),
        secondSample: dataView.getInt16(2, true),
        firstSampleBigEndian: dataView.getInt16(0, false),
        secondSampleBigEndian: dataView.getInt16(2, false),
      });
    }
  } catch (error) {
    const message = source === 'binary'
      ? '假设数据已经是PCM格式'
      : '使用原始数据';
    console.warn(`[APP] ❌ ${shortLabel} Opus解码失败，${message}:`, error);
    pcmBytes = bytes;
    decodingMethod = 'direct_pcm';
    logPcmProbe(shortLabel, pcmBytes);
  }

  console.debug(`[APP] 📊 ${shortLabel}最终PCM数据详情:`, {
    dataSize: pcmBytes.length,
    sampleCount: pcmBytes.length / 2,
    firstFewBytes: Array.from(pcmBytes.slice(0, 16)),
    firstFewBytesHex: toHex(pcmBytes.slice(0, 16)),
    isEvenLength: pcmBytes.length % 2 === 0,
    decodingMethod,
    audioQualityCheck: buildAudioQualityCheck(pcmBytes),
  });

  if (pcmBytes.length === 0) {
    console.warn('[APP] 没有有效的音频数据，跳过播放');
    return null;
  }

  return pcmBytes;
};
