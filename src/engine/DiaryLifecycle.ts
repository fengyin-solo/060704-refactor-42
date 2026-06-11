import { DiaryState, type Diary, type StateTransition, STATE_ORDER, type DiarySchedule, ArchiveReason } from '@/types'
import { globalTimeline } from './Timeline'
import { pluginLoader } from './PluginLoader'

export interface ScheduleStatus {
  isScheduled: boolean
  isPublished: boolean
  isDecaying: boolean
  willArchive: boolean
  timeToPublish: number
  timeToDecay: number
  timeToArchive: number
}

export interface LifecycleTickResult {
  diary: Diary
  stateChanged: boolean
  shouldArchive: boolean
  archiveReason: ArchiveReason | null
}

export class DiaryLifecycle {
  private stateMachines: Map<string, StateMachineCore> = new Map()

  private getOrCreateMachine(typeId: string): StateMachineCore {
    let machine = this.stateMachines.get(typeId)
    if (!machine) {
      const diaryType = pluginLoader.getDiaryType(typeId)
      machine = new StateMachineCore(diaryType?.transitions || [])
      this.stateMachines.set(typeId, machine)
    }
    return machine
  }

  getDecayStart(diary: Diary): number {
    return diary.decayStartTime ?? diary.createdAt
  }

  getElapsed(diary: Diary, currentTime?: number): number {
    const time = currentTime ?? globalTimeline.getTime()
    const decayStart = this.getDecayStart(diary)
    return Math.max(0, time - decayStart)
  }

  getDecayRate(diary: Diary): number {
    return pluginLoader.getDiaryType(diary.type)?.decayRate ?? 1
  }

  getAdjustedElapsed(diary: Diary, currentTime?: number): number {
    return this.getElapsed(diary, currentTime) * this.getDecayRate(diary)
  }

  getDecayLevel(diary: Diary, currentTime?: number): number {
    if (diary.state === DiaryState.SCHEDULED) return 0
    
    const machine = this.getOrCreateMachine(diary.type)
    const adjustedElapsed = this.getAdjustedElapsed(diary, currentTime)
    const decayRate = this.getDecayRate(diary)
    return machine.getDecayLevel(diary, adjustedElapsed, decayRate)
  }

  getScheduleStatus(diary: Diary, currentTime?: number): ScheduleStatus {
    const time = currentTime ?? globalTimeline.getTime()
    return {
      isScheduled: diary.state === DiaryState.SCHEDULED,
      isPublished: diary.schedule.publishAt ? diary.schedule.publishAt <= time : true,
      isDecaying: diary.decayStartTime ? diary.decayStartTime <= time : true,
      willArchive: diary.schedule.autoArchiveAt !== null,
      timeToPublish: diary.schedule.publishAt ? Math.max(0, diary.schedule.publishAt - time) : 0,
      timeToDecay: diary.decayStartTime ? Math.max(0, diary.decayStartTime - time) : 0,
      timeToArchive: diary.schedule.autoArchiveAt ? Math.max(0, diary.schedule.autoArchiveAt - time) : 0
    }
  }

  canTransition(diary: Diary, currentTime?: number): boolean {
    if (diary.frozen || diary.state === DiaryState.DEAD) return false
    
    const time = currentTime ?? globalTimeline.getTime()
    if (diary.state === DiaryState.SCHEDULED) {
      return diary.schedule.publishAt !== null && diary.schedule.publishAt <= time
    }

    if (diary.schedule.autoArchiveAt !== null && diary.schedule.autoArchiveAt <= time) {
      return true
    }

    const machine = this.getOrCreateMachine(diary.type)
    const adjustedElapsed = this.getAdjustedElapsed(diary, time)
    return machine.canTransition(diary, adjustedElapsed)
  }

  tick(diary: Diary, currentTime?: number): LifecycleTickResult {
    const time = currentTime ?? globalTimeline.getTime()
    let result: LifecycleTickResult = {
      diary,
      stateChanged: false,
      shouldArchive: false,
      archiveReason: null
    }

    if (diary.frozen || diary.state === DiaryState.DEAD) {
      return result
    }

    if (diary.state === DiaryState.SCHEDULED) {
      if (diary.schedule.publishAt !== null && diary.schedule.publishAt <= time) {
        result.diary = this.applyState(diary, DiaryState.FRESH, time)
        result.stateChanged = true
        return result
      }
      return result
    }

    if (diary.schedule.autoArchiveAt !== null && diary.schedule.autoArchiveAt <= time) {
      result.shouldArchive = true
      result.archiveReason = ArchiveReason.SCHEDULED_ARCHIVE
      return result
    }

    const machine = this.getOrCreateMachine(diary.type)
    const adjustedElapsed = this.getAdjustedElapsed(diary, time)
    
    if (machine.canTransition(diary, adjustedElapsed)) {
      const newDiary = machine.transition(diary, adjustedElapsed, time)
      
      const diaryType = pluginLoader.getDiaryType(diary.type)
      if (newDiary.state === DiaryState.DEAD && diaryType?.deathEffect) {
        diaryType.deathEffect(newDiary)
      }

      result.diary = newDiary
      result.stateChanged = true

      if (newDiary.state === DiaryState.DEAD) {
        result.shouldArchive = true
        result.archiveReason = ArchiveReason.DEAD
      }
    }

    return result
  }

