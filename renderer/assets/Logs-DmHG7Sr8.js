import { c as createLucideIcon, r as reactExports, j as jsxRuntimeExports, u as useTranslation, f as useSettingsStore, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, B as Button, S as Server, Z as Zap, C as Check, y as Copy, F as FileText, J as DialogDescription, K as DialogFooter, a5 as useSearchParams } from "./index-Dmiad-IP.js";
import { C as Card, c as CardContent } from "./card-CJejDjrN.js";
import { B as Badge } from "./badge-CrPFCp-Q.js";
import { S as Select, d as SelectTrigger, e as SelectValue, f as SelectContent, g as SelectItem, T as Trash2 } from "./select-DfPABgRe.js";
import { T as Tabs, a as TabsList, b as TabsTrigger, d as TabsContent } from "./tabs-Cs4ul3yp.js";
import { D as Download } from "./download-bdv0hDXt.js";
import { U as User } from "./user-DI5gSxfj.js";
import { C as CircleAlert } from "./circle-alert-BOs73daR.js";
import { C as Clock, T as TrendingUp, A as Activity } from "./trending-up-BnM90KHz.js";
import { G as Globe } from "./globe-Cj-vljgr.js";
import { C as CircleCheckBig } from "./circle-check-big-DAvcYbdn.js";
import { C as CircleX } from "./circle-x-CO4cGxfI.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Brain = createLucideIcon("Brain", [
  [
    "path",
    {
      d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
      key: "l5xja"
    }
  ],
  [
    "path",
    {
      d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
      key: "ep3f8r"
    }
  ],
  ["path", { d: "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4", key: "1p4c4q" }],
  ["path", { d: "M17.599 6.5a3 3 0 0 0 .399-1.375", key: "tmeiqw" }],
  ["path", { d: "M6.003 5.125A3 3 0 0 0 6.401 6.5", key: "105sqy" }],
  ["path", { d: "M3.477 10.896a4 4 0 0 1 .585-.396", key: "ql3yin" }],
  ["path", { d: "M19.938 10.5a4 4 0 0 1 .585.396", key: "1qfode" }],
  ["path", { d: "M6 18a4 4 0 0 1-1.967-.516", key: "2e4loj" }],
  ["path", { d: "M19.967 17.484A4 4 0 0 1 18 18", key: "159ez6" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const FileJson = createLucideIcon("FileJson", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  [
    "path",
    { d: "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1", key: "1oajmo" }
  ],
  [
    "path",
    { d: "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1", key: "mpwhp6" }
  ]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const SlidersHorizontal = createLucideIcon("SlidersHorizontal", [
  ["line", { x1: "21", x2: "14", y1: "4", y2: "4", key: "obuewd" }],
  ["line", { x1: "10", x2: "3", y1: "4", y2: "4", key: "1q6298" }],
  ["line", { x1: "21", x2: "12", y1: "12", y2: "12", key: "1iu8h1" }],
  ["line", { x1: "8", x2: "3", y1: "12", y2: "12", key: "ntss68" }],
  ["line", { x1: "21", x2: "16", y1: "20", y2: "20", key: "14d8ph" }],
  ["line", { x1: "12", x2: "3", y1: "20", y2: "20", key: "m0wm8r" }],
  ["line", { x1: "14", x2: "14", y1: "2", y2: "6", key: "14e1ph" }],
  ["line", { x1: "8", x2: "8", y1: "10", y2: "14", key: "1i6ji0" }],
  ["line", { x1: "16", x2: "16", y1: "18", y2: "22", key: "1lctlv" }]
]);
const q = typeof window < "u" ? reactExports.useLayoutEffect : reactExports.useEffect;
function ie(e) {
  if (e !== void 0)
    switch (typeof e) {
      case "number":
        return e;
      case "string": {
        if (e.endsWith("px"))
          return parseFloat(e);
        break;
      }
    }
}
function be({
  box: e,
  defaultHeight: t,
  defaultWidth: s,
  disabled: r,
  element: n,
  mode: o,
  style: i
}) {
  const { styleHeight: f, styleWidth: l } = reactExports.useMemo(
    () => ({
      styleHeight: ie(i?.height),
      styleWidth: ie(i?.width)
    }),
    [i?.height, i?.width]
  ), [c, d] = reactExports.useState({
    height: t,
    width: s
  }), a = r || f !== void 0 || o === "only-width" || f !== void 0 && l !== void 0;
  return q(() => {
    if (n === null || a)
      return;
    const h = new ResizeObserver((p) => {
      for (const I of p) {
        const { contentRect: u, target: w } = I;
        n === w && d((m) => m.height === u.height && m.width === u.width ? m : {
          height: u.height,
          width: u.width
        });
      }
    });
    return h.observe(n, { box: e }), () => {
      h?.unobserve(n);
    };
  }, [e, a, n, f, l]), reactExports.useMemo(
    () => ({
      height: f ?? c.height,
      width: l ?? c.width
    }),
    [c, f, l]
  );
}
function ae(e) {
  const t = reactExports.useRef(() => {
    throw new Error("Cannot call during render.");
  });
  return q(() => {
    t.current = e;
  }, [e]), reactExports.useCallback((s) => t.current?.(s), [t]);
}
function Z({
  containerElement: e,
  direction: t,
  isRtl: s,
  scrollOffset: r
}) {
  return r;
}
function L(e, t = "Assertion error") {
  if (!e)
    throw console.error(t), Error(t);
}
function Y(e, t) {
  if (e === t)
    return true;
  if (!!e != !!t || (L(e !== void 0), L(t !== void 0), Object.keys(e).length !== Object.keys(t).length))
    return false;
  for (const s in e)
    if (!Object.is(t[s], e[s]))
      return false;
  return true;
}
function fe({
  cachedBounds: e,
  itemCount: t,
  itemSize: s
}) {
  if (t === 0)
    return 0;
  if (typeof s == "number")
    return t * s;
  {
    const r = e.get(
      e.size === 0 ? 0 : e.size - 1
    );
    L(r !== void 0, "Unexpected bounds cache miss");
    const n = (r.scrollOffset + r.size) / e.size;
    return t * n;
  }
}
function we({
  align: e,
  cachedBounds: t,
  index: s,
  itemCount: r,
  itemSize: n,
  containerScrollOffset: o,
  containerSize: i
}) {
  if (s < 0 || s >= r)
    throw RangeError(`Invalid index specified: ${s}`, {
      cause: `Index ${s} is not within the range of 0 - ${r - 1}`
    });
  const f = fe({
    cachedBounds: t,
    itemCount: r,
    itemSize: n
  }), l = t.get(s), c = Math.max(
    0,
    Math.min(f - i, l.scrollOffset)
  ), d = Math.max(
    0,
    l.scrollOffset - i + l.size
  );
  switch (e === "smart" && (o >= d && o <= c ? e = "auto" : e = "center"), e) {
    case "start":
      return c;
    case "end":
      return d;
    case "center":
      return l.scrollOffset <= i / 2 ? 0 : l.scrollOffset + l.size / 2 >= f - i / 2 ? f - i : l.scrollOffset + l.size / 2 - i / 2;
    case "auto":
    default:
      return o >= d && o <= c ? o : o < d ? d : c;
  }
}
function P({
  cachedBounds: e,
  containerScrollOffset: t,
  containerSize: s,
  itemCount: r,
  overscanCount: n
}) {
  const o = r - 1;
  let i = 0, f = -1, l = 0, c = -1, d = 0;
  for (; d < o; ) {
    const a = e.get(d);
    if (a.scrollOffset + a.size > t)
      break;
    d++;
  }
  for (i = d, l = Math.max(0, i - n); d < o; ) {
    const a = e.get(d);
    if (a.scrollOffset + a.size >= t + s)
      break;
    d++;
  }
  return f = Math.min(o, d), c = Math.min(r - 1, f + n), i < 0 && (i = 0, f = -1, l = 0, c = -1), {
    startIndexVisible: i,
    stopIndexVisible: f,
    startIndexOverscan: l,
    stopIndexOverscan: c
  };
}
function me({
  itemCount: e,
  itemProps: t,
  itemSize: s
}) {
  const r = /* @__PURE__ */ new Map();
  return {
    get(n) {
      for (L(n < e, `Invalid index ${n}`); r.size - 1 < n; ) {
        const i = r.size;
        let f;
        switch (typeof s) {
          case "function": {
            f = s(i, t);
            break;
          }
          case "number": {
            f = s;
            break;
          }
        }
        if (i === 0)
          r.set(i, {
            size: f,
            scrollOffset: 0
          });
        else {
          const l = r.get(i - 1);
          L(
            l !== void 0,
            `Unexpected bounds cache miss for index ${n}`
          ), r.set(i, {
            scrollOffset: l.scrollOffset + l.size,
            size: f
          });
        }
      }
      const o = r.get(n);
      return L(
        o !== void 0,
        `Unexpected bounds cache miss for index ${n}`
      ), o;
    },
    set(n, o) {
      r.set(n, o);
    },
    get size() {
      return r.size;
    }
  };
}
function Oe({
  itemCount: e,
  itemProps: t,
  itemSize: s
}) {
  return reactExports.useMemo(
    () => me({
      itemCount: e,
      itemProps: t,
      itemSize: s
    }),
    [e, t, s]
  );
}
function ye({
  containerSize: e,
  itemSize: t
}) {
  let s;
  switch (typeof t) {
    case "string": {
      L(
        t.endsWith("%"),
        `Invalid item size: "${t}"; string values must be percentages (e.g. "100%")`
      ), L(
        e !== void 0,
        "Container size must be defined if a percentage item size is specified"
      ), s = e * parseInt(t) / 100;
      break;
    }
    default: {
      s = t;
      break;
    }
  }
  return s;
}
function te({
  containerElement: e,
  containerStyle: t,
  defaultContainerSize: s = 0,
  direction: r,
  isRtl: n = false,
  itemCount: o,
  itemProps: i,
  itemSize: f,
  onResize: l,
  overscanCount: c
}) {
  const { height: d = s, width: a = s } = be({
    defaultHeight: s,
    defaultWidth: void 0,
    element: e,
    mode: "only-height",
    style: t
  }), h = reactExports.useRef({
    height: 0,
    width: 0
  }), p = d, I = ye({ containerSize: p, itemSize: f });
  reactExports.useLayoutEffect(() => {
    if (typeof l == "function") {
      const g = h.current;
      (g.height !== d || g.width !== a) && (l({ height: d, width: a }, { ...g }), g.height = d, g.width = a);
    }
  }, [d, l, a]);
  const u = Oe({
    itemCount: o,
    itemProps: i,
    itemSize: I
  }), w = reactExports.useCallback(
    (g) => u.get(g),
    [u]
  ), [m, O] = reactExports.useState(
    () => P({
      cachedBounds: u,
      // TODO Potentially support a defaultScrollOffset prop?
      containerScrollOffset: 0,
      containerSize: p,
      itemCount: o,
      overscanCount: c
    })
  ), {
    startIndexVisible: G,
    startIndexOverscan: x,
    stopIndexVisible: F,
    stopIndexOverscan: V
  } = {
    startIndexVisible: Math.min(o - 1, m.startIndexVisible),
    startIndexOverscan: Math.min(o - 1, m.startIndexOverscan),
    stopIndexVisible: Math.min(o - 1, m.stopIndexVisible),
    stopIndexOverscan: Math.min(o - 1, m.stopIndexOverscan)
  }, z = reactExports.useCallback(
    () => fe({
      cachedBounds: u,
      itemCount: o,
      itemSize: I
    }),
    [u, o, I]
  ), $ = reactExports.useCallback(
    (g) => {
      const S = Z({
        containerElement: e,
        direction: r,
        isRtl: n,
        scrollOffset: g
      });
      return P({
        cachedBounds: u,
        containerScrollOffset: S,
        containerSize: p,
        itemCount: o,
        overscanCount: c
      });
    },
    [
      u,
      e,
      p,
      r,
      n,
      o,
      c
    ]
  );
  q(() => {
    const g = e?.scrollTop ?? 0;
    O($(g));
  }, [e, r, $]), q(() => {
    if (!e)
      return;
    const g = () => {
      O((S) => {
        const { scrollLeft: E, scrollTop: b } = e, v = Z({
          containerElement: e,
          direction: r,
          isRtl: n,
          scrollOffset: b
        }), R = P({
          cachedBounds: u,
          containerScrollOffset: v,
          containerSize: p,
          itemCount: o,
          overscanCount: c
        });
        return Y(R, S) ? S : R;
      });
    };
    return e.addEventListener("scroll", g), () => {
      e.removeEventListener("scroll", g);
    };
  }, [
    u,
    e,
    p,
    r,
    o,
    c
  ]);
  const y = ae(
    ({
      align: g = "auto",
      containerScrollOffset: S,
      index: E
    }) => {
      let b = we({
        align: g,
        cachedBounds: u,
        containerScrollOffset: S,
        containerSize: p,
        index: E,
        itemCount: o,
        itemSize: I
      });
      if (e) {
        if (b = Z({
          containerElement: e,
          direction: r,
          isRtl: n,
          scrollOffset: b
        }), typeof e.scrollTo != "function") {
          const v = $(b);
          Y(m, v) || O(v);
        }
        return b;
      }
    }
  );
  return {
    getCellBounds: w,
    getEstimatedSize: z,
    scrollToIndex: y,
    startIndexOverscan: x,
    startIndexVisible: G,
    stopIndexOverscan: V,
    stopIndexVisible: F
  };
}
function de(e) {
  return reactExports.useMemo(() => e, Object.values(e));
}
function ue(e, t) {
  const {
    ariaAttributes: s,
    style: r,
    ...n
  } = e, {
    ariaAttributes: o,
    style: i,
    ...f
  } = t;
  return Y(s, o) && Y(r, i) && Y(n, f);
}
function ze(e) {
  return e != null && typeof e == "object" && "getAverageRowHeight" in e && typeof e.getAverageRowHeight == "function";
}
const se = "data-react-window-index";
function Ae({
  children: e,
  className: t,
  defaultHeight: s = 0,
  listRef: r,
  onResize: n,
  onRowsRendered: o,
  overscanCount: i = 3,
  rowComponent: f,
  rowCount: l,
  rowHeight: c,
  rowProps: d,
  tagName: a = "div",
  style: h,
  ...p
}) {
  const I = de(d), u = reactExports.useMemo(
    () => reactExports.memo(f, ue),
    [f]
  ), [w, m] = reactExports.useState(null), O = ze(c), G = reactExports.useMemo(() => O ? (b) => c.getRowHeight(b) ?? c.getAverageRowHeight() : c, [O, c]), {
    getCellBounds: x,
    getEstimatedSize: F,
    scrollToIndex: V,
    startIndexOverscan: z,
    startIndexVisible: $,
    stopIndexOverscan: y,
    stopIndexVisible: g
  } = te({
    containerElement: w,
    containerStyle: h,
    defaultContainerSize: s,
    direction: "vertical",
    itemCount: l,
    itemProps: I,
    itemSize: G,
    onResize: n,
    overscanCount: i
  });
  reactExports.useImperativeHandle(
    r,
    () => ({
      get element() {
        return w;
      },
      scrollToRow({
        align: b = "auto",
        behavior: v = "auto",
        index: R
      }) {
        const k = V({
          align: b,
          containerScrollOffset: w?.scrollTop ?? 0,
          index: R
        });
        typeof w?.scrollTo == "function" && w.scrollTo({
          behavior: v,
          top: k
        });
      }
    }),
    [w, V]
  ), q(() => {
    if (!w)
      return;
    const b = Array.from(w.children).filter((v, R) => {
      if (v.hasAttribute("aria-hidden"))
        return false;
      const k = `${z + R}`;
      return v.setAttribute(se, k), true;
    });
    if (O)
      return c.observeRowElements(b);
  }, [
    w,
    O,
    c,
    z,
    y
  ]), reactExports.useEffect(() => {
    z >= 0 && y >= 0 && o && o(
      {
        startIndex: $,
        stopIndex: g
      },
      {
        startIndex: z,
        stopIndex: y
      }
    );
  }, [
    o,
    z,
    $,
    y,
    g
  ]);
  const S = reactExports.useMemo(() => {
    const b = [];
    if (l > 0)
      for (let v = z; v <= y; v++) {
        const R = x(v);
        b.push(
          /* @__PURE__ */ reactExports.createElement(
            u,
            {
              ...I,
              ariaAttributes: {
                "aria-posinset": v + 1,
                "aria-setsize": l,
                role: "listitem"
              },
              key: v,
              index: v,
              style: {
                position: "absolute",
                left: 0,
                transform: `translateY(${R.scrollOffset}px)`,
                // In case of dynamic row heights, don't specify a height style
                // otherwise a default/estimated height would mask the actual height
                height: O ? void 0 : R.size,
                width: "100%"
              }
            }
          )
        );
      }
    return b;
  }, [
    u,
    x,
    O,
    l,
    I,
    z,
    y
  ]), E = /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      "aria-hidden": true,
      style: {
        height: F(),
        width: "100%",
        zIndex: -1
      }
    }
  );
  return reactExports.createElement(
    a,
    {
      role: "list",
      ...p,
      className: t,
      ref: m,
      style: {
        position: "relative",
        maxHeight: "100%",
        flexGrow: 1,
        overflowY: "auto",
        ...h
      }
    },
    S,
    e,
    E
  );
}
function CopyButton({ text, className = "" }) {
  const { t } = useTranslation();
  const [copied, setCopied] = reactExports.useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    Button,
    {
      variant: "ghost",
      size: "sm",
      onClick: handleCopy,
      className: `h-7 px-2 text-xs gap-1.5 hover:bg-muted/80 transition-all ${className}`,
      children: copied ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Check, { className: "h-3.5 w-3.5 text-success" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-success", children: t("common.copied") })
      ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Copy, { className: "h-3.5 w-3.5" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("common.copy") })
      ] })
    }
  );
}
function SectionHeader({ title, icon, copyText }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between mb-3", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
      icon && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: icon }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm font-semibold text-foreground", children: title })
    ] }),
    copyText && /* @__PURE__ */ jsxRuntimeExports.jsx(CopyButton, { text: copyText })
  ] });
}
function InfoItem({ label, value, icon }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-1 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5 text-xs text-muted-foreground", children: [
      icon,
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: label })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-sm font-medium break-all", children: value })
  ] });
}
function RequestLogDetail({ log, onClose }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = reactExports.useState("info");
  const [savingBundle, setSavingBundle] = reactExports.useState(false);
  const includeBodies = useSettingsStore((state) => state.config?.requestLogConfig?.includeBodies);
  const fetchConfig = useSettingsStore((state) => state.fetchConfig);
  reactExports.useEffect(() => {
    if (includeBodies === void 0) {
      void fetchConfig();
    }
  }, [includeBodies, fetchConfig]);
  const formatTime2 = (timestamp) => {
    return new Date(timestamp).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  };
  const formatLatency2 = (ms) => {
    if (ms < 1e3) return `${ms}ms`;
    return `${(ms / 1e3).toFixed(2)}s`;
  };
  const getStatusColor2 = (status) => {
    return status === "success" ? "badge-success hover:opacity-80" : "badge-error hover:opacity-80";
  };
  const handleSaveBundle = async () => {
    if (savingBundle) return;
    setSavingBundle(true);
    try {
      await window.electronAPI?.requestLogs?.saveBundle(log.id);
    } catch (error) {
      console.error("Failed to save diagnostic bundle:", error);
    } finally {
      setSavingBundle(false);
    }
  };
  const renderJsonViewer = (jsonString) => {
    if (!jsonString) {
      if (includeBodies === false) {
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center py-12 text-muted-foreground text-center px-6", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SlidersHorizontal, { className: "h-12 w-12 mb-3 opacity-30" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm font-medium text-foreground", children: t("logs.bodiesNotRecorded") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs mt-1.5 max-w-md leading-relaxed", children: t("logs.bodiesNotRecordedHint") })
        ] });
      }
      return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center py-12 text-muted-foreground", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(FileJson, { className: "h-12 w-12 mb-3 opacity-30" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm", children: t("logs.noRequestData") })
      ] });
    }
    try {
      const parsed = JSON.parse(jsonString);
      const formatted = JSON.stringify(parsed, null, 2);
      return /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "text-xs bg-muted/50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-all border border-border/50", children: formatted });
    } catch {
      return /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "text-xs bg-muted/50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-all border border-border/50", children: jsonString });
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: true, onOpenChange: onClose, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-3xl w-[90vw] h-[85vh] max-h-[800px] p-0 flex flex-col overflow-hidden bg-background/95 backdrop-blur-sm", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(DialogHeader, { className: "px-6 pt-6 pb-4 shrink-0 border-b border-border/50", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogTitle, { className: "flex items-center gap-3 flex-wrap text-base", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Badge,
        {
          variant: "outline",
          className: `${getStatusColor2(log.status)} font-semibold px-2.5 py-0.5`,
          children: log.statusCode
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "break-all font-mono text-sm", children: log.model }),
      log.actualModel && log.actualModel !== log.model && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-sm text-muted-foreground font-normal break-all", children: [
        "→ ",
        log.actualModel
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        Button,
        {
          variant: "outline",
          size: "sm",
          className: "ml-auto h-8",
          onClick: handleSaveBundle,
          disabled: savingBundle,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Download, { className: "h-3.5 w-3.5 mr-1.5" }),
            t("logs.saveDiagnosticBundle")
          ]
        }
      )
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Tabs, { value: activeTab, onValueChange: setActiveTab, className: "flex-1 flex flex-col min-h-0 overflow-hidden", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "px-6 pt-4 shrink-0 overflow-hidden", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsList, { className: "grid w-full grid-cols-5 bg-muted/50 p-1 rounded-lg", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          TabsTrigger,
          {
            value: "info",
            className: "text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(FileJson, { className: "h-3.5 w-3.5 mr-1.5" }),
              t("logs.tabInfo")
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          TabsTrigger,
          {
            value: "request",
            className: "text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Server, { className: "h-3.5 w-3.5 mr-1.5" }),
              t("logs.tabRequest")
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          TabsTrigger,
          {
            value: "response",
            className: "text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(FileJson, { className: "h-3.5 w-3.5 mr-1.5" }),
              t("logs.tabResponse")
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          TabsTrigger,
          {
            value: "user",
            className: "text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(User, { className: "h-3.5 w-3.5 mr-1.5" }),
              t("logs.tabUserInput")
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          TabsTrigger,
          {
            value: "error",
            className: "text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(CircleAlert, { className: "h-3.5 w-3.5 mr-1.5" }),
              t("logs.tabError")
            ]
          }
        )
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex-1 min-h-0 px-6 py-4 overflow-y-auto", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsContent, { value: "info", className: "mt-0", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.timestamp"),
                value: formatTime2(log.timestamp),
                icon: /* @__PURE__ */ jsxRuntimeExports.jsx(Clock, { className: "h-3 w-3" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.latency"),
                value: formatLatency2(log.latency),
                icon: /* @__PURE__ */ jsxRuntimeExports.jsx(Zap, { className: "h-3 w-3" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.method"),
                value: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-xs bg-muted px-2 py-0.5 rounded", children: log.method })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.url"),
                value: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-xs break-all", children: log.url })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.provider"),
                value: log.providerName || log.providerId || "-"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.account"),
                value: log.accountName || log.accountId || "-"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.stream"),
                value: log.isStream ? t("common.yes") : t("common.no")
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.responseStatus"),
                value: log.responseStatus
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.webSearch"),
                value: log.webSearch ? t("common.enabled") : t("common.disabled"),
                icon: /* @__PURE__ */ jsxRuntimeExports.jsx(Globe, { className: "h-3 w-3" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.reasoningEffort"),
                value: log.reasoningEffort || "-",
                icon: /* @__PURE__ */ jsxRuntimeExports.jsx(Brain, { className: "h-3 w-3" })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.maxTokens"),
                value: log.maxTokens ?? "-"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.finishReason"),
                value: log.finishReason || "-"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.streamTruncated"),
                value: log.streamTruncated === void 0 ? "-" : log.streamTruncated ? t("common.yes") : t("common.no")
              }
            ),
            log.streamTrace?.firstTokenMs !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.streamFirstToken"), value: formatLatency2(log.streamTrace.firstTokenMs) }),
            log.streamTrace?.totalMs !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.duration"), value: formatLatency2(log.streamTrace.totalMs) }),
            log.streamTrace?.bytesOut !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.streamBytes"), value: log.streamTrace.bytesOut.toLocaleString() }),
            log.streamTrace?.endReason !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.streamEndReason"), value: log.streamTrace.endReason }),
            log.streamTrace?.pingCount !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.streamPings"), value: log.streamTrace.pingCount }),
            (log.streamTrace?.upstreamRequestId || log.upstreamRequestId) && /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.upstreamRequestId"),
                value: log.streamTrace?.upstreamRequestId || log.upstreamRequestId
              }
            ),
            log.inputTokensEstimate !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.inputTokensEstimate"),
                value: log.modelContextWindow === void 0 ? log.inputTokensEstimate.toLocaleString() : `${log.inputTokensEstimate.toLocaleString()} / ${log.modelContextWindow.toLocaleString()}`
              }
            ),
            log.contextFit !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(
              InfoItem,
              {
                label: t("logs.contextFit"),
                value: log.contextFitSource === "measured" ? `${t(`logs.contextFit${log.contextFit === "fits" ? "Fits" : log.contextFit === "overflow" ? "Overflow" : "Unknown"}`)} · ${t("logs.contextFitMeasured")}` : t(`logs.contextFit${log.contextFit === "fits" ? "Fits" : log.contextFit === "overflow" ? "Overflow" : "Unknown"}`)
              }
            )
          ] }),
          log.attempts && log.attempts.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-6", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SectionHeader, { title: t("logs.attempts"), icon: /* @__PURE__ */ jsxRuntimeExports.jsx(Server, { className: "h-4 w-4" }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-2", children: log.attempts.map((attempt, index) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-lg border border-border/50 p-3 text-xs space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono font-medium", children: [
                  index + 1,
                  ". ",
                  attempt.providerName || attempt.providerId
                ] }),
                attempt.status !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: attempt.status }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: attempt.outcome }),
                attempt.latencyMs !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: formatLatency2(attempt.latencyMs) }),
                attempt.errorCode !== void 0 && attempt.errorCode !== null && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-muted-foreground", children: String(attempt.errorCode) })
              ] }),
              attempt.errorMessage && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-muted-foreground break-all", children: attempt.errorMessage })
            ] }, `${attempt.providerId}-${attempt.accountId}-${index}`)) })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsContent, { value: "request", className: "mt-0", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SectionHeader,
            {
              title: t("logs.requestBody"),
              icon: /* @__PURE__ */ jsxRuntimeExports.jsx(FileJson, { className: "h-4 w-4" }),
              copyText: log.requestBody || ""
            }
          ),
          renderJsonViewer(log.requestBody)
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsContent, { value: "response", className: "mt-0", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SectionHeader,
            {
              title: t("logs.responseBody"),
              icon: /* @__PURE__ */ jsxRuntimeExports.jsx(FileJson, { className: "h-4 w-4" }),
              copyText: log.responseBody || ""
            }
          ),
          renderJsonViewer(log.responseBody)
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "user", className: "mt-0", children: log.userInput ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SectionHeader,
            {
              title: t("logs.userInput"),
              icon: /* @__PURE__ */ jsxRuntimeExports.jsx(User, { className: "h-4 w-4" }),
              copyText: log.userInput
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "p-4 bg-muted/30 rounded-lg border border-border/50", children: /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "text-sm whitespace-pre-wrap break-all font-sans leading-relaxed", children: log.userInput }) })
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center py-12 text-muted-foreground", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(User, { className: "h-12 w-12 mb-3 opacity-30" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm", children: t("logs.noUserInput") })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "error", className: "mt-0", children: log.errorMessage ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              SectionHeader,
              {
                title: t("logs.errorMessage"),
                icon: /* @__PURE__ */ jsxRuntimeExports.jsx(CircleAlert, { className: "h-4 w-4 text-error" }),
                copyText: log.errorMessage
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "p-4 bg-error-soft rounded-lg", children: /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "text-sm text-error font-medium whitespace-pre-wrap break-all font-sans leading-relaxed", children: log.errorMessage }) })
          ] }),
          (log.errorType || log.errorCode || log.errorParam || log.upstreamStatus !== void 0) && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3", children: [
            log.errorType && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.errorType"), value: log.errorType }),
            log.errorCode !== void 0 && log.errorCode !== null && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.errorCode"), value: String(log.errorCode) }),
            log.errorParam && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.errorParam"), value: log.errorParam }),
            log.upstreamStatus !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(InfoItem, { label: t("logs.upstreamStatus"), value: log.upstreamStatus })
          ] }),
          log.errorStack && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              SectionHeader,
              {
                title: t("logs.stackTrace"),
                icon: /* @__PURE__ */ jsxRuntimeExports.jsx(FileJson, { className: "h-4 w-4" }),
                copyText: log.errorStack
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "text-xs bg-muted/50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-all border border-border/50 font-mono leading-relaxed", children: log.errorStack })
          ] })
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center py-12 text-muted-foreground", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(CircleAlert, { className: "h-12 w-12 mb-3 opacity-30" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm", children: t("logs.noError") })
        ] }) })
      ] })
    ] })
  ] }) });
}
function RequestLogStats({ stats }) {
  const { t } = useTranslation();
  const successRate = stats.todayTotal > 0 ? Math.round(stats.todaySuccess / stats.todayTotal * 100) : 0;
  const statCards = [
    {
      label: t("logs.todayRequests"),
      value: stats.todayTotal,
      icon: TrendingUp
    },
    {
      label: t("logs.todaySuccess"),
      value: stats.todaySuccess,
      icon: CircleCheckBig
    },
    {
      label: t("logs.todayErrors"),
      value: stats.todayError,
      icon: CircleX
    },
    {
      label: t("dashboard.successRate"),
      value: `${successRate}%`,
      icon: Activity
    }
  ];
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid grid-cols-4 gap-4", children: statCards.map((stat, index) => /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { hover: true, className: "p-5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "stat-label", children: stat.label }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(stat.icon, { className: "h-[15px] w-[15px] shrink-0 text-[var(--text-dim)]" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "stat-value mt-2", children: stat.value })
  ] }, index)) });
}
const ITEM_HEIGHT = 72;
const LOG_LIST_LIMIT = 200;
const RECONCILE_INTERVAL_MS = 3e4;
const STATS_REFRESH_DEBOUNCE_MS = 400;
function getStatusColor(status, statusCode) {
  if (status === "success") return "badge-success";
  if (statusCode >= 500) return "badge-error";
  if (statusCode >= 400) return "badge-warning";
  return "badge-error";
}
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
function formatLatency(ms) {
  if (ms < 1e3) return `${ms}ms`;
  return `${(ms / 1e3).toFixed(2)}s`;
}
function RequestLogList({ highlightId }) {
  const { t } = useTranslation();
  const [logs, setLogs] = reactExports.useState([]);
  const [stats, setStats] = reactExports.useState(null);
  const [selectedLog, setSelectedLog] = reactExports.useState(null);
  const [statusFilter, setStatusFilter] = reactExports.useState("all");
  const [isLoading, setIsLoading] = reactExports.useState(true);
  const [showClearDialog, setShowClearDialog] = reactExports.useState(false);
  const logsRef = reactExports.useRef([]);
  const containerRef = reactExports.useRef(null);
  const consumedHighlightRef = reactExports.useRef(null);
  const [containerSize, setContainerSize] = reactExports.useState({ width: 800, height: 400 });
  const fetchLogs = reactExports.useCallback(async () => {
    try {
      const filter = statusFilter === "all" ? {} : { status: statusFilter };
      const result = await window.electronAPI?.requestLogs?.get({ ...filter, limit: LOG_LIST_LIMIT });
      if (result) {
        if (JSON.stringify(result) !== JSON.stringify(logsRef.current)) {
          logsRef.current = result;
          setLogs(result);
        }
      }
    } catch (error) {
      console.error("Failed to fetch request logs:", error);
    }
  }, [statusFilter]);
  const fetchStats = reactExports.useCallback(async () => {
    try {
      const result = await window.electronAPI?.requestLogs?.getStats();
      if (result) {
        setStats(result);
      }
    } catch (error) {
      console.error("Failed to fetch request log stats:", error);
    }
  }, []);
  const refreshLogs = reactExports.useCallback(async () => {
    await Promise.all([fetchLogs(), fetchStats()]);
  }, [fetchLogs, fetchStats]);
  const statsTimerRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    setIsLoading(true);
    refreshLogs().finally(() => setIsLoading(false));
  }, [refreshLogs]);
  reactExports.useEffect(() => {
    const unsubscribe = window.electronAPI?.requestLogs?.onNewLog?.((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) {
        return;
      }
      logsRef.current = [log, ...logsRef.current.filter((entry) => entry.id !== log.id)].slice(0, LOG_LIST_LIMIT);
      setLogs(logsRef.current);
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current);
      statsTimerRef.current = setTimeout(() => {
        statsTimerRef.current = null;
        fetchStats().catch((error) => {
          console.error("Failed to refresh request log stats:", error);
        });
      }, STATS_REFRESH_DEBOUNCE_MS);
    });
    const reconcile = setInterval(() => {
      refreshLogs().catch((error) => {
        console.error("Failed to reconcile request logs:", error);
      });
    }, RECONCILE_INTERVAL_MS);
    return () => {
      unsubscribe?.();
      clearInterval(reconcile);
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current);
    };
  }, [statusFilter, refreshLogs, fetchStats]);
  reactExports.useEffect(() => {
    if (!highlightId || consumedHighlightRef.current === highlightId || logs.length === 0) return;
    const target = logs.find((log) => log.id === highlightId);
    if (target) {
      setSelectedLog(target);
      consumedHighlightRef.current = highlightId;
    }
  }, [highlightId, logs]);
  reactExports.useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: Math.max(100, Math.min(600, logs.length * ITEM_HEIGHT))
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [logs.length]);
  const handleClearLogs = async () => {
    await window.electronAPI?.requestLogs?.clear();
    logsRef.current = [];
    setLogs([]);
    fetchStats();
    setShowClearDialog(false);
  };
  const handleSelectLog = reactExports.useCallback((log) => {
    setSelectedLog(log);
  }, []);
  const RowComponent = reactExports.useCallback(
    ({ index, style, logs: rowLogs, onSelectLog }) => {
      const log = rowLogs[index];
      if (!log) return null;
      return /* @__PURE__ */ jsxRuntimeExports.jsx(
        "div",
        {
          style,
          className: "px-2 pb-2",
          onClick: () => onSelectLog(log),
          children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors h-[68px]", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: getStatusColor(log.status, log.statusCode), children: log.statusCode }),
            log.streamTruncated === true && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "badge-warning", title: t("logs.streamTruncated"), children: t("logs.truncatedShort") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex-1 min-w-0", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-sm truncate", children: log.model }),
                log.actualModel && log.actualModel !== log.model && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-xs text-muted-foreground", children: [
                  "→ ",
                  log.actualModel
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground mt-0.5", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: log.providerName || log.providerId }),
                log.accountName && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "·" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: log.accountName })
                ] })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tabular-nums", children: formatLatency(log.latency) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: formatTime(log.timestamp) })
            ] })
          ] })
        }
      );
    },
    [t]
  );
  const rowProps = reactExports.useMemo(() => ({
    logs,
    onSelectLog: handleSelectLog
  }), [logs, handleSelectLog]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col h-full", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between mb-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-lg font-semibold", children: t("logs.requestLogs") }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: statusFilter, onValueChange: (v) => setStatusFilter(v), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "w-32", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, { placeholder: t("logs.filter") }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "all", children: t("logs.all") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "success", children: t("common.success") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "error", children: t("common.error") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", size: "sm", onClick: refreshLogs, children: t("dashboard.refresh") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "destructive", size: "sm", onClick: () => setShowClearDialog(true), children: t("logs.clearLogs") })
      ] })
    ] }),
    stats && /* @__PURE__ */ jsxRuntimeExports.jsx(RequestLogStats, { stats }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { ref: containerRef, className: "flex-1 mt-4", children: isLoading ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-32 items-center justify-center text-[var(--text-muted)]", children: t("common.loading") }) : logs.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty-state-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(FileText, { className: "h-5 w-5" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-title", children: t("logs.noRequestLogs") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-hint", children: t("logs.noRequestLogsHint") })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(
      Ae,
      {
        rowComponent: RowComponent,
        rowCount: logs.length,
        rowHeight: ITEM_HEIGHT,
        rowProps,
        style: {
          width: containerSize.width,
          height: containerSize.height
        },
        className: "scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
      }
    ) }),
    selectedLog && /* @__PURE__ */ jsxRuntimeExports.jsx(RequestLogDetail, { log: selectedLog, onClose: () => setSelectedLog(null) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: showClearDialog, onOpenChange: setShowClearDialog, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogTitle, { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "h-4 w-4 text-destructive" }) }),
          t("logs.clearConfirm")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("logs.clearConfirmDesc") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => setShowClearDialog(false), children: t("common.cancel") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "destructive", onClick: handleClearLogs, children: t("logs.clearLogs") })
      ] })
    ] }) })
  ] });
}
function LogsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight") || void 0;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center justify-between", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-2xl font-bold", children: t("logs.pageTitle") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-muted-foreground", children: t("logs.pageDescription") })
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "pt-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx(RequestLogList, { highlightId }) }) })
  ] });
}
export {
  LogsPage as default
};
