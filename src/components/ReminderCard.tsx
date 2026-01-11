import React, { useEffect, useState } from 'react';
import styles from './ReminderCard.module.scss';
import type { Reminder } from '../types/reminder';

interface ReminderCardProps {
    reminder: Reminder;
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
}

export const ReminderCard: React.FC<ReminderCardProps> = ({ reminder, onComplete, onDelete }) => {
    const [countdown, setCountdown] = useState(reminder.countdown || '');

    useEffect(() => {
        const updateCountdown = () => {
            const now = new Date();
            const target = new Date(reminder.startAt);
            const diff = target.getTime() - now.getTime();

            if (diff <= 0) {
                setCountdown('⏰ 已触发');
                return;
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            if (days > 0) setCountdown(`${days}天${hours}时${minutes}分`);
            else if (hours > 0) setCountdown(`${hours}时${minutes}分${seconds}秒`);
            else if (minutes > 0) setCountdown(`${minutes}分${seconds}秒`);
            else setCountdown(`${seconds}秒`);
        };

        updateCountdown();
        const timer = setInterval(updateCountdown, 1000);
        return () => clearInterval(timer);
    }, [reminder.startAt]);

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'medicine': return '💊';
            case 'meeting': return '📅';
            case 'alarm': return '⏰';
            case 'birthday': return '🎂';
            default: return '📝';
        }
    };

    return (
        <div className={`${styles.card} ${styles[reminder.type]}`}>
            <div className={styles.header}>
                <span className={styles.typeIcon}>{getTypeIcon(reminder.type)}</span>
                <span className={styles.countdown}>{countdown}</span>
            </div>
            <div className={styles.content}>{reminder.content}</div>
            <div className={styles.time}>
                触发时间: {new Date(reminder.startAt).toLocaleString('zh-CN')}
            </div>
            <div className={styles.actions}>
                <button onClick={() => onComplete(reminder.id)} className={styles.completeBtn}>✅ 完成</button>
                <button onClick={() => onDelete(reminder.id)} className={styles.deleteBtn}>🗑️ 删除</button>
            </div>
        </div>
    );
};