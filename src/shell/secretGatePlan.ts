/**
 * Which page may touch which gateway's management secret.
 *
 * The preload survives cross-origin navigation inside the shell window, so without a
 * gate any page the window lands on could read - or forget - every other gateway's
 * sealed secret through `shell:secret-get/set/forget`. The update and trust surfaces
 * already gate on the active gateway; the secret surface needs the same fence, with
 * one addition: a page may only ever touch the secret of its OWN origin, so even the
 * active gateway's page cannot reach a sibling gateway's row.
 *
 * Kept free of Electron so the rule is assertable without a window.
 */

export interface SecretGateInput {
  /** The calling frame's URL (`event.senderFrame.url`); '' when unknown. */
  senderUrl: string
  /** The origin the page asked to read/write/forget. */
  requested: string
  /** `normalizeOrigin(activeEntry.url)`, null when the book is empty. */
  activeOrigin: string | null
  /** `ELECTRON_RENDERER_URL` in dev, null in the shipped console. */
  devRendererUrl: string | null
}

function originOf(url: string): string | null {
  if (url === '') return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function secretOriginAllowed(input: SecretGateInput): boolean {
  const senderOrigin = originOf(input.senderUrl)
  // A data: failure page, an unknown frame or a foreign origin gets nothing.
  if (senderOrigin === null || senderOrigin !== input.requested) return false
  if (input.activeOrigin !== null && input.requested === input.activeOrigin) return true
  // Dev serves the page from vite, not from the gateway: the renderer origin stands in
  // for the active gateway. Shipped builds have no renderer URL, so this never opens.
  if (input.devRendererUrl !== null && input.devRendererUrl !== '') {
    return input.requested === originOf(input.devRendererUrl)
  }
  return false
}