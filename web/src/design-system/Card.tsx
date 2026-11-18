import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'raised' | 'flat'
  /** Hover sutil de fundo para cartões clicáveis */
  interactive?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'surface',
        variant === 'raised' && 'surface-raised',
        variant === 'flat' && 'surface-flat',
        interactive && 'cursor-pointer transition-colors duration-150 hover:bg-hover',
        className,
      )}
      {...props}
    />
  ),
)

Card.displayName = 'Card'
