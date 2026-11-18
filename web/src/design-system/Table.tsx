import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from './Skeleton'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Conteúdo customizado no cabeçalho (ex.: checkbox de seleção) */
  headerRender?: () => ReactNode
  headerClassName?: string
  cellClassName?: string
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  isLoading?: boolean
  className?: string
}

export function Table<T>({
  columns,
  data,
  rowKey,
  empty,
  isLoading = false,
  className,
}: TableProps<T>) {
  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)} aria-busy="true" aria-label="Carregando">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-sm" />
        ))}
      </div>
    )
  }

  if (data.length === 0) return <>{empty}</>

  return (
    <>
      {/* Desktop: tabela densa com cabeçalho fixo */}
      <div className={cn('surface max-h-[70vh] overflow-auto', className)}>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-subtle">
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-3 text-xs font-semibold text-txt-muted',
                    column.headerClassName,
                  )}
                >
                  {column.headerRender ? column.headerRender() : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-line transition-colors last:border-0 hover:bg-hover"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn('h-11 px-4 align-middle text-txt-secondary', column.cellClassName)}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards empilhados */}
      <div className={cn('space-y-2 md:hidden', className)}>
        {data.map((row, index) => (
          <div
            key={rowKey(row)}
            className="surface stagger-item p-4"
            style={{ animationDelay: `${index * 30}ms` }}
          >
            {columns.map((column) => (
              <div key={column.key} className="flex items-start justify-between gap-4 py-1">
                <span className="text-xs font-medium text-txt-muted">{column.header}</span>
                <span className="text-right text-sm text-txt-primary">{column.render(row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
