import { cn } from '@/lib/utils'

export interface SkeletonProps {
  className?: string
  circle?: boolean
}

export function Skeleton({ className, circle = false }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('skeleton-shimmer', circle ? 'rounded-full' : 'rounded-sm', className)}
    />
  )
}
