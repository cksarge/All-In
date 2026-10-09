import { create } from 'zustand';

export interface OnlinePlayer {
  user_id: string;
  username: string;
}

interface PresenceState {
  online: OnlinePlayer[];
  setOnline: (online: OnlinePlayer[]) => void;
}

/** Who's online, fed by Realtime Presence (see useOnlinePresence). */
export const usePresence = create<PresenceState>()((set) => ({
  online: [],
  setOnline: (online) => set({ online }),
}));
