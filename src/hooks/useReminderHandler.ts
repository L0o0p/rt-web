import { useCallback, useRef, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { remindersAtom } from '../state/reminderAtoms';
import type { ReminderArguments, Reminder } from '../types/reminder';

const calculateCountdown = (startAt: string): string => {
    const now = new Date();
    const target = new Date(startAt);
    const diff = target.getTime() - now.getTime();

    if (diff <= 0) return '已触发';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (days > 0) return `${days}天${hours}小时`;
    if (hours > 0) return `${hours}小时${minutes}分`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
};

export const useReminderHandler = () => {
    const setReminders = useSetAtom(remindersAtom);

    // 使用 ref 存储所有定时器引用
    const timerRefs = useRef<Map<string, number>>(new Map());

    // 清理单个定时器
    const clearTimer = useCallback((id: string) => {
        const timerId = timerRefs.current.get(id);
        if (timerId) {
            clearInterval(timerId);
            timerRefs.current.delete(id);
        }
    }, []);

    // 清理所有定时器
    useEffect(() => {
        return () => {
            timerRefs.current.forEach((timerId) => {
                clearInterval(timerId);
            });
            timerRefs.current.clear();
        };
    }, []);

    const handleReminderCall = useCallback((args: ReminderArguments) => {
        const reminderId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const reminder: Reminder = {
            id: reminderId,
            content: args.content,
            startAt: args.startAt,
            type: args.reminderType || 'custom',
            status: 'pending',
            createdAt: new Date().toISOString(),
            countdown: calculateCountdown(args.startAt)
        };

        setReminders(prev => [...prev, reminder]);
        console.log('[Reminder] 新增提醒:', reminder);

        // 创建倒计时定时器
        const timer = setInterval(() => {
            setReminders(prev => prev.map(r =>
                r.id === reminderId ? { ...r, countdown: calculateCountdown(r.startAt) } : r
            ));
        }, 1000);

        // 存储定时器引用
        timerRefs.current.set(reminderId, timer);
        console.log('[Reminder] 倒计时定时器已启动:', reminderId);

        // 返回清理函数（供外部调用）
        return () => clearTimer(reminderId);
    }, [setReminders, clearTimer]);

    return { handleReminderCall };
};