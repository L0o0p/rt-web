import { BINARY_MESSAGE } from '../types/protocol.js';

/**
 * 二进制协议头部
 */
export class BinaryHeader {
    public sessionId: string;
    public protocolId: number;
    public commandId: number;
    public reserved: Uint8Array;

    constructor(sessionId: string, protocolId: number, commandId: number) {
        if (!sessionId || sessionId.length !== BINARY_MESSAGE.NANOID_SIZE) {
            throw new Error(`会话ID必须为 ${BINARY_MESSAGE.NANOID_SIZE} 字符`);
        }

        if (protocolId < 0 || protocolId > 255) {
            throw new Error("协议ID必须在 0-255 范围内");
        }

        if (commandId < 0 || commandId > 255) {
            throw new Error("命令ID必须在 0-255 范围内");
        }

        this.sessionId = sessionId;
        this.protocolId = protocolId;
        this.commandId = commandId;
        this.reserved = new Uint8Array(14); // 14字节保留字段
    }

    toBytes(): Uint8Array {
        const headerBytes = new Uint8Array(BINARY_MESSAGE.BINARY_HEADER_SIZE);

        // 写入会话ID (前16字节)
        const sessionIdBytes = new TextEncoder().encode(this.sessionId);
        headerBytes.set(sessionIdBytes, 0);

        // 写入协议ID (第17字节)
        headerBytes[BINARY_MESSAGE.PROTOCOL_ID_OFFSET] = this.protocolId;

        // 写入命令ID (第18字节)
        headerBytes[BINARY_MESSAGE.COMMAND_ID_OFFSET] = this.commandId;

        // 保留字段已经是0 (14字节)
        return headerBytes;
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
        const header = new BinaryHeader(sessionId, BINARY_MESSAGE.PROTOCOL_ID_ASR, BINARY_MESSAGE.CMD_AUDIO_CHUNK);
        return new BinaryMessage(header, audioData);
    }

    /**
     * 创建会话开始二进制消息
     */
    static createStartSession(sessionId: string, protocolId: number): BinaryMessage {
        const header = new BinaryHeader(sessionId, protocolId, BINARY_MESSAGE.CMD_START);
        return new BinaryMessage(header, new Uint8Array(0));
    }

    /**
     * 创建ping二进制消息
     */
    static createPing(sessionId: string): BinaryMessage {
        const header = new BinaryHeader(sessionId, BINARY_MESSAGE.PROTOCOL_ID_CONTROL, BINARY_MESSAGE.CMD_START);
        return new BinaryMessage(header, new Uint8Array(0));
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
