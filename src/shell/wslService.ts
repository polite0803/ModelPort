/**
 * WSL gateway lifecycle for the management panel: probe the service, start/stop/restart
 * it, and remove an install. The scripts themselves are planned in `wslInstallPlan.ts`;
 * this module only owns the `wsl.exe` calls and the one fact uninstall must not guess -
 * the install directory, read from the unit rather than assumed to be /opt/modelport.
 */
import { runWsl } from './wslExec'
import { readServiceUnit } from './updater'
import {
  buildFirstInstallRollbackScript,
  buildServiceControlScript,
  buildServiceProbeScript,
  parseWslServiceState,
  type ServiceControlAction,
  type WslServiceState,
} from './wslInstallPlan'

const SERVICE = 'modelport'

/** Null when WSL/systemd did not answer - that says nothing about the unit itself. */
export async function probeWslService(distro?: string): Promise<WslServiceState | null> {
  try {
    const result = await runWsl(distro, true, ['sh', '-lc', buildServiceProbeScript(SERVICE)], 20_000)
    return parseWslServiceState(result.stdout)
  } catch {
    return null
  }
}

export async function controlWslService(distro: string | undefined, action: ServiceControlAction): Promise<void> {
  await runWsl(distro, true, ['sh', '-lc', buildServiceControlScript(SERVICE, action)], 90_000)
}

/** The directory the unit actually points at; a manual deploy may not use /opt/modelport. */
export async function wslInstallDir(distro?: string): Promise<string> {
  return (await readServiceUnit(distro)).installDir
}

/** Removes the program and the unit only. `~/.modelport` is the rollback script's rule too. */
export async function removeWslInstall(distro: string | undefined, installDir: string): Promise<void> {
  await runWsl(distro, true, ['sh', '-lc', buildFirstInstallRollbackScript({
    installDir,
    service: SERVICE,
  })], 120_000)
}