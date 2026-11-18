import * as Toast from '@radix-ui/react-toast'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  duration: number
}

interface ToastContextValue {
  /** Remove todos os avisos (usado ao trocar de sessão) */
  clear: () => void
  toast: (options: {
    kind?: ToastKind
    title: string
    description?: string
    duration?: number
  }) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const icons: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const borderColor: Record<ToastKind, string> = {
  success: 'border-l-success',
  error: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-info',
}

const iconColor: Record<ToastKind, string> = {
  success: 'text-success-fg',
  error: 'text-danger-fg',
  warning: 'text-warning-fg',
  info: 'text-info-fg',
}

const barColor: Record<ToastKind, string> = {
  success: 'bg-success',
  error: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
}

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback<ToastContextValue['toast']>(
    ({ kind = 'info', title, description, duration = 5000 }) => {
      setToasts((current) => {
        // Evita avisos idênticos repetidos (ex.: StrictMode ou duplo clique).
        if (current.some((item) => item.title === title && item.description === description)) {
          return current
        }
        return [...current, { id: ++nextId, kind, title, description, duration }]
      })
    },
    [],
  )

  const clear = useCallback(() => setToasts([]), [])

  const value = useMemo<ToastContextValue>(
    () => ({
      clear,
      toast,
      success: (title, description) => toast({ kind: 'success', title, description }),
      error: (title, description) => toast({ kind: 'error', title, description }),
      warning: (title, description) => toast({ kind: 'warning', title, description }),
      info: (title, description) => toast({ kind: 'info', title, description }),
    }),
    [toast, clear],
  )

  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right" duration={5000}>
        {children}

        <Toast.Viewport className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,400px)] flex-col gap-2 outline-none">
          {toasts.map((item) => {
            const Icon = icons[item.kind]
          return (
            <Toast.Root
              key={item.id}
              open
              duration={item.duration}
              onOpenChange={(open) => {
                if (!open) remove(item.id)
              }}
              className={cn(
                'surface-raised animate-slide-up pointer-events-none relative overflow-hidden border-l-4 p-4 pr-10',
                borderColor[item.kind],
              )}
              role={item.kind === 'error' ? 'alert' : 'status'}
            >
              <div className="flex gap-3">
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconColor[item.kind])} />
                <div className="min-w-0">
                  <Toast.Title className="text-sm font-semibold text-txt-primary">
                    {item.title}
                  </Toast.Title>
                  {item.description && (
                    <Toast.Description className="mt-1 text-xs leading-relaxed text-txt-secondary">
                      {item.description}
                    </Toast.Description>
                  )}
                </div>
              </div>
              <Toast.Close
                aria-label="Fechar aviso"
                className="focus-ring pointer-events-auto absolute right-3 top-3 rounded-sm p-1 text-txt-muted transition-colors hover:text-txt-primary"
              >
                <X className="h-4 w-4" />
              </Toast.Close>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-0 left-0 h-0.5 w-full origin-left',
                  barColor[item.kind],
                )}
                style={{ animation: `toast-progress ${item.duration}ms linear forwards` }}
              />
            </Toast.Root>
          )
          })}
        </Toast.Viewport>
      </Toast.Provider>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast deve ser usado dentro de ToastProvider')
  return context
}
