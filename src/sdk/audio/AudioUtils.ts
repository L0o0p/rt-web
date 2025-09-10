/**
 * 音频处理工具函数
 */

/**
 * 将16位PCM数据转换为Float32Array
 * @param pcmData 16位PCM数据
 * @returns Float32Array格式的数据，范围在 [-1, 1]
 * @throws {Error} 当输入数据无效时抛出错误
 */
export function pcm16ToFloat32(pcmData: Uint8Array): Float32Array {
  // 输入验证
  if (!pcmData) {
    throw new Error('Input PCM data is null or undefined');
  }

  // 检查数据长度是否为偶数（16位PCM应该是成对字节）
  if (pcmData.length % 2 !== 0) {
    console.warn('PCM data length is not even, may cause data loss');
  }

  const sampleCount = pcmData.length >> 1; // 等同于 Math.floor(pcmData.length / 2)，但更快
  const floatData = new Float32Array(sampleCount);

  // 使用 DataView 进行更高效的二进制数据操作
  const dataView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

  // 处理每个采样点
  for (let i = 0; i < sampleCount; i++) {
    // 直接读取有符号16位整数（小端序）
    const int16Value = dataView.getInt16(i * 2, true); // true 表示小端序

    // 归一化到 [-1, 1] 范围
    // 使用位移运算优化除法：32768 = 2^15
    floatData[i] = int16Value / 32768;
  }

  return floatData;
}

/**
 * 将Float32Array数据转换为16位PCM
 * @param floatData Float32Array数据
 * @returns 16位PCM数据
 */
export function float32ToPcm16(floatData: Float32Array, reuse?: Uint8Array): Uint8Array {
  const out = reuse && reuse.length >= floatData.length * 2 ? reuse : new Uint8Array(floatData.length * 2);
  const len = floatData.length;
  let o = 0;
  for (let i = 0; i < len; i++) {
    let s = floatData[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    const v = (s * 32767) | 0; // faster int
    const u = v < 0 ? v + 65536 : v;
    out[o++] = u & 0xFF;
    out[o++] = (u >> 8) & 0xFF;
  }
  return out;
}

/**
 * Base64 字符串转 Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * ArrayBuffer/SharedArrayBuffer 转 Base64 字符串
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | SharedArrayBuffer): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
