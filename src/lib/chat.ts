import { supabase } from './supabase'
import type { DocType } from './leases'

export type ChatSource = { leaseId: string; title: string; docType: DocType; page: number }

export type ChatUsage = { input: number; output: number }

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  // Tokens used to produce this answer (every Claude request made while searching).
  usage?: ChatUsage
  error?: boolean
}

export type LeaseChat = {
  id: string
  lease_id: string | null
  title: string
  messages: ChatMessage[]
  created_at: string
  updated_at: string
}

export type LeaseChatSummary = Pick<LeaseChat, 'id' | 'lease_id' | 'title' | 'updated_at'>

export async function listChats(): Promise<LeaseChatSummary[]> {
  const { data, error } = await supabase
    .from('lease_chats')
    .select('id, lease_id, title, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function fetchChat(id: string): Promise<LeaseChat | null> {
  const { data, error } = await supabase.from('lease_chats').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as LeaseChat | null
}

/** Creates the chat when id is null; returns the saved chat's summary. Failed replies are not stored. */
export async function saveChat(id: string | null, leaseId: string | null, messages: ChatMessage[]): Promise<LeaseChatSummary> {
  const stored = messages.filter((m) => !m.error)
  const row = { lease_id: leaseId, messages: stored, updated_at: new Date().toISOString() }
  const query = id
    ? supabase.from('lease_chats').update(row).eq('id', id)
    : supabase.from('lease_chats').insert({ ...row, title: chatTitle(stored) })
  const { data, error } = await query.select('id, lease_id, title, updated_at').single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteChat(id: string) {
  const { error } = await supabase.from('lease_chats').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function chatTitle(messages: ChatMessage[]) {
  const first = messages.find((m) => m.role === 'user')?.content.trim().replace(/\s+/g, ' ') ?? 'New chat'
  return first.length > 80 ? `${first.slice(0, 77)}…` : first
}

/** Asks the lease-chat Edge Function; history is every earlier message in the conversation. */
export async function askLeaseQuestion(history: ChatMessage[], leaseId: string | null, chatId: string | null) {
  const messages = history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }))
  const { data, error } = await supabase.functions.invoke('lease-chat', { body: { messages, leaseId, chatId } })
  if (error) {
    if (error.name === 'FunctionsFetchError') {
      throw new Error('Could not reach the "lease-chat" Edge Function. Make sure it is deployed to your Supabase project.')
    }
    // FunctionsHttpError carries the function's JSON error body in context.
    const body = await error.context?.json?.().catch(() => null)
    throw new Error(body?.error ?? error.message)
  }
  return data as { answer: string; sources: ChatSource[]; usage?: ChatUsage }
}
