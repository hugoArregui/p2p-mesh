export type PerformanceTracker = {
  startTimer(): void
  stopTimer(): void
  getAvgTime(): number
}

export type PerformanceRegistry = {
  getProcessPerformanceTracker(name: string): PerformanceTracker
  asObject(): Record<string, number>
}

export function createProcessPerformanceTracker(): PerformanceTracker {
  let hits = 0
  let totalTime = 0

  let timer = 0
  function startTimer() {
    if (timer !== 0) {
      throw new Error('timer already started')
    }
    timer = Date.now()
  }
  function stopTimer() {
    if (timer === 0) {
      throw new Error('timer was not started')
    }

    totalTime += Date.now() - timer
    hits += 1

    timer = 0
  }
  function getAvgTime(): number {
    return totalTime / hits
  }

  return {
    startTimer,
    stopTimer,
    getAvgTime
  }
}

export function createPerformanceRegistry(): PerformanceRegistry {
  const trackers = new Map<string, PerformanceTracker>()

  function getProcessPerformanceTracker(name: string): PerformanceTracker {
    let tracker = trackers.get(name)
    if (!tracker) {
      tracker = createProcessPerformanceTracker()
      trackers.set(name, tracker)
    }

    return tracker
  }

  function asObject(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [name, tracker] of trackers) {
      result[name] = tracker.getAvgTime()
    }

    return result
  }

  return {
    getProcessPerformanceTracker,
    asObject
  }
}
