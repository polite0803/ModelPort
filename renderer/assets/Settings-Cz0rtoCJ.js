import { c as createLucideIcon, u as useTranslation, a8 as useTheme, f as useSettingsStore, j as jsxRuntimeExports, a9 as Sun, aa as Moon, a as cn, N as useToast, r as reactExports, B as Button, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, J as DialogDescription, K as DialogFooter, T as TriangleAlert, ab as RotateCw, ac as DialogTrigger, ad as SETTINGS_STORAGE_KEY, ae as sanitizePersistedSettings, af as pickPersistedPreferences, ag as buildExportEnvelope, ah as parseExportEnvelope, ai as LEGACY_SETTINGS_STORAGE_KEY, C as Check, y as Copy, aj as logoIcon, Z as Zap, x as Settings$1 } from "./index-Dmiad-IP.js";
import { T as Tabs, a as TabsList, b as TabsTrigger, d as TabsContent } from "./tabs-Cs4ul3yp.js";
import { C as Card, a as CardHeader, b as CardTitle, c as CardContent, d as CardDescription } from "./card-CJejDjrN.js";
import { S as Switch, L as Label, I as Input } from "./label-BqQAqSEG.js";
import { S as Select, d as SelectTrigger, e as SelectValue, f as SelectContent, g as SelectItem, T as Trash2 } from "./select-DfPABgRe.js";
import { D as Download } from "./download-bdv0hDXt.js";
import { C as CircleCheck, R as RotateCcw } from "./rotate-ccw-QvuFi60u.js";
import { D as Database } from "./database-CgRqZ2QH.js";
import { A as Alert, a as AlertDescription } from "./alert-BDeGQ5C8.js";
import { K as Key, S as Shield, I as Info } from "./shield-C_BXUSe3.js";
import { E as EyeOff, a as Eye } from "./eye-BdblIIb5.js";
import { R as RefreshCw } from "./refresh-cw-BZLwpUhy.js";
import { G as Globe } from "./globe-Cj-vljgr.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
import { C as CircleAlert } from "./circle-alert-BOs73daR.js";
import { P as PageHeader } from "./PageHeader-Uo_aLgRN.js";
import "./chevron-left-DjwtYoGs.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Archive = createLucideIcon("Archive", [
  ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1", key: "1wp1u1" }],
  ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", key: "1s80jp" }],
  ["path", { d: "M10 12h4", key: "a56b0p" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Bug = createLucideIcon("Bug", [
  ["path", { d: "m8 2 1.88 1.88", key: "fmnt4t" }],
  ["path", { d: "M14.12 3.88 16 2", key: "qol33r" }],
  ["path", { d: "M9 7.13v-1a3.003 3.003 0 1 1 6 0v1", key: "d7y7pr" }],
  [
    "path",
    {
      d: "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6",
      key: "xs1cw7"
    }
  ],
  ["path", { d: "M12 20v-9", key: "1qisl0" }],
  ["path", { d: "M6.53 9C4.6 8.8 3 7.1 3 5", key: "32zzws" }],
  ["path", { d: "M6 13H2", key: "82j7cp" }],
  ["path", { d: "M3 21c0-2.1 1.7-3.9 3.8-4", key: "4p0ekp" }],
  ["path", { d: "M20.97 5c0 2.1-1.6 3.8-3.5 4", key: "18gb23" }],
  ["path", { d: "M22 13h-4", key: "1jl80f" }],
  ["path", { d: "M17.2 17c2.1.1 3.8 1.9 3.8 4", key: "k3fwyw" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Github = createLucideIcon("Github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "tonef"
    }
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "9comsn" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Lock = createLucideIcon("Lock", [
  ["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2", key: "1w4ew1" }],
  ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4", key: "fwvmzm" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const ShieldAlert = createLucideIcon("ShieldAlert", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "M12 8v4", key: "1got3b" }],
  ["path", { d: "M12 16h.01", key: "1drbdi" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Terminal = createLucideIcon("Terminal", [
  ["polyline", { points: "4 17 10 11 4 5", key: "akl6gq" }],
  ["line", { x1: "12", x2: "20", y1: "19", y2: "19", key: "q2wloq" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Upload = createLucideIcon("Upload", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "17 8 12 3 7 8", key: "t8dd8p" }],
  ["line", { x1: "12", x2: "12", y1: "3", y2: "15", key: "widbto" }]
]);
const THEME_OPTIONS = [
  { value: "light", labelKey: "settings.themeLight", icon: Sun },
  { value: "dark", labelKey: "settings.themeDark", icon: Moon }
];
function AppearanceSettings() {
  const { t } = useTranslation();
  const { theme, setTheme, isDark } = useTheme();
  const { sidebarCollapsed, setSidebarCollapsed, language, setLanguage } = useSettingsStore();
  const resolvedTheme = theme === "system" ? isDark ? "dark" : "light" : theme;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "pb-3", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("settings.appearance") }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "p-0", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-list", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.theme") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.themeSettingsDesc") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex gap-1 rounded-lg bg-[var(--segment-track)] p-1", children: THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => setTheme(value),
            "aria-pressed": resolvedTheme === value,
            className: cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-meta font-medium transition-colors",
              resolvedTheme === value ? "bg-[var(--segment-thumb)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            ),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { className: "h-3.5 w-3.5" }),
              t(labelKey)
            ]
          },
          value
        )) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.language") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.languageSettingsDesc") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: language, onValueChange: (value) => setLanguage(value), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-9 w-[160px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "zh-CN", children: t("settings.languageZh") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "en-US", children: t("settings.languageEn") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.sidebarCollapsed") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.sidebarCollapsedHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { checked: sidebarCollapsed, onCheckedChange: setSidebarCollapsed })
      ] })
    ] }) })
  ] });
}
function GeneralSettings() {
  const { t } = useTranslation();
  const {
    autoStart,
    setAutoStart,
    autoStartProxy,
    setAutoStartProxy,
    minimizeToTray,
    setMinimizeToTray,
    closeBehavior,
    setCloseBehavior,
    enableNotifications,
    setEnableNotifications,
    oauthProxyMode,
    setOauthProxyMode
  } = useSettingsStore();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "pb-3", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("settings.behavior") }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "p-0", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-list", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.autoStart") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.autoStartHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { checked: autoStart, onCheckedChange: setAutoStart })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.autoStartProxy") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.autoStartProxyHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { checked: autoStartProxy, onCheckedChange: setAutoStartProxy })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.minimizeToTray") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.minimizeToTrayHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { checked: minimizeToTray, onCheckedChange: setMinimizeToTray })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.closeBehavior") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.closeBehaviorDesc") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: closeBehavior, onValueChange: (value) => setCloseBehavior(value), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-9 w-[160px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "minimize", children: t("settings.closeBehaviorMinimize") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "close", children: t("settings.closeBehaviorClose") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "ask", children: t("settings.closeBehaviorAsk") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.enableNotifications") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.enableNotificationsHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { checked: enableNotifications, onCheckedChange: setEnableNotifications })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.oauthProxyMode") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.oauthProxyModeHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: oauthProxyMode, onValueChange: (value) => setOauthProxyMode(value), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-9 w-[160px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "system", children: t("settings.oauthProxySystem") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "none", children: t("settings.oauthProxyNone") })
          ] })
        ] })
      ] })
    ] }) })
  ] });
}
const HOST_ERROR_KEYS = {
  "desktop-only": "desktop-only-export",
  "upload-unavailable": "upload-unavailable"
};
const WARNING_KEYS = {
  "no-credentials": "settings.backup.warnNoCredentials",
  "credentials-unreadable": "settings.backup.warnCredentialsUnreadable",
  "channel-unavailable": "settings.backup.warnChannelUnavailable",
  "different-platform": "settings.backup.warnDifferentPlatform",
  "newer-app-version": "settings.backup.warnNewerAppVersion"
};
const SKIPPED_KEYS = {
  statistics: "settings.backup.skipStatistics",
  logs: "settings.backup.skipLogs",
  channels: "settings.backup.skipChannels"
};
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function DataBackup() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [step, setStep] = reactExports.useState("idle");
  const [busy, setBusy] = reactExports.useState(false);
  const [includeStatistics, setIncludeStatistics] = reactExports.useState(true);
  const [includeLogs, setIncludeLogs] = reactExports.useState(false);
  const [encrypt, setEncrypt] = reactExports.useState(true);
  const [password, setPassword] = reactExports.useState("");
  const [passwordConfirm, setPasswordConfirm] = reactExports.useState("");
  const [token, setToken] = reactExports.useState(null);
  const [unlockPassword, setUnlockPassword] = reactExports.useState("");
  const [preview, setPreview] = reactExports.useState(null);
  const [mode, setMode] = reactExports.useState("replace");
  const [result, setResult] = reactExports.useState(null);
  const api = window.electronAPI?.backup;
  const resetState = () => {
    setStep("idle");
    setBusy(false);
    setPassword("");
    setPasswordConfirm("");
    setUnlockPassword("");
    setToken(null);
    setPreview(null);
    setMode("replace");
    setResult(null);
  };
  const closeAll = () => {
    if (token) void api?.cancel(token);
    resetState();
  };
  const backupErrorText = (cause, fallbackKey) => {
    const code = cause?.code;
    const hostKey = code === void 0 ? void 0 : HOST_ERROR_KEYS[code];
    return t(`settings.backup.error.${hostKey ?? fallbackKey}`);
  };
  const handleRestart = async () => {
    try {
      await window.electronAPI?.backup?.restart();
    } catch (cause) {
      const hostFact = cause?.code === "desktop-only";
      toast({
        title: t("common.error"),
        description: t(
          hostFact ? "settings.backup.error.desktop-only-restart" : "settings.backup.error.restart-failed"
        ),
        variant: "destructive"
      });
    }
  };
  const handleExport = async () => {
    if (!api) return;
    if (encrypt && password !== passwordConfirm) {
      toast({
        title: t("settings.backup.passwordMismatch"),
        variant: "destructive"
      });
      return;
    }
    setBusy(true);
    try {
      const response = await api.export({
        includeStatistics,
        includeLogs,
        ...encrypt && password !== "" ? { password } : {}
      });
      if (response.canceled) {
        setBusy(false);
        return;
      }
      if (response.error || !response.filePath) {
        toast({
          title: t("common.error"),
          description: t(`settings.backup.error.${response.error ?? "write-failed"}`),
          variant: "destructive"
        });
        setBusy(false);
        return;
      }
      toast({
        title: t("settings.backup.exportSuccess"),
        description: t("settings.backup.exportSuccessDesc", {
          size: formatBytes(response.bytes ?? 0),
          accounts: response.preview?.counts.accounts ?? 0,
          providers: response.preview?.counts.providers ?? 0
        })
      });
      resetState();
    } catch (cause) {
      toast({ title: t("common.error"), description: backupErrorText(cause, "write-failed"), variant: "destructive" });
      setBusy(false);
    }
  };
  const handlePick = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const response = await api.pick();
      if (response.canceled) {
        setBusy(false);
        return;
      }
      if (response.error || !response.token) {
        toast({
          title: t("common.error"),
          description: t(`settings.backup.error.${response.error ?? "read-failed"}`),
          variant: "destructive"
        });
        setBusy(false);
        return;
      }
      setToken(response.token);
      if (response.encrypted) {
        setUnlockPassword("");
        setStep("password");
        setBusy(false);
        return;
      }
      setPreview(response.preview ?? null);
      setMode("replace");
      setStep("preview");
      setBusy(false);
    } catch (cause) {
      toast({ title: t("common.error"), description: backupErrorText(cause, "read-failed"), variant: "destructive" });
      setBusy(false);
    }
  };
  const handleUnlock = async () => {
    if (!api || !token) return;
    setBusy(true);
    try {
      const response = await api.unlock(token, unlockPassword);
      if (!response.ok || !response.preview) {
        toast({
          title: t("common.error"),
          description: t(`settings.backup.error.${response.error ?? "bad-password"}`),
          variant: "destructive"
        });
        setBusy(false);
        return;
      }
      setPreview(response.preview);
      setMode("replace");
      setStep("preview");
      setBusy(false);
    } catch {
      toast({ title: t("common.error"), description: t("settings.backup.error.bad-password"), variant: "destructive" });
      setBusy(false);
    }
  };
  const handleApply = async () => {
    if (!api || !token) return;
    setBusy(true);
    try {
      const response = await api.apply(token, mode);
      setResult(response);
      setToken(null);
      if (!response.ok) {
        toast({
          title: t("common.error"),
          description: t(`settings.backup.error.${response.error ?? "apply-failed"}`),
          variant: "destructive"
        });
        setBusy(false);
        setStep("idle");
        return;
      }
      setStep("done");
      setBusy(false);
    } catch {
      toast({ title: t("common.error"), description: t("settings.backup.error.apply-failed"), variant: "destructive" });
      setBusy(false);
      setStep("idle");
    }
  };
  const counts = preview?.counts;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "card-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Archive, { className: "h-3.5 w-3.5" }) }),
          t("settings.backup.title")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("settings.backup.description") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 space-y-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("settings.backup.contains") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("ul", { className: "grid gap-1 text-xs text-muted-foreground md:grid-cols-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { children: [
              "• ",
              t("settings.backup.containsProviders")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { children: [
              "• ",
              t("settings.backup.containsAccounts")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { children: [
              "• ",
              t("settings.backup.containsConfig")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { children: [
              "• ",
              t("settings.backup.containsChannels")
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              className: "flex items-center gap-2",
              onClick: () => {
                resetState();
                setStep("export");
              },
              disabled: busy,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Download, { className: "h-4 w-4" }),
                t("settings.backup.export")
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              className: "flex items-center gap-2",
              onClick: handlePick,
              disabled: busy,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Upload, { className: "h-4 w-4" }),
                busy ? t("settings.backup.reading") : t("settings.backup.import")
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.backup.restartHint") })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: step === "export",
        onOpenChange: (open) => {
          if (!open && !busy) resetState();
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-lg", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("settings.backup.exportTitle") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("settings.backup.exportDesc") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 pr-3", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "backup-statistics", children: t("settings.backup.includeStatistics") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.backup.includeStatisticsHelp") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Switch,
                {
                  id: "backup-statistics",
                  checked: includeStatistics,
                  onCheckedChange: setIncludeStatistics,
                  disabled: busy
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 pr-3", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "backup-logs", children: t("settings.backup.includeLogs") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.backup.includeLogsHelp") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Switch,
                {
                  id: "backup-logs",
                  checked: includeLogs,
                  onCheckedChange: setIncludeLogs,
                  disabled: busy
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 pr-3", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs(Label, { htmlFor: "backup-encrypt", className: "flex items-center gap-2", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Lock, { className: "h-3.5 w-3.5" }),
                  t("settings.backup.encrypt")
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.backup.encryptHelp") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { id: "backup-encrypt", checked: encrypt, onCheckedChange: setEncrypt, disabled: busy })
            ] }),
            encrypt ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-3 md:grid-cols-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "backup-password", children: t("settings.backup.password") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  Input,
                  {
                    id: "backup-password",
                    type: "password",
                    value: password,
                    onChange: (event) => setPassword(event.target.value),
                    placeholder: t("settings.backup.passwordPlaceholder"),
                    disabled: busy
                  }
                )
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "backup-password-confirm", children: t("settings.backup.passwordConfirm") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  Input,
                  {
                    id: "backup-password-confirm",
                    type: "password",
                    value: passwordConfirm,
                    onChange: (event) => setPasswordConfirm(event.target.value),
                    disabled: busy
                  }
                )
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground md:col-span-2", children: t("settings.backup.passwordHelp") })
            ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldAlert, { className: "mt-0.5 h-4 w-4 shrink-0" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("settings.backup.plaintextWarning") })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: resetState, disabled: busy, children: t("common.cancel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: handleExport, disabled: busy || encrypt && password === "", children: busy ? t("settings.backup.exporting") : t("settings.backup.exportConfirm") })
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: step === "password",
        onOpenChange: (open) => {
          if (!open && !busy) closeAll();
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-md", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogTitle, { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Lock, { className: "h-4 w-4" }),
              t("settings.backup.unlockTitle")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("settings.backup.unlockDesc") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "backup-unlock-password", children: t("settings.backup.password") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Input,
              {
                id: "backup-unlock-password",
                type: "password",
                value: unlockPassword,
                onChange: (event) => setUnlockPassword(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter" && unlockPassword !== "" && !busy) void handleUnlock();
                },
                disabled: busy,
                autoFocus: true
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: closeAll, disabled: busy, children: t("common.cancel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: handleUnlock, disabled: busy || unlockPassword === "", children: busy ? t("settings.backup.unlocking") : t("settings.backup.unlock") })
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: step === "preview",
        onOpenChange: (open) => {
          if (!open && !busy) closeAll();
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-xl", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("settings.backup.previewTitle") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("settings.backup.previewDesc") })
          ] }),
          counts ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-2 text-sm md:grid-cols-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countProviders"), value: counts.providers }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                SummaryCell,
                {
                  label: t("settings.backup.countAccounts"),
                  value: `${counts.accounts} (${t("settings.backup.countWithCredentials", { n: counts.accountsWithCredentials })})`
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countRoutes"), value: counts.routes }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countMappings"), value: counts.modelMappings }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countApiKeys"), value: counts.apiKeys }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countChannelAccounts"), value: counts.channelAccounts }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countRequestLogs"), value: counts.requestLogs }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryCell, { label: t("settings.backup.countAppLogs"), value: counts.appLogs }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                SummaryCell,
                {
                  label: t("settings.backup.countCreatedAt"),
                  value: preview?.createdAt && !Number.isNaN(Date.parse(preview.createdAt)) ? new Date(preview.createdAt).toLocaleString() : "-",
                  small: true
                }
              )
            ] }),
            preview && preview.warnings.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200", children: preview.warnings.map((warning) => /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "flex items-start gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "mt-0.5 h-3.5 w-3.5 shrink-0" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t(WARNING_KEYS[warning]) })
            ] }, warning)) }) : null,
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { children: t("settings.backup.mode") }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 md:grid-cols-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  ModeOption,
                  {
                    active: mode === "replace",
                    onClick: () => setMode("replace"),
                    title: t("settings.backup.modeReplace"),
                    description: t("settings.backup.modeReplaceDesc"),
                    disabled: busy
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  ModeOption,
                  {
                    active: mode === "merge",
                    onClick: () => setMode("merge"),
                    title: t("settings.backup.modeMerge"),
                    description: t("settings.backup.modeMergeDesc"),
                    disabled: busy
                  }
                )
              ] })
            ] }),
            mode === "replace" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldAlert, { className: "mt-0.5 h-4 w-4 shrink-0" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("settings.backup.replaceWarning") })
            ] }) : null
          ] }) : null,
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: closeAll, disabled: busy, children: t("common.cancel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: handleApply, disabled: busy, children: busy ? t("settings.backup.applying") : t("settings.backup.apply") })
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: step === "done",
        onOpenChange: (open) => {
          if (!open) resetState();
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-md", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogTitle, { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, { className: "h-4 w-4 text-emerald-400" }),
              t("settings.backup.applySuccess")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("settings.backup.applySuccessDesc") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 text-xs text-muted-foreground", children: [
            result?.skipped && result.skipped.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: t("settings.backup.skipped", { blocks: result.skipped.map((block) => t(SKIPPED_KEYS[block])).join("、") }) }) : null,
            result?.safetyCopy ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "break-all", children: t("settings.backup.safetyCopy", { path: result.safetyCopy }) }) : null
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: resetState, children: t("settings.backup.later") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { className: "flex items-center gap-2", onClick: () => void handleRestart(), children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCw, { className: "h-4 w-4" }),
              t("settings.backup.restartNow")
            ] })
          ] })
        ] })
      }
    )
  ] });
}
function SummaryCell({ label, value, small }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] text-muted-foreground", children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: small ? "text-xs break-all" : "text-sm font-medium", children: value })
  ] });
}
function ModeOption({
  active,
  onClick,
  title,
  description,
  disabled
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "button",
    {
      type: "button",
      onClick,
      disabled,
      className: `rounded-xl border p-3 text-left transition ${active ? "border-[var(--accent-primary)] bg-[var(--glass-bg-hover)]" : "border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)]"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm font-medium", children: title }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-xs text-muted-foreground", children: description })
      ]
    }
  );
}
function DataManagement() {
  const { t } = useTranslation();
  const {
    logLevel,
    setLogLevel,
    logRetentionDays,
    setLogRetentionDays,
    maxLogs,
    setMaxLogs,
    config,
    updateConfig
  } = useSettingsStore();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = reactExports.useState(false);
  const [isImporting, setIsImporting] = reactExports.useState(false);
  const [isClearing, setIsClearing] = reactExports.useState(false);
  const [isResetting, setIsResetting] = reactExports.useState(false);
  const requestLogConfig = config?.requestLogConfig ?? {
    enabled: true,
    maxEntries: 200,
    includeBodies: false,
    maxBodyChars: 2e5,
    redactSensitiveData: true
  };
  const updateRequestLogConfig = async (updates) => {
    await updateConfig({
      requestLogConfig: {
        ...requestLogConfig,
        ...updates
      }
    });
  };
  const handleExportConfig = async () => {
    setIsExporting(true);
    try {
      const version = await window.electronAPI?.app?.getVersion?.();
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const cleaned = sanitizePersistedSettings(raw) ?? JSON.stringify({ state: pickPersistedPreferences(useSettingsStore.getState()), version: 0 });
      const payload = JSON.stringify(buildExportEnvelope(version ?? "unknown", cleaned), null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelport-config-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: t("common.success"),
        description: t("settings.exportSuccess")
      });
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.exportFailed"),
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };
  const handleImportConfig = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const envelope = parseExportEnvelope(text);
      if (envelope === null) {
        toast({
          title: t("common.error"),
          description: t("settings.importFailed"),
          variant: "destructive"
        });
        return;
      }
      localStorage.setItem(SETTINGS_STORAGE_KEY, envelope.settings);
      toast({
        title: t("common.success"),
        description: t("settings.importSuccess")
      });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.importFailed"),
        variant: "destructive"
      });
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };
  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      sessionStorage.clear();
      toast({
        title: t("common.success"),
        description: t("settings.cacheCleared")
      });
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.cacheClearFailed"),
        variant: "destructive"
      });
    } finally {
      setIsClearing(false);
    }
  };
  const handleResetApp = async () => {
    setIsResetting(true);
    try {
      if (window.electronAPI?.store?.clearAll) {
        await window.electronAPI.store.clearAll();
      }
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
      sessionStorage.clear();
      toast({
        title: t("common.success"),
        description: t("settings.resetSuccess")
      });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.resetFailed"),
        variant: "destructive"
      });
    } finally {
      setIsResetting(false);
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "card-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Database, { className: "h-3.5 w-3.5" }) }),
        t("settings.logSettings")
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-4 md:grid-cols-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "log-level", children: t("settings.logLevel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: logLevel, onValueChange: (value) => setLogLevel(value), children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { id: "log-level", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, { placeholder: t("settings.selectLogLevel") }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "debug", children: "Debug" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "info", children: "Info" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "warn", children: "Warn" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "error", children: "Error" })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.logLevelHelp") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "log-retention", children: t("settings.logRetentionDays") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Input,
              {
                id: "log-retention",
                type: "number",
                min: 1,
                max: 365,
                value: logRetentionDays,
                onChange: (e) => setLogRetentionDays(parseInt(e.target.value) || 30)
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.logRetentionHelp") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "max-logs", children: t("settings.maxLogs") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Input,
              {
                id: "max-logs",
                type: "number",
                min: 100,
                max: 1e5,
                value: maxLogs,
                onChange: (e) => setMaxLogs(parseInt(e.target.value) || 1e4)
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.maxLogsHelp") })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "request-log-enabled", children: t("settings.requestLogEnabled") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.requestLogEnabledHelp") })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Switch,
              {
                id: "request-log-enabled",
                checked: requestLogConfig.enabled,
                onCheckedChange: (checked) => {
                  void updateRequestLogConfig({ enabled: checked });
                }
              }
            )
          ] }),
          requestLogConfig.enabled ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "request-log-max-entries", children: t("settings.requestLogMaxEntries") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Input,
                {
                  id: "request-log-max-entries",
                  type: "number",
                  min: 0,
                  max: 1e4,
                  value: requestLogConfig.maxEntries,
                  onChange: (e) => {
                    void updateRequestLogConfig({ maxEntries: parseInt(e.target.value, 10) || 0 });
                  }
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.requestLogMaxEntriesHelp") })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 pr-3", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "request-log-bodies", children: t("settings.requestLogIncludeBodies") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.requestLogIncludeBodiesHelp") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Switch,
                {
                  id: "request-log-bodies",
                  checked: requestLogConfig.includeBodies,
                  onCheckedChange: (checked) => {
                    void updateRequestLogConfig({
                      includeBodies: checked,
                      maxBodyChars: checked ? Math.max(requestLogConfig.maxBodyChars, 8e3) : requestLogConfig.maxBodyChars
                    });
                  }
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 pr-3", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "request-log-redact", children: t("settings.requestLogRedactSensitive") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.requestLogRedactSensitiveHelp") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Switch,
                {
                  id: "request-log-redact",
                  checked: requestLogConfig.redactSensitiveData,
                  onCheckedChange: (checked) => {
                    void updateRequestLogConfig({ redactSensitiveData: checked });
                  }
                }
              )
            ] }),
            requestLogConfig.includeBodies ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 md:col-span-2 xl:col-span-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "request-log-max-body", children: t("settings.requestLogMaxBodyChars") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Input,
                {
                  id: "request-log-max-body",
                  type: "number",
                  min: 0,
                  max: 1e6,
                  value: requestLogConfig.maxBodyChars,
                  onChange: (e) => {
                    void updateRequestLogConfig({ maxBodyChars: parseInt(e.target.value, 10) || 0 });
                  }
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("settings.requestLogMaxBodyCharsHelp") })
            ] }) : null
          ] }) : null
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "card-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Download, { className: "h-3.5 w-3.5" }) }),
          t("settings.dataManagement")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("settings.dataManagementDesc") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "space-y-6", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Button,
          {
            variant: "outline",
            onClick: handleExportConfig,
            disabled: isExporting,
            className: "flex items-center gap-2",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Download, { className: "h-4 w-4" }),
              isExporting ? t("settings.exporting") : t("settings.exportConfig")
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              type: "file",
              accept: ".json",
              onChange: handleImportConfig,
              className: "absolute inset-0 w-full h-full opacity-0 cursor-pointer",
              disabled: isImporting
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              disabled: isImporting,
              className: "flex items-center gap-2",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Upload, { className: "h-4 w-4" }),
                isImporting ? t("settings.importing") : t("settings.importConfig")
              ]
            }
          )
        ] })
      ] }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2 text-destructive", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "h-5 w-5" }),
          t("settings.dangerZone")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("settings.dangerZoneDesc") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "space-y-6", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Button,
          {
            variant: "outline",
            onClick: handleClearCache,
            disabled: isClearing,
            className: "flex items-center gap-2",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "h-4 w-4" }),
              isClearing ? t("settings.clearing") : t("settings.clearCache")
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Dialog, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTrigger, { asChild: true, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "destructive", className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, { className: "h-4 w-4" }),
            t("settings.resetApp")
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("settings.confirmReset") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("settings.confirmResetDesc") })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => {
              }, children: t("common.cancel") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "destructive",
                  onClick: handleResetApp,
                  disabled: isResetting,
                  children: isResetting ? t("settings.resetting") : t("settings.confirmReset")
                }
              )
            ] })
          ] })
        ] })
      ] }) })
    ] })
  ] });
}
function ManagementApiSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = reactExports.useState({
    enableManagementApi: false,
    managementApiSecret: ""
  });
  const [isLoading, setIsLoading] = reactExports.useState(true);
  const [isSaving, setIsSaving] = reactExports.useState(false);
  const [isGenerating, setIsGenerating] = reactExports.useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = reactExports.useState(false);
  const [copied, setCopied] = reactExports.useState(false);
  const [proxyPort, setProxyPort] = reactExports.useState(8181);
  const [showSecret, setShowSecret] = reactExports.useState(false);
  reactExports.useEffect(() => {
    loadConfig();
  }, []);
  const loadConfig = async () => {
    try {
      const result = await window.electronAPI.managementApi.getConfig();
      if (result) {
        setConfig(result);
      }
      const appConfig = await window.electronAPI.config.get();
      if (appConfig?.proxyPort) {
        setProxyPort(appConfig.proxyPort);
      }
    } catch (error) {
      console.error("Failed to load management API config:", error);
    } finally {
      setIsLoading(false);
    }
  };
  const handleToggle = async (enabled) => {
    setIsSaving(true);
    try {
      await window.electronAPI.managementApi.updateConfig({
        enableManagementApi: enabled
      });
      setConfig((prev) => ({ ...prev, enableManagementApi: enabled }));
    } catch (error) {
      console.error("Failed to update management API config:", error);
    } finally {
      setIsSaving(false);
    }
  };
  const handleCopy = async () => {
    if (!config.managementApiSecret) return;
    try {
      await navigator.clipboard.writeText(config.managementApiSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch (error) {
      console.error("Failed to copy secret:", error);
    }
  };
  const handleGenerateNew = async () => {
    setIsGenerating(true);
    try {
      const newSecret = await window.electronAPI.managementApi.generateSecret();
      if (newSecret) {
        setConfig((prev) => ({ ...prev, managementApiSecret: newSecret }));
      }
      setShowConfirmDialog(false);
    } catch (error) {
      console.error("Failed to generate new secret:", error);
    } finally {
      setIsGenerating(false);
    }
  };
  const maskSecret = (secret) => {
    if (!secret || secret.length < 12) return secret;
    return secret.slice(0, 4) + "****" + secret.slice(-4);
  };
  const apiEndpoint = `http://127.0.0.1:${proxyPort}/v1/management`;
  if (isLoading) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "py-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-center text-muted-foreground", children: t("common.loading") }) }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Key, { className: "h-5 w-5" }),
          t("settings.managementApi.title")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("settings.managementApi.description") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "management-api-toggle", children: t("settings.managementApi.enableToggle") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("settings.managementApi.enableDescription") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              id: "management-api-toggle",
              checked: config.enableManagementApi,
              onCheckedChange: handleToggle,
              disabled: isSaving
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-sm font-medium", children: [
            t("settings.managementApi.status"),
            ":"
          ] }),
          config.enableManagementApi ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-success", children: t("settings.managementApi.enabled") }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-muted-foreground", children: t("settings.managementApi.disabled") })
        ] })
      ] })
    ] }),
    config.enableManagementApi && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("settings.managementApi.secretKey") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("settings.managementApi.secretKeyDescription") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(Alert, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "h-4 w-4" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(AlertDescription, { children: t("settings.managementApi.warning") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Input,
              {
                type: "text",
                value: config.managementApiSecret ? showSecret ? config.managementApiSecret : maskSecret(config.managementApiSecret) : t("settings.managementApi.secretKeyPlaceholder"),
                readOnly: true,
                className: "font-mono"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "outline",
                size: "icon",
                onClick: () => setShowSecret(!showSecret),
                disabled: !config.managementApiSecret,
                title: showSecret ? t("settings.managementApi.hideSecret") : t("settings.managementApi.showSecret"),
                children: showSecret ? /* @__PURE__ */ jsxRuntimeExports.jsx(EyeOff, { className: "h-4 w-4" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Eye, { className: "h-4 w-4" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "outline",
                size: "icon",
                onClick: handleCopy,
                disabled: !config.managementApiSecret,
                title: t("settings.managementApi.copySecret"),
                children: copied ? /* @__PURE__ */ jsxRuntimeExports.jsx(Check, { className: "h-4 w-4" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Copy, { className: "h-4 w-4" })
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              onClick: () => setShowConfirmDialog(true),
              disabled: isGenerating,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: `h-4 w-4 mr-2 ${isGenerating ? "animate-spin" : ""}` }),
                t("settings.managementApi.generateNew")
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Terminal, { className: "h-5 w-5" }),
            t("settings.managementApi.apiDocumentation")
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("settings.managementApi.exampleUsage") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { children: t("settings.managementApi.apiEndpoint") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "block w-full rounded-md bg-muted p-3 text-sm font-mono break-all", children: apiEndpoint })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(Label, { children: [
              "curl ",
              t("settings.managementApi.exampleUsage")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "block w-full rounded-md bg-muted p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all", children: `curl -X GET "${apiEndpoint}/config" \\
  -H "Authorization: Bearer YOUR_SECRET_KEY"` })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(Label, { children: [
              "PUT ",
              t("settings.managementApi.exampleUsage")
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "block w-full rounded-md bg-muted p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all", children: `curl -X PUT "${apiEndpoint}/config" \\
  -H "Authorization: Bearer YOUR_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"proxyPort": 8181}'` })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: showConfirmDialog, onOpenChange: setShowConfirmDialog, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("settings.managementApi.generateNew") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("settings.managementApi.generateConfirm") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => setShowConfirmDialog(false), children: t("common.cancel") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: handleGenerateNew, disabled: isGenerating, children: isGenerating ? t("common.loading") : t("common.confirm") })
      ] })
    ] }) })
  ] });
}
const DAY = 24 * 60 * 60 * 1e3;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const SHORT_OPTIONS = [
  { value: WEEK, labelKey: "settings.modelRefresh.week1" },
  { value: 2 * WEEK, labelKey: "settings.modelRefresh.week2" },
  { value: MONTH, labelKey: "settings.modelRefresh.month1" },
  { value: 3 * MONTH, labelKey: "settings.modelRefresh.month3" }
];
const LONG_OPTIONS = [
  { value: 2 * WEEK, labelKey: "settings.modelRefresh.week2" },
  { value: MONTH, labelKey: "settings.modelRefresh.month1" },
  { value: 3 * MONTH, labelKey: "settings.modelRefresh.month3" },
  { value: 6 * MONTH, labelKey: "settings.modelRefresh.month6" }
];
function ModelListRefreshSettings() {
  const { t } = useTranslation();
  const { config, updateConfig } = useSettingsStore();
  const refresh = config?.modelListRefresh ?? null;
  const [triggering, setTriggering] = reactExports.useState(false);
  const [lastTriggerError, setLastTriggerError] = reactExports.useState(null);
  const enabled = refresh?.enabled ?? true;
  const accountChannels = refresh?.accountChannels ?? true;
  const aggregate = refresh?.aggregate ?? true;
  const builtin = refresh?.builtin ?? true;
  const shortMs = refresh?.accountIntervalMs ?? WEEK;
  const longMs = refresh?.aggregateIntervalMs ?? 2 * WEEK;
  function patch(partial) {
    const next = {
      enabled,
      accountIntervalMs: shortMs,
      aggregateIntervalMs: longMs,
      accountChannels,
      aggregate,
      builtin,
      ...partial
    };
    void updateConfig({ modelListRefresh: next });
  }
  async function handleTrigger() {
    setTriggering(true);
    setLastTriggerError(null);
    try {
      const result = await window.electronAPI.modelRefresh.triggerNow();
      if (!result.ok) setLastTriggerError(result.reason ?? "failed");
    } catch (error) {
      setLastTriggerError(error instanceof Error ? error.message : String(error));
    } finally {
      setTriggering(false);
    }
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "pb-3", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("settings.modelRefresh.title") }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "p-0", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-list", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.enabled") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.modelRefresh.enabledHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Switch,
          {
            checked: enabled,
            onCheckedChange: (value) => patch({ enabled: value })
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.shortInterval") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.modelRefresh.shortIntervalHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Select,
          {
            value: String(shortMs),
            onValueChange: (value) => patch({ accountIntervalMs: Number(value) }),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-9 w-[160px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectContent, { children: SHORT_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: String(o.value), children: t(o.labelKey) }, o.value)) })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.longInterval") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.modelRefresh.longIntervalHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Select,
          {
            value: String(longMs),
            onValueChange: (value) => patch({ aggregateIntervalMs: Number(value) }),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-9 w-[160px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectContent, { children: LONG_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: String(o.value), children: t(o.labelKey) }, o.value)) })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.accountChannels") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.modelRefresh.accountChannelsHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Switch,
          {
            checked: accountChannels,
            onCheckedChange: (value) => patch({ accountChannels: value })
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.aggregate") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.modelRefresh.aggregateHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Switch,
          {
            checked: aggregate,
            onCheckedChange: (value) => patch({ aggregate: value })
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.builtin") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: t("settings.modelRefresh.builtinHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Switch,
          {
            checked: builtin,
            onCheckedChange: (value) => patch({ builtin: value })
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row setting-row-wrap", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-label", children: t("settings.modelRefresh.triggerNow") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "setting-hint", children: lastTriggerError ? t("settings.modelRefresh.triggerError", { reason: lastTriggerError }) : t("settings.modelRefresh.triggerNowHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", size: "sm", disabled: triggering || !enabled, onClick: handleTrigger, children: triggering ? t("settings.modelRefresh.triggering") : t("settings.modelRefresh.triggerBtn") })
      ] })
    ] }) })
  ] });
}
function About() {
  const { t } = useTranslation();
  const shellBridge = window.modelportShell;
  const isShell = typeof shellBridge?.checkForUpdates === "function";
  const isRemotePage = window.__MODELPORT_REMOTE__ === true;
  const isDesktopApp = !isShell && !isRemotePage;
  const [appVersion, setAppVersion] = reactExports.useState("");
  reactExports.useEffect(() => {
    if (window.electronAPI?.app?.getVersion) {
      window.electronAPI.app.getVersion().then((v) => {
        if (v) setAppVersion(v);
      });
    }
  }, []);
  const [updateInfo, setUpdateInfo] = reactExports.useState({ phase: "idle", latestVersion: null, error: null });
  const [downloadProgress, setDownloadProgress] = reactExports.useState(null);
  const displayAppVersion = appVersion || "...";
  const [shellVersion, setShellVersion] = reactExports.useState("");
  const [shellCheck, setShellCheck] = reactExports.useState(null);
  const [shellPhase, setShellPhase] = reactExports.useState("idle");
  const [shellProgress, setShellProgress] = reactExports.useState(null);
  const [shellError, setShellError] = reactExports.useState(null);
  reactExports.useEffect(() => {
    if (!isDesktopApp || !window.electronAPI?.app) return;
    const unsubscribeChecking = window.electronAPI.app.onUpdateChecking(() => {
      setUpdateInfo((current) => ({
        ...current,
        phase: "checking",
        error: null
      }));
      setDownloadProgress(null);
    });
    const unsubscribeAvailable = window.electronAPI.app.onUpdateAvailable((info) => {
      setUpdateInfo({
        phase: "available",
        latestVersion: info?.version || null,
        error: null
      });
      setDownloadProgress(null);
    });
    const unsubscribeNotAvailable = window.electronAPI.app.onUpdateNotAvailable((info) => {
      setUpdateInfo({
        phase: "not-available",
        latestVersion: info?.version || null,
        error: null
      });
      setDownloadProgress(null);
    });
    const unsubscribeProgress = window.electronAPI.app.onUpdateProgress((progress) => {
      setDownloadProgress(progress);
      setUpdateInfo((current) => ({
        ...current,
        phase: "downloading",
        error: null
      }));
    });
    const unsubscribeDownloaded = window.electronAPI.app.onUpdateDownloaded((info) => {
      setUpdateInfo({
        phase: "downloaded",
        latestVersion: info?.version || null,
        error: null
      });
      setDownloadProgress(null);
    });
    const unsubscribeError = window.electronAPI.app.onUpdateError((error) => {
      setDownloadProgress(null);
      setUpdateInfo((current) => ({
        ...current,
        phase: "error",
        error: typeof error === "string" ? error : error?.message || "Update failed"
      }));
    });
    return () => {
      unsubscribeChecking();
      unsubscribeAvailable();
      unsubscribeNotAvailable();
      unsubscribeProgress();
      unsubscribeDownloaded();
      unsubscribeError();
    };
  }, [isDesktopApp]);
  reactExports.useEffect(() => {
    if (!isShell || !shellBridge) return;
    let cancelled = false;
    void shellBridge.getVersion?.().then((version) => {
      if (!cancelled) setShellVersion(version);
    }).catch(() => void 0);
    const unsubscribe = shellBridge.onUpdateProgress?.((progress) => {
      if (cancelled) return;
      setShellProgress(progress);
      if (progress.stage === "done") setShellPhase("done");
      if (progress.stage === "error") {
        setShellPhase("error");
        setShellError(progress.message);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isShell, shellBridge]);
  const formatBytes2 = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };
  const formatSpeed = (bytesPerSecond) => {
    return `${formatBytes2(bytesPerSecond)}/s`;
  };
  const getUpdateErrorMessage = (error, fallback) => {
    if (typeof error === "string") return error;
    return error instanceof Error ? error.message : fallback;
  };
  const handleShellCheck = async () => {
    if (!shellBridge?.checkForUpdates) return;
    setShellPhase("checking");
    setShellError(null);
    setShellProgress(null);
    try {
      const result = await shellBridge.checkForUpdates();
      setShellCheck(result);
      setShellPhase("ready");
    } catch (error) {
      setShellPhase("error");
      setShellError(getUpdateErrorMessage(error, t("about.upgradeFailed")));
    }
  };
  const handleShellUpgrade = async () => {
    if (!shellBridge?.startUpgrade) return;
    setShellPhase("upgrading");
    setShellError(null);
    setShellProgress(null);
    try {
      const result = await shellBridge.startUpgrade();
      if (!result.ok) {
        setShellPhase("error");
        setShellError(result.error ?? t("about.upgradeFailed"));
        return;
      }
      if (!result.shellUpdated) {
        setShellPhase("done");
        setShellCheck(null);
      }
    } catch (error) {
      setShellPhase("error");
      setShellError(getUpdateErrorMessage(error, t("about.upgradeFailed")));
    }
  };
  const shellCanUpgrade = shellCheck !== null && (shellCheck.shell.updateAvailable && shellCheck.shell.asset !== null || shellCheck.daemon.managed && shellCheck.daemon.updateAvailable && shellCheck.daemon.asset !== null);
  const shellNeedsMissing = shellCheck !== null && (shellCheck.shell.updateAvailable && shellCheck.shell.asset === null || shellCheck.daemon.managed && shellCheck.daemon.updateAvailable && shellCheck.daemon.asset === null);
  const handleCheckAppUpdate = async () => {
    setUpdateInfo((current) => ({
      ...current,
      phase: "checking",
      error: null
    }));
    setDownloadProgress(null);
    try {
      const status = await window.electronAPI.app.checkUpdate();
      setUpdateInfo({
        phase: status.error ? "error" : status.checking ? "checking" : status.downloaded ? "downloaded" : status.downloading ? "downloading" : status.available ? "available" : "not-available",
        latestVersion: status.version || null,
        error: status.error
      });
    } catch (error) {
      setUpdateInfo((current) => ({
        ...current,
        phase: "error",
        error: getUpdateErrorMessage(error, "Update check failed")
      }));
    }
  };
  const handleDownloadUpdate = async () => {
    try {
      setUpdateInfo((current) => ({
        ...current,
        phase: "downloading",
        error: null
      }));
      setDownloadProgress(null);
      await window.electronAPI.app.downloadUpdate();
    } catch (error) {
      setDownloadProgress(null);
      setUpdateInfo((current) => ({
        ...current,
        phase: "error",
        error: getUpdateErrorMessage(error, "Download failed")
      }));
    }
  };
  const handleInstallUpdate = async () => {
    try {
      await window.electronAPI.app.installUpdate();
    } catch (error) {
      setUpdateInfo((current) => ({
        ...current,
        phase: "error",
        error: getUpdateErrorMessage(error, "Install failed")
      }));
    }
  };
  const handleOpenExternal = (url) => {
    if (window.electronAPI?.app?.openExternal) {
      window.electronAPI.app.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };
  const links = [
    {
      label: t("about.github"),
      icon: Github,
      url: "https://github.com/polite0803/ModelPort"
    },
    {
      label: t("about.releases"),
      icon: Download,
      url: "https://github.com/polite0803/ModelPort/releases"
    },
    {
      label: t("about.reportIssue"),
      icon: Bug,
      url: "https://github.com/polite0803/ModelPort/issues"
    }
  ];
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6 animate-fade-in", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center py-6 text-center relative", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-[var(--accent-primary)]/10 blur-[60px] rounded-full pointer-events-none" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "relative mb-4 animate-scale-in", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "relative w-16 h-16 rounded-2xl glass-card p-2.5 overflow-hidden", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        "img",
        {
          src: logoIcon,
          alt: "ModelPort Logo",
          className: "w-full h-full object-contain drop-shadow-md"
        }
      ) }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 z-10", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-xl font-semibold tracking-tight text-[var(--text-primary)]", children: t("settings.appName") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[var(--text-muted)] font-medium max-w-sm mx-auto", children: t("about.tagline") }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "inline-flex items-center gap-2 px-3 py-1 mt-3 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-xs font-mono text-[var(--text-muted)]", children: [
            "v",
            displayAppVersion
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid grid-cols-1 gap-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "glass-card p-5 space-y-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("h3", { className: "text-xs font-bold uppercase tracking-widest text-[var(--text-dim)] flex items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Globe, { className: "w-3.5 h-3.5" }),
        t("about.links")
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-3", children: links.map((link) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          onClick: () => handleOpenExternal(link.url),
          className: "w-full flex items-center justify-between p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)] hover:border-[var(--glass-border-hover)] transition-all group cursor-pointer text-left",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "p-1.5 rounded-lg bg-[var(--bg-tertiary)]/50 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors", children: /* @__PURE__ */ jsxRuntimeExports.jsx(link.icon, { className: "w-3.5 h-3.5" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors font-medium", children: link.label })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-6 h-6 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)]/30 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-micro text-[var(--text-primary)]", children: "↗" }) })
          ]
        },
        link.label
      )) })
    ] }) }),
    !isDesktopApp && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "glass-card p-6 space-y-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col sm:flex-row sm:items-start justify-between gap-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("h3", { className: "text-sm font-bold text-[var(--text-primary)] flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Zap, { className: "w-4 h-4 text-[var(--accent-primary)]" }),
            isShell ? t("about.shellUpdateTitle") : t("about.gatewayRemoteTitle")
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-[var(--text-muted)] max-w-xl", children: isShell ? t("about.shellUpdateDesc") : t("about.gatewayRemoteDesc") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 shrink-0", children: [
          isShell && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              onClick: () => void handleShellCheck(),
              disabled: shellPhase === "checking" || shellPhase === "upgrading",
              className: "px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] rounded-full text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50",
              children: [
                shellPhase === "checking" ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "w-4 h-4" }),
                t("settings.checkUpdates")
              ]
            }
          ),
          isShell && shellCanUpgrade && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              onClick: () => void handleShellUpgrade(),
              disabled: shellPhase === "upgrading",
              className: "px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] rounded-full text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Download, { className: "w-4 h-4" }),
                t("about.upgradeAll")
              ]
            }
          ),
          !isShell && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              onClick: () => handleOpenExternal("https://github.com/polite0803/ModelPort/releases"),
              className: "px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] rounded-full text-sm font-medium transition-colors flex items-center gap-2",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Github, { className: "w-4 h-4" }),
                t("about.openReleasePage")
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3", children: [
        isShell && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3 space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-micro uppercase tracking-widest text-[var(--text-dim)]", children: t("about.shellVersion") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-sm font-mono text-[var(--text-primary)]", children: [
            shellVersion || "...",
            shellCheck?.shell.latest ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[var(--text-muted)]", children: [
              " → ",
              shellCheck.shell.latest
            ] }) : null
          ] }),
          shellCheck && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-[var(--text-muted)]", children: shellCheck.shell.updateAvailable ? t("about.updateAvailable") : t("settings.upToDate") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3 space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-micro uppercase tracking-widest text-[var(--text-dim)]", children: t("about.gatewayVersion") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-sm font-mono text-[var(--text-primary)]", children: [
            displayAppVersion,
            shellCheck?.daemon.latest ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[var(--text-muted)]", children: [
              " → ",
              shellCheck.daemon.latest
            ] }) : null
          ] }),
          shellCheck && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-[var(--text-muted)]", children: shellCheck.daemon.current === null ? t("about.daemonReadFailed") : shellCheck.daemon.updateAvailable ? shellCheck.daemon.managed ? t("about.updateAvailable") : t("about.gatewayUnmanaged") : t("settings.upToDate") })
        ] })
      ] }),
      isShell && shellCheck?.daemon.managed === false && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-[var(--text-muted)]", children: t("about.gatewayUnmanaged") }),
      isShell && shellCheck && shellNeedsMissing && /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-[var(--accent-error)]", children: [
        t("about.missingAssets"),
        ": ",
        shellCheck.missing.join(", ")
      ] }),
      isShell && (shellCheck?.error || shellError) && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-[var(--accent-error)]", children: shellCheck?.error ?? shellError }),
      isShell && shellProgress && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 pt-3 border-t border-[var(--glass-border)]", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between text-xs text-[var(--text-muted)]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t(`about.stages.${shellProgress.stage}`) }),
          shellProgress.percent !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono", children: [
            shellProgress.percent.toFixed(1),
            "%"
          ] })
        ] }),
        shellProgress.percent !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: "h-full bg-[var(--accent-primary)] transition-all duration-300",
            style: { width: `${shellProgress.percent}%` }
          }
        ) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-[var(--text-muted)]", children: shellProgress.message })
      ] }),
      isShell && shellPhase === "done" && !shellProgress && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-[var(--accent-success)]", children: t("about.upgradeDone") }),
      isShell && shellCheck?.release && /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          onClick: () => handleOpenExternal(shellCheck.release?.pageUrl ?? ""),
          className: "text-xs text-[var(--accent-primary)] hover:underline text-left",
          children: t("about.openReleasePage")
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: `glass-card p-6 relative overflow-hidden group${isDesktopApp ? "" : " hidden"}`, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute top-0 right-0 w-64 h-64 bg-[var(--accent-primary)]/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none transition-opacity opacity-50 group-hover:opacity-100" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("h3", { className: "text-sm font-bold text-[var(--text-primary)] flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Zap, { className: "w-4 h-4 text-[var(--accent-primary)]" }),
            t("about.appUpdates")
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-[var(--text-muted)]", children: [
            t("settings.currentVersion"),
            ":",
            " ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-primary)] font-mono ml-1", children: displayAppVersion })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center gap-3", children: updateInfo.phase === "checking" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-muted)]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "w-4 h-4 animate-spin" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm font-medium", children: t("settings.checking") })
        ] }) : updateInfo.phase === "downloading" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2 min-w-[200px]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between text-xs text-[var(--text-muted)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("settings.downloadingUpdate") }),
            downloadProgress && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono", children: [
              downloadProgress.percent.toFixed(1),
              "%"
            ] })
          ] }),
          downloadProgress ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              "div",
              {
                className: "h-full bg-[var(--accent-primary)] transition-all duration-300",
                style: { width: `${downloadProgress.percent}%` }
              }
            ) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between text-xs text-[var(--text-dim)]", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: formatSpeed(downloadProgress.bytesPerSecond) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
                formatBytes2(downloadProgress.transferred),
                " / ",
                formatBytes2(downloadProgress.total)
              ] })
            ] })
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-xs text-[var(--text-dim)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "w-3.5 h-3.5 animate-spin" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("settings.downloadingUpdate") })
          ] })
        ] }) : updateInfo.phase === "downloaded" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--success)]/10 shadow-[0_0_8px_var(--success)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, { className: "w-3.5 h-3.5 text-[var(--success)]" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs font-medium text-[var(--success)]", children: t("settings.updateDownloaded") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              onClick: handleInstallUpdate,
              className: "px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] text-sm font-medium rounded-full transition-colors flex items-center gap-2 shadow-lg shadow-[var(--accent-primary)]/20",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "w-4 h-4" }),
                t("settings.restartAndInstall")
              ]
            }
          )
        ] }) : updateInfo.phase === "error" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 rounded-full badge-error", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(CircleAlert, { className: "w-3.5 h-3.5" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs font-medium", children: t("settings.updateCheckFailed") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              onClick: handleCheckAppUpdate,
              className: "px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] hover:border-[var(--glass-border-hover)] rounded-full text-sm text-[var(--text-primary)] font-medium transition-all duration-200 flex items-center gap-2",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "h-4 w-4 text-[var(--text-muted)]" }),
                t("settings.retry")
              ]
            }
          )
        ] }) : updateInfo.phase === "available" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--success)]/10 shadow-[0_0_8px_var(--success)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "relative flex h-2 w-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-xs font-medium text-[var(--success)]", children: [
              t("settings.updateAvailable"),
              updateInfo.latestVersion ? ` v${updateInfo.latestVersion}` : ""
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              onClick: handleDownloadUpdate,
              className: "px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] text-sm font-medium rounded-full transition-colors flex items-center gap-2 shadow-lg shadow-[var(--accent-primary)]/20",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Download, { className: "w-4 h-4" }),
                t("settings.downloadUpdate")
              ]
            }
          )
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            onClick: handleCheckAppUpdate,
            className: "px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] hover:border-[var(--glass-border-hover)] rounded-full text-sm text-[var(--text-primary)] font-medium transition-all duration-200 flex items-center gap-2",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Globe, { className: "h-4 w-4 text-[var(--text-muted)]" }),
              t("settings.checkUpdates")
            ]
          }
        ) })
      ] }),
      (updateInfo.phase === "error" || updateInfo.phase === "not-available") && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-4 pt-4 border-t border-[var(--glass-border)]", children: updateInfo.phase === "error" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-[var(--accent-error)]", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleAlert, { className: "w-4 h-4" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm font-medium", children: updateInfo.error || t("settings.updateCheckFailed") })
      ] }) : updateInfo.phase === "not-available" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-[var(--accent-success)]", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, { className: "w-4 h-4" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm font-medium", children: t("settings.upToDate") })
      ] }) : null })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-center space-y-3 pt-8 pb-4 border-t border-[var(--glass-border)] opacity-60", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-caption font-bold tracking-[0.2em] text-[var(--text-dim)] uppercase", children: t("about.credits") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-[var(--text-muted)] max-w-lg mx-auto leading-relaxed", children: t("about.builtWith") }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-micro text-[var(--text-dim)] font-mono", children: [
        "© ",
        (/* @__PURE__ */ new Date()).getFullYear(),
        " ",
        t("settings.appName"),
        " • GPL-3.0 License"
      ] })
    ] })
  ] }) });
}
function Settings() {
  const { t } = useTranslation();
  const { fetchConfig, setConfig } = useSettingsStore();
  reactExports.useEffect(() => {
    void fetchConfig();
    const unsubscribe = window.electronAPI?.config?.onConfigChanged?.((config) => {
      setConfig(config);
    });
    return () => {
      unsubscribe?.();
    };
  }, [fetchConfig, setConfig]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, { title: t("settings.title"), description: t("settings.description") }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Tabs, { defaultValue: "general", className: "w-full", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsList, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "general", className: "gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Settings$1, { className: "h-4 w-4" }),
          t("settings.general")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "dataSecurity", className: "gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Shield, { className: "h-4 w-4" }),
          t("settings.dataSecurity")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "managementApi", className: "gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Key, { className: "h-4 w-4" }),
          t("settings.managementApi.title")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "about", className: "gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Info, { className: "h-4 w-4" }),
          t("nav.about")
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "general", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(AppearanceSettings, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx(GeneralSettings, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx(ModelListRefreshSettings, {})
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "dataSecurity", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DataBackup, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DataManagement, {})
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "managementApi", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ManagementApiSettings, {}) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "about", children: /* @__PURE__ */ jsxRuntimeExports.jsx(About, {}) })
    ] })
  ] });
}
export {
  Settings
};
