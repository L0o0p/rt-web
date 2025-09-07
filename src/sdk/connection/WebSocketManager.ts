import { CONFIG } from '../types/protocol.js';
// import { Logger } from '../utils/logger.js';
import { BinaryMessage } from '../protocol/BinaryMessage.js';

export interface WebSocketEventHandlers {
    onOpen?: (event: Event) => void;
    onMessage?: (event: MessageEvent) => void;
    onClose?: (event: CloseEvent) => void;
    onError?: (event: Event) => void;
}

export class WebSocketManager {
    private websocket: WebSocket | null = null;
    // private logger: Logger;
    private connectionAttempts: number = 0;
    private reconnectTimeout: number | null = null;
    private heartbeatInterval: number | null = null;
    private sessionId: string | null = null;
    private sessionCreated: boolean = false;
    private pingTimestamps: Array<{ id: number; timestamp: number }> = [];
    private packetLossStats = { sent: 0, acked: 0 };
    private bandwidthStats = { bytesSent: 0, startTime: null as number | null };

    constructor(
        // logger: Logger
    ) {
        // this.logger = logger;
    }

    // 连接到WebSocket服务器
    async connect(handlers: WebSocketEventHandlers): Promise<void> {
        try {
            // this.logger.info('🔌 开始连接WebSocket服务器...');

            // 检查浏览器是否支持WebSocket
            if (!window.WebSocket) {
                throw new Error('当前浏览器不支持WebSocket');
            }

            // 建立WebSocket连接
            this.websocket = new WebSocket(CONFIG.WEBSOCKET_URL);

            // 设置事件处理器
            this.websocket.onopen = (event) => {
                this.handleOpen(event);
                handlers.onOpen?.(event);
            };

            this.websocket.onmessage = (event) => {
                // this.logger.info(`[RAW] WebSocket收到消息，类型: ${typeof event.data}, 长度: ${event.data.length || event.data.byteLength || 'unknown'}`);
                handlers.onMessage?.(event);
            };

            this.websocket.onclose = (event) => {
                this.handleClose(event);
                handlers.onClose?.(event);
            };

            this.websocket.onerror = (event) => {
                // this.logger.error(`[RAW] WebSocket错误事件: ${JSON.stringify(event)}`);
                handlers.onError?.(event);
            };

            // this.logger.info(`尝试连接到 ${CONFIG.WEBSOCKET_URL}`);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            // error(`连接失败: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error("连接失败");
        }
    }

    // 处理WebSocket打开事件
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private handleOpen(_event: Event): void {
        // this.logger.info('WebSocket连接已建立');
        // this.logger.debug(`WebSocket readyState: ${this.websocket?.readyState}`);
        // this.logger.debug(`WebSocket URL: ${this.websocket?.url}`);
        // this.logger.debug(`WebSocket protocol: ${this.websocket?.protocol}`);

        // 重置重连尝试计数
        this.connectionAttempts = 0;

        // 生成新的会话ID
        this.sessionId = this.generateSessionId();
        this.sessionCreated = false;

        // 创建会话
        this.createSession();

        // 启动心跳机制
        this.startHeartbeat();

        // this.logger.info('🔧 WebSocket连接已建立，等待消息...');
        // this.logger.debug('📊 会话信息: ' + this.sessionId);
    }

    // 处理WebSocket关闭事件
    private handleClose(event: CloseEvent): void {
        // this.logger.info(`WebSocket连接已关闭: ${event.reason}`);

        // 停止心跳机制
        this.stopHeartbeat();

        // 如果不是手动断开且未达到最大重连次数，则尝试重连
        if (!event.wasClean && this.connectionAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
            this.connectionAttempts++;
            // this.logger.info(`尝试重新连接 (${this.connectionAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})...`);

            this.reconnectTimeout = window.setTimeout(() => {
                // 这里需要重新传入handlers，实际使用时可能需要保存handlers引用
                // this.connect(savedHandlers);
            }, CONFIG.RECONNECT_INTERVAL);
        }
    }

    // 断开连接
    disconnect(): void {
        // this.logger.info('🔌 WebSocketManager: 开始断开连接');

        if (this.websocket) {
            const currentState = this.websocket.readyState;
            // this.logger.info(`🔌 WebSocket当前状态: ${currentState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);

            if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
                this.websocket.close(1000, 'Client requested disconnection');
                // this.logger.info('🔌 已调用websocket.close()');
            } else {
                // this.logger.info('🔌 WebSocket已关闭或正在关闭，无需调用close()');
            }
        } else {
            // this.logger.info('🔌 WebSocket对象不存在');
        }

