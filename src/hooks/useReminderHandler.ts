import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { remindersAtom } from '../state/reminderAtoms';
import type { ReminderArguments } from '../types/reminder';

export const useReminderHandler = () => {
    const setReminders = useSetAtom(remindersAtom);

    const handleReminderCall = useCallback((args: ReminderArguments) => {
        const reminder = {
            id: `reminder_${Date.now()}`,
            content: args.content,
            startAt: args.startAt,
            type: args.reminderType,
            status: 'pending' as const,
            createdAt: new Date().toISOString()
        };

        setReminders(prev => [...prev, reminder]);
        console.log('[Reminder] 新增提醒:', reminder);
    }, [setReminders]);

    return { handleReminderCall };
};