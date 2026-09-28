import { useRef, useState } from 'react'
import { uploadLeaseFile, type Lease, type Stage } from '../lib/leases'
import { useDialog } from './Dialog'
import { useT } from '../i18n'
import { uploadAmendment } from '../i18n/messages/uploadAmendment'

/**
 * Uploads a PDF of amendments (or addenda, letters…) for one main lease: the
 * file is analyzed like any upload, and its documents are linked to that lease.
 */
export function UploadAmendmentButton({ lease, compact, onDone }: {
  /** The main lease the documents belong to. */
  lease: Pick<Lease, 'id' | 'title'>
  /** Short "+ Amendment" label, for table rows. */
  compact?: boolean
  /** Called after the upload finished (or failed), to reload the page's data. */
  onDone: () => void
}) {
  const { t } = useT(uploadAmendment)
  const dialog = useDialog()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage | null>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setStage({ stage: 'uploading' })
    try {
      await uploadLeaseFile(file, setStage, lease.id)
      await dialog.alert({ title: t('doneTitle'), message: t('doneBody', { file: file.name, lease: lease.title }) })
    } catch (e) {
      await dialog.alert({ title: t('failedTitle'), message: e instanceof Error ? e.message : String(e) })
    } finally {
      setStage(null)
      if (inputRef.current) inputRef.current.value = ''
      onDone()
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <button
        className="btn btn-ghost btn-sm"
        disabled={stage !== null}
        title={t('title', { lease: lease.title })}
        onClick={() => inputRef.current?.click()}
      >
        {stage ? (
          <>
            <span className="spinner" aria-hidden /> {t(`busy_${stage.stage}`)}
          </>
        ) : compact ? t('short') : t('button')}
      </button>
    </>
  )
}
