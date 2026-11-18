import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  dismissable?: boolean
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-50 bg-slate-900/50" />
        <Dialog.Content
          onInteractOutside={(event) => {
            if (!dismissable) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => {
            if (!dismissable) event.preventDefault()
          }}
          className={cn(
            'surface-raised animate-modal-in fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto shadow-lg focus:outline-none',
            size === 'sm' && 'max-w-md',
            size === 'md' && 'max-w-xl',
            size === 'lg' && 'max-w-3xl',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-txt-primary">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-txt-secondary">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Fechar" className="-mr-2 -mt-1">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="px-6 py-5">{children}</div>

          {footer && (
            <footer className="flex flex-col-reverse gap-2 border-t border-line bg-subtle px-6 py-4 sm:flex-row sm:justify-end">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
