import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { TrayView } from '@/components/Tray/TrayView'
import { Toaster } from '@/components/ui/toaster'
import { Skeleton } from '@/components/ui/skeleton'
import ErrorBoundary from '@/components/ErrorBoundary'

const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Providers = lazy(() => import('@/pages/Providers').then(m => ({ default: m.Providers })))
const Aggregate = lazy(() => import('@/pages/Aggregate').then(m => ({ default: m.Aggregate })))
const Channels = lazy(() => import('@/pages/Channels').then(m => ({ default: m.Channels })))
const ProxySettings = lazy(() => import('@/pages/ProxySettings').then(m => ({ default: m.ProxySettings })))
const Models = lazy(() => import('@/pages/Models').then(m => ({ default: m.Models })))
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
          <Route path="/logs" element={<Suspense fallback={<PageLoader />}><Logs /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
          {/* 兜底：书签或深链指向已改名/已删除的路由时，之前是「有侧边栏、内容区空白」，
              用户读不出是路由错了还是页面坏了。 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  )
}

export default App
