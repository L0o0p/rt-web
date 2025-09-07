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
export function float32ToPcm16(floatData: Float32Array): Uint8Array {
  const pcmData = new Uint8Array(floatData.length * 2);

  for (let i = 0; i < floatData.length; i++) {
    const floatValue = Math.max(-1, Math.min(1, floatData[i]));
    const int16Value = Math.round(floatValue * 32767);
    const unsignedValue = int16Value < 0 ? int16Value + 65536 : int16Value;

    // 小端序编码
    pcmData[i * 2] = unsignedValue & 0xFF;
    pcmData[i * 2 + 1] = (unsignedValue >> 8) & 0xFF;
  }

  return pcmData;
}
