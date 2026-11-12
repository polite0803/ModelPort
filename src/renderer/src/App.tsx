import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { TrayView } from '@/components/Tray/TrayView'
import { Toaster } from '@/components/ui/toaster'
import { Skeleton } from '@/components/ui/skeleton'
import ErrorBoundary from '@/components/ErrorBoundary'
import type { ShellBridge } from '@shared/shellBridge'
import { installTrayRouteBridge } from '@/api/trayRoutes'

const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Providers = lazy(() => import('@/pages/Providers').then(m => ({ default: m.Providers })))
const Aggregate = lazy(() => import('@/pages/Aggregate').then(m => ({ default: m.Aggregate })))
const Channels = lazy(() => import('@/pages/Channels').then(m => ({ default: m.Channels })))
const ProxySettings = lazy(() => import('@/pages/ProxySettings').then(m => ({ default: m.ProxySettings })))
const Models = lazy(() => import('@/pages/Models').then(m => ({ default: m.Models })))
const RoutesPage = lazy(() => import('@/pages/Routes').then(m => ({ default: m.Routes })))
const Gateways = lazy(() => import('@/pages/Gateways').then(m => ({ default: m.Gateways })))
const Logs = lazy(() => import('@/pages/Logs'))
const Settings = lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="space-y-4 w-full max-w-md">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}

/**
 * The menu entry and its accelerator ask for a page instead of opening a second window, so
 * the request arrives here rather than as a new window. Only in-app paths are honoured: the
 * bridge exists in the console, but a page must never be able to steer itself off-origin.
 */
function ShellNavigation(): null {
  const navigate = useNavigate()

  useEffect(() => {
    const bridge = (window as unknown as { modelportShell?: ShellBridge }).modelportShell
    const off = bridge?.onNavigate?.((path) => {
      if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) navigate(path)
    })
    return () => off?.()
  }, [navigate])

  return null
}

/**
 * The tray's model submenu is drawn by the shell but answered here (the secret lives in
 * this page). Mounted once at the app root: it must be alive on every route, not only on
 * the models page - the tray does not know which page the user is looking at.
 */
function TrayRouteBridge(): null {
  useEffect(() => installTrayRouteBridge(), [])
  return null
}

function App() {
  return (
    <>
      <Routes>
        <Route path="/tray" element={<ErrorBoundary><TrayView /></ErrorBoundary>} />
        <Route element={<MainLayout />}>
          <Route path="/" element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
          <Route path="/providers" element={<Suspense fallback={<PageLoader />}><Providers /></Suspense>} />
          <Route path="/aggregate" element={<Suspense fallback={<PageLoader />}><Aggregate /></Suspense>} />
          <Route path="/channels" element={<Suspense fallback={<PageLoader />}><Channels /></Suspense>} />
          <Route path="/proxy" element={<Suspense fallback={<PageLoader />}><ProxySettings /></Suspense>} />
          <Route path="/models" element={<Suspense fallback={<PageLoader />}><Models /></Suspense>} />
          <Route path="/routes" element={<Suspense fallback={<PageLoader />}><RoutesPage /></Suspense>} />
          <Route path="/gateways" element={<Suspense fallback={<PageLoader />}><Gateways /></Suspense>} />
          <Route path="/logs" element={<Suspense fallback={<PageLoader />}><Logs /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
          {/* 兜底：书签或深链指向已改名/已删除的路由时，之前是「有侧边栏、内容区空白」，
              用户读不出是路由错了还是页面坏了。 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ShellNavigation />
      <TrayRouteBridge />
      <Toaster />
    </>
  )
}

export default App
