/** Shared contract for the Docker gateway's online update (daemon RPC + console UI). */

export type DockerUpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'loading'
  | 'staging'
  | 'swapping'
  | 'failed'

export type DockerUpdateAbsence = 'ok' | 'not-docker' | 'no-socket' | 'socket-denied'

export interface DockerUpdateCheck {
  capability: DockerUpdateAbsence
  current: string
  latest: string
  newer: boolean
  pageUrl: string
}

export interface DockerUpdateStatus {
  phase: DockerUpdatePhase
  capability: DockerUpdateAbsence
  current: string
  targetVersion: string | null
  error: string | null
}