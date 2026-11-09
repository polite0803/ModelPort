import { c as createLucideIcon, u as useTranslation, N as useToast, r as reactExports, j as jsxRuntimeExports, B as Button, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, J as DialogDescription, K as DialogFooter } from "./index-Dmiad-IP.js";
import { B as Badge } from "./badge-CrPFCp-Q.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Tags = createLucideIcon("Tags", [
  ["path", { d: "m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19", key: "1cbfv1" }],
  [
    "path",
    {
      d: "M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z",
      key: "135mg7"
    }
  ],
  ["circle", { cx: "6.5", cy: "9.5", r: ".5", fill: "currentColor", key: "5pm5xn" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const WandSparkles = createLucideIcon("WandSparkles", [
  [
    "path",
    {
      d: "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",
      key: "ul74o6"
    }
  ],
  ["path", { d: "m14 7 3 3", key: "1r5n42" }],
  ["path", { d: "M5 6v4", key: "ilb8ba" }],
  ["path", { d: "M19 14v4", key: "blhpug" }],
  ["path", { d: "M10 2v2", key: "7u0qdc" }],
  ["path", { d: "M7 8H3", key: "zfb6yr" }],
  ["path", { d: "M21 16h-4", key: "1cnmox" }],
  ["path", { d: "M11 3H9", key: "1obp7u" }]
]);
function isCatalogBatchActive(status) {
  return status === "running" || status === "paused";
}
function CatalogScopeBatchButton({
  providerId,
  scopeLabel,
  onFinished,
  disabled = false
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [estimate, setEstimate] = reactExports.useState(null);
  const [confirmOpen, setConfirmOpen] = reactExports.useState(false);
  const [probing, setProbing] = reactExports.useState(false);
  const [estimating, setEstimating] = reactExports.useState(false);
  const [starting, setStarting] = reactExports.useState(false);
  const [snapshot, setSnapshot] = reactExports.useState(null);
  const acceptProgress = reactExports.useCallback((job) => {
    if (job.providerScope !== providerId) return;
    setSnapshot(job);
  }, [providerId]);
  reactExports.useEffect(() => {
    const api = window.electronAPI?.providers;
    if (!api?.onCatalogBatchProgress) return;
    const unsubscribe = api.onCatalogBatchProgress(acceptProgress);
    return unsubscribe;
  }, [acceptProgress]);
  reactExports.useEffect(() => {
    const api = window.electronAPI?.providers;
    if (!api?.getCatalogBatchJobs) return;
    void api.getCatalogBatchJobs().then((jobs) => {
      const mine = jobs.filter((job) => job.providerScope === providerId);
      const active2 = mine.find((job) => isCatalogBatchActive(job.status));
      if (active2) setSnapshot(active2);
    }).catch(() => void 0);
  }, [providerId]);
  const active = snapshot !== null && isCatalogBatchActive(snapshot.status);
  const start = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    if (!api?.startCatalogBatch) return;
    setStarting(true);
    try {
      const result = await api.startCatalogBatch({ probe: probing, providerId });
      if (!result.success) {
        toast({
          title: t("models.metadata.batchScopeFailedStart"),
          description: result.error ?? scopeLabel,
          variant: "destructive"
        });
        return;
      }
      setConfirmOpen(false);
      setEstimate(null);
      if (result.snapshot) setSnapshot(result.snapshot);
    } finally {
      setStarting(false);
    }
  }, [probing, providerId, scopeLabel, t, toast]);
  const begin = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    if (!api?.estimateCatalogBatch) return;
    setEstimating(true);
    try {
      const result = await api.estimateCatalogBatch(providerId);
      if (result.models === 0) {
        toast({
          title: t("models.metadata.batchNoTargets"),
          description: t("models.metadata.batchScopeNone")
        });
        return;
      }
      setEstimate(result);
      setProbing(false);
      setConfirmOpen(true);
    } finally {
      setEstimating(false);
    }
  }, [providerId, t, toast]);
  const wasActiveRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      return;
    }
    if (!wasActiveRef.current || snapshot === null) return;
    wasActiveRef.current = false;
    const title = snapshot.status === "cancelled" ? t("models.metadata.batchScopeCancelled") : snapshot.status === "failed" ? t("models.metadata.batchScopeFailedStart") : t("models.metadata.batchScopeDone");
    toast({
      title,
      description: t("models.metadata.batchSummary", {
        success: snapshot.success,
        skipped: snapshot.skipped,
        failed: snapshot.failed
      }),
      variant: snapshot.failed > 0 ? "destructive" : "default"
    });
    onFinished?.();
  }, [active, onFinished, snapshot, t, toast]);
  const control = reactExports.useCallback(async (action) => {
    const api = window.electronAPI?.providers;
    const jobId = snapshot?.jobId;
    if (!jobId) return;
    if (action === "pause") await api?.pauseCatalogBatch?.(jobId);
    if (action === "resume") await api?.resumeCatalogBatch?.(jobId);
    if (action === "cancel") await api?.cancelCatalogBatch?.(jobId);
  }, [snapshot?.jobId]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      Button,
      {
        variant: "outline",
        size: "sm",
        disabled: disabled || estimating || active,
        onClick: () => void begin(),
        title: t("models.metadata.batchScopeDesc"),
        children: [
          estimating || starting ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(WandSparkles, { className: "mr-1.5 h-4 w-4" }),
          active ? t("models.metadata.batchViewProgress") : t("models.metadata.batchScopeButton")
        ]
      }
    ),
    snapshot && active && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex w-full flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: t("models.metadata.batchScopeProgressTitle") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: snapshot.status === "paused" ? t("models.metadata.batchPausedLabel") : t(`models.metadata.batchPhase_${snapshot.phase}`) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("models.metadata.batchProcessed", {
        done: snapshot.processedModels,
        total: snapshot.totalModels,
        percent: snapshot.totalModels > 0 ? Math.min(100, Math.round(snapshot.processedModels / snapshot.totalModels * 100)) : 0
      }) }),
      snapshot.currentModel && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "truncate text-muted-foreground", title: snapshot.currentModel, children: [
        t("models.metadata.batchCurrentModel"),
        ": ",
        snapshot.currentModel
      ] }),
      snapshot.probeEnabled && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: t("models.metadata.batchProbeUsage", {
        sent: snapshot.requestsSent,
        limit: snapshot.requestLimit
      }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ml-auto flex items-center gap-1", children: [
        snapshot.status === "running" && /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", size: "sm", className: "h-6 px-2", onClick: () => void control("pause"), children: t("models.metadata.batchPause") }),
        snapshot.status === "paused" && /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", size: "sm", className: "h-6 px-2", onClick: () => void control("resume"), children: t("models.metadata.batchResume") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", size: "sm", className: "h-6 px-2", onClick: () => void control("cancel"), children: t("models.metadata.batchCancelRun") })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: confirmOpen && estimate !== null, onOpenChange: (open) => !open ? setConfirmOpen(false) : void 0, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-md", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("models.metadata.batchScopeTitle", { scope: scopeLabel }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("models.metadata.batchScopeDesc") })
      ] }),
      estimate && /* @__PURE__ */ jsxRuntimeExports.jsxs("ul", { className: "space-y-1 text-sm", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: t("models.metadata.batchModels", { selected: estimate.models }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: t("models.metadata.batchFields", { count: estimate.fields }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: t("models.metadata.batchMatchBreakdown", {
          exact: estimate.exactModels,
          alias: estimate.aliasModels,
          family: estimate.familyCandidates
        }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: t("models.metadata.batchProbeModels", { count: estimate.probeModels }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: t("models.metadata.batchSkippedDisabled", { count: estimate.skippedDisabled }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-start gap-2 text-xs", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "checkbox",
            className: "mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]",
            checked: probing,
            onChange: (event) => setProbing(event.target.checked)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          t("models.metadata.batchProbeToggle"),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-[11px] text-muted-foreground", children: t("models.metadata.batchProbeToggleHint") })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", size: "sm", onClick: () => setConfirmOpen(false), disabled: starting, children: t("common.cancel") }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { size: "sm", onClick: () => void start(), disabled: starting, children: [
          starting ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : null,
          t("models.metadata.batchConfirmStart")
        ] })
      ] })
    ] }) })
  ] });
}
export {
  CatalogScopeBatchButton as C,
  Tags as T
};
