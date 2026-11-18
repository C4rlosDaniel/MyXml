import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="MyFly — para o seu negócio decolar"
      className={cn('h-16 w-auto object-contain', className)}
    />
  )
}
