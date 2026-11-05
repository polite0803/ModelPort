import { useEffect, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * The caption-button overlay only exists in a desktop window. On a headless host the same
 * call answers `desktop-only`, and an uncaught rejection there is one console error per
 * theme change - so this swallows exactly that code and lets anything else surface.
 */
function applyTitleBarTheme(dark: boolean): void {
  const pending = window.electronAPI?.app?.setTitleBarTheme?.(dark ? 'dark' : 'light')
  pending?.catch((cause: unknown) => {
    if ((cause as { code?: string } | null)?.code !== 'desktop-only') throw cause
  })
}

export function useTheme() {
  const { theme, setTheme } = useSettingsStore()

  const isDark = useMemo(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return theme === 'dark'
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      root.setAttribute('data-theme', systemTheme)
    } else {
      root.setAttribute('data-theme', theme)
    }

    // Keep the window caption-button overlay in step with the app theme
    applyTitleBarTheme(isDark)
  }, [theme, isDark])

  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      const root = window.document.documentElement
      root.setAttribute('data-theme', e.matches ? 'dark' : 'light')
      applyTitleBarTheme(e.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  return {
    theme,
    setTheme,
    toggleTheme,
    isDark,
  }
}
