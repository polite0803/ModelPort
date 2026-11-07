/**
 * Pure row building for the gateway list: entries + probe results -> what the window shows.
 *
 * Kept free of Electron and `node:fs` so the action matrix can be asserted without a
 * window: "a stopped local gateway offers start, a never-provisioned one offers install,
 * a remote one offers neither" is exactly the kind of rule that rots silently.
 */
import type {
  GatewayKind,
  GatewayListSnapshot,
  GatewayPhase,
  GatewayRow,
  GatewayRowAction,
} from '../shared/shellList.ts'

export interface GatewayListEntry {
  id: string
  name: string
  url: string
  kind: GatewayKind
  active: boolean
}

export interface GatewayProbeState {
  phase: GatewayPhase
  version: string | null
}

const KIND_LABEL: Record<GatewayKind, string> = {
  local: '本机',
  wsl: 'WSL',
  remote: '远程',
}

const PHASE_LABEL: Record<GatewayPhase, string> = {
  running: '运行中',
  stopped: '已停止',
  unreachable: '无响应',
  'not-installed': '未安装',
  offline: '连不上',
  unknown: '未知',
}

export function gatewayKindLabel(kind: GatewayKind): string {
  return KIND_LABEL[kind]
}

export function gatewayPhaseLabel(phase: GatewayPhase): string {
  return PHASE_LABEL[phase]
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function actionsFor(entry: GatewayListEntry, phase: GatewayPhase): GatewayRowAction[] {
  // Connect first and only when it is not what the window already shows: clicking the row
  // that is already open must not reload the page and lose its session state.
  const actions: GatewayRowAction[] = entry.active ? [] : ['connect']
  if (entry.kind === 'local') {
    if (phase === 'not-installed') {
      actions.push('install')
    } else if (phase === 'running' || phase === 'unreachable') {
      actions.push('stop', 'repair')
    } else {
      actions.push('start', 'repair')
    }
  } else if (entry.kind === 'wsl') {
    // Installing when it is already installed is a probe-then-refuse on the main side,
    // which is cheaper than making the row's label depend on a slow `wsl.exe` call.
    actions.push('install')
  }
  actions.push('edit', 'remove')
  return actions
}

export function buildGatewayRows(
  entries: readonly GatewayListEntry[],
  states: Readonly<Record<string, GatewayProbeState>>,
): GatewayRow[] {
  return entries.map(entry => {
    const state = states[entry.id] ?? { phase: 'unknown' as const, version: null }
    const version = state.version
    return {
      id: entry.id,
      name: entry.name,
      url: entry.url,
      kind: entry.kind,
      active: entry.active,
      phase: state.phase,
      version,
      detail: [KIND_LABEL[entry.kind], hostOf(entry.url), version ? `v${version}` : PHASE_LABEL[state.phase]]
        .filter(part => part !== '')
        .join(' · '),
      actions: actionsFor(entry, state.phase),
    }
  })
}

/** Action labels are part of the contract: the page renders whatever this table says. */
export const GATEWAY_ACTION_LABELS: Record<GatewayRowAction, string> = {
  connect: '连接',
  edit: '编辑',
  remove: '删除',
  start: '启动',
  stop: '停止',
  repair: '修复',
  install: '安装',
}

export function buildSnapshot(
  entries: readonly GatewayListEntry[],
  states: Readonly<Record<string, GatewayProbeState>>,
  options: { canAddWsl: boolean; error?: string },
): GatewayListSnapshot {
  return {
    rows: buildGatewayRows(entries, states),
    labels: GATEWAY_ACTION_LABELS,
    canAddWsl: options.canAddWsl,
    ...(options.error === undefined ? {} : { error: options.error }),
  }
}
