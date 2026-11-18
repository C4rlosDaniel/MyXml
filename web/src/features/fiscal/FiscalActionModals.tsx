import { AlertTriangle, Ban, FilePenLine, Hash } from 'lucide-react'
import { useState } from 'react'
import { Button, Input, Modal, useToast } from '@/design-system'
import type { Note } from '@/types'

export type FiscalAction = 'cancelamento' | 'carta-correcao' | 'inutilizacao'

const config: Record<FiscalAction, { title: string; description: string; icon: typeof Ban; label: string }> = {
  cancelamento: {
    title: 'Cancelar nota',
    description: 'Informe o motivo do cancelamento. A SEFAZ só aceita cancelamentos dentro do prazo permitido.',
    icon: Ban,
    label: 'Justificativa',
  },
  'carta-correcao': {
    title: 'Carta de Correção',
    description: 'Use para corrigir erros que não alteram valor, impostos ou destinatário.',
    icon: FilePenLine,
    label: 'Texto da correção',
  },
  inutilizacao: {
    title: 'Inutilizar numeração',
    description: 'Inutilize números que nunca foram usados. Esta ação é irreversível.',
    icon: Hash,
    label: 'Justificativa',
  },
}

interface FiscalActionModalsProps {
  action: FiscalAction | null
  note: Note | null
  onOpenChange: (open: boolean) => void
}

export function FiscalActionModals({ action, note, onOpenChange }: FiscalActionModalsProps) {
  const { success, error: showError, info } = useToast()
  const [reason, setReason] = useState('')
  const [serie, setSerie] = useState('1')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [saving, setSaving] = useState(false)

  const close = () => {
    setReason('')
    setFrom('')
    setTo('')
    onOpenChange(false)
  }

  const confirm = async () => {
    if (reason.trim().length < 10) {
      showError('Justificativa muito curta', 'Informe ao menos 10 caracteres.')
      return
    }
    if (action === 'inutilizacao' && (!from || !to || Number(to) < Number(from))) {
      showError('Faixa inválida', 'Confira os números inicial e final.')
      return
    }
    setSaving(true)
    // TODO: enviar para a API (POST /notes/:id/cancel, /correction, /inutilization)
    await new Promise((resolve) => setTimeout(resolve, 700))
    setSaving(false)
    success('Solicitação registrada!', 'O resultado do evento será exibido no histórico da nota.')
    info('Integração com a SEFAZ pendente.', 'Nenhuma regra fiscal foi aplicada nesta demonstração.')
    close()
  }

  if (!action) return null
  const item = config[action]

  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title={item.title}
      description={item.description}
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancelar</Button>
          <Button variant={action === 'carta-correcao' ? 'primary' : 'danger'} loading={saving} loadingText="Enviando..." onClick={confirm}>Confirmar</Button>
        </>
      }
    >
      <div className="flex items-start gap-2 rounded-sm border border-warning-border bg-warning-soft p-3 text-xs text-warning-fg">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {action === 'cancelamento' && 'Prazo: cancelamentos devem ser solicitados em até 24 horas após a autorização.'}
          {action === 'carta-correcao' && 'A carta de correção não pode alterar valores, impostos ou o destinatário.'}
          {action === 'inutilizacao' && 'Só inutilize números nunca utilizados. A faixa inutilizada não poderá ser usada depois.'}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {note && (
          <div className="rounded-sm border border-line bg-subtle p-3 text-xs text-txt-secondary">
            Nota nº <strong className="text-txt-primary">{note.numero}</strong> • {note.clientName ?? '—'}
          </div>
        )}
        {action === 'inutilizacao' && (
          <div className="grid grid-cols-3 gap-3">
            <Input label="Série" value={serie} onChange={(event) => setSerie(event.target.value)} />
            <Input label="Nº inicial" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Input label="Nº final" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-txt-secondary" htmlFor="fiscal-reason">{item.label}</label>
          <textarea
            id="fiscal-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Descreva o motivo com clareza"
            className="field w-full resize-none p-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none"
          />
        </div>
      </div>
    </Modal>
  )
}
