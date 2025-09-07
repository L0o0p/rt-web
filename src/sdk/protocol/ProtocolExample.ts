import {
    createWebSocketMessage,
    serializeWebSocketMessage,
    parseWebSocketMessage,
    ProtocolId,
    CommandId,
    type TextDataPayload,
    type SessionConfigPayload
} from './ClientProtocol.js';

import { BinaryMessage } from './BinaryMessage.js';

/**
 * 创建一个文本数据消息的示例
 */
export function createTextDataMessageExample(): string {
    // 创建载荷
    const payload: TextDataPayload = {
        type: "text_data",
        text: "你好，世界！"
    };

    // 创建WebSocket消息
    const message = createWebSocketMessage(
        ProtocolId.Tts,
        CommandId.TextData,
        "session123",
        payload
    );

    // 序列化为JSON字符串
    return serializeWebSocketMessage(message);
}

/**
 * 创建一个会话配置消息的示例
 */
export function createSessionConfigMessageExample(): string {
    // 创建载荷
    const payload: SessionConfigPayload = {
        type: "session_config",
        mode: "vad",
        vad_threshold: 0.5,
        silence_duration_ms: 500,
        min_speech_duration_ms: 200,
        system_prompt: "你是一个智能助手",
        asr_language: "zh",
        timezone: "Asia/Shanghai",
        location: "中国"
    };

    // 创建WebSocket消息
    const message = createWebSocketMessage(
        ProtocolId.All,
        CommandId.Start,
        "session123",
        payload
    );

    // 序列列化为JSON字符串
    return serializeWebSocketMessage(message);
}

/**
 * 解析WebSocket消息的示例
 */
export function parseWebSocketMessageExample(json: string): void {
    try {
        // 解析消息
        const message = parseWebSocketMessage(json);
        
        console.log("解析后的消息:");
        console.log("协议ID:", message.protocol_id);
        console.log("命令ID:", message.command_id);
        console.log("会话ID:", message.session_id);
        
        if (message.payload) {
            console.log("载荷类型:", message.payload.type);
            // 根据载荷类型进行处理
            switch (message.payload.type) {
                case "text_data":
                    console.log("文本内容:", (message.payload as TextDataPayload).text);
                    break;
                case "session_config":
                    console.log("会话配置:", message.payload);
                    break;
                default:
                    console.log("其他载荷类型:", message.payload.type);
            }
        }
    } catch (error) {
        console.error("解析消息时出错:", error);
    }
}

/**
 * 创建二进制消息的示例
 */
export function createBinaryMessageExample(): Uint8Array {
    const sessionId = "session123";
    
    // 创建开始会话的二进制消息
    const startMessage = BinaryMessage.createStartSession(sessionId, ProtocolId.Asr);
    
    // 转换为字节数组
    return startMessage.toBytes();
}

/**
 * 解析二进制消息的示例
 */
export function parseBinaryMessageExample(_bytes: Uint8Array): void {
    try {
        // 从字节数组创建二进制消息
        // 注意：BinaryMessage.fromBytes 抛出错误，因为它没有正确实现
        // 在实际应用中，应该使用 ClientBinaryMessage.fromBytes
        console.log("注意：BinaryMessage.fromBytes 没有正确实现");
        // const message = BinaryMessage.fromBytes(bytes);
        
        // 为了演示目的，我们手动创建一个 BinaryMessage 实例
        // const header = new BinaryHeader("session123", ProtocolId.Asr, CommandId.Start);
        // const message = new BinaryMessage(header, new Uint8Array(0));
        
        // console.log("解析后的二进制消息:");
        // console.log("会话ID:", message.header.sessionId);
        console.log("此功能尚未完全实现");
    } catch (error) {
        console.error("解析二进制消息时出错:", error);
    }
}