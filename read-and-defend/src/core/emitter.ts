type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter used to decouple game logic from the UI. */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn as Handler<never>);
    this.handlers.set(type, set);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<Events[K]>)(payload));
  }
}
