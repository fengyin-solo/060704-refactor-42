import type { DiaryType } from '@/types'
import { createDefaultTransitions } from '@/engine/DiaryLifecycle'
import { DiaryState } from '@/types'

const loveLetter: DiaryType = {
  id: 'loveLetter',
  name: '情书',
  extends: 'base',
  decayRate: 0.5,
  transitions: [
    {
      from: DiaryState.FRESH,
      to: DiaryState.ROTTING,
      condition: (_, elapsed) => elapsed >= 200
    },
    {
      from: DiaryState.ROTTING,
      to: DiaryState.ROTTED,
      condition: (_, elapsed) => elapsed >= 600
    },
    {
      from: DiaryState.ROTTED,
      to: DiaryState.DYING,
      condition: (_, elapsed) => elapsed >= 1000
    },
    {
      from: DiaryState.DYING,
      to: DiaryState.DEAD,
      condition: (_, elapsed) => elapsed >= 2000
    }
  ],
  itemEffectModifiers: {
    repairPatch: 1.5,
    timeCrystal: 0.8,
    memoryFragment: 1.2
  }
}

export default loveLetter
