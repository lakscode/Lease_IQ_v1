import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type ConfirmOptions = {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  // Red confirm button, for actions that delete or replace data.
  danger?: boolean
}

type AlertOptions = { title: string; message?: ReactNode; okLabel?: string }

type DialogApi = {
  /** Resolves true when the user confirms, false when they cancel or dismiss. */
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Resolves when the user closes the message. */
  alert: (options: AlertOptions) => Promise<void>
}

type OpenDialog = ConfirmOptions & { kind: 'confirm' | 'alert'; resolve: (ok: boolean) => void }

const DialogContext = createContext<DialogApi | null>(null)

/** In-app replacement for window.confirm / window.alert. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, kind: 'confirm', resolve })),
    [],
  )
  const alert = useCallback(
    ({ okLabel, ...options }: AlertOptions) =>
      new Promise<void>((resolve) => setDialog({ ...options, confirmLabel: okLabel ?? 'OK', kind: 'alert', resolve: () => resolve() })),
    [],
  )

  const close = useCallback(
    (ok: boolean) => {
      dialog?.resolve(ok)
      setDialog(null)
    },
    [dialog],
  )

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog && <DialogView dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  )
}

function DialogView({ dialog, onClose }: { dialog: OpenDialog; onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog" role={dialog.kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialog-title">
        <div className={`dialog-icon${dialog.danger ? ' dialog-icon-danger' : ''}`} aria-hidden>
          {dialog.kind === 'alert' ? 'i' : dialog.danger ? '!' : '?'}
        </div>
        <div className="dialog-content">
          <h3 id="dialog-title">{dialog.title}</h3>
          {dialog.message && <div className="dialog-message">{dialog.message}</div>}
        </div>
        <div className="dialog-actions">
          {dialog.kind === 'confirm' && (
            <button className="btn btn-ghost" onClick={() => onClose(false)}>
              {dialog.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button ref={confirmRef} className={`btn${dialog.danger ? ' btn-danger' : ''}`} onClick={() => onClose(true)}>
            {dialog.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useDialog(): DialogApi {
  const api = useContext(DialogContext)
  if (!api) throw new Error('useDialog must be used inside <DialogProvider>')
  return api
}
