/**
 * One binary, three roles - chosen here and nowhere else.
 *
 *   (no flag)        console: window + tray + gateway supervision (src/shell)
 *   --gateway        windowless local gateway (src/main/gateway/entry.ts)
 *   --init-local     same, plus first-run provisioning and a one-time handshake
 *   --desktop        the pre-merge desktop host, kept for development only
 *
 * The role decides which Electron profile gets pinned (`app.setPath`), so it must be
 * resolved **before** any role module is evaluated. That is also why every branch is a
 * dynamic import: a console process that evaluated the gateway tree would hold a second
 * gateway identity - the failure `tests/build/shell-entries.test.ts` exists to prevent.
 */

const argv = process.argv
const role: 'gateway' | 'desktop' | 'console' =
  argv.includes('--gateway') || argv.includes('--init-local')
    ? 'gateway'
    : argv.includes('--desktop')
      ? 'desktop'
      : 'console'

if (role === 'gateway') void import('./gateway/entry')
else if (role === 'desktop') void import('./desktop/entry')
else void import('../shell/main')
