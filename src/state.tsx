import { atom } from "jotai";

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

export const isUserSpeakingAtom = atom(false)
export const wsConnectedAtom = atom(false)
export const sessionCreatedAtom = atom(false)
export const logsAtom = atom<LogEntry[]>([])
