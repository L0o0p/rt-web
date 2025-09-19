import { atom } from "jotai";

export const isUserSpeakingAtom = atom(false)
export const wsConnectedAtom = atom(false)
export const sessionCreatedAtom = atom(false)
export const logsAtom = atom<any[]>([])
