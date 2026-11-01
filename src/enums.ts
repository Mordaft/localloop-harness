export const AppScreen = {
  SESSIONS: 'sessions',
  MEMORY: 'memory',
  SETTINGS: 'settings',
} as const
export type AppScreen = (typeof AppScreen)[keyof typeof AppScreen]

export const SessionFilter = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
} as const
export type SessionFilter = (typeof SessionFilter)[keyof typeof SessionFilter]

export const SessionStatus = {
  IDLE: 1,
  RUNNING: 2,
  WAITING_APPROVAL: 3,
  COMPLETED: 4,
  BUDGET_EXCEEDED: 5,
  ERROR: 6,
} as const
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus]

export const FsWriteMode = {
  CONFIRM: 'confirm',
  AUTO: 'auto',
} as const
export type FsWriteMode = (typeof FsWriteMode)[keyof typeof FsWriteMode]

export const FileProposalStatus = {
  PENDING: 'pending',
  APPLIED: 'applied',
  REJECTED: 'rejected',
} as const
export type FileProposalStatus = (typeof FileProposalStatus)[keyof typeof FileProposalStatus]

export const McpTransportType = {
  SSE: 'sse',
  HTTP: 'http',
  WS: 'ws',
} as const
export type McpTransportType = (typeof McpTransportType)[keyof typeof McpTransportType]
