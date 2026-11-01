import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

/**
 * 错误文本与组件栈里常带绝对路径（`C:\Users\<用户名>\...`、`/home/<用户名>/...`），而这张
 * 页面就是用户截图贴进 issue 的那一张。完整信息仍然进控制台（`componentDidCatch`），界面
 * 上只留脱敏后的形态。
 */
function redactLocalPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:\\Users\\[^\\/?'"*\s>]+/gi, '[local path]')
    .replace(/\/(?:home|Users|private\/var\/folders)\/[^/\s"'?]+/g, '[local path]')
}

function redactStack(value: string | null | undefined): string {
  if (!value) return ''
  return redactLocalPaths(value)
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          fontFamily: 'monospace',
          backgroundColor: '#1a1a1a',
          color: '#fff',
          minHeight: '100vh'
        }}>
          <h1 style={{ color: '#ff6b6b' }}>Application Error</h1>
          <pre style={{ 
            backgroundColor: '#2a2a2a', 
            padding: '10px', 
            borderRadius: '4px',
            overflow: 'auto',
            maxWidth: '100%'
          }}>
            {redactStack(this.state.error?.toString())}
          </pre>
          <p style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
            Full details are in the developer console and the app log.
          </p>
          {this.state.errorInfo && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer', color: '#888' }}>Component Stack</summary>
              <pre style={{ 
                backgroundColor: '#2a2a2a', 
                padding: '10px', 
                borderRadius: '4px',
                overflow: 'auto',
                maxWidth: '100%',
                fontSize: '12px'
              }}>
                {redactStack(this.state.errorInfo.componentStack)}
              </pre>
            </details>
          )}
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#4a9eff',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
