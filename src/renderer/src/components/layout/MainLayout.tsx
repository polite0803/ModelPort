import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import ErrorBoundary from '@/components/ErrorBoundary'

export function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          {/* 页面不设最大宽度：宽窗口下用满宽度，留白只来自内边距。 */}
          <div className="w-full px-6 py-6 lg:px-8">
            {/* 页面级隔离：某一页渲染异常只打掉内容区，侧边栏、顶栏和托盘还在，
                用户能切到别的页面继续用，而不是整窗白屏只能强制结束进程。 */}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
