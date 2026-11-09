import { c as createLucideIcon, u as useTranslation, N as useToast, r as reactExports, j as jsxRuntimeExports, B as Button, y as Copy, V as KeyRound, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, J as DialogDescription, K as DialogFooter } from "./index-Dmiad-IP.js";
import { L as ListChecks, c as channelAddFlowOf, a as channelModelDisplayName } from "./channels-Ck20oZNV.js";
import { C as CatalogScopeBatchButton, T as Tags } from "./CatalogScopeBatchButton-CyDc-H3J.js";
import { M as ModelAnnotationDialog } from "./ModelAnnotationDialog-D1MW0Y2K.js";
import { B as Badge } from "./badge-CrPFCp-Q.js";
import { C as Card, c as CardContent, a as CardHeader } from "./card-CJejDjrN.js";
import { S as Switch, I as Input } from "./label-BqQAqSEG.js";
import { R as RefreshCw } from "./refresh-cw-BZLwpUhy.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
import { i as ChevronUp, h as ChevronDown, T as Trash2 } from "./select-DfPABgRe.js";
import { a as Eye, E as EyeOff } from "./eye-BdblIIb5.js";
import { P as Plus } from "./plus-CRYwvOZy.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const CalendarCheck = createLucideIcon("CalendarCheck", [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "m9 16 2 2 4-4", key: "19s6y9" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Ticket = createLucideIcon("Ticket", [
  [
    "path",
    {
      d: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
      key: "qn84l0"
    }
  ],
  ["path", { d: "M13 5v2", key: "dyzc3o" }],
  ["path", { d: "M13 17v2", key: "1ont0d" }],
  ["path", { d: "M13 11v2", key: "1wjjxi" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Undo2 = createLucideIcon("Undo2", [
  ["path", { d: "M9 14 4 9l5-5", key: "102s5s" }],
  ["path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11", key: "f3b9sd" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const UserMinus = createLucideIcon("UserMinus", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["line", { x1: "22", x2: "16", y1: "11", y2: "11", key: "1shjgl" }]
]);
const TASK_ORDER = {
  completed: 0,
  in_progress: 1,
  accepted: 2,
  not_accepted: 3,
  claimed: 4
};
function taskOrder(row) {
  if (row.claimable) return 0;
  return TASK_ORDER[row.status] ?? 9;
}
function taskSearchTerm(row) {
  const match = row.description.match(/[「《]([^」》]{2,40})[」》]/);
  return match === null ? null : match[1].trim();
}
const POLL_INTERVAL_MS = 5e3;
const POLL_TIMEOUT_MS = 5 * 60 * 1e3;
const CHANGED_DEBOUNCE_MS = 1500;
const CREDITS_MIN_INTERVAL_MS = 1e4;
const PENDING_POLL_INTERVAL_MS = 3e4;
function formatIdentityTime(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function modelSourceBadgeKey(source) {
  if (source === "official-cache") return "channels.models.source.badgeCache";
  if (source === "static-fallback") return "channels.models.source.badgeFallback";
  return null;
}
function modelSourceNoticeKey(source) {
  if (source === "official-cache") return "channels.models.source.noticeCache";
  if (source === "static-fallback") return "channels.models.source.noticeFallback";
  return null;
}
function Channels() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [channels, setChannels] = reactExports.useState([]);
  const [credits, setCredits] = reactExports.useState({});
  const [models, setModels] = reactExports.useState({});
  const [modelSources, setModelSources] = reactExports.useState({});
  const [identity, setIdentity] = reactExports.useState({});
  const [openModels, setOpenModels] = reactExports.useState({});
  const [tasks, setTasks] = reactExports.useState({});
  const [openTasks, setOpenTasks] = reactExports.useState({});
  const [taskErrors, setTaskErrors] = reactExports.useState({});
  const [loading, setLoading] = reactExports.useState(true);
  const [unavailable, setUnavailable] = reactExports.useState(null);
  const [busyId, setBusyId] = reactExports.useState(null);
  const [autoCheckin, setAutoCheckin] = reactExports.useState(null);
  const [autoCheckinBusy, setAutoCheckinBusy] = reactExports.useState(false);
  const [autoGrowth, setAutoGrowth] = reactExports.useState(null);
  const [autoGrowthBusy, setAutoGrowthBusy] = reactExports.useState(false);
  const [login, setLogin] = reactExports.useState(null);
  const [credentialAdd, setCredentialAdd] = reactExports.useState(null);
  const [traeDevice, setTraeDevice] = reactExports.useState(null);
  const [annotateTarget, setAnnotateTarget] = reactExports.useState(null);
  const pollTimer = reactExports.useRef(null);
  const autoCheckinTimer = reactExports.useRef(null);
  const autoGrowthTimer = reactExports.useRef(null);
  const refreshTimer = reactExports.useRef(null);
  const creditsTimer = reactExports.useRef(null);
  const creditsPendingViews = reactExports.useRef(null);
  const creditsLastRunAt = reactExports.useRef(0);
  const loginRef = reactExports.useRef(null);
  loginRef.current = login;
  const runCredits = reactExports.useCallback(async (views) => {
    const connected = views.filter((view) => view.accounts.total > 0);
    if (connected.length === 0) return;
    setCredits((current) => {
      let next = current;
      for (const view of connected) {
        if (next[view.id] === void 0) next = { ...next, [view.id]: "loading" };
      }
      return next;
    });
    try {
      const values = await window.electronAPI.channels.creditsAll(connected.map((view) => view.id));
      setCredits((current) => ({ ...current, ...values }));
    } catch (error) {
      console.warn("[Channels] 批量读取渠道积分失败：", error);
    }
  }, []);
  const loadCredits = reactExports.useCallback((views) => {
    creditsPendingViews.current = views;
    const elapsed = Date.now() - creditsLastRunAt.current;
    if (elapsed >= CREDITS_MIN_INTERVAL_MS) {
      creditsLastRunAt.current = Date.now();
      creditsPendingViews.current = null;
      void runCredits(views);
      return;
    }
    if (creditsTimer.current !== null) return;
    creditsTimer.current = setTimeout(() => {
      creditsTimer.current = null;
      const pending = creditsPendingViews.current;
      creditsPendingViews.current = null;
      if (pending === null) return;
      creditsLastRunAt.current = Date.now();
      void runCredits(pending);
    }, CREDITS_MIN_INTERVAL_MS - elapsed);
  }, [runCredits]);
  const loadIdentity = reactExports.useCallback(async () => {
    const result = await window.electronAPI.channels.rpc("identity.snapshot", {});
    if (!result.ok) {
      setIdentity({});
      return;
    }
    const value = result.value;
    const entries = Array.isArray(value?.entries) ? value.entries : [];
    setIdentity(Object.fromEntries(entries.map((entry) => [entry.channel, entry])));
  }, []);
  const loadAutoCheckin = reactExports.useCallback(async () => {
    if (autoCheckinTimer.current !== null) {
      clearTimeout(autoCheckinTimer.current);
      autoCheckinTimer.current = null;
    }
    const result = await window.electronAPI.channels.autoCheckin();
    if (!result.success || result.state === void 0) {
      setAutoCheckin(null);
      return;
    }
    setAutoCheckin(result.state);
    if (result.state.running) {
      autoCheckinTimer.current = setTimeout(() => {
        void loadAutoCheckin();
      }, POLL_INTERVAL_MS);
    } else if (result.state.enabled && result.state.pending > 0) {
      autoCheckinTimer.current = setTimeout(() => {
        void loadAutoCheckin();
      }, PENDING_POLL_INTERVAL_MS);
    }
  }, []);
  const loadAutoGrowth = reactExports.useCallback(async () => {
    if (autoGrowthTimer.current !== null) {
      clearTimeout(autoGrowthTimer.current);
      autoGrowthTimer.current = null;
    }
    const result = await window.electronAPI.channels.rpc("usage.autoGrowth", {});
    if (!result.ok) {
      setAutoGrowth(null);
      return;
    }
    const state = result.value?.autoGrowth;
    if (state === void 0) {
      setAutoGrowth(null);
      return;
    }
    setAutoGrowth(state);
    if (state.running) {
      autoGrowthTimer.current = setTimeout(() => {
        void loadAutoGrowth();
      }, POLL_INTERVAL_MS);
    } else if (state.enabled && state.pending > 0) {
      autoGrowthTimer.current = setTimeout(() => {
        void loadAutoGrowth();
      }, PENDING_POLL_INTERVAL_MS);
    }
  }, []);
  const refresh = reactExports.useCallback(async () => {
    const result = await window.electronAPI.channels.list();
    setChannels(result.channels);
    setUnavailable(result.success ? null : result.reason ?? "channels_unavailable");
    setLoading(false);
    void loadCredits(result.channels);
    void loadAutoCheckin();
    void loadAutoGrowth();
    void loadIdentity();
  }, [loadAutoCheckin, loadAutoGrowth, loadCredits, loadIdentity]);
  const scheduleRefresh = reactExports.useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, CHANGED_DEBOUNCE_MS);
  }, [refresh]);
  reactExports.useEffect(() => {
    void refresh();
    const unsubscribe = window.electronAPI.channels.onChanged(scheduleRefresh);
    return unsubscribe;
  }, [refresh, scheduleRefresh]);
  reactExports.useEffect(() => () => {
    if (pollTimer.current !== null) clearTimeout(pollTimer.current);
    if (autoCheckinTimer.current !== null) clearTimeout(autoCheckinTimer.current);
    if (autoGrowthTimer.current !== null) clearTimeout(autoGrowthTimer.current);
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    if (creditsTimer.current !== null) clearTimeout(creditsTimer.current);
  }, []);
  const stopPolling = reactExports.useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);
  const pollLogin = reactExports.useCallback((accountId, startedAt) => {
    stopPolling();
    pollTimer.current = setTimeout(async () => {
      const result = await window.electronAPI.channels.rpc("login.poll", { accountId });
      const value = result.ok ? result.value : void 0;
      if (!result.ok) {
        setLogin((current) => current === null ? null : { ...current, phase: "failed", error: result.error?.message });
        return;
      }
      if (value?.done === true) {
        if (value.success === true) {
          setLogin(null);
          toast({ title: t("channels.login.success") });
          void refresh();
          return;
        }
        setLogin((current) => current === null ? null : {
          ...current,
          phase: "failed",
          error: value.error ?? t("channels.login.failed")
        });
        return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setLogin((current) => current === null ? null : { ...current, phase: "failed", error: t("channels.login.timeout") });
        return;
      }
      pollLogin(accountId, startedAt);
    }, POLL_INTERVAL_MS);
  }, [refresh, stopPolling, t]);
  const startLogin = async (channel) => {
    stopPolling();
    setLogin({ channel, phase: "starting" });
    const result = await window.electronAPI.channels.rpc("account.create", { provider: channel.id });
    if (!result.ok) {
      setLogin({ channel, phase: "failed", error: result.error?.message ?? t("channels.login.failed") });
      return;
    }
    const value = result.value;
    if (typeof value?.accountId !== "string") {
      setLogin({ channel, phase: "failed", error: t("channels.login.failed") });
      return;
    }
    setLogin({ channel, accountId: value.accountId, phase: "waiting" });
    pollLogin(value.accountId, Date.now());
  };
  const cancelLogin = async () => {
    stopPolling();
    const current = loginRef.current;
    setLogin(null);
    if (current?.accountId !== void 0) {
      await window.electronAPI.channels.rpc("account.delete", { accountId: current.accountId });
      void refresh();
    }
  };
  const openCredentialAdd = (channel) => {
    setCredentialAdd({ channel, apiKey: "", nickname: "", busy: false });
  };
  const submitCredentialAdd = async (mode) => {
    const current = credentialAdd;
    if (current === null || current.busy) return;
    const method = mode === "key" ? current.channel.credentialAdd?.withKey : current.channel.credentialAdd?.anonymous;
    if (method === void 0) {
      setCredentialAdd({ ...current, error: t("channels.credential.misconfigured") });
      return;
    }
    const apiKey = current.apiKey.trim();
    if (mode === "key" && apiKey.length === 0) {
      setCredentialAdd({ ...current, error: t("channels.credential.keyRequired") });
      return;
    }
    setCredentialAdd({ ...current, busy: true, error: void 0 });
    const nickname = current.nickname.trim();
    const payload = mode === "key" ? { apiKey, ...nickname.length > 0 ? { nickname } : {} } : nickname.length > 0 ? { nickname } : {};
    const result = await window.electronAPI.channels.rpc(method, payload);
    if (!result.ok) {
      setCredentialAdd((prev) => prev === null ? null : {
        ...prev,
        busy: false,
        error: result.error?.message ?? t("channels.credential.failed")
      });
      return;
    }
    setCredentialAdd(null);
    toast({
      title: t(mode === "key" ? "channels.credential.addedKey" : "channels.credential.addedAnonymous")
    });
    void refresh();
  };
  const toggleAutoCheckin = async (enabled) => {
    setAutoCheckinBusy(true);
    const result = await window.electronAPI.channels.autoCheckin(enabled);
    setAutoCheckinBusy(false);
    if (!result.success || result.state === void 0) {
      toast({ title: t("common.error"), description: result.reason, variant: "destructive" });
      return;
    }
    setAutoCheckin(result.state);
    if (result.state.running) {
      autoCheckinTimer.current = setTimeout(() => {
        void loadAutoCheckin();
      }, POLL_INTERVAL_MS);
    }
  };
  const toggleAutoGrowth = async (enabled) => {
    setAutoGrowthBusy(true);
    const result = await window.electronAPI.channels.rpc("usage.autoGrowth", { enabled });
    setAutoGrowthBusy(false);
    const state = result.ok ? result.value?.autoGrowth : void 0;
    if (!result.ok || state === void 0) {
      toast({
        title: t("common.error"),
        description: result.ok ? t("channels.autoGrowth.unavailable") : result.error?.message ?? "",
        variant: "destructive"
      });
      return;
    }
    setAutoGrowth(state);
    if (state.running) {
      autoGrowthTimer.current = setTimeout(() => {
        void loadAutoGrowth();
      }, POLL_INTERVAL_MS);
    }
  };
  const toggleChannel = async (channel, enabled) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.setEnabled(channel.id, enabled);
    setBusyId(null);
    if (!result.success) {
      toast({ title: t("common.error"), description: result.reason, variant: "destructive" });
      return;
    }
    await refresh();
  };
  const toggleAccount = async (channel, accountId, enabled) => {
    setBusyId(channel.id);
    await window.electronAPI.channels.rpc("account.update", { accountId, patch: { enabled } });
    setBusyId(null);
    await refresh();
  };
  const deleteAccount = async (channel, accountId) => {
    setBusyId(channel.id);
    await window.electronAPI.channels.rpc("account.delete", { accountId });
    setBusyId(null);
    await refresh();
  };
  const openTraeDevice = async (account) => {
    setTraeDevice({
      accountId: account.id,
      nickname: account.nickname,
      deviceId: "",
      devices: [],
      searched: [],
      loading: true,
      saving: false
    });
    const result = await window.electronAPI.channels.rpc("credits.traeDevices", { accountId: account.id });
    const value = result.ok ? result.value : void 0;
    setTraeDevice((current) => current === null || current.accountId !== account.id ? current : {
      ...current,
      loading: false,
      deviceId: value?.current ?? current.deviceId,
      devices: value?.devices ?? [],
      searched: value?.searched ?? [],
      error: result.ok ? void 0 : result.error?.message ?? t("channels.device.readFailed")
    });
  };
  const saveTraeDevice = async () => {
    const current = traeDevice;
    if (current === null) return;
    const deviceId = current.deviceId.trim();
    if (!/^\d{16}$/.test(deviceId)) {
      setTraeDevice({ ...current, error: t("channels.device.invalid") });
      return;
    }
    setTraeDevice({ ...current, saving: true, error: void 0 });
    const result = await window.electronAPI.channels.rpc("credits.setTraeDevice", {
      accountId: current.accountId,
      deviceId
    });
    if (!result.ok) {
      setTraeDevice((state) => state === null || state.accountId !== current.accountId ? state : { ...state, saving: false, error: result.error?.message ?? t("channels.device.saveFailed") });
      return;
    }
    setTraeDevice(null);
    toast({ title: t("channels.device.saved"), description: t("channels.device.savedHint", { name: current.nickname }) });
  };
  const claimCredits = async (channel) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.rpc("credits.claimAll", { provider: channel.id });
    setBusyId(null);
    if (!result.ok) {
      toast({
        title: t("common.error"),
        description: result.error?.message ?? t("channels.claimFailed"),
        variant: "destructive"
      });
      return;
    }
    const summary = result.value?.summary;
    toast({
      title: t("channels.claimDone"),
      description: t("channels.claimSummary", {
        claimed: summary?.claimed ?? 0,
        already: summary?.alreadyClaimed ?? 0,
        failed: summary?.failed ?? 0,
        total: summary?.totalCredit ?? 0
      })
    });
    await refresh();
  };
  const claimTasks = async (channel) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.rpc("onboarding.claimAll", { provider: channel.id });
    setBusyId(null);
    if (!result.ok) {
      toast({
        title: t("common.error"),
        description: result.error?.message ?? t("channels.claimTasksError"),
        variant: "destructive"
      });
      return;
    }
    const value = result.value;
    const summary = value?.summary ?? {};
    const gained = summary.gained ?? {};
    const credit = Number(gained.credit) || 0;
    const energy = Number(gained.energy) || 0;
    const claimed = Number(summary.claimedTasks) || 0;
    const gains = [
      credit > 0 ? t("channels.claimTasksGainsCredit", { credit }) : "",
      energy > 0 ? t("channels.claimTasksGainsEnergy", { energy }) : ""
    ].filter((part) => part.length > 0).join(t("channels.listSeparator"));
    const segments = [];
    if (claimed > 0) {
      segments.push(gains.length > 0 ? t("channels.claimTasksClaimedWithGains", { count: claimed, gains }) : t("channels.claimTasksClaimed", { count: claimed }));
    }
    const already = Number(summary.alreadyClaimedTasks) || 0;
    if (already > 0) segments.push(t("channels.claimTasksAlready", { count: already }));
    const pending = Number(summary.notClaimableTasks) || 0;
    if (pending > 0) segments.push(t("channels.claimTasksNotClaimable", { count: pending }));
    const failed = Number(summary.failedTasks) || 0;
    if (failed > 0) segments.push(t("channels.claimTasksFailed", { count: failed }));
    const errors = Number(summary.errors) || 0;
    if (errors > 0) segments.push(t("channels.claimTasksErrors", { count: errors }));
    const firstError = (value?.accounts ?? []).find((account) => typeof account?.error === "string")?.error;
    if (firstError !== void 0 && firstError.length > 0) segments.push(firstError);
    toast({
      title: t("channels.claimTasksDone"),
      description: segments.length > 0 ? segments.join(t("channels.listSeparator")) : t("channels.claimTasksNothing"),
      variant: failed > 0 || errors > 0 ? "destructive" : "default"
    });
    await refresh();
  };
  const acceptTasks = async (channel) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.rpc("onboarding.acceptAll", { provider: channel.id });
    setBusyId(null);
    if (!result.ok) {
      toast({
        title: t("common.error"),
        description: result.error?.message ?? t("channels.tasks.acceptError"),
        variant: "destructive"
      });
      return;
    }
    const summary = result.value?.summary ?? {};
    const accepted = Number(summary.acceptedTasks) || 0;
    const errors = Number(summary.errors) || 0;
    const untouched = Number(summary.untouchedTasks) || 0;
    const segments = [];
    if (accepted > 0) segments.push(t("channels.tasks.accepted", { count: accepted }));
    if (untouched > 0) segments.push(t("channels.tasks.untouched", { count: untouched }));
    if (errors > 0) segments.push(t("channels.tasks.acceptErrors", { count: errors }));
    const firstError = result.value?.accounts?.find((account) => typeof account?.error === "string")?.error;
    if (firstError) segments.push(firstError);
    toast({
      title: t("channels.tasks.acceptDone"),
      description: segments.length > 0 ? `${segments.join(t("channels.listSeparator"))}${accepted > 0 ? ` · ${t("channels.tasks.acceptNote")}` : ""}` : t("channels.tasks.acceptNothing"),
      variant: errors > 0 ? "destructive" : "default"
    });
    if (openTasks[channel.id] === true) await loadTasks(channel);
  };
  const loadTasks = async (channel) => {
    setTasks((current) => ({ ...current, [channel.id]: "loading" }));
    const listed = await window.electronAPI.channels.rpc("account.list", { provider: channel.id });
    if (!listed.ok) {
      setTasks((current) => ({ ...current, [channel.id]: "error" }));
      setTaskErrors((current) => ({ ...current, [channel.id]: listed.error?.message ?? t("channels.tasks.readFailed") }));
      return;
    }
    const accounts = listed.value?.accounts ?? [];
    if (accounts.length === 0) {
      setTasks((current) => ({ ...current, [channel.id]: [] }));
      return;
    }
    const rows = [];
    const failures = [];
    for (const account of accounts) {
      const status = await window.electronAPI.channels.rpc("onboarding.status", {
        provider: channel.id,
        accountId: account.id
      });
      if (!status.ok) {
        failures.push(status.error?.message ?? t("channels.tasks.readFailed"));
        continue;
      }
      const value = status.value;
      if (value?.items === void 0) {
        failures.push(t("channels.tasks.readFailed"));
        continue;
      }
      for (const item of value.items) {
        rows.push({ ...item, account: account.nickname || account.id });
      }
    }
    if (rows.length === 0 && failures.length > 0) {
      setTasks((current) => ({ ...current, [channel.id]: "error" }));
      setTaskErrors((current) => ({ ...current, [channel.id]: failures[0] }));
      return;
    }
    setTaskErrors((current) => ({ ...current, [channel.id]: failures[0] ?? "" }));
    setTasks((current) => ({ ...current, [channel.id]: rows }));
  };
  const toggleTasks = async (channel) => {
    const next = openTasks[channel.id] !== true;
    setOpenTasks((current) => ({ ...current, [channel.id]: next }));
    if (next && !Array.isArray(tasks[channel.id])) await loadTasks(channel);
  };
  const copyTaskTerm = async (term) => {
    try {
      await navigator.clipboard.writeText(term);
      toast({ title: t("channels.tasks.copied"), description: term });
    } catch {
      toast({
        title: t("common.error"),
        description: t("channels.tasks.copyFailed"),
        variant: "destructive"
      });
    }
  };
  const loadModels = async (channel) => {
    setModels((current) => ({ ...current, [channel.id]: "loading" }));
    const result = await window.electronAPI.channels.models(channel.id);
    setModels((current) => ({ ...current, [channel.id]: result.success ? result.models : [] }));
    setModelSources((current) => {
      if (result.source === void 0) {
        if (!(channel.id in current)) return current;
        const next = { ...current };
        delete next[channel.id];
        return next;
      }
      return { ...current, [channel.id]: result.source };
    });
    if (!result.success) {
      toast({ title: t("common.error"), description: result.reason, variant: "destructive" });
    }
  };
  const toggleModels = async (channel) => {
    const next = openModels[channel.id] !== true;
    setOpenModels((current) => ({ ...current, [channel.id]: next }));
    if (next && !Array.isArray(models[channel.id])) await loadModels(channel);
  };
  const refreshChannelModels = async (channel) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.refreshModels(channel.id);
    setBusyId(null);
    if (!result.success) {
      toast({
        title: t("channels.models.refreshFailed"),
        description: result.reason,
        variant: "destructive"
      });
      await loadModels(channel);
      return;
    }
    const noticeKey = modelSourceNoticeKey(result.source);
    toast({
      title: t("channels.models.refreshed"),
      description: noticeKey === null ? t("channels.models.refreshedCount", { count: result.count ?? 0 }) : `${t("channels.models.refreshedCount", { count: result.count ?? 0 })} · ${t(noticeKey)}`
    });
    await loadModels(channel);
    await refresh();
  };
  const setModelDisabled = async (channel, model, disabled) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.setModelDisabled(channel.id, model.id, disabled);
    setBusyId(null);
    if (!result.success) {
      toast({ title: t("channels.models.updateFailed"), description: result.reason, variant: "destructive" });
      return;
    }
    setModels((current) => ({ ...current, [channel.id]: result.models }));
    await refresh();
  };
  const restoreDeadModel = async (channel, model) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.clearDeadModels(channel.id, model.id);
    setBusyId(null);
    if (!result.success) {
      toast({ title: t("channels.models.updateFailed"), description: result.reason, variant: "destructive" });
      await loadModels(channel);
      return;
    }
    setModels((current) => ({ ...current, [channel.id]: result.models }));
    toast({
      title: t("channels.models.restored"),
      description: t("channels.models.restoredCount", { count: result.removed ?? 0 })
    });
    await refresh();
  };
  const refreshAccount = async (channel, accountId) => {
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.rpc("account.refresh", { accountId });
    setBusyId(null);
    if (!result.ok) {
      toast({
        title: t("channels.refreshAccountFailed"),
        description: result.error?.message,
        variant: "destructive"
      });
      return;
    }
    toast({ title: t("channels.refreshedAccount") });
    await refresh();
  };
  const moveAccount = async (channel, index, delta) => {
    const orderedIds = channel.accounts.list.map((account) => account.id);
    const target = index + delta;
    if (target < 0 || target >= orderedIds.length) return;
    const [moved] = orderedIds.splice(index, 1);
    orderedIds.splice(target, 0, moved);
    setBusyId(channel.id);
    const result = await window.electronAPI.channels.rpc("account.reorder", {
      provider: channel.id,
      orderedIds
    });
    setBusyId(null);
    if (!result.ok) {
      toast({
        title: t("channels.reorderFailed"),
        description: result.error?.message,
        variant: "destructive"
      });
      return;
    }
    await refresh();
  };
  const removeChannel = async (channel) => {
    if (!window.confirm(t("channels.removeConfirm", { name: channel.name }))) return;
    setBusyId(channel.id);
    await window.electronAPI.channels.remove(channel.id);
    setBusyId(null);
    toast({ title: t("channels.removed", { name: channel.name }) });
    await refresh();
  };
  const connectedCount = reactExports.useMemo(
    () => channels.filter((channel) => channel.accounts.total > 0).length,
    [channels]
  );
  const autoCheckinStatus = reactExports.useMemo(() => {
    if (autoCheckin === null) return t("channels.autoCheckin.unavailable");
    if (autoCheckin.running) return t("channels.autoCheckin.running");
    if (autoCheckin.enabled && autoCheckin.pending > 0) {
      return t("channels.autoCheckin.pending", { count: autoCheckin.pending });
    }
    if (autoCheckin.ranToday) {
      return t("channels.autoCheckin.ranToday", { date: autoCheckin.lastDate });
    }
    if (autoCheckin.lastResult !== "") {
      return t("channels.autoCheckin.last", {
        result: autoCheckin.lastResult,
        time: new Date(autoCheckin.lastAt).toLocaleString()
      });
    }
    return t("channels.autoCheckin.never");
  }, [autoCheckin, t]);
  const autoGrowthStatus = reactExports.useMemo(() => {
    if (autoGrowth === null) return t("channels.autoGrowth.unavailable");
    if (autoGrowth.running) return t("channels.autoGrowth.running");
    if (autoGrowth.enabled && autoGrowth.pending > 0) {
      return t("channels.autoGrowth.pending", { count: autoGrowth.pending });
    }
    if (autoGrowth.ranToday) return t("channels.autoGrowth.ranToday", { date: autoGrowth.lastDate });
    if (autoGrowth.lastResult !== "") {
      return t("channels.autoGrowth.last", {
        result: autoGrowth.lastResult,
        time: new Date(autoGrowth.lastAt).toLocaleString()
      });
    }
    return t("channels.autoGrowth.never");
  }, [autoGrowth, t]);
  const hasGrowthChannel = reactExports.useMemo(() => channels.some((channel) => channel.growthTasks), [channels]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-2xl font-bold tracking-tight", children: t("channels.title") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-muted-foreground", children: t("channels.description", { connected: connectedCount, total: channels.length }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", onClick: () => void refresh(), disabled: loading, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "mr-2 h-4 w-4" }),
        t("common.refresh")
      ] })
    ] }),
    unavailable !== null && /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { className: "border-destructive/50", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "pt-6 text-sm text-destructive", children: unavailable }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CalendarCheck, { className: "mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2 font-medium", children: [
            t("channels.autoCheckin.title"),
            autoCheckin !== null && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: autoCheckin.enabled ? "secondary" : "outline", children: autoCheckin.enabled ? t("channels.autoCheckin.on") : t("channels.autoCheckin.off") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("channels.autoCheckin.description") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "flex items-center gap-1.5 text-xs text-muted-foreground", children: [
            autoCheckin?.running === true && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3 w-3 animate-spin" }),
            autoCheckinStatus
          ] }),
          autoCheckin !== null && autoCheckin.channels.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: autoCheckin.channels.map((entry) => t("channels.autoCheckin.channelLine", {
            name: channels.find((channel) => channel.id === entry.provider)?.name ?? entry.provider,
            status: entry.text
          })).join(" · ") })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Switch,
        {
          checked: autoCheckin?.enabled === true,
          disabled: autoCheckinBusy || autoCheckin === null,
          onCheckedChange: (checked) => void toggleAutoCheckin(checked)
        }
      )
    ] }) }),
    hasGrowthChannel && /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ListChecks, { className: "mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2 font-medium", children: [
            t("channels.autoGrowth.title"),
            autoGrowth !== null && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: autoGrowth.enabled ? "secondary" : "outline", children: autoGrowth.enabled ? t("channels.autoGrowth.on") : t("channels.autoGrowth.off") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("channels.autoGrowth.description") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "flex items-center gap-1.5 text-xs text-muted-foreground", children: [
            autoGrowth?.running === true && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3 w-3 animate-spin" }),
            autoGrowthStatus
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Switch,
        {
          checked: autoGrowth?.enabled === true,
          disabled: autoGrowthBusy || autoGrowth === null,
          onCheckedChange: (checked) => void toggleAutoGrowth(checked)
        }
      )
    ] }) }),
    loading && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-center py-16 text-muted-foreground", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-5 w-5 animate-spin" }),
      t("common.loading")
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid gap-4 lg:grid-cols-2", children: !loading && channels.map((channel) => {
      const busy = busyId === channel.id;
      const connected = channel.accounts.total > 0;
      const creditState = credits[channel.id];
      const remaining = creditState !== void 0 && creditState !== "loading" ? creditState.remaining : void 0;
      const modelState = models[channel.id];
      const modelList = Array.isArray(modelState) ? modelState : [];
      const modelsOpen = openModels[channel.id] === true;
      const modelSource = modelSources[channel.id] ?? channel.models.source;
      const sourceBadge = modelSourceBadgeKey(modelSource);
      const sourceNotice = modelSourceNoticeKey(modelSource);
      return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: "flex flex-col", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "pb-3", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold uppercase", children: channel.name.slice(0, 1) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate font-semibold", children: channel.name }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: connected ? "secondary" : "outline", children: connected ? t("channels.connected") : t("channels.notConnected") }),
                channel.upstreamIdentity !== void 0 && (() => {
                  const live = identity[channel.id];
                  const liveText = live === void 0 ? "" : ` ${t("channels.identityLive.title")}：v${live.version}（${t(`channels.identityLive.source.${live.source}`)}，${t("channels.identityLive.checkedAt", { time: formatIdentityTime(live.checkedAt) })}）${live.detail !== void 0 ? ` · ${live.detail}` : ""}`;
                  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      Badge,
                      {
                        variant: "outline",
                        className: channel.upstreamIdentity.risk === "high" ? "border-destructive text-destructive" : channel.upstreamIdentity.risk === "medium" ? "border-amber-500 text-amber-600" : "text-muted-foreground",
                        title: t("channels.identityRiskTooltip", {
                          declared: channel.upstreamIdentity.declared
                        }) + liveText,
                        children: t(`channels.identityRisk.${channel.upstreamIdentity.risk}`)
                      }
                    ),
                    live !== void 0 && (() => {
                      const stale = live.source === "fallback";
                      return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                        Badge,
                        {
                          variant: "outline",
                          className: stale ? "border-amber-500 text-amber-600" : "border-emerald-600 text-emerald-600",
                          title: t("channels.identityLive.badgeTooltip", {
                            version: live.version,
                            source: t(`channels.identityLive.source.${live.source}`),
                            time: formatIdentityTime(live.checkedAt),
                            state: t(stale ? "channels.identityLive.badgeState.stale" : "channels.identityLive.badgeState.fresh")
                          }),
                          children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(
                              "span",
                              {
                                "aria-hidden": true,
                                className: `mr-1 inline-block size-2 rounded-full ${stale ? "bg-amber-500" : "bg-emerald-600"}`
                              }
                            ),
                            "v",
                            live.version,
                            " · ",
                            t(stale ? "channels.identityLive.badge.stale" : "channels.identityLive.badge.fresh")
                          ]
                        }
                      );
                    })()
                  ] });
                })()
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "truncate text-xs text-muted-foreground", children: [
                channel.vendor,
                " · ",
                t(`channels.loginKind.${channel.loginKind}`)
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              checked: channel.enabled,
              disabled: busy || !channel.configured,
              onCheckedChange: (checked) => void toggleChannel(channel, checked)
            }
          )
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-1 flex-col gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: channel.description }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-2 rounded-md border p-3 text-center", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("channels.statAccounts") }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "font-medium", children: [
                channel.accounts.enabled,
                "/",
                channel.accounts.total
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("channels.statModels") }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "font-medium", children: [
                channel.models.total - channel.models.disabled,
                "/",
                channel.models.total
              ] }),
              connected && sourceBadge !== null && sourceNotice !== null && /* @__PURE__ */ jsxRuntimeExports.jsx(
                Badge,
                {
                  variant: "outline",
                  className: "mt-1 max-w-full border-amber-500 text-[10px] text-amber-600",
                  title: t(sourceNotice),
                  children: t(sourceBadge)
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("channels.statCredits") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "font-medium", children: creditState === "loading" ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mx-auto h-4 w-4 animate-spin" }) : remaining !== void 0 ? remaining : "—" })
            ] })
          ] }),
          creditState !== void 0 && creditState !== "loading" && creditState.accounts.length > 0 && (creditState.reported < creditState.accounts.length || creditState.accounts.length > 1) && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-md border p-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("channels.statCredits") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("channels.creditsReported", {
                reported: creditState.reported,
                total: creditState.accounts.length
              }) })
            ] }),
            creditState.error !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mb-1 text-xs text-destructive", children: creditState.error }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "space-y-1", children: creditState.accounts.map((account) => /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "flex items-center justify-between gap-2 text-xs", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "min-w-0 truncate", children: [
                account.nickname,
                account.enabled === false && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-1 text-muted-foreground", children: t("channels.creditsDisabled") })
              ] }),
              account.error !== void 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "min-w-0 truncate text-destructive", title: account.error, children: account.error }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: account.remaining ?? "—" })
            ] }, account.accountId)) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                Button,
                {
                  variant: "ghost",
                  size: "sm",
                  className: "px-2",
                  onClick: () => void toggleModels(channel),
                  children: [
                    modelsOpen ? /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronUp, { className: "mr-1 h-3.5 w-3.5" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronDown, { className: "mr-1 h-3.5 w-3.5" }),
                    t("channels.models.title"),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-1 text-xs text-muted-foreground", children: modelList.length > 0 ? modelList.length : channel.models.total })
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  disabled: busy || !connected,
                  onClick: () => void refreshChannelModels(channel),
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: `mr-1 h-3.5 w-3.5${busy ? " animate-spin" : ""}` }),
                    t("channels.models.refresh")
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                CatalogScopeBatchButton,
                {
                  providerId: channel.id,
                  scopeLabel: channel.name,
                  disabled: !connected,
                  onFinished: () => void loadModels(channel)
                }
              )
            ] }),
            openTasks[channel.id] === true && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
              taskErrors[channel.id] !== void 0 && taskErrors[channel.id].length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-700", children: taskErrors[channel.id] }),
              tasks[channel.id] === "loading" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-center rounded-md border py-4 text-xs text-muted-foreground", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-3.5 w-3.5 animate-spin" }),
                t("common.loading")
              ] }),
              tasks[channel.id] === "error" && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border py-4 text-center text-xs text-muted-foreground", children: t("channels.tasks.readFailed") }),
              Array.isArray(tasks[channel.id]) && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "divide-y rounded-md border", children: tasks[channel.id].slice().sort((a, b) => taskOrder(a) - taskOrder(b)).map((row) => {
                const term = taskSearchTerm(row);
                return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "px-2 py-2 text-xs", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: row.title || row.key }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: row.claimable ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700" : "rounded bg-muted px-1.5 py-0.5 text-muted-foreground", children: t(`channels.tasks.status.${row.status}`) }),
                    row.progress !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: `${row.progress.current}/${row.progress.target}` }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-auto text-muted-foreground", children: [
                      row.rewardCredit > 0 ? t("channels.claimTasksGainsCredit", { credit: row.rewardCredit }) : "",
                      row.rewardEnergy > 0 ? t("channels.claimTasksGainsEnergy", { energy: row.rewardEnergy }) : "",
                      row.rewardBuddy ? t("channels.tasks.gainsBuddy") : ""
                    ].filter((part) => part.length > 0).join(t("channels.listSeparator")) })
                  ] }),
                  row.description.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-muted-foreground", children: row.description }),
                  term !== null && /* @__PURE__ */ jsxRuntimeExports.jsxs(
                    Button,
                    {
                      variant: "ghost",
                      size: "sm",
                      className: "mt-1 h-6 px-1.5 text-[11px]",
                      onClick: () => void copyTaskTerm(term),
                      children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx(Copy, { className: "mr-1 h-3 w-3" }),
                        t("channels.tasks.copyTerm", { term })
                      ]
                    }
                  ),
                  channel.accounts.total > 1 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-0.5 text-[10px] text-muted-foreground/70", children: row.account })
                ] }, `${row.account}-${row.key}`);
              }) })
            ] }),
            modelsOpen && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
              connected && sourceNotice !== null && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-700", children: t(sourceNotice) }),
              modelState === "loading" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-center rounded-md border py-4 text-xs text-muted-foreground", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-3.5 w-3.5 animate-spin" }),
                t("common.loading")
              ] }) : modelList.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "rounded-md border px-2 py-2 text-xs text-muted-foreground", children: t("channels.models.empty") }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "max-h-56 space-y-1 overflow-y-auto rounded-md border p-2", children: modelList.map((model) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `min-w-0 flex-1 truncate${model.disabled || model.dead ? " text-muted-foreground line-through" : ""}`, children: model.name }),
                model.free && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "shrink-0 border-emerald-500/40 text-emerald-600", children: t("channels.models.free") }),
                model.weight !== void 0 && !model.free && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "secondary", className: "shrink-0", children: model.baseWeight === void 0 ? `x${model.weight}` : `x${model.baseWeight}→x${model.weight}` }),
                model.dead && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "shrink-0", children: t("channels.models.dead") }),
                model.disabled && !model.dead && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "shrink-0", children: t("channels.models.disabled") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    className: "shrink-0 px-1",
                    disabled: model.disabled || model.dead,
                    title: model.disabled || model.dead ? t("channels.models.annotateBlocked") : `${t("channels.models.annotate")} · ${t("channels.models.annotateHint")}`,
                    onClick: () => setAnnotateTarget({ channel, model }),
                    children: /* @__PURE__ */ jsxRuntimeExports.jsx(Tags, { className: "h-3.5 w-3.5" })
                  }
                ),
                model.dead ? (
                  // 失效模型只能恢复、不能开关：它已经不在目录里了。
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    Button,
                    {
                      variant: "ghost",
                      size: "sm",
                      className: "shrink-0 px-1",
                      disabled: busy,
                      title: t("channels.models.restoreModel"),
                      onClick: () => void restoreDeadModel(channel, model),
                      children: /* @__PURE__ */ jsxRuntimeExports.jsx(Undo2, { className: "h-3.5 w-3.5" })
                    }
                  )
                ) : /* @__PURE__ */ jsxRuntimeExports.jsx(
                  Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    className: "shrink-0 px-1",
                    disabled: busy,
                    title: model.disabled ? t("channels.models.enableModel") : t("channels.models.disableModel"),
                    onClick: () => void setModelDisabled(channel, model, !model.disabled),
                    children: model.disabled ? /* @__PURE__ */ jsxRuntimeExports.jsx(Eye, { className: "h-3.5 w-3.5" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(EyeOff, { className: "h-3.5 w-3.5" })
                  }
                )
              ] }, model.id)) })
            ] })
          ] }),
          channel.accounts.list.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "space-y-1", children: channel.accounts.list.map((account, index) => /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "flex items-center gap-2 rounded border px-2 py-1 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "min-w-0 flex-1 truncate", children: account.nickname }),
            account.serviceStopped !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(
              "span",
              {
                className: "shrink-0 text-xs text-destructive",
                title: account.serviceStopped.text,
                children: t("channels.serviceStopped")
              }
            ),
            account.expiresAt !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "shrink-0 text-xs text-muted-foreground", children: new Date(account.expiresAt).toLocaleDateString() }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                className: "px-1",
                disabled: busy || index === 0,
                title: t("channels.moveUp"),
                onClick: () => void moveAccount(channel, index, -1),
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronUp, { className: "h-3.5 w-3.5" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                className: "px-1",
                disabled: busy || index === channel.accounts.list.length - 1,
                title: t("channels.moveDown"),
                onClick: () => void moveAccount(channel, index, 1),
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronDown, { className: "h-3.5 w-3.5" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                className: "px-1",
                disabled: busy,
                title: t("channels.refreshAccount"),
                onClick: () => void refreshAccount(channel, account.id),
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "h-3.5 w-3.5" })
              }
            ),
            channel.id === "trae" && /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                className: "px-1",
                disabled: busy,
                title: t("channels.device.button"),
                onClick: () => void openTraeDevice(account),
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(KeyRound, { className: "h-3.5 w-3.5" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Switch,
              {
                checked: account.enabled,
                disabled: busy,
                onCheckedChange: (checked) => void toggleAccount(channel, account.id, checked),
                className: "scale-75"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled: busy,
                onClick: () => void deleteAccount(channel, account.id),
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(UserMinus, { className: "h-3.5 w-3.5" })
              }
            )
          ] }, account.id)) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-auto flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                size: "sm",
                disabled: busy,
                onClick: () => {
                  if (channelAddFlowOf(channel.loginKind) === "credential") openCredentialAdd(channel);
                  else void startLogin(channel);
                },
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Plus, { className: "mr-1 h-3.5 w-3.5" }),
                  t("channels.addAccount")
                ]
              }
            ),
            channel.dailyCheckin && /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy || !connected,
                onClick: () => void claimCredits(channel),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Ticket, { className: "mr-1 h-3.5 w-3.5" }),
                  t("channels.claim")
                ]
              }
            ),
            channel.growthTasks && /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy || !connected,
                onClick: () => void claimTasks(channel),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Ticket, { className: "mr-1 h-3.5 w-3.5" }),
                  t("channels.claimTasks")
                ]
              }
            ),
            channel.growthTasks && /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy || !connected,
                onClick: () => void acceptTasks(channel),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(ListChecks, { className: "mr-1 h-3.5 w-3.5" }),
                  t("channels.tasks.accept")
                ]
              }
            ),
            channel.growthTasks && /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled: !connected,
                onClick: () => void toggleTasks(channel),
                children: t("channels.tasks.list")
              }
            ),
            connected && /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled: busy,
                onClick: () => void removeChannel(channel),
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "h-3.5 w-3.5 text-destructive" })
              }
            )
          ] })
        ] })
      ] }, channel.id);
    }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: login !== null, onOpenChange: (open) => {
      if (!open) void cancelLogin();
    }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "sm:max-w-[460px]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("channels.login.title", { name: login?.channel.name }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: login?.phase === "failed" ? login.error : t(`channels.login.hint.${login?.channel.loginKind ?? "browser"}`) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center gap-3 rounded-md border p-3 text-sm", children: login?.phase === "failed" ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-destructive", children: login.error }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: login?.phase === "starting" ? t("channels.login.starting") : t("channels.login.waiting") })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(DialogFooter, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => void cancelLogin(), children: login?.phase === "failed" ? t("common.close") : t("common.cancel") }) })
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: credentialAdd !== null,
        onOpenChange: (open) => {
          if (!open && credentialAdd?.busy !== true) setCredentialAdd(null);
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "sm:max-w-[460px]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("channels.credential.title", { name: credentialAdd?.channel.name }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("channels.credential.hint") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-xs text-muted-foreground", htmlFor: "channel-credential-key", children: t("channels.credential.keyLabel") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Input,
                {
                  id: "channel-credential-key",
                  type: "password",
                  autoComplete: "off",
                  spellCheck: false,
                  disabled: credentialAdd?.busy === true,
                  value: credentialAdd?.apiKey ?? "",
                  placeholder: t("channels.credential.keyPlaceholder"),
                  onChange: (event) => setCredentialAdd((current) => current === null ? null : { ...current, apiKey: event.target.value, error: void 0 })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-xs text-muted-foreground", htmlFor: "channel-credential-nickname", children: t("channels.credential.nicknameLabel") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Input,
                {
                  id: "channel-credential-nickname",
                  autoComplete: "off",
                  disabled: credentialAdd?.busy === true,
                  value: credentialAdd?.nickname ?? "",
                  placeholder: t("channels.credential.nicknamePlaceholder"),
                  onChange: (event) => setCredentialAdd((current) => current === null ? null : { ...current, nickname: event.target.value })
                }
              )
            ] }),
            credentialAdd?.error !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-destructive", children: credentialAdd.error }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("channels.credential.anonymousHint") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { className: "gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "outline",
                disabled: credentialAdd?.busy === true,
                onClick: () => setCredentialAdd(null),
                children: t("common.cancel")
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "secondary",
                disabled: credentialAdd?.busy === true || credentialAdd?.channel.credentialAdd?.anonymous === void 0,
                onClick: () => void submitCredentialAdd("anonymous"),
                children: t("channels.credential.addAnonymous")
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                disabled: credentialAdd?.busy === true || credentialAdd?.channel.credentialAdd?.withKey === void 0,
                onClick: () => void submitCredentialAdd("key"),
                children: [
                  credentialAdd?.busy === true && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-4 w-4 animate-spin" }),
                  t("channels.credential.addKey")
                ]
              }
            )
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: traeDevice !== null,
        onOpenChange: (open) => {
          if (!open && traeDevice?.saving !== true) setTraeDevice(null);
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "sm:max-w-[460px]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("channels.device.title", { name: traeDevice?.nickname }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("channels.device.hint") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-xs text-muted-foreground", htmlFor: "trae-device-id", children: t("channels.device.label") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Input,
                {
                  id: "trae-device-id",
                  inputMode: "numeric",
                  autoComplete: "off",
                  spellCheck: false,
                  disabled: traeDevice?.loading === true || traeDevice?.saving === true,
                  value: traeDevice?.deviceId ?? "",
                  placeholder: t("channels.device.placeholder"),
                  onChange: (event) => setTraeDevice((current) => current === null ? null : { ...current, deviceId: event.target.value, error: void 0 })
                }
              )
            ] }),
            traeDevice?.loading === true && /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3.5 w-3.5 animate-spin" }),
              t("channels.device.reading")
            ] }),
            traeDevice !== null && traeDevice.loading !== true && traeDevice.devices.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("channels.device.detected") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "space-y-1", children: traeDevice.devices.map((device) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  className: "w-full justify-start font-mono text-xs",
                  disabled: traeDevice.saving,
                  onClick: () => setTraeDevice((current) => current === null ? null : { ...current, deviceId: device.deviceId, error: void 0 }),
                  children: device.deviceId
                }
              ) }, device.deviceId)) })
            ] }),
            traeDevice !== null && traeDevice.loading !== true && traeDevice.devices.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("channels.device.none") }),
            traeDevice?.error !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-destructive", children: traeDevice.error }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("channels.device.where") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { className: "gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", disabled: traeDevice?.saving === true, onClick: () => setTraeDevice(null), children: t("common.cancel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                disabled: traeDevice?.saving === true || traeDevice?.loading === true,
                onClick: () => void saveTraeDevice(),
                children: [
                  traeDevice?.saving === true && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-4 w-4 animate-spin" }),
                  t("channels.device.save")
                ]
              }
            )
          ] })
        ] })
      }
    ),
    annotateTarget && /* @__PURE__ */ jsxRuntimeExports.jsx(
      ModelAnnotationDialog,
      {
        providerId: annotateTarget.channel.id,
        displayName: channelModelDisplayName(
          annotateTarget.channel.name,
          annotateTarget.channel.id,
          annotateTarget.model
        ),
        modelLabel: annotateTarget.model.name,
        onClose: () => setAnnotateTarget(null),
        onChanged: () => void loadModels(annotateTarget.channel)
      }
    )
  ] });
}
export {
  Channels,
  Channels as default
};
