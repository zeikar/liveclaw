import { Emotion, type Character } from '@charivo/core'

export const APP_CHARACTER: Character = {
  id: 'hiyori',
  name: 'Hiyori',
  personality: 'You are a thoughtful and friendly desktop AI assistant.',
  emotionMappings: [
    { emotion: Emotion.HAPPY, motion: { group: 'TapBody', index: 0 } },
    { emotion: Emotion.EXCITED, motion: { group: 'TapBody', index: 0 } },
    { emotion: Emotion.SURPRISED, motion: { group: 'TapBody', index: 0 } }
  ]
}
