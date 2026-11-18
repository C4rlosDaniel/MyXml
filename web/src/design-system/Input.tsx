import { Check, X } from 'lucide-react'
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  icon?: ReactNode
  containerClassName?: string
  success?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      icon,
      containerClassName,
      success = false,
      className,
      id,
      type = 'text',
      ...props
    },
    ref,
  ) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined

    return (
      <div className={cn('w-full', containerClassName)}>
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-xs font-medium text-txt-secondary"
        >
          {label}
        </label>

        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted">
              {icon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            type={type}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={describedBy}
            className={cn(
              'field h-10 w-full px-3 text-sm text-txt-primary placeholder:text-txt-muted',
              'transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none',
              icon && 'pl-9',
              (error || success) && 'pr-9',
              error && 'border-danger',
              className,
            )}
            {...props}
          />

          {(error || success) && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full',
                error ? 'bg-danger-soft text-danger-fg' : 'bg-success-soft text-success-fg',
              )}
            >
              {error ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            </span>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-danger-fg">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="mt-1 text-xs text-txt-muted">
            {hint}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'
