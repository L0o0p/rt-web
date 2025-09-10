/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useMemo } from 'react';
import { wsConnectedAtom } from '../state';
import { useAtomValue } from 'jotai';

export const StatusPoint = React.memo(function StatusPoint() {
    const isWsConnected = useAtomValue(wsConnectedAtom);

    // 优化内联样式，减少重渲染时的对象创建
    const statusPointStyle = useMemo(() => ({
        marginLeft: '8px',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        backgroundColor: isWsConnected ? '#00ff00' : '#ef4444',
    }), [isWsConnected]);

    return (
        <div style={statusPointStyle} />
    );
});
