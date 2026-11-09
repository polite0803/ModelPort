import { c as createLucideIcon, u as useTranslation, r as reactExports, j as jsxRuntimeExports, B as Button, a6 as Network } from "./index-Dmiad-IP.js";
import { C as Card, c as CardContent } from "./card-CJejDjrN.js";
import { P as PageHeader } from "./PageHeader-Uo_aLgRN.js";
import { R as RefreshCw } from "./refresh-cw-BZLwpUhy.js";
import { P as Plus } from "./plus-CRYwvOZy.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
import "./chevron-left-DjwtYoGs.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const MonitorOff = createLucideIcon("MonitorOff", [
  ["path", { d: "M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2", key: "k0q8oc" }],
  ["path", { d: "M22 15V5a2 2 0 0 0-2-2H9", key: "cp1ac0" }],
  ["path", { d: "M8 21h8", key: "1ev6f3" }],
  ["path", { d: "M12 17v4", key: "1riwvh" }],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
]);
const PHASE_DOT = {
  running: "bg-emerald-500",
  stopped: "bg-zinc-400",
  "not-installed": "bg-zinc-400",
  unreachable: "bg-red-500",
  offline: "bg-red-500",
  unknown: "bg-amber-500"
};
function dangerAction(action) {
  return action === "remove" || action === "uninstall";
}
function Gateways() {
  const { t } = useTranslation();
  const shellBridge = window.modelportShell;
  const gateways = shellBridge?.gateways;
  const [snapshot, setSnapshot] = reactExports.useState(null);
  const [pending, setPending] = reactExports.useState(null);
  const mounted = reactExports.useRef(true);
  const load = reactExports.useCallback(async () => {
    if (!gateways) return;
    try {
      const next = await gateways.snapshot();
      if (mounted.current) setSnapshot(next);
    } catch {
      if (mounted.current) {
        setSnapshot((current) => current ?? { rows: [], labels: {}, canAddWsl: false, error: t("gateways.loadFailed") });
      }
    }
  }, [gateways, t]);
  reactExports.useEffect(() => {
    mounted.current = true;
    void load();
    const off = gateways?.onChanged?.(() => void load());
    return () => {
      mounted.current = false;
      off?.();
    };
  }, [gateways, load]);
  const run = async (key, action) => {
    setPending(key);
    try {
      await action();
      await load();
    } finally {
      if (mounted.current) setPending(null);
    }
  };
  const onConnect = (row) => {
    if (!gateways || row.active || !row.actions.includes("connect")) return;
    void run(`${row.id}:connect`, () => gateways.connect(row.id));
  };
  const onAct = (row, action) => {
    if (!gateways) return;
    const key = `${row.id}:${action}`;
    if (action === "connect") return onConnect(row);
    if (action === "edit") return void run(key, () => gateways.edit(row.id));
    if (action === "remove") return void run(key, () => gateways.remove(row.id));
    if (action === "install") return void run(key, () => gateways.installWsl(row.id));
    if (action === "upgrade") return void run(key, () => gateways.upgrade(row.id));
    if (action === "deploy") return void run(key, () => gateways.deploy(row.id));
    if (row.kind === "wsl") {
      return void run(key, () => gateways.wslAction(row.id, action));
    }
    return void run(key, () => gateways.localAction(row.id, action));
  };
  if (!gateways) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, { title: t("gateways.title"), description: t("gateways.description") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex items-center gap-3 p-6 text-sm text-[var(--text-muted)]", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(MonitorOff, { className: "h-5 w-5 flex-none" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("gateways.desktopOnly") })
      ] }) })
    ] });
  }
  const rows = snapshot?.rows ?? [];
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      PageHeader,
      {
        title: t("gateways.title"),
        description: t("gateways.description"),
        actions: /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", size: "sm", onClick: () => void load(), disabled: pending !== null, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "mr-1.5 h-4 w-4" }),
            t("gateways.refresh")
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { size: "sm", onClick: () => void gateways.add(), disabled: pending !== null, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Plus, { className: "mr-1.5 h-4 w-4" }),
            t("gateways.add")
          ] })
        ] })
      }
    ),
    snapshot?.error && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400", children: snapshot.error }),
    snapshot === null ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 py-16 text-sm text-[var(--text-muted)]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
      t("gateways.loading")
    ] }) : rows.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col items-center gap-3 py-16 text-sm text-[var(--text-muted)]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Network, { className: "h-6 w-6" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("gateways.empty") })
    ] }) }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-2", children: rows.map((row) => {
      const busy = pending?.startsWith(`${row.id}:`) === true || pending === row.id;
      const clickable = !row.active && row.actions.includes("connect");
      return /* @__PURE__ */ jsxRuntimeExports.jsx(
        Card,
        {
          className: row.active ? "border-[var(--accent-primary)]/60" : clickable ? "cursor-pointer transition-colors hover:bg-[var(--surface-hover)]" : void 0,
          children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col gap-3 p-4 sm:flex-row sm:items-center", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default",
                onClick: () => onConnect(row),
                disabled: !clickable || busy,
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `mt-1.5 h-2 w-2 flex-none rounded-full ${PHASE_DOT[row.phase]}` }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "min-w-0 space-y-0.5", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "flex items-center gap-2", children: [
                      row.active && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "rounded border border-[var(--glass-border)] px-1.5 py-px text-[11px] font-medium text-[var(--text-muted)]", children: t("gateways.current") }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate text-sm font-semibold", children: row.name }),
                      busy && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3.5 w-3.5 flex-none animate-spin" })
                    ] }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "block truncate text-xs text-[var(--text-muted)]", children: [
                      t(`gateways.phase.${row.phase}`),
                      " · ",
                      row.detail
                    ] })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-none flex-wrap items-center justify-end gap-1.5", children: row.actions.filter((action) => action !== "connect").map((action) => /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: dangerAction(action) ? "ghost" : "outline",
                size: "sm",
                className: dangerAction(action) ? "text-red-400 hover:text-red-300" : void 0,
                disabled: pending !== null,
                onClick: () => onAct(row, action),
                children: snapshot.labels[action] ?? action
              },
              action
            )) })
          ] })
        },
        row.id
      );
    }) })
  ] });
}
export {
  Gateways
};
