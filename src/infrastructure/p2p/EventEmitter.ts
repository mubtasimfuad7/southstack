// ============================================================
// P2P INFRASTRUCTURE: Typed EventEmitter
// Strongly-typed pub/sub base for all P2P services.
// ============================================================

type Listener<T> = (event: T) => void

export class TypedEventEmitter<TMap extends Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<unknown>>>()

  on<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): () => void {
    const key = String(event)
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(listener as Listener<unknown>)
    return () => this.off(event, listener)
  }

  once<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): void {
    const unsub = this.on(event, (e) => {
      listener(e)
      unsub()
    })
  }

  off<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): void {
    const key = String(event)
    this.listeners.get(key)?.delete(listener as Listener<unknown>)
  }

  emit<K extends keyof TMap>(event: K, data: TMap[K]): void {
    const key = String(event)
    this.listeners.get(key)?.forEach((fn) => {
      try { fn(data) } catch (err) {
        console.error(`[EventEmitter] Error in listener for "${key}":`, err)
      }
    })
  }

  removeAllListeners(event?: keyof TMap): void {
    if (event) {
      this.listeners.delete(String(event))
    } else {
      this.listeners.clear()
    }
  }
}
