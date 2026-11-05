import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  hasManagementSecret,
  loadRememberedSecret,
  probeGateway,
  rememberSecret,
  secretCanRemember,
  setManagementSecret,
  unauthorizedEventName,
} from '../api/headless'

/**
 * The connect screen for a gateway that has no window of its own.
 *
 * It exists because the management secret is not a URL you can bookmark into a session:
 * every call this page makes needs it. It also says out loud what the whole point of the
 * headless daemon is - closing this tab leaves the gateway serving - so the screen does
 * not read like the gateway depends on it.
 */
export default function ConnectGate({
  remote,
  children,
}: {
  remote: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(() => !remote || hasManagementSecret())
  // The shell keeps the secret in the OS keystore; asking for it is one IPC round trip, so
  // the form must not flash before the answer arrives.
  const [retrieving, setRetrieving] = useState(remote && !hasManagementSecret())
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!retrieving) return
    void (async () => {
      const found = await loadRememberedSecret()
      setRetrieving(false)
      if (found) setReady(true)
    })()
  }, [retrieving])

  // A 401 from any call (rpc or the event stream) lands back here with the secret gone.
  useEffect(() => {
    if (!remote) return
    const onUnauthorized = (): void => {
      setReady(false)
      setError(t('connect.unauthorized'))
    }
    window.addEventListener(unauthorizedEventName, onUnauthorized)
    return () => window.removeEventListener(unauthorizedEventName, onUnauthorized)
  }, [remote, t])

  if (retrieving) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">{t('connect.retrieving')}</p>
      </div>
    )
  }

  if (!ready) {
    const submit = async (): Promise<void> => {
      setChecking(true)
      setError(null)
      setManagementSecret(value)
      try {
        await probeGateway()
        // Only a secret the gateway accepted is worth keeping: storing a typo would make the
        // next start fail the same way with no explanation.
        rememberSecret(value)
        setReady(true)
      } catch (cause) {
        setManagementSecret('')
        setError(
          (cause as Error).message === 'unauthorized'
            ? t('connect.unauthorized')
            : t('connect.unreachable', { message: (cause as Error).message }),
        )
      } finally {
        setChecking(false)
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6"
        >
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">{t('connect.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('connect.subtitle')}</p>
          </div>

          <label className="block space-y-1">
            <span className="text-sm text-foreground">{t('connect.secretLabel')}</span>
            <input
              autoFocus
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="mgmt_..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={checking || value.trim() === ''}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {checking ? t('connect.connecting') : t('connect.submit')}
          </button>

          <p className="text-xs text-muted-foreground">{t('connect.daemonKeepsRunning')}</p>
          {secretCanRemember() && (
            <p className="text-xs text-muted-foreground">{t('connect.remembered')}</p>
          )}
        </form>
      </div>
    )
  }

  return <>{children}</>
}
