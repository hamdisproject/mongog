import { create } from 'zustand';

export const DEFAULT_TOAST_DURATION_MS = 3_000;

export interface ToastNotification {
  id: string;
  message: string;
  tone: 'success' | 'error';
}

interface ToastState {
  notifications: ToastNotification[];
  show: (
    message: string,
    tone?: ToastNotification['tone'],
    durationMS?: number,
  ) => string;
  dismiss: (id: string) => void;
}

let nextToastId = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  notifications: [],
  show: (message, tone = 'success', durationMS = DEFAULT_TOAST_DURATION_MS) => {
    const id = `toast-${++nextToastId}`;
    set((state) => ({
      notifications: [...state.notifications, { id, message, tone }].slice(-4),
    }));
    setTimeout(() => get().dismiss(id), durationMS);
    return id;
  },
  dismiss: (id) => set((state) => ({
    notifications: state.notifications.filter((notification) => notification.id !== id),
  })),
}));
