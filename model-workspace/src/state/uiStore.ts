import { create } from 'zustand';
import { uid } from '../core/ids';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';
export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

export type Route = { name: 'home' } | { name: 'editor'; projectId: string };

interface UIState {
  route: Route;
  toasts: Toast[];
  navigate: (r: Route) => void;
  toast: (kind: ToastKind, title: string, message?: string, ttl?: number) => void;
  dismissToast: (id: string) => void;
}

export const useUI = create<UIState>()((set, get) => ({
  route: { name: 'home' },
  toasts: [],
  navigate: (route) => set({ route }),
  toast: (kind, title, message, ttl) => {
    const id = uid('t');
    set({ toasts: [...get().toasts.slice(-4), { id, kind, title, message }] });
    const life = ttl ?? (kind === 'error' ? 7000 : 3200);
    setTimeout(() => get().dismissToast(id), life);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (kind: ToastKind, title: string, message?: string, ttl?: number) =>
  useUI.getState().toast(kind, title, message, ttl);
