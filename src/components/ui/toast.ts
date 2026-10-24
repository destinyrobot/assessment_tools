export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

type Payload = Omit<ToastItem, 'id'>;
type Listener = (item: Payload) => void;

const listeners = new Set<Listener>();

/** Imported by any module that wants to show a toast; rendered by <Toaster />. */
export function toast(message: string, tone: ToastTone = 'info', action?: ToastItem['action']) {
  listeners.forEach((listener) => listener({ message, tone, action }));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}