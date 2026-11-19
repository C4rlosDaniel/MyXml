/* ============================================================
   Trava de navegação enquanto uma execução de download está ativa.

   Toda troca de "aba" (rota) do sistema passa por requestNavigation().
   Se houver download em andamento, um aviso é exibido:
     - Sim => encerra o programa de download e navega;
     - Não => permanece na tela e o download continua.
   ============================================================ */

import { AlertTriangle } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button, Modal } from '@/design-system'

interface DownloadGuardContextValue {
  isDownloading: boolean
  /** Inicia a trava e registra como o download deve ser encerrado. */
  beginDownload: (cancel: () => void) => void
  /** Libera a trava (conclusão, erro ou cancelamento). */
  endDownload: () => void
  /** Executa uma navegação, pedindo confirmação se houver download ativo. */
  requestNavigation: (action: () => void) => void
}

const DownloadGuardContext = createContext<DownloadGuardContextValue | null>(null)

export function DownloadGuardProvider({ children }: { children: ReactNode }) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const beginDownload = useCallback((cancel: () => void) => {
    cancelRef.current = cancel
    setIsDownloading(true)
  }, [])

  const endDownload = useCallback(() => {
    cancelRef.current = null
    setIsDownloading(false)
  }, [])

  const requestNavigation = useCallback(
    (action: () => void) => {
      if (!isDownloading) {
        action()
        return
      }
      setPendingAction(() => action)
    },
    [isDownloading],
  )

  const stay = () => setPendingAction(null)

  const leave = () => {
    const action = pendingAction
    cancelRef.current?.()
    cancelRef.current = null
    setIsDownloading(false)
    setPendingAction(null)
    action?.()
  }

  // Fechar/atualizar a aba do navegador também precisa de confirmação.
  useEffect(() => {
    if (!isDownloading) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDownloading])

  const value = useMemo<DownloadGuardContextValue>(
    () => ({ isDownloading, beginDownload, endDownload, requestNavigation }),
    [isDownloading, beginDownload, endDownload, requestNavigation],
  )

  return (
    <DownloadGuardContext.Provider value={value}>
      {children}

      <Modal
        open={pendingAction !== null}
        onOpenChange={(open) => !open && stay()}
        title="Download em andamento"
        description="Atenção: sair daqui pausará o download."
        size="sm"
        dismissable={false}
        footer={
          <>
            <Button variant="secondary" onClick={stay}>
              Não, continuar baixando
            </Button>
            <Button variant="danger" onClick={leave}>
              Sim, pausar e sair
            </Button>
          </>
        }
      >
        <div className="flex gap-3 rounded-sm border border-warning-border bg-warning-soft p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-fg" />
          <div className="text-sm text-txt-secondary">
            <p>
              Se você sair desta aba, o download será <strong>pausado</strong>. Tudo o
              que já foi baixado fica salvo.
            </p>
            <p className="mt-2">
              Ao voltar, é só iniciar o download do mesmo período novamente para
              continuar de onde parou, sem baixar tudo outra vez.
            </p>
          </div>
        </div>
      </Modal>
    </DownloadGuardContext.Provider>
  )
}

export function useDownloadGuard() {
  const context = useContext(DownloadGuardContext)
  if (!context) {
    throw new Error('useDownloadGuard deve ser usado dentro de DownloadGuardProvider')
  }
  return context
}
