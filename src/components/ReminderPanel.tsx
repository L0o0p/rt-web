import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { remindersAtom } from '../state/reminderAtoms';
import { ReminderCard } from './ReminderCard';
import styles from './ReminderPanel.module.scss';

export const ReminderPanel: React.FC = () => {
    const reminders = useAtomValue(remindersAtom);
    const setReminders = useSetAtom(remindersAtom);

    const handleComplete = (id: string) => {
        setReminders(prev => prev.map(r =>
            r.id === id ? { ...r, status: 'completed' } : r
        ));
    };

    const handleDelete = (id: string) => {
        setReminders(prev => prev.filter(r => r.id !== id));
    };

    return (
        <div className={styles.panel}>
            <h3>📌 提醒列表</h3>
            <div className={styles.list}>
                {reminders.map(r => (
                    <ReminderCard key={r.id} reminder={r} onComplete={handleComplete} onDelete={handleDelete} />
                ))}
            </div>
        </div>
    );
};