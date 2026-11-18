import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Download,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  UserCircle2,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Button } from '@/design-system'
import { cn } from '@/lib/utils'
import { isMockMode } from '@/services/config'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { CommandPalette, type Command as PaletteCommand } from './CommandPalette'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const routeLabels: Record<string, string> = {
  '/': 'Visão geral',
  '/notas': 'Notas fiscais',
  '/baixar': 'Baixar notas',
  '/empresas': 'Empresas',
  '/historico': 'Histórico',
  '/configuracoes': 'Configurações',
  '/admin/licencas': 'Licenças',
}

function getBreadcrumbs(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return ['Visão geral']
  if (segments[0] === 'notas' && segments[1]) return ['Notas fiscais', 'Detalhe da nota']
  return [routeLabels[`/${segments[0]}`] ?? 'Página']
}

function ThemeToggle() {
  // Entrada sempre clara; o escuro é uma escolha explícita dentro da sessão.
  const [theme, setTheme] = useState<'dark' | 'light'>('light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('myxml-theme', theme)
    localStorage.setItem('myxml-theme-v2', '1')
  }, [theme])

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
      onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}

export function AppShell() {
  const { profile, signOut } = useAuth()
  const { companies, selectedCompany, selectedCompanyId, selectCompany } = useCompany()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('myxml-sidebar') === 'collapsed')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const lastG = useRef(0)

  useEffect(() => {
    localStorage.setItem('myxml-sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  const navGroups = useMemo<NavGroup[]>(
    () => [
      { label: 'Geral', items: [{ to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true }] },
      {
        label: 'Fiscal',
        items: [
          { to: '/baixar', label: 'Baixar notas', icon: Download },
          { to: '/notas', label: 'Notas fiscais', icon: FileText },
          { to: '/historico', label: 'Histórico', icon: History },
        ],
      },
      {
        label: 'Cadastros',
        items: [{ to: '/empresas', label: 'Empresas', icon: Building2 }],
      },
      {
        label: 'Configurações',
        items: [
          { to: '/configuracoes', label: 'Configurações', icon: Settings },
          ...(profile?.role === 'admin'
            ? [{ to: '/admin/licencas', label: 'Licenças', icon: ShieldCheck }]
            : []),
        ],
      },
    ],
    [profile?.role],
  )

  const commands = useMemo<PaletteCommand[]>(() => {
    const navCommands = navGroups.flatMap((group) =>
      group.items.map((item) => ({
        id: item.to,
        label: item.label,
        group: group.label,
        icon: item.icon,
        run: () => navigate(item.to),
      })),
    )
    return [
      ...navCommands,
      {
        id: 'download',
        label: 'Baixar notas agora',
        group: 'Ações',
        icon: Download,
        run: () => navigate('/baixar'),
      },
    ]
  }, [navGroups, navigate])

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/', { replace: true })
  }, [signOut, navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        navigate('/baixar')
        return
      }
      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (!isTyping && event.key.toLowerCase() === 'g') {
        lastG.current = Date.now()
        return
      }
      if (!isTyping && event.key.toLowerCase() === 'd' && Date.now() - lastG.current < 900) {
        navigate('/')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  const sidebarWidth = collapsed ? 'md:pl-16' : 'md:pl-60'
  const breadcrumbs = getBreadcrumbs(location.pathname)

  const renderNav = (compact: boolean) => (
    <nav aria-label="Navegação principal" className="space-y-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          {!compact && (
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-txt-muted">
              {group.label}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={compact ? item.label : undefined}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-sm py-2 text-sm font-medium transition-colors focus-ring',
                    compact ? 'justify-center px-2' : 'px-3',
                    isActive
                      ? 'border-l-2 border-accent bg-accent-soft text-primary-fg'
                      : 'border-l-2 border-transparent text-txt-secondary hover:bg-hover hover:text-txt-primary',
                  )
                }
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                {!compact && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-app">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-txt-primary focus:shadow-md"
      >
        Pular para o conteúdo
      </a>

      {/* Sidebar desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-150 md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('flex h-14 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
          {collapsed ? (
            <Logo className="h-8" />
          ) : (
            <Logo className="h-10" />
          )}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={cn('focus-ring rounded-sm p-1 text-txt-muted hover:bg-hover', collapsed && 'absolute -right-3 top-4 rounded-full border border-line bg-surface shadow-xs')}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">{renderNav(collapsed)}</div>

        <div className="border-t border-line p-3">
          {collapsed ? (
            <span className="mx-auto block h-2.5 w-2.5 rounded-full bg-warning" title="Homologação" />
          ) : (
            <div className="rounded-sm border border-line bg-subtle p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-txt-secondary">
                <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
                SEFAZ-SP
              </div>
              <p className="mt-1 text-xs text-txt-muted">Homologação • a verificar</p>
            </div>
          )}
        </div>
      </aside>

      <div className={cn('transition-[padding] duration-150', sidebarWidth)}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="focus-ring rounded-sm p-1.5 text-txt-secondary hover:bg-hover md:hidden"
              aria-label="Abrir menu"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />}
                  <span className={cn('truncate', index === breadcrumbs.length - 1 ? 'font-medium text-txt-primary' : 'text-txt-muted')}>
                    {crumb}
                  </span>
                </span>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Abrir busca (Ctrl+K)"
              className="focus-ring flex h-9 items-center gap-2 rounded-sm border border-line bg-subtle px-3 text-sm text-txt-muted transition-colors hover:bg-hover"
            >
              <Search className="h-4 w-4" />
              <span className="hidden lg:inline">Buscar...</span>
              <kbd className="hidden items-center gap-0.5 rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] lg:flex">
                <Command className="h-2.5 w-2.5" /> K
              </kbd>
            </button>

            <span
              className={cn(
                'hidden items-center gap-1.5 rounded-sm border px-2 py-1 text-xs font-medium sm:inline-flex',
                isMockMode
                  ? 'border-warning-border bg-warning-soft text-warning-fg'
                  : 'border-success-border bg-success-soft text-success-fg',
              )}
              title="Ambiente configurado"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', isMockMode ? 'bg-warning' : 'bg-success')} />
              {isMockMode ? 'Homologação' : 'Produção'}
            </span>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button aria-label="Notificações" className="focus-ring relative rounded-sm p-2 text-txt-secondary hover:bg-hover">
                  <Bell className="h-4 w-4" />
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="surface-raised z-50 w-72 p-3 shadow-md">
                  <p className="text-sm font-semibold text-txt-primary">Notificações</p>
                  <p className="mt-2 text-xs text-txt-muted">Nenhuma notificação nova.</p>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="ghost" size="sm" className="hidden gap-2 lg:inline-flex">
                  <Building2 className="h-4 w-4" />
                  <span className="max-w-[140px] truncate">
                    {selectedCompany?.nomeExibicao ?? selectedCompany?.razaoSocial ?? 'Selecionar empresa'}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="surface-raised z-50 w-72 p-1 shadow-md">
                  <DropdownMenu.Label className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-txt-muted">
                    Empresa selecionada
                  </DropdownMenu.Label>
                  {companies.map((company) => (
                    <DropdownMenu.Item
                      key={company.id}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-hover"
                      onSelect={() => {
                        selectCompany(company.id)
                        navigate('/')
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-txt-primary">
                          {company.nomeExibicao || company.razaoSocial}
                        </span>
                        <span className="block truncate text-xs text-txt-muted">{company.razaoSocial}</span>
                      </span>
                      {selectedCompanyId === company.id && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      )}
                    </DropdownMenu.Item>
                  ))}
                  {companies.length === 0 && (
                    <DropdownMenu.Item disabled className="px-3 py-2 text-xs text-txt-muted">
                      Nenhuma empresa com certificado cadastrado
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item
                    className="cursor-pointer rounded-sm px-3 py-2 text-sm text-primary-fg outline-none data-[highlighted]:bg-accent-soft"
                    onSelect={() => navigate('/empresas')}
                  >
                    + Gerenciar empresas / certificados
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <ThemeToggle />

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label="Menu do usuário"
                  className="focus-ring flex h-9 w-9 items-center justify-center rounded-full border border-line bg-subtle text-txt-secondary hover:bg-hover"
                >
                  <UserCircle2 className="h-5 w-5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="surface-raised z-50 w-60 p-2 shadow-md">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium text-txt-primary">{profile?.fullName}</p>
                    <p className="truncate text-xs text-txt-muted">{profile?.email}</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-primary-fg">
                      {profile?.role === 'admin' ? 'Administrador' : 'Contador'}
                    </p>
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm text-danger-fg outline-none data-[highlighted]:bg-danger-soft"
                    onSelect={handleSignOut}
                  >
                    <LogOut className="h-4 w-4" /> Sair
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <main id="conteudo" className="mx-auto w-full max-w-[1160px] px-4 pb-24 pt-6 md:px-8 md:pb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Drawer mobile */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="animate-fade fixed inset-0 z-40 bg-slate-900/50" />
          <Dialog.Content className="animate-slide-up fixed inset-y-0 left-0 z-50 w-72 border-r border-line bg-surface p-4 focus:outline-none">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <div className="mb-6 flex items-center justify-between">
              <Logo className="h-10" />
              <Dialog.Close className="focus-ring rounded-sm p-1 text-txt-muted" aria-label="Fechar menu">
                <span aria-hidden="true">✕</span>
              </Dialog.Close>
            </div>
            {renderNav(false)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Bottom bar mobile */}
      <nav aria-label="Navegação mobile" className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-md border border-line bg-surface px-2 py-2 shadow-md md:hidden">
        {navGroups.flatMap((group) => group.items).slice(0, 4).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn('flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm py-1 text-[11px] font-medium', isActive ? 'text-primary-fg' : 'text-txt-muted')
            }
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawerOpen(true)} className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium text-txt-muted">
          <Menu className="h-5 w-5" />
          Mais
        </button>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  )
}
