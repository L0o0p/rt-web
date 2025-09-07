import { 
    createTextDataMessageExample, 
    createSessionConfigMessageExample,
    parseWebSocketMessageExample,
    createBinaryMessageExample
} from './ProtocolExample.js';

console.log("=== WebSocket 消息示例 ===");

// 创建文本数据消息
const textMessage = createTextDataMessageExample();
console.log("文本数据消息:");
console.log(textMessage);

// 创建会话配置消息
const configMessage = createSessionConfigMessageExample();
console.log("\n会话配置消息:");
console.log(configMessage);

console.log("\n=== 解析 WebSocket 消息示例 ===");

// 解析文本数据消息
console.log("解析文本数据消息:");
parseWebSocketMessageExample(textMessage);

// 解析会话配置消息
console.log("\n解析会话配置消息:");
parseWebSocketMessageExample(configMessage);

console.log("\n=== 二进制消息示例 ===");

// 创建二进制消息
const binaryMessageBytes = createBinaryMessageExample();
console.log("二进制消息字节数组长度:", binaryMessageBytes.length);

// 注意：解析二进制消息的功能尚未完全实现
console.log("\n注意：解析二进制消息的功能尚未完全实现");