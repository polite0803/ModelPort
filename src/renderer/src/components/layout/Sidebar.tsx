import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Server,
  Settings2,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Cpu,
  AlertTriangle,
  Zap,
  Boxes,
  KeyRound,
  Network,
} from 'lucide-react'
import type { ShellBridge } from '@shared/shellBridge'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNavigationStore } from '@/stores/navigationStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface NavItem {
  titleKey: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { titleKey: 'nav.dashboard', href: '/', icon: LayoutDashboard },
  { titleKey: 'nav.providers', href: '/providers', icon: Server },
  { titleKey: 'nav.aggregate', href: '/aggregate', icon: Boxes },
  { titleKey: 'nav.channels', href: '/channels', icon: KeyRound },
  { titleKey: 'nav.proxy', href: '/proxy', icon: Settings2 },
  { titleKey: 'nav.models', href: '/models', icon: Cpu },
  { titleKey: 'nav.logs', href: '/logs', icon: FileText },
  { titleKey: 'nav.settings', href: '/settings', icon: Settings },
]

function NavButton({
  item,
  collapsed,
  onNavigate,
  hasBlockers,
  isCurrent,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate: (href: string) => void
  hasBlockers: boolean
  isCurrent: boolean
}) {
  const { t } = useTranslation()
  const title = t(item.titleKey)

  const link = (
    <NavLink
      to={item.href}
      aria-label={title}
      onClick={(event) => {
        if (hasBlockers && !isCurrent) {
          event.preventDefault()
          onNavigate(item.href)
        }
      }}
      className={({ isActive }) =>
        cn(
          'sidebar-nav-item',
          collapsed ? 'collapsed' : 'expanded',
          isActive ? 'active' : 'inactive'
        )
      }
    >
      <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
      {!collapsed && <span className="truncate">{title}</span>}
    </NavLink>
  )

  if (!collapsed) return link

  return (
    <div className="tooltip-container">
      {link}
      <div className="tooltip-content" role="tooltip">
        {title}
      </div>
    </div>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const { sidebarCollapsed, toggleSidebar } = useSettingsStore()
  const { blockers, isDialogOpen, setPendingNavigation, confirmNavigation, cancelNavigation } =
    useNavigationStore()
  const navigate = useNavigate()
  const location = useLocation()

  // Only the console window injects `modelportShell`; the same page opened in a browser
  // (or in a shell older than the panel) has no bridge and shows no entry.
  const openGatewayManager = (window as unknown as { modelportShell?: ShellBridge }).modelportShell
    ?.openGatewayManager

  const hasBlockers = blockers.length > 0

  const handleNavigation = (href: string) => {
    if (hasBlockers && location.pathname !== href) {
      setPendingNavigation(() => navigate(href))
    } else {
      navigate(href)
    }
  }

  const handleCancelNavigation = () => {
    cancelNavigation()
  }

  return (
    <>
      <aside
        className={cn(
          'glass-sidebar flex shrink-0 flex-col transition-[width] duration-200 ease-out',
          sidebarCollapsed ? 'w-16' : 'w-[232px]'
        )}
      >
        <div
          className={cn(
            'drag-region flex h-12 items-center border-b border-[var(--glass-border)]',
            sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
          )}
        >
          <div className="sidebar-logo-icon">
            <Zap className="h-3.5 w-3.5" />
          </div>
          {!sidebarCollapsed && (
            <span className="sidebar-wordmark">ModelPort</span>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-2">
          {navItems.map((item) => (
            <NavButton
              key={item.href}
              item={item}
              collapsed={sidebarCollapsed}
              onNavigate={handleNavigation}
              hasBlockers={hasBlockers}
              isCurrent={
                location.pathname === item.href ||
                (item.href !== '/' && location.pathname.startsWith(`${item.href}/`))
              }
            />
          ))}
          {openGatewayManager !== undefined && (
            <button
              type="button"
              className={cn(
                'sidebar-nav-item',
                sidebarCollapsed ? 'collapsed' : 'expanded',
                'inactive'
              )}
              aria-label={t('nav.gatewayManager')}
              title={sidebarCollapsed ? t('nav.gatewayManager') : undefined}
              onClick={() => void openGatewayManager()}
            >
              <Network className="h-[18px] w-[18px] flex-shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{t('nav.gatewayManager')}</span>}
            </button>
          )}
        </nav>

        <div className="border-t border-[var(--glass-border)] p-2">
          <div className={cn('flex', sidebarCollapsed ? 'justify-center' : 'justify-end')}>
            <button
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? t('settings.expandSidebar') : t('settings.collapseSidebar')}
              title={sidebarCollapsed ? t('settings.expandSidebar') : t('settings.collapseSidebar')}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </aside>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && handleCancelNavigation()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[var(--warning)]" />
              {t('proxy.unsavedChangesTitle')}
            </DialogTitle>
            <DialogDescription>
              {blockers[0]?.message || t('proxy.unsavedChangesDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCancelNavigation}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmNavigation}>
              {t('proxy.discardAndLeave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
