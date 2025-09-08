/* eslint-disable @typescript-eslint/no-unused-vars */
import { wsConnectedAtom } from '../state';
import { useAtomValue } from 'jotai';

export function StatusPoint() {
    const isWsConnected = useAtomValue(wsConnectedAtom);

    return (
        // <div style={{ display: 'flex', gap: '8px' }}>
        <div
            style={{
                // display: 'inline-block',
                marginLeft: '8px',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: isWsConnected ? '#00ff00' : '#ef4444',
                // border: '1.5px solid #222',
                // boxShadow: '0 0 4px rgba(0,0,0,0.10)'
            }}
        />
        // {/* <span style={{ fontSize: '14px', color: '#333' }}>
        //     {isWsConnected  ? '已连接' : '未连接'}
        // </span> */}
        // </div>
    );
}
