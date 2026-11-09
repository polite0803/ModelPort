import { j as jsxRuntimeExports } from "./index-Dmiad-IP.js";
import { C as ChevronLeft } from "./chevron-left-DjwtYoGs.js";
function PageHeader({
  title,
  description,
  actions,
  onBack,
  backLabel
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "mb-5 space-y-3", children: [
    onBack && /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "page-back", onClick: onBack, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronLeft, { className: "h-4 w-4" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: backLabel })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 space-y-1", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "page-title truncate", children: title }),
        description && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "page-description max-w-2xl", children: description })
      ] }),
      actions && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex shrink-0 flex-wrap items-center gap-2", children: actions })
    ] })
  ] });
}
export {
  PageHeader as P
};
