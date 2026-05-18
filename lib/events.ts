// Tiny pub-sub via window CustomEvents — components fire these after writes,
// other components listen and re-fetch. Avoids prop-drilling state managers.

export const EVENTS = {
  TASK_CHANGED: 'os:task-changed',
  CAPTURE_SAVED: 'os:capture-saved',
} as const;

export function emit(event: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(event));
}

export function onEvent(event: string, handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}
