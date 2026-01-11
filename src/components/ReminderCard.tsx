import React from 'react';
import styles from './ReminderCard.module.scss';
import type { Reminder } from '../types/reminder';

interface ReminderCardProps {
    reminder: Reminder;
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
}

export const ReminderCard: React.FC<ReminderCardProps> = ({ reminder, onComplete, onDelete }) => {
    return (
        <div className={`${styles.card} ${styles[reminder.type]}`}>
            <div className={styles.content}>{reminder.content}</div>
            <div className={styles.time}>{reminder.startAt}</div>
            <div className={styles.actions}>
                <button onClick={() => onComplete(reminder.id)}>完成</button>
                <button onClick={() => onDelete(reminder.id)}>删除</button>
            </div>
        </div>
    );
};