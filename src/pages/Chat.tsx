import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../lib/db'
import { DOC_TYPE_LABELS, formatTokens, type Lease } from '../lib/leases'
import { useDialog } from '../components/Dialog'
import { formatDateTime, formatNumber, useT } from '../i18n'
import { chat as chatMessages } from '../i18n/messages/chat'
import { common } from '../i18n/messages/common'
import { askLeaseQuestion, deleteChat, fetchChat, listChats, saveChat, type ChatMessage, type LeaseChatSummary } from '../lib/chat'

const SUGGESTIONS = ['suggestion1', 'suggestion2', 'suggestion3', 'suggestion4'] as const

// Renders **bold** spans; everything else is shown as plain text.
function renderText(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

export function Chat() {
  const [params, setParams] = useSearchParams()
  const leaseId = params.get('lease')
  const chatId = params.get('chat')
  const [leases, setLeases] = useState<Lease[]>([])
  const [chats, setChats] = useState<LeaseChatSummary[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const dialog = useDialog()
  const { t, tp } = useT(chatMessages)
  const { t: tc } = useT(common)
  // The chat whose messages are in state, so reopening it doesn't refetch.
  const loadedChatId = useRef<string | null>(null)

  const setUrl = (chat: string | null, lease: string | null) => {
    const next: Record<string, string> = {}
    if (chat) next.chat = chat
    if (lease) next.lease = lease
    setParams(next)
  }

  useEffect(() => {
    listChats().then(setChats, (e) => setHistoryError(e.message))
  }, [])

  // Open the chat named in the URL (sidebar click, back/forward, shared link).
  useEffect(() => {
    if (chatId === loadedChatId.current) return
    loadedChatId.current = chatId
    if (!chatId) {
      setMessages([])
      return
    }
    fetchChat(chatId).then(
      (chat) => {
        if (loadedChatId.current !== chatId) return
        if (!chat) {
          setUrl(null, leaseId)
          return
        }
        setMessages(chat.messages)
        if (chat.lease_id !== leaseId) setUrl(chat.id, chat.lease_id)
      },
      (e) => setHistoryError(e.message),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  useEffect(() => {
    db
      .from('leases')
      .select('*')
      .order('title')
      .then(({ data }) => setLeases((data as Lease[]) ?? []))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const send = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setBusy(true)
    // A new chat is saved before asking, so the question's token usage can be linked to it.
    let id = chatId
    if (!id) {
      try {
        const created = await saveChat(null, leaseId, history)
        id = created.id
        setChats((list) => [created, ...list])
        loadedChatId.current = created.id
        setUrl(created.id, leaseId)
      } catch (err) {
        setHistoryError(t('saveFailed', { error: err instanceof Error ? err.message : String(err) }))
      }
    }

    let reply: ChatMessage
    try {
      const { answer, sources, usage } = await askLeaseQuestion(history, leaseId, id)
      reply = { role: 'assistant', content: answer, sources, usage }
    } catch (err) {
      reply = { role: 'assistant', content: err instanceof Error ? err.message : String(err), error: true }
    }
    const all = [...history, reply]
    setMessages(all)
    setBusy(false)

    try {
      const saved = await saveChat(id, leaseId, all)
      setChats((list) => [saved, ...list.filter((c) => c.id !== saved.id)])
      if (saved.id !== id) {
        loadedChatId.current = saved.id
        setUrl(saved.id, leaseId)
      }
      setHistoryError(null)
    } catch (err) {
      setHistoryError(t('saveFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  const newChat = () => setUrl(null, leaseId)

  const removeChat = async (chat: LeaseChatSummary) => {
    const ok = await dialog.confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage', { title: chat.title }),
      confirmLabel: tc('delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteChat(chat.id)
      setChats((list) => list.filter((c) => c.id !== chat.id))
      if (chat.id === chatId) setUrl(null, leaseId)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err))
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const setScope = (id: string) => setUrl(chatId, id || null)

  const answered = messages.filter((m) => m.usage)
  const chatInput = answered.reduce((n, m) => n + (m.usage?.input ?? 0), 0)
  const chatOutput = answered.reduce((n, m) => n + (m.usage?.output ?? 0), 0)

  return (
    <main className="container wide chat-page">
      <div className="page-header">
        <div>
          <h1>{t('title')}</h1>
          <p className="muted">{t('intro')}</p>
        </div>
        <div className="chat-toolbar">
          {answered.length > 0 && (
            <span
              className="muted small chat-usage-total"
              title={tp('chatUsageTitle', answered.length, { input: formatNumber(chatInput), output: formatNumber(chatOutput) })}
            >
              {t('chatUsage', { input: formatTokens(chatInput), output: formatTokens(chatOutput) })}
            </span>
          )}
          <select className="select" value={leaseId ?? ''} onChange={(e) => setScope(e.target.value)} aria-label={t('documentsToSearch')}>
            <option value="">{t('allDocuments')}</option>
            {leases.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} ({DOC_TYPE_LABELS[l.doc_type]})
              </option>
            ))}
          </select>
        </div>
      </div>
      {historyError && <p className="error">{historyError}</p>}

      <div className="chat-layout">
        <aside className="chat-history card">
          <button className="btn btn-sm chat-new" onClick={newChat} disabled={busy}>
            {t('newChat')}
          </button>
          {chats.length === 0 ? (
            <p className="muted small chat-history-empty">{t('historyEmpty')}</p>
          ) : (
            <ul className="chat-history-list">
              {chats.map((c) => (
                <li key={c.id} className={c.id === chatId ? 'active' : undefined}>
                  <button className="chat-history-item" onClick={() => setUrl(c.id, c.lease_id)} disabled={busy} title={c.title}>
                    <span className="chat-history-title">{c.title}</span>
                    <span className="muted small">{formatDateTime(c.updated_at)}</span>
                  </button>
                  <button className="chat-history-delete" onClick={() => removeChat(c)} disabled={busy} aria-label={t('deleteChatLabel', { title: c.title })} title={t('deleteChat')}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="chat card">
          <div className="chat-log">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p className="muted">{t('tryThese')}</p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((key) => (
                    <button key={key} className="chat-suggestion" onClick={() => void send(t(key))}>
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`chat-msg chat-${m.role}${m.error ? ' chat-error' : ''}`}>
                <div className="chat-bubble">{m.role === 'assistant' ? renderText(m.content) : m.content}</div>
                {m.usage && (
                <div
                  className="muted small chat-usage"
                  title={t('messageUsageTitle', { input: formatNumber(m.usage.input), output: formatNumber(m.usage.output) })}
                >
                  {t('messageUsage', { input: formatTokens(m.usage.input), output: formatTokens(m.usage.output) })}
                </div>
              )}
              {m.sources && m.sources.length > 0 && (
                  <div className="chat-sources">
                    <span className="muted small">{t('sources')}</span>
                    {m.sources.map((s) => (
                      <Link key={`${s.leaseId}:${s.page}`} to={`/leases/${s.leaseId}`} className="chat-source" title={DOC_TYPE_LABELS[s.docType]}>
                        {t('sourcePage', { title: s.title, page: s.page })}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="chat-msg chat-assistant">
                <div className="chat-bubble muted">
                  <span className="spinner" role="status" aria-label={t('working')} /> {t('searching')}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="chat-input" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('placeholder')}
              rows={2}
              disabled={busy}
            />
            <button className="btn" type="submit" disabled={busy || !input.trim()}>
              {t('send')}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
