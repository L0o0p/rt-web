# 二进制音频协议解析指南

## 核心要点

从JSON格式迁移到二进制格式的主要变化：

**重要变更**: 延迟计算方式已从 `response.audio.delta` 改为 `binary_audio_delta`，二进制协议提供更精确的延迟测量能力。

### 1. 消息格式变化

**之前的JSON格式** (response.audio.delta - 备用方案):
```json
{
  "type": "response.audio.delta",
  "response_id": "resp_123",
  "item_id": "item_456",
  "output_index": 0,
  "content_index": 0,
  "delta": "base64编码的音频数据"
}
```

**现在的二进制格式** (binary_audio_delta - 优先方案):
```
[32字节头部] + [可变长度载荷]
```

### 2. 二进制头部结构 (32字节)

```typescript
// 偏移量 | 大小 | 说明
// 0-15   | 16  | session_id (nanoid)
// 16     | 1   | protocol_id (TTS=3, All=100)
// 17     | 1   | command_id (ResponseAudioDelta=20)
// 18-31  | 14  | reserved (全0)
```

### 3. 载荷格式 (ResponseAudioDelta)

```
[response_id_len(4)] + [response_id] + [item_id_len(4)] + [item_id] + [output_index(4)] + [content_index(4)] + [audio_data]
```

## TypeScript解析代码

```typescript
class BinaryAudioParser {
    parseResponseAudioDelta(data: ArrayBuffer): ParsedAudioChunk | null {
        // 1. 检查最小长度
        if (data.length < 32) {
            console.error('数据太短，不是有效的二进制消息');
            return null;
        }

        // 2. 解析头部
        const headerView = new DataView(data, 0, 32);

        // 读取command_id (偏移量17)
        const commandId = headerView.getUint8(17);

        // 检查是否为音频增量消息
        if (commandId !== 20) { // ResponseAudioDelta = 20
            return null;
        }

        // 3. 解析载荷
        return this.parsePayload(data.slice(32));
    }

    private parsePayload(payload: ArrayBuffer): ParsedAudioChunk {
        const view = new DataView(payload);
        let offset = 0;

        // 读取response_id
        const responseIdLen = view.getUint32(offset, true); // 小端序
        offset += 4;
        const responseId = this.readString(view, offset, responseIdLen);
        offset += responseIdLen;

        // 读取item_id
        const itemIdLen = view.getUint32(offset, true);
        offset += 4;
        const itemId = this.readString(view, offset, itemIdLen);
        offset += itemIdLen;

        // 读取output_index
        const outputIndex = view.getUint32(offset, true);
        offset += 4;

        // 读取content_index
        const contentIndex = view.getUint32(offset, true);
        offset += 4;

        // 剩余的是音频数据
        const audioData = payload.slice(offset);

        return {
            responseId,
            itemId,
            outputIndex,
            contentIndex,
            audioData
        };
    }

    private readString(view: DataView, offset: number, length: number): string {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
        return new TextDecoder('utf-8').decode(bytes);
    }
}

interface ParsedAudioChunk {
    responseId: string;
    itemId: string;
    outputIndex: number;
    contentIndex: number;
    audioData: ArrayBuffer;
}
```

## WebSocket集成

```typescript
// 在您的WebSocket处理器中
websocket.onbinary = (data: ArrayBuffer) => {
    const parser = new BinaryAudioParser();
    const audioChunk = parser.parseResponseAudioDelta(data);

    if (audioChunk) {
        // 使用您现有的音频处理流程
        handleAudioChunk(audioChunk);
    }
};

function handleAudioChunk(chunk: ParsedAudioChunk) {
    // 您现有的音频处理逻辑
    // 1. 按content_index排序
    // 2. 缓冲管理
    // 3. 转换PCM到Float32
    // 4. 播放调度
}
```

## 音频数据格式

**重要**: 音频数据格式没有变化：
- 采样率: 16000 Hz
- 位深度: 16位
- 声道: 单声道
- 字节序: 小端序

您现有的PCM转换代码无需修改：

```typescript
function convertPCMToFloat32(pcmData: ArrayBuffer): Float32Array {
    const int16View = new Int16Array(pcmData);
    const float32Data = new Float32Array(int16View.length);

    for (let i = 0; i < int16View.length; i++) {
        float32Data[i] = int16View[i] / 32768.0;
    }

    return float32Data;
}
```

## 迁移检查清单

- [ ] WebSocket消息处理改为监听二进制数据
- [ ] 实现上述二进制解析器
- [ ] 保持现有的音频缓冲和播放逻辑
- [ ] 测试音频播放是否正常

## 调试技巧

```typescript
// 添加调试日志
console.log('接收到的二进制数据长度:', data.byteLength);
console.log('Command ID:', commandId);
console.log('解析的音频块:', {
    responseId: chunk.responseId,
    itemId: chunk.itemId,
    contentIndex: chunk.contentIndex,
    audioDataSize: chunk.audioData.byteLength
});
```

这样您就可以快速适配新的二进制协议，而无需修改现有的音频处理核心逻辑。
