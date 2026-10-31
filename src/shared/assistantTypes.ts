export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; isError: boolean }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }

export interface ApprovalRequest { id: string; tool: string; summary: string }