  rewindState(diary: Diary, currentTime?: number): Diary {
    const time = currentTime ?? globalTimeline.getTime()
    const machine = this.getOrCreateMachine(diary.type)
    return machine.rewindState(diary, time)
  }

  canRewind(diary: Diary): boolean {
    const machine = this.getOrCreateMachine(diary.type)
    return machine.canRewind(diary)
  }

  applyState(diary: Diary, newState: DiaryState, currentTime?: number): Diary {
    const time = currentTime ?? globalTimeline.getTime()
    return {
      ...diary,
      state: newState,
      stateTimestamps: {
        ...diary.stateTimestamps,
        [newState]: time
      }
    }
  }

  applySchedule(diary: Diary, schedule: Partial<DiarySchedule>, currentTime?: number): Diary {
    const time = currentTime ?? globalTimeline.getTime()
    const newSchedule = {
      ...diary.schedule,
      ...schedule
    }

    let newState = diary.state
    const newStateTimestamps = { ...diary.stateTimestamps }

    if (newSchedule.publishAt && newSchedule.publishAt > time) {
      if (diary.state !== DiaryState.SCHEDULED) {
        newState = DiaryState.SCHEDULED
        newStateTimestamps[DiaryState.SCHEDULED] = time
      }
    } else if (diary.state === DiaryState.SCHEDULED) {
      newState = DiaryState.FRESH
      newStateTimestamps[DiaryState.FRESH] = time
    }

    return {
      ...diary,
      schedule: newSchedule,
      decayStartTime: newSchedule.decayStartAt ?? null,
      state: newState,
      stateTimestamps: newStateTimestamps
    }
  }
}

class StateMachineCore {
  private transitions: Map<DiaryState, StateTransition[]> = new Map()

  constructor(transitions: StateTransition[] = []) {
    this.addTransitions(transitions)
  }

  addTransition(transition: StateTransition): void {
    const existing = this.transitions.get(transition.from) || []
    existing.push(transition)
    this.transitions.set(transition.from, existing)
  }

  addTransitions(transitions: StateTransition[]): void {
    transitions.forEach(t => this.addTransition(t))
  }

  canTransition(diary: Diary, elapsed: number): boolean {
    if (diary.state === DiaryState.SCHEDULED) return false
    const transitions = this.transitions.get(diary.state) || []
    return transitions.some(t => t.condition(diary, elapsed))
  }

  transition(diary: Diary, elapsed: number, currentTime: number): Diary {
    if (diary.state === DiaryState.SCHEDULED) return diary
    
    const transitions = this.transitions.get(diary.state) || []
    
    for (const t of transitions) {
      if (t.condition(diary, elapsed)) {
        const newDiary = { ...diary }
        newDiary.state = t.to
        newDiary.stateTimestamps = {
          ...diary.stateTimestamps,
          [t.to]: currentTime
        }
        
        if (t.onTransition) {
          t.onTransition(newDiary)
        }
        
        return newDiary
      }
    }
    
    return diary
  }

  canRewind(diary: Diary): boolean {
    const currentIndex = STATE_ORDER.indexOf(diary.state)
    return currentIndex > 1
  }

  rewindState(diary: Diary, currentTime: number): Diary {
    if (!this.canRewind(diary)) {
      return diary
    }

    const currentIndex = STATE_ORDER.indexOf(diary.state)
    const prevState = STATE_ORDER[currentIndex - 1]
    
    return {
      ...diary,
      state: prevState,
      frozen: false,
      stateTimestamps: {
        ...diary.stateTimestamps,
        [diary.state]: currentTime
      }
    }
  }

  getDecayLevel(diary: Diary, elapsed: number, decayRate: number = 1): number {
    if (diary.state === DiaryState.SCHEDULED) return 0
    
    const stateIndex = STATE_ORDER.indexOf(diary.state) - 1
    const baseLevel = stateIndex * 0.25
    
    const thresholds = [0, 100, 300, 500, 1000]
    const currentThreshold = thresholds[stateIndex] || 0
    const nextThreshold = thresholds[stateIndex + 1] || thresholds[stateIndex]
    
    const adjustedElapsed = elapsed * decayRate
    const progress = nextThreshold > currentThreshold 
      ? Math.min(1, Math.max(0, (adjustedElapsed - currentThreshold) / (nextThreshold - currentThreshold)))
      : 0
    
    return Math.min(1, Math.max(0, baseLevel + progress * 0.25))
  }
}

export const diaryLifecycle = new DiaryLifecycle()

export { StateMachineCore as StateMachine }

export const createDefaultTransitions = (): StateTransition[] => [
  {
    from: DiaryState.FRESH,
    to: DiaryState.ROTTING,
    condition: (_, elapsed) => elapsed >= 100
  },
  {
    from: DiaryState.ROTTING,
    to: DiaryState.ROTTED,
    condition: (_, elapsed) => elapsed >= 300
  },
  {
    from: DiaryState.ROTTED,
    to: DiaryState.DYING,
    condition: (_, elapsed) => elapsed >= 500
  },
  {
    from: DiaryState.DYING,
    to: DiaryState.DEAD,
    condition: (_, elapsed) => elapsed >= 1000
  }
]
