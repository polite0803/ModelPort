/**
 * Pure decisions for the Docker gateway's in-UI online update.
 *
 * The daemon is PID 1 of its container: it can load a new image and stage the
 * replacement, but the stop-old/start-new swap must run outside it (a separate
 * short-lived helper container from the same image). Everything here is the
 * part a test can prove without a Docker host: capability absences, asset
 * naming, self-identification and the recreate config mapping.
 */

export type DockerUpdateAbsence = 'ok' | 'not-docker' | 'no-socket' | 'socket-denied'

/** Three absences stay distinct: the UI must say which one, not a bare "unavailable". */
export function dockerUpdateCapability(input: {
  inDocker: boolean
  socketPresent: boolean
  socketAccessible: boolean
}): DockerUpdateAbsence {
  if (!input.inDocker) return 'not-docker'
  if (!input.socketPresent) return 'no-socket'
  if (!input.socketAccessible) return 'socket-denied'
  return 'ok'
}

export function dockerDaemonAssetName(version: string, arch: 'x64' | 'arm64'): string {
  return `modelport-daemon-${version}-docker-${arch}.tar.gz`
}

export function dockerArchFromNodeArch(arch: string): 'x64' | 'arm64' | null {
  if (arch === 'x64') return 'x64'
  if (arch === 'arm64') return 'arm64'
  return null
}

/**
 * cgroup v1 carries `docker/<64hex>`; v2 often shows only `0::/`, so fall back to
 * the hostname, which Docker defaults to the short container id. A custom hostname
 * yields null and the caller must refuse rather than guess a container.
 */
export function selfContainerId(cgroupText: string, hostname: string): string | null {
  const match = cgroupText.match(/docker[/-]([0-9a-f]{64})/)
  if (match) return match[1]
  if (/^[0-9a-f]{12}$/.test(hostname) || /^[0-9a-f]{64}$/.test(hostname)) return hostname
  return null
}

export interface ContainerInspect {
  Name: string
  Config: { Image: string; Env?: string[] }
  HostConfig: {
    Binds?: string[]
    PortBindings?: Record<string, { HostIp?: string; HostPort?: string }[]>
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number }
    NetworkMode?: string
    GroupAdd?: string[]
  }
}

export interface RecreateBody {
  Image: string
  Env: string[]
  HostConfig: {
    Binds: string[]
    PortBindings: Record<string, { HostIp?: string; HostPort?: string }[]>
    RestartPolicy: { Name?: string; MaximumRetryCount?: number }
    NetworkMode: string
    GroupAdd: string[]
  }
}

/**
 * Copy only what makes this deployment this deployment - env, volumes, published
 * ports, restart policy, network mode, supplementary groups. Cmd/Entrypoint/User
 * come from the new image, never from the old container: that is what makes this an
 * upgrade and not a clone. GroupAdd matters: it is what lets the container user reach
 * the mounted docker.sock, and dropping it would break the next online update.
 */
export function recreateConfig(inspect: ContainerInspect, image: string): RecreateBody {
  const host = inspect.HostConfig ?? { Binds: [], PortBindings: {}, RestartPolicy: { Name: 'no' } }
  return {
    Image: image,
    Env: inspect.Config?.Env ?? [],
    HostConfig: {
      Binds: host.Binds ?? [],
      PortBindings: host.PortBindings ?? {},
      RestartPolicy: host.RestartPolicy ?? { Name: 'no' },
      NetworkMode: host.NetworkMode && host.NetworkMode !== '' ? host.NetworkMode : 'bridge',
      GroupAdd: host.GroupAdd ?? [],
    },
  }
}

export function swapHelperEnv(input: {
  oldName: string
  newName: string
  port: number
  scheme: 'http' | 'https'
  /** Empty = inspect the new container for its bridge IP; '127.0.0.1' for host networking. */
  probeHost: string
  timeoutMs: number
  graceMs: number
}): string[] {
  return [
    `MP_OLD=${input.oldName}`,
    `MP_NEW=${input.newName}`,
    `MP_PORT=${input.port}`,
    `MP_SCHEME=${input.scheme}`,
    `MP_PROBE_HOST=${input.probeHost}`,
    `MP_TIMEOUT_MS=${input.timeoutMs}`,
    `MP_GRACE_MS=${input.graceMs}`,
  ]
}