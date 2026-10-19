import type { AiSendInput, AiTarget } from '@atp/model'

export type AiContext = NonNullable<AiSendInput['context']>

export type AiToolStatus = 'running' | 'ok' | 'error'

export interface AiToolCall {
  id: string
  name: string
  label: string
  input: unknown
  status: AiToolStatus
  durationMs?: number
  output?: unknown
  error?: string
  evidenceUrl?: string
  target?: AiTarget
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning: string
  tools: AiToolCall[]
  pending: boolean
  cancelled?: boolean
  error?: string
}

export interface AiSeed {
  id: string
  message: string
  context?: AiContext
}

export type AiRightTab = 'steps' | 'elements' | 'report' | 'copilot'
