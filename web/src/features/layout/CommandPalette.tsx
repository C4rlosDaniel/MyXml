import * as Dialog from '@radix-ui/react-dialog'
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export interface Command {
  id: string
  label: string
  group: string
  icon: LucideIcon
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
}

export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const normalize = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  const filtered = useMemo(() => {
    const term = normalize(query.trim())
    if (!term) return commands
    return commands.filter((command) =>
      normalize(`${command.label} ${command.group}`).includes(term),
    )
  }, [commands, query])

  useEffect(() => setActive(0), [query])

  const execute = (command: Command | undefined) => {
    if (!command) return
    command.run()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-[60] bg-slate-900/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="surface-raised animate-modal-in fixed left-1/2 top-1/2 z-[61] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden shadow-lg focus:outline-none"
        >
          <Dialog.Title className="sr-only">Buscar comandos</Dialog.Title>

          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-4 w-4 shrink-0 text-txt-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((index) => Math.min(index + 1, filtered.length - 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((index) => Math.max(index - 1, 0))
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  execute(filtered[active])
                }
              }}
              placeholder="Buscar notas, clientes ou ações..."
              aria-label="Buscar comandos"
              className="h-12 w-full bg-transparent text-sm text-txt-primary outline-none placeholder:text-txt-muted"
            />
            <kbd className="rounded-sm border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-txt-muted">
              ESC
            </kbd>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-txt-muted">Nenhum comando encontrado.</p>
            ) : (
              filtered.map((command, index) => {
                const Icon = command.icon
                return (
                  <button
                    key={command.id}
                    type="button"
                    onClick={() => execute(command)}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm transition-colors focus-ring',
                      index === active ? 'bg-accent-soft text-primary-fg' : 'text-txt-secondary hover:bg-hover',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{command.label}</span>
                    <span className="text-xs text-txt-muted">{command.group}</span>
                    {index === active && <CornerDownLeft className="h-3.5 w-3.5" />}
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-line bg-subtle px-4 py-2 text-[11px] text-txt-muted">
            <span><kbd className="font-medium">↑↓</kbd> navegar</span>
            <span><kbd className="font-medium">Enter</kbd> selecionar</span>
            <span><kbd className="font-medium">Esc</kbd> fechar</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
