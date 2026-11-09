import { u as useTranslation, j as jsxRuntimeExports, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, J as DialogDescription, K as DialogFooter, B as Button, N as useToast, r as reactExports } from "./index-Dmiad-IP.js";
import { B as Badge } from "./badge-CrPFCp-Q.js";
import { L as Label, I as Input } from "./label-BqQAqSEG.js";
import { S as Select, d as SelectTrigger, e as SelectValue, f as SelectContent, g as SelectItem } from "./select-DfPABgRe.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
const METADATA_ATTRIBUTES = [
  "modelType",
  "vision",
  "tools",
  "reasoning",
  "modalities",
  "contextTokens",
  "maxOutputTokens",
  "weight",
  "free"
];
const ROUTING_METADATA_ATTRIBUTES = [
  "vision",
  "tools",
  "reasoning",
  "modalities",
  "contextTokens",
  "maxOutputTokens"
];
function isAttributeApplicable(attribute, providerType) {
  if (attribute === "weight") return providerType === "account";
  if (attribute === "free") return providerType === "account" || providerType === "aggregate";
  return true;
}
const CATALOG_SOURCES = ["models.dev", "litellm", "openrouter"];
const CATALOG_SOURCE_META = {
  "models.dev": {
    label: "models.dev",
    homepage: "https://models.dev",
    sourceUrl: "https://models.dev/api.json",
    license: "MIT",
    attribution: "models.dev contributors"
  },
  litellm: {
    label: "LiteLLM",
    homepage: "https://github.com/BerriAI/litellm",
    sourceUrl: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    license: "MIT",
    attribution: "BerriAI / LiteLLM"
  },
  openrouter: {
    label: "OpenRouter",
    homepage: "https://openrouter.ai",
    sourceUrl: "https://openrouter.ai/api/v1/models",
    license: "OpenRouter API Terms",
    attribution: "OpenRouter"
  }
};
const CATALOG_ADOPTION_FIELDS = [
  "contextTokens",
  "maxOutputTokens",
  "price",
  "modalities",
  "vision",
  "tools",
  "reasoning"
];
function sanitizeCatalogMirrorUrl(raw) {
  if (typeof raw !== "string") return void 0;
  const value = raw.trim();
  if (value.length === 0) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : void 0;
  } catch {
    return void 0;
  }
}
function catalogFieldValue(entry, field) {
  switch (field) {
    case "contextTokens":
      return entry.contextTokens;
    case "maxOutputTokens":
      return entry.maxOutputTokens;
    case "modalities":
      return entry.modalities;
    case "vision":
      return entry.vision;
    case "tools":
      return entry.tools;
    case "reasoning":
      return entry.reasoning;
    case "price":
      return entry.price;
  }
}
const ATTRIBUTE_LABEL_KEYS = {
  modelType: "models.metadata.attrModelType",
  vision: "models.metadata.attrVision",
  tools: "models.metadata.attrTools",
  reasoning: "models.metadata.attrReasoning",
  modalities: "models.metadata.attrModalities",
  contextTokens: "models.metadata.attrContextTokens",
  maxOutputTokens: "models.metadata.attrMaxOutputTokens",
  weight: "models.metadata.attrWeight",
  free: "models.metadata.attrFree"
};
const SOURCE_LABEL_KEYS = {
  manual: "models.metadata.sourceManual",
  upstream: "models.metadata.sourceUpstream",
  catalog: "models.metadata.sourceCatalog",
  "family-rule": "models.metadata.sourceFamilyRule",
  probe: "models.metadata.sourceProbe",
  "cost-ledger": "models.metadata.sourceCostLedger",
  unclassified: "models.metadata.sourceUnclassified"
};
const CONFIDENCE_LABEL_KEYS = {
  declared: "models.metadata.confidenceDeclared",
  inferred: "models.metadata.confidenceInferred",
  measured: "models.metadata.confidenceMeasured"
};
const SOURCE_TONE = {
  manual: "text-primary",
  upstream: "text-success",
  catalog: "text-info",
  "family-rule": "text-warning",
  probe: "text-info",
  "cost-ledger": "text-muted-foreground"
};
const CATALOG_CONFIDENCE_LABEL_KEYS = {
  exact: "models.metadata.catalogConfidenceExact",
  alias: "models.metadata.catalogConfidenceAlias",
  family: "models.metadata.catalogConfidenceFamily",
  fuzzy: "models.metadata.catalogConfidenceFuzzy"
};
const CATALOG_CONFIDENCE_TONE = {
  exact: "text-success",
  alias: "text-warning",
  family: "text-muted-foreground",
  fuzzy: "text-muted-foreground"
};
const CATALOG_FIELD_LABEL_KEYS = {
  contextTokens: "models.metadata.attrContextTokens",
  maxOutputTokens: "models.metadata.attrMaxOutputTokens",
  price: "models.metadata.catalogFieldPrice",
  modalities: "models.metadata.attrModalities",
  vision: "models.metadata.attrVision",
  tools: "models.metadata.attrTools",
  reasoning: "models.metadata.attrReasoning"
};
function formatCatalogValue(field, value, t) {
  if (field === "price") {
    const price = value;
    if (!price) return "—";
    const parts = [];
    if (price.inputPerMillion !== void 0) parts.push(`in $${price.inputPerMillion}`);
    if (price.outputPerMillion !== void 0) parts.push(`out $${price.outputPerMillion}`);
    return `${parts.join(" · ")} / 1M`;
  }
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(" + ");
  if (value === "yes") return t("models.metadata.catalogYes");
  if (value === "no") return t("models.metadata.catalogNo");
  if (typeof value === "number") return formatTokens(value);
  return value === void 0 ? "—" : String(value);
}
function entryValue(entry, field) {
  return catalogFieldValue(entry, field);
}
function formatTokens(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value % 1e6 === 0 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value % 1e3 === 0 ? 0 : 1)}K`;
  return String(value);
}
function formatDate(iso) {
  return iso.slice(0, 10);
}
function FactCell({
  fact,
  t,
  showEvidence = false
}) {
  if (fact.state === "unclassified") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-muted-foreground", children: t("models.metadata.unclassified") });
  }
  const display = Array.isArray(fact.value) ? fact.value.join(" + ") : typeof fact.value === "number" ? formatTokens(fact.value) : String(fact.value);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-0.5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm", children: display }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: `text-[11px] ${SOURCE_TONE[fact.source] ?? "text-muted-foreground"}`, children: [
      t(SOURCE_LABEL_KEYS[fact.source] ?? "models.metadata.sourceUnclassified"),
      fact.confidence !== "declared" ? ` · ${t(CONFIDENCE_LABEL_KEYS[fact.confidence] ?? "")}` : ""
    ] }),
    showEvidence && (fact.evidence || fact.asOf) && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[11px] text-muted-foreground", children: [
      fact.evidence ?? "",
      fact.asOf ? ` ${formatDate(fact.asOf)}` : ""
    ] })
  ] });
}
const TRI_STATE_FIELDS = [
  ["vision", "proxy.routePoolMarkVision"],
  ["tools", "proxy.routePoolMarkTools"],
  ["reasoning", "proxy.routePoolMarkReasoning"]
];
const MODALITIES = ["text", "image", "audio", "video", "pdf"];
const MAX_MARK_OUTPUT_TOKENS = 1e6;
function cleanHint(draft) {
  const hint = {};
  if (draft.tier !== void 0) hint.tier = draft.tier;
  if (draft.vision !== void 0) hint.vision = draft.vision;
  if (draft.tools !== void 0) hint.tools = draft.tools;
  if (draft.reasoning !== void 0) hint.reasoning = draft.reasoning;
  if (draft.modalities !== void 0) hint.modalities = [...draft.modalities];
  if (draft.contextTokens !== void 0) hint.contextTokens = draft.contextTokens;
  if (draft.maxOutputTokens !== void 0) hint.maxOutputTokens = draft.maxOutputTokens;
  if (draft.weight !== void 0) hint.weight = draft.weight;
  if (draft.free !== void 0) hint.free = draft.free;
  return Object.keys(hint).length === 0 ? null : hint;
}
function ModelMarkEditor({
  providerId,
  displayName,
  mark,
  sources,
  onSaved,
  onCancel
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = reactExports.useState({});
  const [saving, setSaving] = reactExports.useState(false);
  const [error, setError] = reactExports.useState(null);
  const [outputDraft, setOutputDraft] = reactExports.useState("");
  reactExports.useEffect(() => {
    setDraft(mark ? { ...mark, modalities: mark.modalities ? [...mark.modalities] : void 0 } : {});
    setOutputDraft(mark?.maxOutputTokens !== void 0 ? String(mark.maxOutputTokens) : "");
    setError(null);
  }, [providerId, displayName]);
  const patch = (changes) => {
    setDraft((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(changes)) {
        if (value === void 0) delete next[key];
        else next[key] = value;
      }
      return next;
    });
  };
  const triState = (field) => draft[field] ?? "inherit";
  const setTriState = (field, value) => {
    patch({ [field]: value === "inherit" ? void 0 : value });
  };
  const toggleModality = (modality) => {
    const current = draft.modalities ?? [];
    const next = current.includes(modality) ? current.filter((item) => item !== modality) : [...current, modality];
    patch({ modalities: next.length === 0 ? void 0 : next });
  };
  const outputError = validateMaxOutput(outputDraft, t);
  const changeMaxOutput = (raw) => {
    setOutputDraft(raw);
    const parsed = parseMaxOutput(raw);
    patch({ maxOutputTokens: parsed === null ? void 0 : parsed.value });
  };
  const handleSave = async () => {
    if (outputError !== null) {
      setError(outputError);
      return;
    }
    const api = window.electronAPI?.providers;
    if (!api?.setModelMark) {
      setError(t("proxy.routesUnavailable"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.setModelMark(providerId, displayName, cleanHint(draft));
      if (result.success) {
        onSaved(result.marks);
      } else {
        setError(result.error ?? t("proxy.routePoolMarkSaveFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("proxy.routePoolMarkSaveFailed"));
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("proxy.routePoolMarkHelp") }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "text-xs", children: t("proxy.routePoolMarkTier") }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        Select,
        {
          value: draft.tier ?? "inherit",
          onValueChange: (value) => patch({ tier: value === "inherit" ? void 0 : value }),
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-8 text-xs", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "inherit", children: t("proxy.routePoolMarkInherit") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "fast", children: "fast" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "balanced", children: "balanced" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "strong", children: "strong" })
            ] })
          ]
        }
      )
    ] }),
    TRI_STATE_FIELDS.map(([field, labelKey]) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "text-xs", children: t(labelKey) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: triState(field), onValueChange: (value) => setTriState(field, value), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "h-8 text-xs", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "inherit", children: t("proxy.routePoolMarkInherit") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "yes", children: t("proxy.routePoolMarkYes") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "no", children: t("proxy.routePoolMarkNo") })
        ] })
      ] })
    ] }, field)),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "text-xs", children: t("proxy.routePoolMarkContext") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Input,
        {
          type: "number",
          min: 1,
          className: "h-8 text-xs",
          value: draft.contextTokens ?? "",
          onChange: (event) => {
            const raw = event.target.value;
            patch({ contextTokens: raw === "" ? void 0 : Math.max(1, Number(raw) || 0) });
          },
          placeholder: t("proxy.routePoolMarkInherit")
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "text-xs", children: t("proxy.routePoolMarkMaxOutput") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Input,
        {
          type: "text",
          inputMode: "numeric",
          className: "h-8 text-xs",
          value: outputDraft,
          onChange: (event) => changeMaxOutput(event.target.value),
          placeholder: t("proxy.routePoolMarkMaxOutputPlaceholder"),
          "aria-invalid": outputError !== null
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] text-muted-foreground", children: t("proxy.routePoolMarkMaxOutputHelp", {
        max: MAX_MARK_OUTPUT_TOKENS.toLocaleString("en-US")
      }) }),
      outputError !== null && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] text-destructive break-words", children: outputError })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "text-xs", children: t("proxy.routePoolMarkModalities") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-2", children: MODALITIES.map((modality) => /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-1 text-xs", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "checkbox",
            className: "h-3.5 w-3.5 accent-[var(--primary)]",
            checked: (draft.modalities ?? []).includes(modality),
            onChange: () => toggleModality(modality)
          }
        ),
        modality
      ] }, modality)) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] text-muted-foreground", children: t("proxy.routePoolMarkModalitiesHelp") })
    ] }),
    sources && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-1.5", children: sources.map((entry) => /* @__PURE__ */ jsxRuntimeExports.jsxs(Badge, { variant: "outline", className: "text-[10px] font-normal", children: [
      entry.label,
      ": ",
      t(`proxy.routePoolSource_${entry.source}`)
    ] }, entry.label)) }),
    error && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-destructive break-words", children: error }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap justify-end gap-2", children: [
      onCancel && /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: onCancel, disabled: saving, children: t("common.cancel") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { type: "button", size: "sm", onClick: () => void handleSave(), disabled: saving, children: saving ? t("proxy.saving") : t("common.save") })
    ] })
  ] });
}
function parseMaxOutput(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: void 0 };
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value <= 0 || value > MAX_MARK_OUTPUT_TOKENS) return null;
  return { value };
}
function validateMaxOutput(raw, t) {
  const trimmed = raw.trim();
  if (parseMaxOutput(trimmed) !== null) return null;
  if (Number(trimmed) > MAX_MARK_OUTPUT_TOKENS) {
    return t("proxy.routePoolMarkMaxOutputTooLarge", {
      max: MAX_MARK_OUTPUT_TOKENS.toLocaleString("en-US")
    });
  }
  return t("proxy.routePoolMarkMaxOutputInvalid");
}
function ModelAnnotationDialog({
  providerId,
  displayName,
  modelLabel,
  onClose,
  onChanged
}) {
  const { t } = useTranslation();
  return /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: true, onOpenChange: (open) => !open ? onClose() : void 0, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "flex max-w-2xl max-h-[85vh] flex-col overflow-hidden", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { className: "shrink-0", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("models.annotation.title", { model: modelLabel ?? displayName }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { className: "break-all", children: displayName })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      AnnotationBody,
      {
        providerId,
        displayName,
        onChanged
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(DialogFooter, { className: "shrink-0", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", onClick: onClose, children: t("common.close") }) })
  ] }) });
}
function AnnotationBody({
  providerId,
  displayName,
  onChanged
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [metadata, setMetadata] = reactExports.useState(null);
  const [metadataError, setMetadataError] = reactExports.useState(null);
  const [mark, setMark] = reactExports.useState(void 0);
  const [data, setData] = reactExports.useState(null);
  const [loading, setLoading] = reactExports.useState(true);
  const [busy, setBusy] = reactExports.useState(null);
  const loadFacts = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    if (!api?.getModelMetadataOne) {
      setMetadataError(t("models.annotation.unavailable"));
      return;
    }
    const result = await api.getModelMetadataOne(providerId, displayName);
    if (result.success) {
      setMetadata(result.metadata);
      setMetadataError(null);
    } else {
      setMetadataError(result.error);
    }
  }, [displayName, providerId, t]);
  const loadCandidates = reactExports.useCallback(async () => {
    if (!window.electronAPI?.providers?.getCatalogCandidates) return;
    try {
      setData(await window.electronAPI.providers.getCatalogCandidates(providerId, displayName));
    } catch (cause) {
      toast({
        title: t("models.metadata.catalogFailed"),
        description: cause instanceof Error ? cause.message : displayName,
        variant: "destructive"
      });
    }
  }, [displayName, providerId, t, toast]);
  const loadMark = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    if (!api?.getModelMarks) return;
    const marks = await api.getModelMarks();
    setMark(marks[providerId]?.[displayName]);
  }, [displayName, providerId]);
  reactExports.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([loadFacts(), loadCandidates(), loadMark()]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadCandidates, loadFacts, loadMark]);
  const afterChange = reactExports.useCallback(async () => {
    await Promise.all([loadFacts(), loadCandidates(), loadMark()]);
    onChanged?.();
  }, [loadCandidates, loadFacts, loadMark, onChanged]);
  const adopt = reactExports.useCallback(
    async (entry, field) => {
      const api = window.electronAPI?.providers;
      if (!api?.adoptCatalogField) return;
      setBusy(`${entry.catalogId}\0${field}`);
      try {
        const result = await api.adoptCatalogField(providerId, displayName, entry.catalogId, field);
        if (!result.success) {
          toast({
            title: t("models.metadata.catalogFailed"),
            description: result.error ?? displayName,
            variant: "destructive"
          });
          return;
        }
        setData(
          (current) => current ? { ...current, adoptions: result.adoptions ?? current.adoptions } : current
        );
        await afterChange();
        toast({
          title: t("models.metadata.catalogAdopted"),
          description: `${displayName} · ${t(CATALOG_FIELD_LABEL_KEYS[field])}`
        });
      } finally {
        setBusy(null);
      }
    },
    [afterChange, displayName, providerId, t, toast]
  );
  const revoke = reactExports.useCallback(
    async (field) => {
      const api = window.electronAPI?.providers;
      if (!api?.revokeCatalogAdoption) return;
      setBusy(`revoke\0${field ?? "all"}`);
      try {
        const result = await api.revokeCatalogAdoption(providerId, displayName, field);
        if (!result.success) {
          toast({
            title: t("models.metadata.catalogFailed"),
            description: result.error ?? displayName,
            variant: "destructive"
          });
          return;
        }
        setData(
          (current) => current ? { ...current, adoptions: result.adoptions ?? current.adoptions } : current
        );
        await afterChange();
        toast({ title: t("models.metadata.catalogRevoked"), description: displayName });
      } finally {
        setBusy(null);
      }
    },
    [afterChange, displayName, providerId, t, toast]
  );
  const unfetchedSources = data ? CATALOG_SOURCES.filter(
    (source) => !data.statuses.some((status) => status.source === source)
  ) : [];
  if (loading) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
      t("models.metadata.catalogLoading")
    ] });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-h-0 flex-1 space-y-4 overflow-y-auto pr-1", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "text-sm font-medium", children: t("models.annotation.factsSection") }),
      metadataError && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-destructive break-words", children: metadataError }),
      metadata && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "divide-y rounded-md border", children: METADATA_ATTRIBUTES.filter(
        (attribute) => isAttributeApplicable(attribute, metadata.providerType)
      ).map((attribute) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3 px-3 py-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "shrink-0 text-xs text-muted-foreground", children: t(ATTRIBUTE_LABEL_KEYS[attribute]) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-right", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          FactCell,
          {
            fact: metadata[attribute],
            t,
            showEvidence: true
          }
        ) })
      ] }, attribute)) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "text-sm font-medium", children: t("models.annotation.catalogSection") }),
      unfetchedSources.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning", children: t("models.metadata.catalogSourcesNotFetched", {
        sources: unfetchedSources.map((source) => CATALOG_SOURCE_META[source].label).join(" / ")
      }) }),
      data && data.adoptions.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 rounded-md border p-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm font-medium", children: t("models.metadata.catalogAdoptedTitle") }),
          data.adoptions.length > 1 && /* @__PURE__ */ jsxRuntimeExports.jsx(
            Button,
            {
              variant: "ghost",
              size: "sm",
              disabled: busy !== null,
              onClick: () => void revoke(),
              children: t("models.metadata.catalogRevokeAll")
            }
          )
        ] }),
        data.adoptions.map((adoption) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            className: "flex items-center justify-between gap-3 text-sm",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
                  t(CATALOG_FIELD_LABEL_KEYS[adoption.field]),
                  " · ",
                  formatCatalogValue(adoption.field, adoption.value, t)
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[11px] text-muted-foreground", children: [
                  CATALOG_SOURCE_META[adoption.source].label,
                  " · ",
                  /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: adoption.catalogId })
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  disabled: busy !== null,
                  onClick: () => void revoke(adoption.field),
                  children: t("models.metadata.catalogRevoke")
                }
              )
            ]
          },
          `${adoption.field}\0${adoption.catalogId}`
        ))
      ] }),
      data && data.matches.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border p-6 text-center text-sm text-muted-foreground", children: t("models.metadata.catalogNoMatches") }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-3", children: (data?.matches ?? []).map((match) => {
        const entry = match.entry;
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-md border p-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: CATALOG_CONFIDENCE_TONE[match.confidence], children: t(CATALOG_CONFIDENCE_LABEL_KEYS[match.confidence]) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "rounded bg-muted px-2 py-0.5", children: entry.id }),
            entry.provider && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-muted-foreground", children: entry.provider }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-auto text-xs text-muted-foreground", children: CATALOG_SOURCE_META[entry.source].label })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-3 space-y-1.5", children: CATALOG_ADOPTION_FIELDS.map((field) => {
            const value = entryValue(entry, field);
            const adopted = data?.adoptions.find((item) => item.field === field);
            const same = adopted?.catalogId === entry.catalogId;
            return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3 text-sm", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-xs text-muted-foreground", children: [
                  t(CATALOG_FIELD_LABEL_KEYS[field]),
                  field === "price" && ` · ${t("models.metadata.catalogPriceHint")}`
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: formatCatalogValue(field, value, t) }),
                value === void 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.catalogFieldAbsent") }),
                adopted && !same && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[11px] text-warning", children: t("models.metadata.catalogAdoptedOther", { id: adopted.catalogId }) })
              ] }),
              same ? /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "shrink-0 text-success", children: t("models.metadata.catalogAdoptedBadge") }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  className: "shrink-0",
                  disabled: value === void 0 || busy !== null,
                  onClick: () => void adopt(entry, field),
                  children: [
                    busy === `${entry.catalogId}\0${field}` ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-3.5 w-3.5 animate-spin" }) : null,
                    t("models.metadata.catalogAdopt")
                  ]
                }
              )
            ] }, field);
          }) })
        ] }, entry.catalogId);
      }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "text-sm font-medium", children: t("models.annotation.markSection") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        ModelMarkEditor,
        {
          providerId,
          displayName,
          mark,
          onSaved: () => void afterChange()
        }
      )
    ] })
  ] });
}
export {
  ATTRIBUTE_LABEL_KEYS as A,
  CATALOG_SOURCE_META as C,
  FactCell as F,
  ModelAnnotationDialog as M,
  ROUTING_METADATA_ATTRIBUTES as R,
  SOURCE_LABEL_KEYS as S,
  ModelMarkEditor as a,
  METADATA_ATTRIBUTES as b,
  CATALOG_SOURCES as c,
  formatTokens as d,
  formatDate as f,
  sanitizeCatalogMirrorUrl as s
};
