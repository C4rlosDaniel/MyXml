import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Step {
  id: string
  label: string
  description?: string
}

export interface StepperProps {
  steps: Step[]
  current: number
  onStepClick?: (index: number) => void
  /** Índices com erro de validação */
  errorSteps?: number[]
  className?: string
}

export function Stepper({
  steps,
  current,
  onStepClick,
  errorSteps = [],
  className,
}: StepperProps) {
  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100

  return (
    <div className={cn('w-full', className)}>
      <div className="relative mb-5 h-1 w-full rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={current + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-label="Progresso do preenchimento"
        />
      </div>

      <ol className="flex items-start justify-between gap-1">
        {steps.map((step, index) => {
          const done = index < current && !errorSteps.includes(index)
          const hasError = errorSteps.includes(index)
          const active = index === current
          return (
            <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center text-center">
              <button
                type="button"
                disabled={!onStepClick || index > current}
                onClick={() => onStepClick?.(index)}
                aria-current={active ? 'step' : undefined}
                aria-invalid={hasError || undefined}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-150 focus-ring',
                  hasError && 'border-danger bg-danger-soft text-danger-fg',
                  done && 'border-success-border bg-success-soft text-success-fg',
                  active && 'border-accent bg-accent text-accent-on',
                  !done && !active && !hasError && 'border-line-strong bg-surface text-txt-muted',
                  onStepClick && index <= current && 'cursor-pointer',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : index + 1}
              </button>
              <span
                className={cn(
                  'mt-2 max-w-[90px] text-xs font-medium leading-tight',
                  active ? 'text-primary-fg' : hasError ? 'text-danger-fg' : 'text-txt-muted',
                )}
              >
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