        this.cleanup();
    }

    // 发送文本消息
    sendTextMessage(message: unknown): void {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const messageStr = JSON.stringify(message);
            try {
                this.websocket.send(messageStr);
                // this.logger.info(`📤 发送文本消息: ${messageStr}`);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
                // this.logger.error(`发送文本消息失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        } else {
            // this.logger.error('WebSocket未连接，无法发送消息');
        }
    }

    // 发送二进制消息
    sendBinaryMessage(message: BinaryMessage): void {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            try {
                const bytes = message.toBytes();
                this.websocket.send(bytes);
                // this.logger.debug(`📤 发送二进制消息: ${bytes.length} 字节`);

                // 更新带宽统计
                this.bandwidthStats.bytesSent += bytes.length;
                if (!this.bandwidthStats.startTime) {
                    this.bandwidthStats.startTime = performance.now();
                }
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
                // this.logger.error(`发送二进制消息失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        } else {
            // this.logger.error('WebSocket未连接，无法发送二进制消息');
        }
    }

    // 生成会话ID
    private generateSessionId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2);
        const combined = timestamp + random;
        return combined.substr(0, 16).padEnd(16, '0');
    }

    // 创建会话
    private createSession(): void {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.sessionId) {
            const sessionMessage = {
                protocol_id: 100, // 会话协议ID
                command_id: 1,  // 创建会话命令ID
                session_id: this.sessionId,
                type: 'create_session'
            };

            this.sendTextMessage(sessionMessage);
            // this.logger.info(`✅ 成功发送创建会话请求`);
            // this.logger.debug(`会话ID长度: ${this.sessionId.length}, 内容: "${this.sessionId}"`);

            // 设置5秒超时检查是否收到响应
            setTimeout(() => {
                if (!this.sessionCreated) {
                    // this.logger.warning('⚠️ 5秒内未收到会话创建响应');
                }
            }, 5000);
        } else {
            // this.logger.error('WebSocket未连接，无法创建会话');
        }
    }

    // 重新创建会话
    recreateSession(): void {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            // 重置会话状态
            this.sessionCreated = false;

            // 生成新的会话ID
            this.sessionId = this.generateSessionId();

            // this.logger.info(`🔄 重新创建会话，新会话ID: ${this.sessionId}`);

            // 创建会话
            this.createSession();
        } else {
            // this.logger.error('❌ WebSocket未连接，无法重新创建会话');
        }
    }

    // 测试Ping
    testPing(): void {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const testMessage = {
                type: 'ping',
                timestamp: Date.now(),
                test: true
            };

            this.sendTextMessage(testMessage);
            // this.logger.info(`📤 发送测试Ping消息`);
        } else {
            // this.logger.error('❌ WebSocket未连接，无法发送测试Ping');
        }
    }

    // 启动心跳机制
    private startHeartbeat(): void {
        this.stopHeartbeat(); // 先停止之前的心跳

        this.heartbeatInterval = window.setInterval(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.sessionId) {
                // 记录发送ping的时间
                const pingId = Date.now();
                this.pingTimestamps.push({ id: pingId, timestamp: performance.now() });

                // 限制pingTimestamps数组长度，避免内存泄漏
                if (this.pingTimestamps.length > 10) {
                    this.pingTimestamps.shift();
                }

                // 创建并发送二进制ping消息
                const pingMessage = BinaryMessage.createPing(this.sessionId);
                this.sendBinaryMessage(pingMessage);
                // this.logger.debug('发送心跳包');

                // 更新发送统计
                this.packetLossStats.sent++;
            }
        }, 10000); // 每10秒发送一次心跳
    }

    // 停止心跳机制
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // 清理资源
    private cleanup(): void {
        // 停止重连定时器
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        // 停止心跳
        this.stopHeartbeat();

        // 清空数组
        this.pingTimestamps = [];

        // 重置统计信息
        this.packetLossStats = { sent: 0, acked: 0 };
        this.bandwidthStats = { bytesSent: 0, startTime: null };

        // this.logger.info('WebSocket资源清理完成');
    }

    // Getters
    get isConnected(): boolean {
        return this.websocket?.readyState === WebSocket.OPEN;
    }

    get currentSessionId(): string | null {
        return this.sessionId;
    }

    get isSessionCreated(): boolean {
        return this.sessionCreated;
    }

    // 设置会话创建状态（由外部消息处理器调用）
    setSessionCreated(created: boolean): void {
        this.sessionCreated = created;
    }

    // 处理pong响应
    handlePongResponse(pingId: number): { latency: number; jitter: number } | null {
        const now = performance.now();
        const pingRecord = this.pingTimestamps.find(p => p.id === pingId);

        if (pingRecord) {
            // 计算延迟
            const latency = now - pingRecord.timestamp;
            // this.logger.debug(`网络延迟: ${latency.toFixed(2)} ms`);

            // 更新丢包统计
            this.packetLossStats.acked++;

            // 从数组中移除已处理的ping记录
            this.pingTimestamps = this.pingTimestamps.filter(p => p.id !== pingId);

            return { latency, jitter: 0 }; // 抖动计算可以在上层实现
        }

        return null;
    }

    // 获取网络统计信息
    getNetworkStats() {
        const now = performance.now();
        const elapsedSeconds = this.bandwidthStats.startTime ?
            (now - this.bandwidthStats.startTime) / 1000 : 0;
        const kbps = elapsedSeconds > 0 ?
            (this.bandwidthStats.bytesSent * 8 / 1024 / elapsedSeconds) : 0;

        return {
            packetLoss: this.packetLossStats.sent > 0 ?
                ((this.packetLossStats.sent - this.packetLossStats.acked) / this.packetLossStats.sent) : 0,
            bandwidth: kbps > 0 ? kbps.toFixed(2) : '0',
            bytesSent: this.bandwidthStats.bytesSent
        };
    }
}
