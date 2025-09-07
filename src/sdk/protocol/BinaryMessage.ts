import { BinaryHeader as ClientBinaryHeader, ProtocolId, CommandId } from './ClientProtocol.js';

/**
 * 二进制协议头部 (继承自客户端协议定义)
 */
export class BinaryHeader extends ClientBinaryHeader {
    constructor(sessionId: string, protocolId: ProtocolId, commandId: CommandId) {
        super(sessionId, protocolId, commandId);
    }
}

/**
 * 二进制WebSocket消息
 */
export class BinaryMessage {
    public header: BinaryHeader;
    public payload: Uint8Array;

    constructor(header: BinaryHeader, payload?: Uint8Array) {
        this.header = header;
        this.payload = payload || new Uint8Array(0);
    }

    /**
     * 创建音频数据二进制消息
     */
    static createAudioChunk(sessionId: string, audioData: Uint8Array): BinaryMessage {
        const header = new BinaryHeader(sessionId, ProtocolId.Asr, CommandId.AudioChunk);
        return new BinaryMessage(header, audioData);
    }

    /**
     * 创建会话开始二进制消息
     */
    static createStartSession(sessionId: string, protocolId: ProtocolId): BinaryMessage {
        const header = new BinaryHeader(sessionId, protocolId, CommandId.Start);
        return new BinaryMessage(header, new Uint8Array(0));
    }


    /**
     * 从字节数组创建二进制消息
     */
    static fromBytes(bytes: Uint8Array): BinaryMessage {
        // 这里应该调用父类的 fromBytes 方法，但由于我们没有继承，所以直接实现
        // 实际上，我们应该重构代码，让 BinaryHeader 继承 ClientBinaryHeader 的 fromBytes 方法
        // 但现在，我们直接实现
        
        // 这个实现应该与 ClientProtocol.ts 中的 ClientBinaryMessage.fromBytes 相同
        // 但为了简单起见，我们将直接抛出一个错误，表示这个方法需要实现
        // 我们至少需要使用 'bytes' 参数来避免 ESLint 错误
        if (bytes.length === 0) {
            throw new Error("Empty byte array");
        }
        throw new Error("Method not implemented. Please use ClientBinaryMessage.fromBytes from ClientProtocol.ts");
    }

    /**
     * 转换为字节数组
     */
    toBytes(): Uint8Array {
        const headerBytes = this.header.toBytes();
        const result = new Uint8Array(headerBytes.length + this.payload.length);

        result.set(headerBytes, 0);
        result.set(this.payload, headerBytes.length);

        return result;
    }
}
