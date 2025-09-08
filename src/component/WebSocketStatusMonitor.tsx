/* eslint-disable @typescript-eslint/no-unused-vars */
import {useEffect } from 'react';
import type { VoiceChatCore } from '../sdk/core/VoiceChatCore';
import { wsConnectedAtom } from '../state';
import { useAtom } from 'jotai';
import type { RealTime } from '../RealTime';

export function WebSocketStatusMonitor({ realTime }: WebSocketStatusMonitorProps) {
    const [isWsConnected, setIsWsConnected] = useAtom(wsConnectedAtom);

    useEffect(() => {
        const voiceChatCore: VoiceChatCore = realTime.getVoiceChatCore();

        // 监听WebSocket原生事件
        const handleOpen = () => {
            // 连接成功时，connectionStatusChange事件应该已经更新了状态
            setIsWsConnected(true);
        };

        const handleClose = () => {
            setIsWsConnected(false);
            // setConnectionStatus({
            //     state: 'disconnected',
            //     message: 'WebSocket连接已断开'
            // });
        };

        const handleError = (error: any) => {
            // setConnectionStatus({
            //     state: 'error',
            //     message: 'WebSocket连接发生错误',
            //     error: error.message || '未知错误'
            // });
        };

        // 监听会话创建事件
        const handleSessionCreated = (data: any) => {
            // setSessionStatus({
            //     created: true,
            //     sessionId: data.session?.id || null
            // });
        };

        // 注册事件监听器
        // voiceChatCore.on('connectionStatusChange', handleConnectionStatusChange);
        voiceChatCore.on('open', handleOpen);
        voiceChatCore.on('close', handleClose);
        voiceChatCore.on('error', handleError);
        voiceChatCore.on('session.created', handleSessionCreated);

        // 清理函数
        return () => {
            // voiceChatCore.off('connectionStatusChange', handleConnectionStatusChange);
            voiceChatCore.off('open', handleOpen);
            voiceChatCore.off('close', handleClose);
            voiceChatCore.off('error', handleError);
            voiceChatCore.off('session.created', handleSessionCreated);
        };
    }, [realTime]);

    return null
}


// interface ConnectionStatus {
//     state: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
//     message: string;
//     error?: string;
// }

// interface SessionStatus {
//     created: boolean;
//     sessionId: string | null;
// }

export interface WebSocketStatusMonitorProps {
    realTime: RealTime;
}
