import { c as createLucideIcon, u as useTranslation, j as jsxRuntimeExports, a as cn, S as Server, r as reactExports, Z as Zap, B as Button, b as Settings2, F as FileText, E as ExternalLink, d as create, e as useNavigate, f as useSettingsStore, T as TriangleAlert } from "./index-Dmiad-IP.js";
import { C as Card, a as CardHeader, b as CardTitle, c as CardContent } from "./card-CJejDjrN.js";
import { T as TrendingUp, A as Activity, C as Clock } from "./trending-up-BnM90KHz.js";
import { M as Minus } from "./minus-D8cNH9y7.js";
import { r as recentLocalDays, c as currentLocalDay, l as localDayKey } from "./localDay-CzWGkYP0.js";
import { C as Coins } from "./coins-B2YPUoKF.js";
import { P as Plus } from "./plus-CRYwvOZy.js";
import { D as Database } from "./database-CgRqZ2QH.js";
import { P as PageHeader } from "./PageHeader-Uo_aLgRN.js";
import { R as RefreshCw } from "./refresh-cw-BZLwpUhy.js";
import { C as CircleCheckBig } from "./circle-check-big-DAvcYbdn.js";
import { U as Users } from "./users-ZQtKFulg.js";
import "./chevron-left-DjwtYoGs.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const History = createLucideIcon("History", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }],
  ["path", { d: "M12 7v5l4 2", key: "1fdv2h" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const TrendingDown = createLucideIcon("TrendingDown", [
  ["polyline", { points: "22 17 13.5 8.5 8.5 13.5 2 7", key: "1r2t7k" }],
  ["polyline", { points: "16 17 22 17 22 11", key: "11uiuu" }]
]);
function StatsCard({
  title,
  value,
  icon: Icon,
  trend,
  trendPolarity = "positive",
  className
}) {
  const { t } = useTranslation();
  const getTrendIcon = () => {
    if (!trend || trend.value === null) return null;
    if (trend.value > 0) return /* @__PURE__ */ jsxRuntimeExports.jsx(TrendingUp, { className: "h-3 w-3" });
    if (trend.value < 0) return /* @__PURE__ */ jsxRuntimeExports.jsx(TrendingDown, { className: "h-3 w-3" });
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Minus, { className: "h-3 w-3" });
  };
  const getTrendColor = () => {
    if (!trend || trend.value === null || trend.value === 0) return "text-[var(--text-muted)]";
    const isGood = trendPolarity === "negative" ? trend.value < 0 : trend.value > 0;
    return isGood ? "text-[var(--success)]" : "text-[var(--error)]";
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { hover: true, className: cn("p-5", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "stat-label", children: title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { className: "h-[15px] w-[15px] shrink-0 text-[var(--text-dim)]" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "stat-value mt-2", children: value }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: cn("mt-1.5 flex items-center gap-1 text-meta", getTrendColor()), children: [
      trend && (trend.value === null ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-dim)]", children: t("dashboard.trendUnavailable") }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        getTrendIcon(),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "tabular-nums", children: [
          trend.value > 0 ? "+" : "",
          trend.value,
          "%"
        ] })
      ] })),
      trend?.label && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-1 text-[var(--text-dim)]", children: trend.label })
    ] })
  ] });
}
function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1e3) return String(Math.round(value));
  if (value < 1e6) return `${(value / 1e3).toFixed(1)}k`;
  return `${(value / 1e6).toFixed(2)}M`;
}
function TokenUsageCard({ usage, className }) {
  const { t } = useTranslation();
  const upstreamTotal = usage ? usage.upstreamPrompt + usage.upstreamCompletion : 0;
  const estimatedTotal = usage ? usage.estimatedPrompt + usage.estimatedCompletion : 0;
  const hasAny = usage !== null && usage.requests > 0;
  const coverageText = usage && usage.upstreamCoverage !== null ? `${Math.round(usage.upstreamCoverage * 100)}%` : null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { hover: true, className: cn("p-5", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "stat-label", children: t("dashboard.tokenUsage.title") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Coins, { className: "h-[15px] w-[15px] shrink-0 text-[var(--text-dim)]" })
    ] }),
    !hasAny ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 text-sm text-[var(--text-dim)]", children: t("dashboard.tokenUsage.noData") }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-3 space-y-2.5", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-x-8 gap-y-2.5 sm:grid-cols-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-baseline justify-between gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-meta text-[var(--text-muted)]", children: t("dashboard.tokenUsage.upstream") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-value tabular-nums text-base", children: formatTokens(upstreamTotal) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-baseline justify-between gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-meta text-[var(--text-muted)]", children: t("dashboard.tokenUsage.estimated") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "span",
            {
              className: "tabular-nums text-[var(--text-dim)]",
              title: t("dashboard.tokenUsage.estimatedHint"),
              children: [
                "≈ ",
                formatTokens(estimatedTotal)
              ]
            }
          )
        ] })
      ] }),
      coverageText && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-meta text-[var(--text-dim)]", children: t("dashboard.tokenUsage.coverage", { percent: coverageText }) }),
      usage && usage.upstreamCacheRead > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-baseline justify-between gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "span",
          {
            className: "text-meta text-[var(--text-muted)]",
            title: t("dashboard.tokenUsage.cacheReadHint"),
            children: t("dashboard.tokenUsage.cacheRead")
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "tabular-nums text-[var(--text-dim)]", children: [
          formatTokens(usage.upstreamCacheRead),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ml-1", children: [
            "/ ",
            formatTokens(usage.upstreamPrompt)
          ] })
        ] })
      ] })
    ] }),
    hasAny && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-2.5 text-meta", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(TrendingDown, { className: "h-3 w-3 text-[var(--success)]" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-muted)]", children: t("dashboard.tokenUsage.saved") }),
      usage?.compressionEnabled === false ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "span",
          {
            className: "tabular-nums text-[var(--text-dim)]",
            title: t("dashboard.tokenUsage.savedDisabledHint"),
            children: "-"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-dim)]", children: t("dashboard.tokenUsage.savedDisabled") })
      ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tabular-nums text-[var(--success)]", children: formatTokens(usage?.savedTokens ?? 0) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-dim)]", children: t("dashboard.tokenUsage.savedHint") })
      ] })
    ] })
  ] });
}
const PRESETS$1 = [
  { key: "today", window: { kind: "today" }, labelKey: "dashboard.providerWindow.today" },
  { key: "days7", window: { kind: "days", days: 7 }, labelKey: "dashboard.providerWindow.days", count: 7 },
  { key: "days30", window: { kind: "days", days: 30 }, labelKey: "dashboard.providerWindow.days", count: 30 },
  { key: "all", window: { kind: "all" }, labelKey: "dashboard.providerWindow.all" }
];
function formatUsd(value) {
  if (value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
function ProviderStatusCard({
  providers,
  statsWindow,
  onWindowChange,
  className
}) {
  const { t } = useTranslation();
  const statusDot = (status) => {
    switch (status) {
      case "online":
        return "status-dot-online";
      case "offline":
        return "status-dot-offline";
      default:
        return "bg-[var(--warning)]";
    }
  };
  const statusText = (status) => {
    switch (status) {
      case "online":
        return t("providers.online");
      case "offline":
        return t("providers.offline");
      default:
        return t("providers.unknown");
    }
  };
  const formatLatency = (ms) => {
    if (ms < 1e3) return `${ms}ms`;
    return `${(ms / 1e3).toFixed(2)}s`;
  };
  const tokenHint = (tokens) => {
    if (tokens === void 0) return t("dashboard.providerWindow.tokenMissing");
    const coverage = Math.round(tokens.upstreamRequests / Math.max(tokens.requests, 1) * 100);
    return [
      `${t("dashboard.tokenUsage.upstream")}: ${formatTokens(tokens.upstreamTokens)}`,
      `${t("dashboard.tokenUsage.estimated")}: ≈${formatTokens(tokens.estimatedTokens)}`,
      t("dashboard.tokenUsage.coverage", { percent: `${coverage}%` }),
      tokens.coveredFrom ? t("dashboard.providerWindow.tokenFrom", { day: tokens.coveredFrom }) : ""
    ].filter(Boolean).join(" · ");
  };
  const isCustom = statsWindow.kind === "range";
  const isActivePreset = (preset) => {
    if (isCustom || preset.kind !== statsWindow.kind) return false;
    return preset.kind !== "days" || statsWindow.kind === "days" && statsWindow.days === preset.days;
  };
  const openCustomRange = () => {
    const days = recentLocalDays(7);
    onWindowChange({ kind: "range", start: days[0].key, end: days[days.length - 1].key });
  };
  const setRangeEdge = (edge, value) => {
    if (statsWindow.kind !== "range") return;
    onWindowChange({ ...statsWindow, [edge]: value });
  };
  const rangeEdges = statsWindow.kind === "range" ? statsWindow : null;
  const invalidRange = rangeEdges !== null && rangeEdges.start > rangeEdges.end;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: cn("flex h-full flex-col p-5", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Server, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "card-heading", children: t("dashboard.providerStats") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1", children: [
        PRESETS$1.map((preset) => {
          const active = isActivePreset(preset.window);
          return /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: () => onWindowChange(preset.window),
              className: cn(
                "rounded-md px-2 py-1 text-caption transition-colors",
                active ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              ),
              children: preset.count === void 0 ? t(preset.labelKey) : t(preset.labelKey, { count: preset.count })
            },
            preset.key
          );
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            onClick: openCustomRange,
            className: cn(
              "rounded-md px-2 py-1 text-caption transition-colors",
              isCustom ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            ),
            children: t("dashboard.providerWindow.custom")
          }
        )
      ] })
    ] }),
    rangeEdges && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-2 pl-4 text-caption text-[var(--text-muted)]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("dashboard.providerWindow.from") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "date",
            value: rangeEdges.start,
            onChange: (event) => setRangeEdge("start", event.target.value),
            className: "rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-caption"
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("dashboard.providerWindow.to") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "date",
            value: rangeEdges.end,
            onChange: (event) => setRangeEdge("end", event.target.value),
            className: "rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-caption"
          }
        )
      ] }),
      invalidRange && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--warning)]", children: t("dashboard.providerWindow.invalidRange") })
    ] }),
    providers.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state flex-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty-state-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Server, { className: "h-5 w-5" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-title", children: t("providers.noProvidersFound") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-hint", children: t("providers.clickToAddProvider") })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1", children: providers.map((provider) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        className: "rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: cn("status-dot shrink-0", statusDot(provider.status)) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate text-label", children: provider.name })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "shrink-0 text-caption text-[var(--text-dim)]", children: [
              statusText(provider.status),
              provider.latency !== void 0 && provider.latency > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { title: t("dashboard.providerWindow.probeHint"), children: [
                " · ",
                t("dashboard.providerWindow.probe"),
                " ",
                provider.latency,
                "ms"
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 grid grid-cols-5 gap-2 pl-4 text-caption", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-dim)]", children: t("dashboard.totalRequests") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-medium tabular-nums", children: provider.requestCount.toLocaleString() })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "span",
                {
                  className: "text-[var(--text-dim)]",
                  title: provider.coveredFrom ? t("dashboard.providerWindow.outcomeFrom", { day: provider.coveredFrom }) : t("dashboard.providerWindow.outcomeMissing"),
                  children: t("dashboard.successRate")
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-medium tabular-nums", children: provider.successRate === void 0 ? "-" : `${provider.successRate}%` })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-dim)]", children: t("dashboard.avgResponse") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-medium tabular-nums", children: provider.avgLatencyMs === void 0 ? "-" : formatLatency(provider.avgLatencyMs) })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "span",
                {
                  className: "text-[var(--text-dim)]",
                  title: tokenHint(provider.tokens),
                  children: t("dashboard.tokenTotal")
                }
              ),
              provider.tokens === void 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-medium tabular-nums", children: "-" }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "font-medium tabular-nums", children: [
                formatTokens(provider.tokens.upstreamTokens),
                provider.tokens.estimatedTokens > 0 && // Second pool, second number: one total would read as
                // measured while being mostly `chars/4`.
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ml-1 font-normal text-[var(--text-dim)]", children: [
                  "+≈ ",
                  formatTokens(provider.tokens.estimatedTokens)
                ] })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "span",
                {
                  className: "text-[var(--text-dim)]",
                  title: provider.tokens ? t("dashboard.providerWindow.costHint", {
                    costed: provider.tokens.costedRequests,
                    requests: provider.tokens.requests
                  }) : t("dashboard.providerWindow.costMissing"),
                  children: t("dashboard.cost")
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-medium tabular-nums", children: provider.tokens?.costUsd === void 0 ? "-" : formatUsd(provider.tokens.costUsd) })
            ] })
          ] })
        ]
      },
      provider.id
    )) })
  ] });
}
function dayCountsOf(point) {
  if (!point) return { requests: null, success: null, avgLatency: null };
  return { requests: point.total, success: point.success, avgLatency: point.avgLatency };
}
function dailyTrendPoints(buckets, days, now = Date.now()) {
  const oldestKey = Object.keys(buckets).sort()[0];
  return recentLocalDays(days, now).map((window2) => {
    if (!oldestKey || oldestKey > window2.key) {
      return { date: window2.key, total: null, success: null, error: null, avgLatency: null };
    }
    const bucket = buckets[window2.key];
    const success = bucket?.successRequests ?? 0;
    return {
      date: window2.key,
      total: bucket?.totalRequests ?? 0,
      success,
      error: bucket?.failedRequests ?? 0,
      avgLatency: bucket && success > 0 ? Math.round(bucket.totalLatency / success) : 0
    };
  });
}
function successRateOf(counts) {
  if (counts.requests === null || counts.success === null || counts.requests === 0) return null;
  return Math.round(counts.success / counts.requests * 100);
}
function percentChange(current, base) {
  if (current === null || base === null) return null;
  if (base === 0) return current > 0 ? 100 : 0;
  return Math.round((current - base) / base * 100);
}
function differenceInPoints(current, base) {
  if (current === null || base === null) return null;
  return current - base;
}
function isolatedIndices(values) {
  const indices = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const previous = index > 0 ? values[index - 1] : null;
    const next = index < values.length - 1 ? values[index + 1] : null;
    if (previous === null && next === null) indices.push(index);
  });
  return indices;
}
const CHART_WIDTH = 640;
const CHART_HEIGHT = 260;
const CHART_PADDING = {
  top: 18,
  right: 18,
  bottom: 38,
  left: 44
};
function RequestChart({ data, className }) {
  const { t } = useTranslation();
  const series = reactExports.useMemo(() => [
    { key: "requests", label: t("dashboard.totalRequests"), color: "hsl(var(--primary))", ring: true },
    { key: "success", label: t("common.success"), color: "hsl(142, 76%, 36%)", ring: false },
    { key: "failed", label: t("common.error"), color: "hsl(0, 84%, 60%)", ring: false }
  ], [t]);
  const chart = reactExports.useMemo(() => {
    const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
    const knownValues = data.flatMap((point) => [point.requests, point.success, point.failed]).filter((value) => value !== null);
    const maxValue = Math.max(1, ...knownValues);
    const yTicks = [maxValue, Math.ceil(maxValue / 2), 0];
    const xStep = data.length > 1 ? plotWidth / (data.length - 1) : 0;
    const labelEvery = Math.max(1, Math.ceil(data.length / 6));
    const x = (index) => CHART_PADDING.left + index * xStep;
    const y = (value) => CHART_PADDING.top + (1 - value / maxValue) * plotHeight;
    const pathFor = (key) => {
      const segments = [];
      let command = "M";
      data.forEach((point, index) => {
        const value = point[key];
        if (value === null) {
          command = "M";
          return;
        }
        segments.push(`${command} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`);
        command = "L";
      });
      return segments.join(" ");
    };
    const isolatedBySeries = {
      requests: isolatedIndices(data.map((point) => point.requests)),
      success: isolatedIndices(data.map((point) => point.success)),
      failed: isolatedIndices(data.map((point) => point.failed))
    };
    return { plotWidth, plotHeight, maxValue, yTicks, labelEvery, x, y, pathFor, isolatedBySeries };
  }, [data]);
  const hasRetainedData = data.some((point) => point.requests !== null);
  const missingDays = data.filter((point) => point.requests === null).map((point) => point.time);
  const retentionGapText = missingDays.length > 0 ? t("dashboard.chartRetentionGap", { days: missingDays.join(", ") }) : "";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: cn("", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Activity, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
      t("dashboard.requestsTrend")
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-[240px] w-full", children: data.length === 0 || !hasRetainedData ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state h-full", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty-state-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Activity, { className: "h-5 w-5" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-title", children: t("common.noData") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-hint", children: retentionGapText || t("dashboard.chartEmptyHint", { defaultValue: "" }) })
      ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "svg",
        {
          viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
          className: "h-full w-full overflow-visible",
          role: "img",
          "aria-label": t("dashboard.requestsTrend"),
          children: [
            chart.yTicks.map((tick) => /* @__PURE__ */ jsxRuntimeExports.jsxs("g", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "line",
                {
                  x1: CHART_PADDING.left,
                  x2: CHART_WIDTH - CHART_PADDING.right,
                  y1: chart.y(tick),
                  y2: chart.y(tick),
                  stroke: "hsl(var(--border))",
                  strokeDasharray: "3 3"
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "text",
                {
                  x: CHART_PADDING.left - 10,
                  y: chart.y(tick),
                  textAnchor: "end",
                  dominantBaseline: "middle",
                  className: "fill-[var(--text-muted)] text-caption",
                  children: tick
                }
              )
            ] }, tick)),
            data.map((point, index) => index % chart.labelEvery === 0 || index === data.length - 1 ? /* @__PURE__ */ jsxRuntimeExports.jsx(
              "text",
              {
                x: chart.x(index),
                y: CHART_HEIGHT - 10,
                textAnchor: "middle",
                className: "fill-[var(--text-muted)] text-caption",
                children: point.time
              },
              `${point.time}-${index}`
            ) : null),
            series.map((item) => /* @__PURE__ */ jsxRuntimeExports.jsxs("g", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "path",
                {
                  d: chart.pathFor(item.key),
                  fill: "none",
                  stroke: item.color,
                  strokeWidth: 2,
                  strokeLinecap: "round",
                  strokeLinejoin: "round"
                }
              ),
              chart.isolatedBySeries[item.key].map((index) => {
                const value = data[index]?.[item.key];
                if (value === null || value === void 0) return null;
                return /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "circle",
                  {
                    cx: chart.x(index),
                    cy: chart.y(value),
                    r: item.ring ? 5 : 2.5,
                    fill: item.ring ? "none" : item.color,
                    stroke: item.ring ? item.color : void 0,
                    strokeWidth: item.ring ? 1.5 : void 0
                  },
                  index
                );
              })
            ] }, item.key))
          ]
        }
      ) }),
      data.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-[var(--text-muted)]", children: series.map((item) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "h-2 w-2 rounded-full", style: { backgroundColor: item.color } }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: item.label })
        ] }, item.key)) }),
        retentionGapText && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-caption text-[var(--text-muted)]", children: retentionGapText })
      ] })
    ] })
  ] });
}
function QuickActions({
  onAddAccount,
  onViewLogs,
  onOpenProxy,
  className
}) {
  const { t } = useTranslation();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: cn("flex h-full flex-col p-5", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Zap, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "card-heading", children: t("quickActions.title") })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 flex flex-1 flex-col gap-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { className: "w-full justify-start", onClick: onAddAccount, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Plus, { className: "h-4 w-4" }),
        t("quickActions.addAccount")
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { className: "w-full justify-start font-normal", variant: "ghost", onClick: onOpenProxy, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Settings2, { className: "h-4 w-4" }),
        t("nav.proxy")
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { className: "w-full justify-start font-normal", variant: "ghost", onClick: onViewLogs, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(FileText, { className: "h-4 w-4" }),
        t("quickActions.viewLogs")
      ] })
    ] })
  ] });
}
function RecentActivity({
  activities,
  onItemClick,
  className,
  maxVisible = 7
}) {
  const { t } = useTranslation();
  const getTypeDot = (type) => {
    switch (type) {
      case "success":
        return "bg-[var(--success)]";
      case "error":
        return "bg-[var(--error)]";
      case "warning":
        return "bg-[var(--warning)]";
      default:
        return "bg-[var(--accent-primary)]";
    }
  };
  const formatTime = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 6e4);
    const hours = Math.floor(diff / 36e5);
    const days = Math.floor(diff / 864e5);
    if (minutes < 1) return t("dashboard.justNow");
    if (minutes < 60) return t("dashboard.minutesAgo", { count: minutes });
    if (hours < 24) return t("dashboard.hoursAgo", { count: hours });
    return t("dashboard.daysAgo", { count: days });
  };
  const formatLatency = (ms) => {
    if (ms < 1e3) return `${ms}ms`;
    return `${(ms / 1e3).toFixed(2)}s`;
  };
  const visibleActivities = activities.slice(0, maxVisible);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: cn("flex h-full flex-col p-5", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(History, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "card-heading", children: t("dashboard.recentActivity") })
    ] }),
    activities.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state flex-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty-state-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(History, { className: "h-5 w-5" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-title", children: t("dashboard.noActivity") })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1", children: visibleActivities.map((item) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        className: cn(
          "group rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]",
          onItemClick && "cursor-pointer"
        ),
        onClick: () => onItemClick?.(item),
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: cn("status-dot shrink-0", getTypeDot(item.type)) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate text-label", children: item.title })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex shrink-0 items-center gap-2", children: [
              item.statusCode && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "badge-soft font-mono", children: item.statusCode }),
              onItemClick && /* @__PURE__ */ jsxRuntimeExports.jsx(ExternalLink, { className: "h-3.5 w-3.5 text-[var(--text-dim)] opacity-0 transition-opacity group-hover:opacity-100" })
            ] })
          ] }),
          item.description && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mb-1 truncate pl-4 text-caption text-[var(--text-muted)]", children: item.description }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5 pl-4 text-caption text-[var(--text-dim)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: formatTime(item.timestamp) }),
            item.clientLabel && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "·" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: item.clientLabel })
            ] }),
            item.providerName && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "·" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: item.providerName })
            ] }),
            item.actualModel && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "·" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono", children: item.actualModel })
            ] }),
            item.accountName && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "·" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: item.accountName })
            ] }),
            item.latency !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "·" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tabular-nums", children: formatLatency(item.latency) })
            ] })
          ] })
        ]
      },
      item.id
    )) })
  ] });
}
const PRESETS = [
  { key: "today", window: { kind: "today" }, labelKey: "dashboard.providerWindow.today" },
  { key: "days7", window: { kind: "days", days: 7 }, labelKey: "dashboard.providerWindow.days", count: 7 },
  { key: "days30", window: { kind: "days", days: 30 }, labelKey: "dashboard.providerWindow.days", count: 30 },
  { key: "all", window: { kind: "all" }, labelKey: "dashboard.providerWindow.all" }
];
const DEFAULT_VISIBLE_ROWS = 8;
function isActiveWindow(preset, current) {
  if (preset.kind !== current.kind) return false;
  return preset.kind !== "days" || current.kind === "days" && preset.days === current.days;
}
function percentOf(numerator, denominator) {
  if (!(denominator > 0)) return null;
  return `${Math.round(numerator / denominator * 100)}%`;
}
function ModelCacheCard({
  stats,
  coverage,
  statsWindow,
  onWindowChange,
  className
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = reactExports.useState(false);
  const coverageGap = coverage !== void 0 && coverage.detailedRequests < coverage.totalRequests ? coverage : null;
  const rows = reactExports.useMemo(() => {
    return Object.entries(stats).map(([key, usage]) => ({ key, ...usage })).sort(
      (a, b) => b.promptWithCache - a.promptWithCache || b.promptTokens - a.promptTokens || b.requests - a.requests
    );
  }, [stats]);
  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE_ROWS);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: cn("p-5", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Database, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "card-heading", children: t("dashboard.modelCache.title") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center gap-1", children: PRESETS.map((preset) => {
        const active = isActiveWindow(preset.window, statsWindow);
        return /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            onClick: () => onWindowChange(preset.window),
            className: cn(
              "rounded-md px-2 py-1 text-caption transition-colors",
              active ? "bg-[var(--accent-soft)] text-[var(--accent-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            ),
            children: preset.count === void 0 ? t(preset.labelKey) : t(preset.labelKey, { count: preset.count })
          },
          preset.key
        );
      }) })
    ] }),
    rows.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 text-sm text-[var(--text-dim)]", children: t("dashboard.modelCache.noData") }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-3 overflow-x-auto", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("table", { className: "w-full min-w-[560px] text-meta", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "text-[var(--text-muted)]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "py-1.5 pr-3 text-left font-medium", children: t("dashboard.modelCache.model") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "py-1.5 px-2 text-right font-medium", children: t("dashboard.modelCache.requests") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "py-1.5 px-2 text-right font-medium", children: t("dashboard.modelCache.upstream") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "py-1.5 px-2 text-right font-medium", children: t("dashboard.modelCache.input") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "py-1.5 px-2 text-right font-medium", children: t("dashboard.modelCache.cacheRead") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "py-1.5 pl-2 text-right font-medium", children: t("dashboard.modelCache.hitRate") })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: visibleRows.map((row) => {
          const hitRate = percentOf(row.cacheReadTokens, row.promptWithCache);
          const coverage2 = percentOf(row.upstreamRequests, row.requests);
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "border-t border-[var(--border)]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("td", { className: "max-w-[18rem] py-1.5 pr-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "truncate text-[var(--text-primary)]", children: row.model }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "truncate text-caption text-[var(--text-dim)]", children: row.providerId })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]", children: row.requests }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "td",
              {
                className: "py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]",
                title: coverage2 === null ? t("dashboard.modelCache.missing") : t("dashboard.modelCache.coverageHint", {
                  upstream: row.upstreamRequests,
                  requests: row.requests
                }),
                children: coverage2 ?? "-"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]", children: row.promptTokens > 0 ? formatTokens(row.promptTokens) : "-" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]", children: row.cacheReportedRequests > 0 ? formatTokens(row.cacheReadTokens) : "-" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "py-1.5 pl-2 text-right tabular-nums", children: hitRate === null ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-dim)]", children: "-" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[var(--text-primary)]", children: hitRate }) })
          ] }, row.key);
        }) })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 flex items-center justify-between gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-caption text-[var(--text-dim)]", children: t("dashboard.modelCache.note") }),
          coverageGap !== null && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-caption text-[var(--text-dim)]", children: t("dashboard.modelCache.coverageNote", {
            covered: coverageGap.detailedRequests,
            total: coverageGap.totalRequests
          }) })
        ] }),
        rows.length > DEFAULT_VISIBLE_ROWS && /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            onClick: () => setExpanded((value) => !value),
            className: "shrink-0 rounded-md px-2 py-1 text-caption text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)]",
            children: expanded ? t("dashboard.modelCache.collapse") : t("dashboard.modelCache.expand", { count: rows.length })
          }
        )
      ] })
    ] })
  ] });
}
const DEFAULT_PROVIDER_WINDOW = { kind: "today" };
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function isDayKey(value) {
  return typeof value === "string" && DAY_KEY_PATTERN.test(value);
}
function compareDayKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
function windowDayKeys(days, window2, now = Date.now()) {
  const stored = Object.keys(days).filter(isDayKey).sort(compareDayKeys);
  if (window2.kind === "all") return stored;
  if (window2.kind === "range") {
    if (!isDayKey(window2.start) || !isDayKey(window2.end)) return [];
    return stored.filter(
      (key) => compareDayKeys(key, window2.start) >= 0 && compareDayKeys(key, window2.end) <= 0
    );
  }
  const wanted = window2.kind === "today" ? [currentLocalDay(now).key] : recentLocalDays(window2.days, now).map((day) => day.key);
  return stored.filter((key) => wanted.includes(key));
}
function aggregateProviderUsage(days, window2, now = Date.now()) {
  const totals = {};
  for (const key of windowDayKeys(days, window2, now)) {
    const bucket = days[key];
    const covered = bucket?.providerSuccess !== void 0 && bucket?.providerLatency !== void 0;
    for (const [providerId, requests] of Object.entries(bucket?.providerUsage ?? {})) {
      if (!(requests > 0)) continue;
      const total = totals[providerId] ?? { requests: 0, coveredRequests: 0, successes: 0, latencySum: 0 };
      total.requests += requests;
      if (covered) {
        const successes = bucket?.providerSuccess?.[providerId] ?? 0;
        total.coveredRequests += requests;
        total.successes += successes;
        total.latencySum += bucket?.providerLatency?.[providerId] ?? 0;
        if (total.coveredFrom === void 0 || compareDayKeys(key, total.coveredFrom) < 0) {
          total.coveredFrom = key;
        }
      }
      totals[providerId] = total;
    }
  }
  const result = {};
  for (const [providerId, total] of Object.entries(totals)) {
    const usage = { requests: total.requests };
    if (total.coveredRequests > 0) {
      usage.successRate = Math.round(total.successes / total.coveredRequests * 100);
    }
    if (total.successes > 0) {
      usage.avgLatencyMs = Math.round(total.latencySum / total.successes);
    }
    if (total.coveredFrom !== void 0) {
      usage.coveredFrom = total.coveredFrom;
    }
    result[providerId] = usage;
  }
  return result;
}
function aggregateProviderTokenUsage(days, window2, now = Date.now()) {
  const totals = {};
  for (const key of windowDayKeys(days, window2, now)) {
    const byProvider = days[key]?.byProvider;
    if (byProvider === void 0) continue;
    for (const [providerId, usage] of Object.entries(byProvider)) {
      const total = totals[providerId] ?? {
        upstreamTokens: 0,
        estimatedTokens: 0,
        requests: 0,
        upstreamRequests: 0,
        costUsd: 0,
        costedRequests: 0
      };
      total.upstreamTokens += usage.upstreamPrompt + usage.upstreamCompletion;
      total.estimatedTokens += usage.estimatedPrompt + usage.estimatedCompletion;
      total.requests += usage.requests;
      total.upstreamRequests += usage.upstreamRequests;
      total.costUsd += usage.costUsd;
      total.costedRequests += usage.costedRequests;
      if (total.coveredFrom === void 0 || compareDayKeys(key, total.coveredFrom) < 0) {
        total.coveredFrom = key;
      }
      totals[providerId] = total;
    }
  }
  const result = {};
  for (const [providerId, total] of Object.entries(totals)) {
    const usage = {
      upstreamTokens: total.upstreamTokens,
      estimatedTokens: total.estimatedTokens,
      requests: total.requests,
      upstreamRequests: total.upstreamRequests,
      costedRequests: total.costedRequests
    };
    if (total.costedRequests > 0) usage.costUsd = total.costUsd;
    if (total.coveredFrom !== void 0) usage.coveredFrom = total.coveredFrom;
    result[providerId] = usage;
  }
  return result;
}
function aggregateModelTokenUsage(days, window2, now = Date.now()) {
  const totals = {};
  for (const key of windowDayKeys(days, window2, now)) {
    const byModel = days[key]?.byModel;
    if (byModel === void 0) continue;
    for (const [modelKey, usage] of Object.entries(byModel)) {
      const total = totals[modelKey] ?? {
        providerId: usage.providerId,
        model: usage.model,
        requests: 0,
        upstreamRequests: 0,
        promptTokens: 0,
        cacheReadTokens: 0,
        cacheReportedRequests: 0,
        promptWithCache: 0
      };
      total.requests += usage.requests;
      total.upstreamRequests += usage.upstreamRequests;
      total.promptTokens += usage.upstreamPrompt;
      total.cacheReadTokens += usage.upstreamCacheRead;
      total.cacheReportedRequests += usage.cacheReportedRequests;
      total.promptWithCache += usage.upstreamPromptWithCache;
      if (total.coveredFrom === void 0 || compareDayKeys(key, total.coveredFrom) < 0) {
        total.coveredFrom = key;
      }
      totals[modelKey] = total;
    }
  }
  return totals;
}
function aggregateModelCoverage(days, window2, now = Date.now()) {
  let totalRequests = 0;
  let detailedRequests = 0;
  let coveredFrom;
  for (const key of windowDayKeys(days, window2, now)) {
    const bucket = days[key];
    totalRequests += bucket?.requests ?? 0;
    const byModel = bucket?.byModel;
    if (byModel === void 0) continue;
    if (coveredFrom === void 0) coveredFrom = key;
    for (const usage of Object.values(byModel)) {
      detailedRequests += usage.requests;
    }
  }
  return {
    totalRequests,
    detailedRequests: Math.min(detailedRequests, totalRequests),
    ...coveredFrom === void 0 ? {} : { coveredFrom }
  };
}
const EMPTY_PROVIDER_CARD = { meta: [], days: {}, tokenDays: {} };
const providerStatsOf = (inputs, window2) => {
  const usage = aggregateProviderUsage(inputs.days, window2);
  const tokenUsage = aggregateProviderTokenUsage(inputs.tokenDays, window2);
  return inputs.meta.map((meta) => {
    const counted = usage[meta.id];
    return {
      ...meta,
      requestCount: counted?.requests ?? 0,
      successRate: counted?.successRate,
      avgLatencyMs: counted?.avgLatencyMs,
      coveredFrom: counted?.coveredFrom,
      tokens: tokenUsage[meta.id]
    };
  });
};
const convertLogsToActivities = (logs, providers) => {
  return logs.slice(0, 10).map((log) => {
    const provider = log.providerId ? providers.find((p) => p.id === log.providerId) : void 0;
    let type = "info";
    if (log.level === "error") type = "error";
    else if (log.level === "warn") type = "warning";
    else if (log.level === "info" && log.message.includes("success")) type = "success";
    return {
      id: log.id,
      type,
      title: log.message,
      description: log.data ? JSON.stringify(log.data).slice(0, 100) : void 0,
      timestamp: log.timestamp,
      providerName: provider?.name,
      modelName: log.data?.model
    };
  });
};
const clientLabelOf = (client) => {
  if (!client?.label) return void 0;
  return client.version ? `${client.label} ${client.version}` : client.label;
};
const convertRequestLogsToActivities = (logs) => {
  return logs.slice(0, 10).map((log) => {
    return {
      id: log.id,
      type: log.status === "success" ? "success" : "error",
      title: log.model,
      description: log.status === "error" ? log.errorMessage : log.userInput?.slice(0, 100),
      timestamp: log.timestamp,
      providerName: log.providerName,
      modelName: log.model,
      actualModel: log.actualModel,
      accountName: log.accountName,
      clientLabel: clientLabelOf(log.client),
      latency: log.latency,
      statusCode: log.statusCode
    };
  });
};
const useDashboardStore = create((set, get) => ({
  proxyStatus: null,
  statistics: null,
  stats: {
    totalRequests: 0,
    successRate: 0,
    avgLatency: 0,
    activeAccounts: 0,
    requestsTrend: null,
    successRateTrend: null,
    latencyTrend: null,
    accountsTrend: null
  },
  providers: [],
  modelCacheStats: {},
  modelCacheCoverage: { totalRequests: 0, detailedRequests: 0 },
  providerWindow: DEFAULT_PROVIDER_WINDOW,
  providerCard: EMPTY_PROVIDER_CARD,
  activities: [],
  chartData: [],
  tokenUsage: null,
  isLoading: false,
  error: null,
  lastUpdated: null,
  setProxyStatus: (status) => set({ proxyStatus: status }),
  setStatistics: (statistics) => set({ statistics }),
  setTokenUsage: (tokenUsage) => set({ tokenUsage }),
  setStats: (stats) => set((state) => ({ stats: { ...state.stats, ...stats } })),
  setProviders: (providers) => set({ providers }),
  setProviderWindow: (window2) => set((state) => ({
    providerWindow: window2,
    providers: providerStatsOf(state.providerCard, window2),
    modelCacheStats: aggregateModelTokenUsage(state.providerCard.tokenDays, window2),
    modelCacheCoverage: aggregateModelCoverage(state.providerCard.tokenDays, window2)
  })),
  setActivities: (activities) => set({ activities }),
  addActivity: (activity) => set((state) => ({
    activities: [activity, ...state.activities].slice(0, 50)
  })),
  setChartData: (data) => set({ chartData: data }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  refreshData: async () => {
    const { setLoading, setError, setProxyStatus, setStatistics, setTokenUsage, setStats, setProviders, setActivities, setChartData } = get();
    setLoading(true);
    setError(null);
    try {
      const proxyStatusPromise = window.electronAPI?.proxy?.getStatus?.() ?? Promise.resolve(null);
      const statisticsPromise = window.electronAPI?.proxy?.getStatistics?.() ?? Promise.resolve(null);
      const persistentStatsPromise = window.electronAPI?.statistics?.get?.() ?? Promise.resolve(null);
      const providersPromise = window.electronAPI?.providers?.getAll?.() ?? Promise.resolve([]);
      const accountsPromise = window.electronAPI?.accounts?.getAll?.() ?? Promise.resolve([]);
      const providerStatusPromise = window.electronAPI?.providers?.checkAllStatus?.() ?? Promise.resolve({});
      const logsPromise = window.electronAPI?.logs?.get?.({ limit: 10 }) ?? Promise.resolve([]);
      const tokenUsagePromise = window.electronAPI?.statistics?.getTokenUsage?.() ?? Promise.resolve(null);
      const tokenDaysPromise = window.electronAPI?.statistics?.getTokenUsageDays?.() ?? Promise.resolve({});
      const [proxyStatus, statistics, persistentStats, providers, accounts, providerStatuses, logs, tokenUsage, tokenDays] = await Promise.all([
        proxyStatusPromise,
        statisticsPromise,
        persistentStatsPromise,
        providersPromise,
        accountsPromise,
        providerStatusPromise,
        logsPromise,
        tokenUsagePromise,
        tokenDaysPromise
      ]);
      const dailyTrends = persistentStats?.dailyStats ? dailyTrendPoints(persistentStats.dailyStats, 7) : [];
      setProxyStatus(proxyStatus);
      setStatistics(statistics);
      setTokenUsage(tokenUsage);
      const totalRequests = persistentStats?.totalRequests ?? statistics?.totalRequests ?? 0;
      const successRequests = persistentStats?.successRequests ?? statistics?.successRequests ?? 0;
      const successRate = totalRequests > 0 ? Math.round(successRequests / totalRequests * 100) : 0;
      const today = localDayKey(Date.now());
      const todayStats = persistentStats?.dailyStats?.[today];
      const avgLatency = todayStats && todayStats.successRequests > 0 ? Math.round(todayStats.totalLatency / todayStats.successRequests) : successRequests > 0 ? Math.round((persistentStats?.totalLatency ?? 0) / successRequests) : Math.round(statistics?.avgLatency ?? 0);
      const activeAccounts = accounts?.filter((a) => a.status === "active").length ?? 0;
      const yesterday = recentLocalDays(2)[0].key;
      const todayTrend = dailyTrends.find((point) => point.date === today);
      const yesterdayTrend = dailyTrends.find((point) => point.date === yesterday);
      const todayCounts = dayCountsOf(todayTrend);
      const yesterdayCounts = dayCountsOf(yesterdayTrend);
      const requestsTrend = percentChange(todayCounts.requests, yesterdayCounts.requests);
      const successRateTrend = differenceInPoints(successRateOf(todayCounts), successRateOf(yesterdayCounts));
      const latencyTrend = percentChange(todayCounts.avgLatency || null, yesterdayCounts.avgLatency || null);
      setStats({
        totalRequests,
        successRate,
        avgLatency,
        activeAccounts,
        requestsTrend,
        successRateTrend,
        latencyTrend
      });
      const requestLogsPromise = window.electronAPI?.requestLogs?.get?.({ limit: 100 }) ?? Promise.resolve([]);
      const requestLogs = await requestLogsPromise;
      const providerCard = {
        meta: (providers ?? []).map((provider) => {
          const check = providerStatuses?.[provider.id];
          return {
            id: provider.id,
            name: provider.name,
            status: check?.status ?? provider.status ?? "unknown",
            latency: check?.latency
          };
        }),
        days: persistentStats?.dailyStats ?? {},
        tokenDays: tokenDays ?? {}
      };
      set({ providerCard });
      setProviders(providerStatsOf(providerCard, get().providerWindow));
      set({ modelCacheStats: aggregateModelTokenUsage(providerCard.tokenDays, get().providerWindow) });
      set({ modelCacheCoverage: aggregateModelCoverage(providerCard.tokenDays, get().providerWindow) });
      const recentRequestLogs = requestLogs.slice(0, 10);
      if (recentRequestLogs && recentRequestLogs.length > 0) {
        setActivities(convertRequestLogsToActivities(recentRequestLogs));
      } else {
        setActivities(convertLogsToActivities(logs, providers ?? []));
      }
      setChartData(dailyTrends.map((point) => ({
        time: point.date.slice(5),
        requests: point.total,
        success: point.success,
        failed: point.error
      })));
      set({ lastUpdated: Date.now() });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to fetch data");
      setStats({
        totalRequests: 0,
        successRate: 0,
        avgLatency: 0,
        activeAccounts: 0,
        requestsTrend: null,
        successRateTrend: null,
        latencyTrend: null,
        accountsTrend: null
      });
      setActivities([]);
      setChartData([]);
    } finally {
      setLoading(false);
    }
  }
}));
function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    proxyStatus,
    stats,
    providers,
    providerWindow,
    activities,
    chartData,
    tokenUsage,
    modelCacheStats,
    modelCacheCoverage,
    isLoading,
    error,
    lastUpdated,
    refreshData,
    setProviderWindow
  } = useDashboardStore();
  const { setProxyEnabled } = useSettingsStore();
  const hasLoadedRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      refreshData();
    }
  }, []);
  reactExports.useEffect(() => {
    const interval = setInterval(() => {
      useDashboardStore.getState().refreshData();
    }, 6e4);
    return () => clearInterval(interval);
  }, []);
  reactExports.useEffect(() => {
    if (proxyStatus) {
      setProxyEnabled(proxyStatus.isRunning);
    }
  }, [proxyStatus, setProxyEnabled]);
  reactExports.useEffect(() => {
    if (!window.electronAPI?.proxy?.onStatusChanged) return;
    const unsubscribe = window.electronAPI.proxy.onStatusChanged((status) => {
      useDashboardStore.getState().setProxyStatus(status);
      setProxyEnabled(status.isRunning);
    });
    return unsubscribe;
  }, [setProxyEnabled]);
  const handleAddAccount = reactExports.useCallback(() => {
    navigate("/providers");
  }, [navigate]);
  const handleViewLogs = reactExports.useCallback(() => {
    navigate("/logs");
  }, [navigate]);
  const handleOpenProxy = reactExports.useCallback(() => {
    navigate("/proxy");
  }, [navigate]);
  const handleActivityClick = reactExports.useCallback((item) => {
    navigate("/logs?highlight=" + item.id);
  }, [navigate]);
  const isElectron = !!window.electronAPI;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      PageHeader,
      {
        title: t("dashboard.title"),
        description: t("dashboard.description"),
        actions: /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          lastUpdated && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-meta text-[var(--text-dim)]", children: [
            t("dashboard.lastUpdated"),
            ": ",
            new Date(lastUpdated).toLocaleTimeString()
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", size: "sm", onClick: refreshData, disabled: isLoading, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: cn("h-4 w-4", isLoading && "animate-spin") }),
            t("dashboard.refresh")
          ] })
        ] })
      }
    ),
    !isElectron && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "alert-warning mb-4 px-4 py-3 text-body", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-medium", children: t("dashboard.browserMode") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-0.5 text-[var(--text-muted)]", children: t("dashboard.browserModeDesc") })
    ] }),
    error && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "alert-error mb-4 flex items-start gap-2 px-4 py-3 text-body", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "mt-0.5 h-4 w-4 shrink-0 text-error" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: error })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-4 md:grid-cols-2 lg:grid-cols-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        StatsCard,
        {
          title: t("dashboard.totalRequests"),
          value: stats.totalRequests.toLocaleString(),
          icon: Activity,
          trend: {
            value: stats.requestsTrend,
            label: t("dashboard.vsYesterday")
          }
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        StatsCard,
        {
          title: t("dashboard.successRate"),
          value: `${stats.successRate}%`,
          icon: CircleCheckBig,
          trend: {
            value: stats.successRateTrend,
            label: t("dashboard.vsYesterday")
          }
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        StatsCard,
        {
          title: t("dashboard.avgResponseTime"),
          value: `${stats.avgLatency}ms`,
          icon: Clock,
          trendPolarity: "negative",
          trend: {
            value: stats.latencyTrend,
            label: t("dashboard.vsYesterday")
          }
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 grid gap-4 lg:grid-cols-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "cursor-pointer", onClick: handleAddAccount, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        StatsCard,
        {
          className: "flex h-full flex-col justify-center",
          title: t("dashboard.activeAccountCount"),
          value: stats.activeAccounts,
          icon: Users,
          trend: {
            value: stats.accountsTrend,
            label: t("dashboard.vsYesterday")
          }
        }
      ) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "lg:col-span-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx(TokenUsageCard, { className: "h-full", usage: tokenUsage }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 grid gap-4 lg:grid-cols-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "lg:col-span-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx(RequestChart, { data: chartData }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        QuickActions,
        {
          onAddAccount: handleAddAccount,
          onViewLogs: handleViewLogs,
          onOpenProxy: handleOpenProxy
        }
      ) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 grid items-stretch gap-4 lg:grid-cols-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        ProviderStatusCard,
        {
          providers,
          statsWindow: providerWindow,
          onWindowChange: setProviderWindow
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(RecentActivity, { activities, onItemClick: handleActivityClick })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-4", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      ModelCacheCard,
      {
        stats: modelCacheStats,
        coverage: modelCacheCoverage,
        statsWindow: providerWindow,
        onWindowChange: setProviderWindow
      }
    ) })
  ] });
}
export {
  Dashboard
};
