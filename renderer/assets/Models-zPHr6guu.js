import { c as createLucideIcon, r as reactExports, j as jsxRuntimeExports, B as Button, C as Check, a as cn, u as useTranslation, a4 as useNavigationStore, N as useToast, T as TriangleAlert, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, J as DialogDescription, K as DialogFooter, O as useProvidersStore, a2 as Cpu, a1 as Square, y as Copy, a5 as useSearchParams } from "./index-Dmiad-IP.js";
import { T as Tabs, a as TabsList, b as TabsTrigger, d as TabsContent } from "./tabs-Cs4ul3yp.js";
import { C as Card, a as CardHeader, b as CardTitle, d as CardDescription, c as CardContent } from "./card-CJejDjrN.js";
import { I as Input, L as Label, S as Switch } from "./label-BqQAqSEG.js";
import { B as Badge } from "./badge-CrPFCp-Q.js";
import { T as Trash2, S as Select, d as SelectTrigger, e as SelectValue, f as SelectContent, g as SelectItem } from "./select-DfPABgRe.js";
import { T as Table, a as TableHeader, b as TableRow, c as TableHead, d as TableBody, e as TableCell } from "./table-DXILV6XS.js";
import { u as useProxyStore, P as Pencil, R as Radar } from "./slider-Bx20ZX66.js";
import { b as costBucketOf, L as ListChecks } from "./channels-Ck20oZNV.js";
import { a as aggregateCostOf } from "./aggregateCost-B41jA_HQ.js";
import { S as Search, C as ChevronRight } from "./search-FGE6QrPq.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
import { R as RotateCcw, C as CircleCheck } from "./rotate-ccw-QvuFi60u.js";
import { C as ChevronLeft } from "./chevron-left-DjwtYoGs.js";
import { D as Database } from "./database-CgRqZ2QH.js";
import { C as CircleX } from "./circle-x-CO4cGxfI.js";
import { s as sanitizeCatalogMirrorUrl, C as CATALOG_SOURCE_META, b as METADATA_ATTRIBUTES, R as ROUTING_METADATA_ATTRIBUTES, A as ATTRIBUTE_LABEL_KEYS, c as CATALOG_SOURCES, f as formatDate, F as FactCell, d as formatTokens, S as SOURCE_LABEL_KEYS, M as ModelAnnotationDialog } from "./ModelAnnotationDialog-D1MW0Y2K.js";
import { R as RefreshCw } from "./refresh-cw-BZLwpUhy.js";
import { A as ArrowRight } from "./arrow-right-CWAKfkrF.js";
import { P as Plus } from "./plus-CRYwvOZy.js";
import "./localDay-CzWGkYP0.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Ban = createLucideIcon("Ban", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m4.9 4.9 14.2 14.2", key: "1m5liu" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const ChevronsUpDown = createLucideIcon("ChevronsUpDown", [
  ["path", { d: "m7 15 5 5 5-5", key: "1hf1tw" }],
  ["path", { d: "m7 9 5-5 5 5", key: "sgt6xg" }]
]);
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Save = createLucideIcon("Save", [
  [
    "path",
    {
      d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      key: "1c8476"
    }
  ],
  ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", key: "1ydtos" }],
  ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7", key: "t51u73" }]
]);
const MODEL_FAMILY_RULES = [
  {
    id: "openai-gpt-oss",
    family: "OpenAI gpt-oss",
    pattern: /^gpt[-_]?oss(?:[-_.]|$)/,
    hint: { tools: "yes", reasoning: "yes", contextTokens: 131072 },
    evidence: "OpenAI gpt-oss 系列公开 128K (131072) 上下文，原生工具调用与 reasoning 通道；与 docs/data 旁表口径一致"
  },
  {
    id: "moonshot-kimi-k2",
    family: "Moonshot Kimi K2.x",
    pattern: /^kimi[-_]?k2(?:[._-]|$)/,
    hint: {
      tools: "yes",
      reasoning: "yes",
      vision: "yes",
      modalities: ["text", "image"],
      contextTokens: 262144
    },
    evidence: "月之暗面 Kimi K2.x 公开 256K (262144) 上下文、图片输入与工具调用；与 models.dev 旁表一致"
  },
  {
    id: "qwen3-coder",
    family: "Qwen3-Coder",
    pattern: /^qwen[-_]?3(?:[._]\d+)?[-_]?coder/,
    hint: { tools: "yes", contextTokens: 262144 },
    evidence: "阿里云 Qwen3-Coder 公开 256K (262144) 上下文与函数调用"
  },
  {
    id: "zhipu-glm-5",
    family: "智谱 GLM-5",
    pattern: /^glm[-_]?5(?:[._-]|$)/,
    hint: { tools: "yes", reasoning: "yes" },
    evidence: "智谱 GLM-5 系列声明原生工具调用与 reasoning 输出"
  },
  {
    id: "deepseek-v3-v4",
    family: "DeepSeek V3/V4",
    pattern: /^deepseek[-_]?v(?:3|4)(?:[._-]|$)/,
    hint: { tools: "yes", reasoning: "yes" },
    evidence: "DeepSeek V3/V4 声明函数调用与 reasoning_content 通道"
  },
  {
    id: "anthropic-claude",
    family: "Anthropic Claude",
    pattern: /^claude(?:[-_.]|$)/,
    hint: {
      tools: "yes",
      vision: "yes",
      modalities: ["text", "image"],
      contextTokens: 2e5
    },
    evidence: "Anthropic Claude 系列公开 200K 上下文、图片输入与原生工具调用"
  },
  {
    id: "google-gemini",
    family: "Google Gemini",
    pattern: /^gemini(?:[-_.]|$)/,
    hint: { tools: "yes", vision: "yes", modalities: ["text", "image"] },
    evidence: "Google Gemini 声明图片输入与函数调用"
  }
];
function normalizeFamilyModelName(modelId) {
  const slash = modelId.lastIndexOf("/");
  const tail = slash >= 0 ? modelId.slice(slash + 1) : modelId;
  return tail.trim().toLowerCase();
}
function matchFamilyRules(modelId) {
  const normalized = normalizeFamilyModelName(modelId);
  if (!normalized) return [];
  return MODEL_FAMILY_RULES.filter((rule) => rule.pattern.test(normalized));
}
function familyRuleLayer(modelId) {
  const rules = matchFamilyRules(modelId);
  if (rules.length === 0) return void 0;
  const hint = rules.reduce(
    (merged, rule) => ({ ...merged, ...rule.hint }),
    {}
  );
  return {
    source: "family-rule",
    confidence: "inferred",
    evidence: rules.map((rule) => `${rule.family}: ${rule.evidence}`).join("；"),
    hint
  };
}
const CONTEXT_PROBE_LADDER = [4096, 8192, 16384, 32768, 65536, 98304, 131072, 2e5];
const OUTPUT_PROBE_LADDER = [1024, 2048, 4096, 8192, 16384, 32768];
const PROBE_MAX_REQUESTS = 8;
const PROBE_PROMPT_OVERHEAD_TOKENS = 32;
function clampTierList(tiers, index) {
  const next = [
    tiers[index - 1],
    tiers[index],
    tiers[index + 1]
  ].filter((tier) => typeof tier === "number");
  return [...new Set(next)].sort((left, right) => left - right);
}
function nearestTierIndex(tiers, hintTokens) {
  let best = 0;
  for (let index = 1; index < tiers.length; index++) {
    if (Math.abs(tiers[index] - hintTokens) < Math.abs(tiers[best] - hintTokens)) {
      best = index;
    }
  }
  return best;
}
function planLadder(scope, tiers, hintTokens, narrowedBy) {
  const selected = hintTokens === void 0 ? [...tiers] : clampTierList(tiers, nearestTierIndex(tiers, hintTokens));
  const requestCount = Math.min(selected.length, PROBE_MAX_REQUESTS);
  const estimatedInputTokens = selected.reduce(
    (total, tier) => total + (scope === "context" ? tier : PROBE_PROMPT_OVERHEAD_TOKENS),
    0
  ) + selected.length * PROBE_PROMPT_OVERHEAD_TOKENS;
  const estimatedOutputTokens = selected.reduce(
    (total, tier) => total + (scope === "output" ? tier : 16),
    0
  );
  return {
    scope,
    tiers: selected,
    requestCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    ...hintTokens === void 0 || narrowedBy === void 0 ? {} : { narrowedBy }
  };
}
function planContextProbe(input = {}) {
  return planLadder("context", CONTEXT_PROBE_LADDER, input.hintTokens, input.hintSource);
}
function planOutputProbe(input = {}) {
  return planLadder("output", OUTPUT_PROBE_LADDER, input.hintTokens, input.hintSource);
}
function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select option...",
  emptyText = "No option found.",
  disabled = false,
  className
}) {
  const [isOpen, setIsOpen] = reactExports.useState(false);
  const [searchQuery, setSearchQuery] = reactExports.useState("");
  const containerRef = reactExports.useRef(null);
  const filteredOptions = reactExports.useMemo(() => {
    if (!searchQuery) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()) || option.value.toLowerCase().includes(searchQuery.toLowerCase()) || option.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, searchQuery]);
  const selectedOption = options.find((option) => option.value === value);
  const groupedOptions = reactExports.useMemo(() => {
    const groups = {};
    filteredOptions.forEach((option) => {
      const group = option.group || "Other";
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(option);
    });
    return groups;
  }, [filteredOptions]);
  reactExports.useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchQuery("");
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { ref: containerRef, className: cn("relative", className), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      Button,
      {
        variant: "outline",
        role: "combobox",
        "aria-expanded": isOpen,
        disabled,
        onClick: () => setIsOpen(!isOpen),
        className: "w-full justify-between",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate", children: selectedOption ? selectedOption.label : placeholder }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronsUpDown, { className: "ml-2 h-4 w-4 shrink-0 opacity-50" })
        ]
      }
    ),
    isOpen && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "p-2 border-b", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Search, { className: "h-4 w-4 text-muted-foreground" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            placeholder: "Search...",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            className: "flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
            autoFocus: true
          }
        )
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "max-h-60 overflow-auto", children: filteredOptions.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "py-6 text-center text-sm text-muted-foreground", children: emptyText }) : Object.entries(groupedOptions).map(([group, groupOptions]) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50", children: group }),
        groupOptions.map((option) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            onClick: () => handleSelect(option.value),
            className: cn(
              "flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
              value === option.value && "bg-accent"
            ),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Check,
                {
                  className: cn(
                    "h-4 w-4",
                    value === option.value ? "opacity-100" : "opacity-0"
                  )
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col flex-1", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: option.label }),
                option.description && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-muted-foreground", children: option.description })
              ] })
            ]
          },
          option.value
        ))
      ] }, group)) })
    ] })
  ] });
}
const BLOCKER_ID = "model-mapping-changes";
const MODEL_OPTION_SEPARATOR = "::";
const createModelOptionValue = (providerId, model) => `${providerId}${MODEL_OPTION_SEPARATOR}${model}`;
const parseModelOptionValue = (value) => {
  const separatorIndex = value.indexOf(MODEL_OPTION_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    providerId: value.slice(0, separatorIndex),
    model: value.slice(separatorIndex + MODEL_OPTION_SEPARATOR.length)
  };
};
function ModelMappingConfig({ onConfigChange }) {
  const { t } = useTranslation();
  const {
    modelMappings,
    setModelMappings,
    saveAppConfig,
    isLoading
  } = useProxyStore();
  const { registerBlocker, unregisterBlocker } = useNavigationStore();
  const { toast } = useToast();
  const [mappings, setMappings] = reactExports.useState([]);
  const [originalMappings, setOriginalMappings] = reactExports.useState([]);
  const [providers, setProviders] = reactExports.useState([]);
  const [accounts, setAccounts] = reactExports.useState([]);
  const [searchQuery, setSearchQuery] = reactExports.useState("");
  const [isDialogOpen, setIsDialogOpen] = reactExports.useState(false);
  const [editingMapping, setEditingMapping] = reactExports.useState(null);
  const [hasChanges, setHasChanges] = reactExports.useState(false);
  const isInitializedRef = reactExports.useRef(false);
  const [formData, setFormData] = reactExports.useState({
    requestModel: "",
    actualModel: "",
    preferredProviderId: "",
    preferredAccountId: ""
  });
  const AUTO_SELECT_VALUE = "auto";
  reactExports.useEffect(() => {
    fetchProviders();
    fetchAccounts();
  }, []);
  reactExports.useEffect(() => {
    if (!isInitializedRef.current && modelMappings.length >= 0) {
      setMappings([...modelMappings]);
      setOriginalMappings([...modelMappings]);
      isInitializedRef.current = true;
    }
  }, [modelMappings]);
  reactExports.useEffect(() => {
    if (hasChanges) {
      registerBlocker(BLOCKER_ID, t("proxy.unsavedChangesDescription"));
    } else {
      unregisterBlocker(BLOCKER_ID);
    }
    return () => unregisterBlocker(BLOCKER_ID);
  }, [hasChanges, registerBlocker, unregisterBlocker, t]);
  reactExports.useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = t("proxy.unsavedChangesWarning");
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges, t]);
  const fetchProviders = async () => {
    try {
      const data = await window.electronAPI.providers.getAll();
      setProviders(data.filter((p) => p.enabled));
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  };
  const fetchAccounts = async () => {
    try {
      const data = await window.electronAPI.accounts.getAll();
      setAccounts(data.filter((a) => a.status === "active"));
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    }
  };
  const filteredMappings = mappings.filter(
    (m) => m.requestModel.toLowerCase().includes(searchQuery.toLowerCase()) || m.actualModel.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const handleOpenDialog = (mapping) => {
    if (mapping) {
      setEditingMapping(mapping);
      setFormData({
        requestModel: mapping.requestModel,
        actualModel: mapping.actualModel,
        preferredProviderId: mapping.preferredProviderId || AUTO_SELECT_VALUE,
        preferredAccountId: mapping.preferredAccountId || AUTO_SELECT_VALUE
      });
    } else {
      setEditingMapping(null);
      setFormData({
        requestModel: "",
        actualModel: "",
        preferredProviderId: "",
        preferredAccountId: ""
      });
    }
    setIsDialogOpen(true);
  };
  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMapping(null);
    setFormData({
      requestModel: "",
      actualModel: "",
      preferredProviderId: "",
      preferredAccountId: ""
    });
  };
  const handleSaveMapping = async () => {
    if (!formData.requestModel.trim() || !formData.actualModel.trim()) {
      toast({
        title: t("proxy.validationFailed"),
        description: t("proxy.requestActualModelRequired"),
        variant: "destructive"
      });
      return;
    }
    if (formData.requestModel.includes("*")) {
      toast({
        title: t("proxy.validationFailed"),
        description: t("proxy.wildcardUnsupported"),
        variant: "destructive"
      });
      return;
    }
    const mapping = {
      requestModel: formData.requestModel.trim(),
      actualModel: formData.actualModel.trim(),
      preferredProviderId: formData.preferredProviderId === AUTO_SELECT_VALUE ? void 0 : formData.preferredProviderId || void 0,
      preferredAccountId: formData.preferredAccountId === AUTO_SELECT_VALUE ? void 0 : formData.preferredAccountId || void 0,
      // 编辑其它字段不许顺手把停用位清掉；新建时省略这个键（即启用）。
      // 这个位只有模型页那一个开关会写，这一页负责的是「别丢」。
      disabled: editingMapping?.disabled
    };
    if (editingMapping) {
      const updatedMappings = mappings.map(
        (m) => m.requestModel === editingMapping.requestModel ? mapping : m
      );
      setMappings(updatedMappings);
    } else {
      if (mappings.some((m) => m.requestModel === mapping.requestModel)) {
        toast({
          title: t("proxy.validationFailed"),
          description: t("proxy.mappingExists"),
          variant: "destructive"
        });
        return;
      }
      setMappings([...mappings, mapping]);
    }
    setHasChanges(true);
    onConfigChange?.();
    handleCloseDialog();
    toast({
      title: editingMapping ? t("providers.updateSuccess") : t("providers.addSuccess"),
      description: t(editingMapping ? "proxy.mappingUpdatedPending" : "proxy.mappingAddedPending", { model: mapping.requestModel })
    });
  };
  const handleDeleteMapping = (requestModel) => {
    const updatedMappings = mappings.filter((m) => m.requestModel !== requestModel);
    setMappings(updatedMappings);
    setHasChanges(true);
    onConfigChange?.();
    toast({
      title: t("providers.deleteSuccess"),
      description: t("proxy.mappingDeletedPending", { model: requestModel })
    });
  };
  const handleSaveAll = async () => {
    const mappingRecord = {};
    for (const mapping of mappings) {
      mappingRecord[mapping.requestModel] = mapping;
    }
    const success = await saveAppConfig({
      modelMappings: mappingRecord
    });
    if (success) {
      setModelMappings(mappings);
      setOriginalMappings([...mappings]);
      setHasChanges(false);
      toast({
        title: t("providers.updateSuccess"),
        description: t("proxy.configSaved")
      });
    } else {
      toast({
        title: t("providers.updateFailed"),
        description: t("proxy.configSaveFailed"),
        variant: "destructive"
      });
    }
  };
  const handleReset = () => {
    setMappings([...originalMappings]);
    setHasChanges(false);
    toast({
      description: t("proxy.changesDiscarded")
    });
  };
  const selectedProviderId = formData.preferredProviderId === AUTO_SELECT_VALUE ? "" : formData.preferredProviderId;
  const filteredAccounts = selectedProviderId ? accounts.filter((a) => a.providerId === selectedProviderId) : [];
  const modelOptions = reactExports.useMemo(() => {
    const options = [];
    providers.forEach((provider) => {
      provider.supportedModels?.forEach((model) => {
        options.push({
          value: createModelOptionValue(provider.id, model),
          label: model,
          group: provider.name
        });
      });
    });
    return options.sort(
      (a, b) => a.label === b.label ? (a.group || "").localeCompare(b.group || "") : a.label.localeCompare(b.label)
    );
  }, [providers]);
  const selectedModelOptionValue = selectedProviderId && formData.actualModel ? createModelOptionValue(selectedProviderId, formData.actualModel) : "";
  const modelMatchedProviders = reactExports.useMemo(() => {
    if (!formData.actualModel.trim()) {
      return providers;
    }
    return providers.filter(
      (provider) => provider.supportedModels?.includes(formData.actualModel)
    );
  }, [formData.actualModel, providers]);
  const providerOptions = formData.actualModel.trim() ? modelMatchedProviders : providers;
  reactExports.useEffect(() => {
    if (!formData.preferredProviderId || formData.preferredProviderId === AUTO_SELECT_VALUE || providerOptions.some((provider) => provider.id === formData.preferredProviderId)) {
      return;
    }
    setFormData((prev) => ({
      ...prev,
      preferredProviderId: "",
      preferredAccountId: ""
    }));
  }, [formData.preferredProviderId, providerOptions]);
  const handleModelChange = (value) => {
    const selectedOption = parseModelOptionValue(value);
    const selectedModel = selectedOption?.model || value;
    const selectedProviderId2 = selectedOption?.providerId || "";
    const nextProviders = selectedModel.trim() ? providers.filter((provider) => provider.supportedModels?.includes(selectedModel)) : providers;
    const shouldSelectProvider = selectedProviderId2 && nextProviders.some((provider) => provider.id === selectedProviderId2);
    setFormData((prev) => {
      if (shouldSelectProvider) {
        return {
          ...prev,
          actualModel: selectedModel,
          preferredProviderId: selectedProviderId2,
          preferredAccountId: prev.preferredProviderId === selectedProviderId2 ? prev.preferredAccountId : ""
        };
      }
      const canKeepProvider = !prev.preferredProviderId || prev.preferredProviderId === AUTO_SELECT_VALUE || nextProviders.some((provider) => provider.id === prev.preferredProviderId);
      return {
        ...prev,
        actualModel: selectedModel,
        preferredProviderId: canKeepProvider ? prev.preferredProviderId : "",
        preferredAccountId: canKeepProvider ? prev.preferredAccountId : ""
      };
    });
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: hasChanges ? "highlight-warning" : "", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(ArrowRight, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("proxy.modelMappingConfig") })
        ] }),
        hasChanges && /* @__PURE__ */ jsxRuntimeExports.jsxs(Badge, { variant: "outline", className: "badge-warning gap-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "h-3 w-3" }),
          t("proxy.unsaved")
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("proxy.modelMappingDesc") })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-6", children: [
      hasChanges && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "alert-warning p-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "h-4 w-4 text-warning" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-warning font-medium", children: t("proxy.unsavedChangesHint") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex shrink-0 gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: handleReset,
              disabled: isLoading,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, { className: "h-4 w-4 mr-2" }),
                t("common.reset")
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              size: "sm",
              onClick: handleSaveAll,
              disabled: isLoading,
              className: "btn-warning",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Save, { className: "h-4 w-4 mr-2" }),
                isLoading ? t("providers.saving") : t("proxy.saveConfig")
              ]
            }
          )
        ] })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative flex-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Search, { className: "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Input,
            {
              placeholder: t("proxy.searchMappings"),
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
              className: "pl-9"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center gap-2", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { onClick: () => handleOpenDialog(), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Plus, { className: "h-4 w-4 mr-2" }),
          t("proxy.addMapping")
        ] }) })
      ] }),
      filteredMappings.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "border rounded-lg", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Table, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(TableRow, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("proxy.requestModel") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "w-[50px]" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("proxy.actualModel") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("proxy.preferredProvider") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("proxy.preferredAccount") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "w-[100px]", children: t("common.actions") })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableBody, { children: filteredMappings.map((mapping) => {
          const provider = providers.find((p) => p.id === mapping.preferredProviderId);
          const account = accounts.find((a) => a.id === mapping.preferredAccountId);
          const isWildcardMapping = mapping.requestModel.includes("*");
          return /* @__PURE__ */ jsxRuntimeExports.jsxs(TableRow, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
              isWildcardMapping && // 老版本界面教过用户写通配键，运行时却只按精确名查表。
              // 存量条目照样列出（删不删由用户决定），但必须明说它到不了。
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { title: t("proxy.wildcardUnsupported"), className: "inline-flex", children: /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, { className: "h-4 w-4 text-warning" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "text-sm", children: mapping.requestModel }),
              mapping.disabled === true && // 停用位在模型页的开关上，这一页只报状态：两处对不上就是
              // 「看着能改其实改不到」。
              /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-xs text-muted-foreground", children: t("models.stopped") })
            ] }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(ArrowRight, { className: "h-4 w-4 text-muted-foreground" }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "text-sm", children: mapping.actualModel }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: provider ? /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: provider.name }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground text-sm", children: t("proxy.auto") }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: account ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm", children: account.name }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground text-sm", children: t("proxy.auto") }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "ghost",
                  size: "icon",
                  onClick: () => handleOpenDialog(mapping),
                  className: "h-8 w-8",
                  title: t("common.edit"),
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Pencil, { className: "h-4 w-4" })
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "ghost",
                  size: "icon",
                  onClick: () => handleDeleteMapping(mapping.requestModel),
                  className: "h-8 w-8 text-destructive hover:text-destructive",
                  title: t("common.delete"),
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "h-4 w-4" })
                }
              )
            ] }) })
          ] }, mapping.requestModel);
        }) })
      ] }) }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-center py-8 text-muted-foreground border rounded-lg", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm", children: t("proxy.noMappings") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs mt-1", children: t("proxy.noMappingsDesc") })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: isDialogOpen, onOpenChange: setIsDialogOpen, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: editingMapping ? t("proxy.editMapping") : t("proxy.addMapping") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("proxy.addMappingDesc") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4 py-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "requestModel", children: t("proxy.requestModel") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Input,
            {
              id: "requestModel",
              placeholder: t("proxy.requestModelPlaceholder"),
              value: formData.requestModel,
              onChange: (e) => setFormData((prev) => ({ ...prev, requestModel: e.target.value })),
              disabled: !!editingMapping
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("proxy.requestModelHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "actualModel", children: t("proxy.actualModel") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Combobox,
            {
              options: modelOptions,
              value: selectedModelOptionValue,
              onChange: handleModelChange,
              placeholder: t("proxy.selectModel"),
              emptyText: t("proxy.noModelFound")
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("proxy.actualModelHelp") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "provider", children: t("proxy.preferredProviderOptional") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Select,
            {
              value: formData.preferredProviderId,
              onValueChange: (value) => setFormData((prev) => ({
                ...prev,
                preferredProviderId: value,
                preferredAccountId: ""
              })),
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { id: "provider", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, { placeholder: t("proxy.autoSelect") }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: AUTO_SELECT_VALUE, children: t("proxy.autoSelect") }),
                  providerOptions.map((provider) => /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: provider.id, children: provider.name }, provider.id))
                ] })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "account", children: t("proxy.preferredAccountOptional") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Select,
            {
              value: formData.preferredAccountId,
              onValueChange: (value) => setFormData((prev) => ({ ...prev, preferredAccountId: value })),
              disabled: !selectedProviderId,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { id: "account", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, { placeholder: selectedProviderId ? t("proxy.autoSelect") : t("proxy.selectProviderFirst") }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: AUTO_SELECT_VALUE, children: t("proxy.autoSelect") }),
                  filteredAccounts.map((account) => /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: account.id, children: account.name }, account.id))
                ] })
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: handleCloseDialog, children: t("common.cancel") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: handleSaveMapping, children: editingMapping ? t("providers.updateSuccess") : t("common.add") })
      ] })
    ] }) })
  ] });
}
const modelMappingIcon = "data:image/svg+xml,%3c?xml%20version='1.0'%20standalone='no'?%3e%3c!DOCTYPE%20svg%20PUBLIC%20'-//W3C//DTD%20SVG%201.1//EN'%20'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'%3e%3csvg%20t='1772903226394'%20class='icon'%20viewBox='0%200%201024%201024'%20version='1.1'%20xmlns='http://www.w3.org/2000/svg'%20p-id='19395'%20xmlns:xlink='http://www.w3.org/1999/xlink'%20width='32'%20height='32'%3e%3cpath%20d='M0%200m256%200l512%200q256%200%20256%20256l0%20512q0%20256-256%20256l-512%200q-256%200-256-256l0-512q0-256%20256-256Z'%20fill='%230070FF'%20p-id='19396'%3e%3c/path%3e%3cpath%20d='M576%20790.314667a239.36%20239.36%200%200%201-207.786667-40.149334%20110.165333%20110.165333%200%200%200-29.397333-151.424%20107.008%20107.008%200%200%200-149.546667%2029.312%20110.165333%20110.165333%200%200%200%2028.416%20151.594667c32.426667%2022.058667%2073.984%2024.746667%20108.885334%207.125333a291.626667%20291.626667%200%200%200%20263.466666%2055.893334%2027.52%2027.52%200%200%200%2018.048-34.048%2028.032%2028.032%200%200%200-32.597333-18.773334l0.469333%200.469334z'%20fill='%23FFFFFF'%20opacity='.747'%20p-id='19397'%3e%3c/path%3e%3cpath%20d='M512.256%20170.666667c-56.490667%200.128-103.210667%2044.586667-106.88%20101.674666a298.112%20298.112%200%200%200-179.626667%20203.306667%2027.989333%2027.989333%200%200%200%2019.029334%2033.578667%2027.562667%2027.562667%200%200%200%2033.152-19.328A243.114667%20243.114667%200%200%201%20415.914667%20327.253333a107.392%20107.392%200%200%200%20129.109333%2057.130667%20109.354667%20109.354667%200%200%200%2074.794667-120.96A108.330667%20108.330667%200%200%200%20512.725333%20170.666667h-0.469333z%20m293.034667%20428.032a302.933333%20302.933333%200%200%200-82.304-259.285334%2026.88%2026.88%200%200%200-47.36%2011.221334%2027.648%2027.648%200%200%200%209.216%2027.434666%20247.936%20247.936%200%200%201%2070.272%20203.349334%20109.056%20109.056%200%200%200-116.906667%2085.504%20110.549333%20110.549333%200%200%200%2069.333333%20128%20108.330667%20108.330667%200%200%200%20133.973334-53.845334%20111.146667%20111.146667%200%200%200-36.266667-141.397333v-0.981333z'%20fill='%23FFFFFF'%20p-id='19398'%3e%3c/path%3e%3c/svg%3e";
const providerIcons = {
  mapping: modelMappingIcon
};
function toModality(declared) {
  if (declared === true) return "multimodal";
  if (declared === false) return "text";
  return "unknown";
}
function weightTone(weight) {
  if (weight === 0) return "text-success";
  if (weight < 1) return "text-primary";
  if (weight === 1) return "text-muted-foreground";
  return "text-warning";
}
const PAGE_SIZE = 50;
const ModelRow = reactExports.memo(({ model, isSelected, onSelect, t, credits, onToggleServed }) => {
  const providerIcon = providerIcons[model.providerId];
  const credit = credits[model.providerId];
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    TableRow,
    {
      className: cn(
        "cursor-pointer hover:bg-muted/50",
        isSelected && "bg-muted",
        !model.served && "opacity-60"
      ),
      onClick: () => onSelect(model.id),
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: isSelected ? /* @__PURE__ */ jsxRuntimeExports.jsx(Check, { className: "h-4 w-4 text-primary" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Square, { className: "h-4 w-4 text-muted-foreground" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "text-sm bg-muted px-2 py-1 rounded", children: model.name }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Badge,
            {
              variant: "outline",
              className: model.free === true ? "text-success" : model.weight === void 0 ? "text-muted-foreground" : weightTone(model.weight),
              title: model.free === true ? void 0 : model.weight === void 0 ? t("models.weightUnknownHint") : void 0,
              children: model.free === true ? "x0" : model.weight === void 0 ? t("models.costUnknown") : `x${model.weight}`
            }
          ),
          model.free === true && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-success", children: t("models.free") }),
          model.modality === "multimodal" && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "secondary", children: t("models.multimodal") })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          providerIcon ? /* @__PURE__ */ jsxRuntimeExports.jsx(
            "img",
            {
              src: providerIcon,
              alt: model.providerName,
              className: "h-4 w-4 object-contain"
            }
          ) : /* @__PURE__ */ jsxRuntimeExports.jsx(Database, { className: "h-4 w-4 text-muted-foreground" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: model.providerName }),
          credit === "loading" ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3 w-3 animate-spin text-muted-foreground" }) : typeof credit?.remaining === "number" ? /* @__PURE__ */ jsxRuntimeExports.jsx(
            "sup",
            {
              className: "text-[10px] font-medium tabular-nums text-muted-foreground",
              title: `${t("models.providerCredits")}: ${credit.remaining}`,
              children: credit.remaining
            }
          ) : null
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: model.accountName ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm", children: model.accountName }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-muted-foreground", children: "-" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          (model.source !== void 0 || model.alias !== void 0) && /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              checked: model.served,
              onCheckedChange: (checked) => onToggleServed(model, checked),
              onClick: (event) => event.stopPropagation(),
              "aria-label": t("models.serveToggle")
            }
          ),
          model.status === "stopped" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Ban, { className: "h-4 w-4 text-muted-foreground" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-muted-foreground", children: t("models.stopped") })
          ] }) : model.status === "available" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, { className: "h-4 w-4 text-success" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-success", children: t("models.available") })
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(CircleX, { className: "h-4 w-4 text-error" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm text-error", children: t("models.unavailable") })
          ] })
        ] }) })
      ]
    }
  );
});
ModelRow.displayName = "ModelRow";
function ModelList() {
  const { t } = useTranslation();
  const { providers, accounts, modelsLastUpdated, setProviders, setAccounts, setModelsLastUpdated } = useProvidersStore();
  const { modelMappings, setModelMappings } = useProxyStore();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = reactExports.useState("");
  const [selectedProvider, setSelectedProvider] = reactExports.useState("all");
  const [selectedModels, setSelectedModels] = reactExports.useState(/* @__PURE__ */ new Set());
  const [selectAll, setSelectAll] = reactExports.useState(false);
  const [currentPage, setCurrentPage] = reactExports.useState(1);
  const [catalogueMap, setCatalogueMap] = reactExports.useState({});
  const [serving, setServing] = reactExports.useState(false);
  const [modalityFilter, setModalityFilter] = reactExports.useState("all");
  const [costFilter, setCostFilter] = reactExports.useState("all");
  const [servedFilter, setServedFilter] = reactExports.useState("all");
  const [freeFlags, setFreeFlags] = reactExports.useState({});
  const [weightFlags, setWeightFlags] = reactExports.useState({});
  const [modalityFlags, setModalityFlags] = reactExports.useState({});
  const [credits, setCredits] = reactExports.useState({});
  reactExports.useEffect(() => {
    if (!window.electronAPI?.providers?.getAll || !window.electronAPI.accounts?.getAll) return;
    let cancelled = false;
    Promise.all([
      window.electronAPI.providers.getAll(),
      window.electronAPI.accounts.getAll()
    ]).then(([providersData, accountsData]) => {
      if (cancelled) return;
      setProviders(providersData);
      setAccounts(accountsData);
    }).catch((error) => console.error("Failed to load providers for the model list:", error));
    return () => {
      cancelled = true;
    };
  }, [setProviders, setAccounts]);
  const loadCatalogue = reactExports.useCallback(async () => {
    try {
      const enabledProviders = providers.filter((p) => p.enabled);
      const newMap = {};
      for (const provider of enabledProviders) {
        try {
          const models = await window.electronAPI.providers.getModelCatalogue(provider.id);
          newMap[provider.id] = models;
        } catch (error) {
          console.error(`Failed to load models for provider ${provider.id}:`, error);
          newMap[provider.id] = [];
        }
      }
      setCatalogueMap(newMap);
    } catch (error) {
      console.error("Failed to load model catalogue:", error);
    }
  }, [providers]);
  reactExports.useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue, modelsLastUpdated]);
  const loadCatalogueFacts = reactExports.useCallback(async () => {
    const free = {};
    const weights = {};
    const images = {};
    const channelProviders = providers.filter((p) => p.enabled && p.type === "account");
    await Promise.all(channelProviders.map(async (provider) => {
      try {
        const result = await window.electronAPI.channels.models(provider.id);
        for (const model of result.models ?? []) {
          const key = `${provider.id}/${model.id}`;
          free[key] = model.free;
          if (model.weight !== void 0) weights[key] = model.weight;
          if (model.supportsImage !== void 0) images[key] = model.supportsImage;
        }
      } catch (error) {
        console.error(`Failed to load channel models for ${provider.id}:`, error);
      }
    }));
    try {
      const result = await window.electronAPI.aggregate.list();
      for (const entry of result.entries ?? []) {
        for (const model of entry.models ?? []) {
          const signal = aggregateCostOf({
            entryId: entry.id,
            modelId: model.id,
            ...entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}
          });
          if (signal.class === "free") free[`${entry.id}/${model.id}`] = true;
        }
      }
    } catch (error) {
      console.error("Failed to load aggregate cost classification:", error);
    }
    setFreeFlags(free);
    setWeightFlags(weights);
    setModalityFlags(images);
  }, [providers]);
  reactExports.useEffect(() => {
    loadCatalogueFacts();
  }, [loadCatalogueFacts, modelsLastUpdated]);
  const loadCredits = reactExports.useCallback(async () => {
    const connected = providers.filter((p) => p.enabled && p.type === "account" && accounts.some((account) => account.providerId === p.id));
    if (connected.length === 0) {
      setCredits({});
      return;
    }
    setCredits((current) => {
      let next = current;
      for (const provider of connected) {
        if (next[provider.id] === void 0) next = { ...next, [provider.id]: "loading" };
      }
      return next;
    });
    try {
      const values = await window.electronAPI.channels.creditsAll(connected.map((provider) => provider.id));
      setCredits((current) => ({ ...current, ...values }));
    } catch (error) {
      console.error("Failed to load channel credits:", error);
    }
  }, [providers, accounts]);
  reactExports.useEffect(() => {
    void loadCredits();
  }, [loadCredits, modelsLastUpdated]);
  const modelList = reactExports.useMemo(() => {
    const models = [];
    const enabledProviders = providers.filter((p) => p.enabled);
    const addedModelNames = /* @__PURE__ */ new Set();
    const catalogueNames = /* @__PURE__ */ new Set();
    for (const provider of providers) {
      for (const name of provider.supportedModels || []) {
        catalogueNames.add(name);
      }
    }
    const accountMap = /* @__PURE__ */ new Map();
    for (const account of accounts) {
      if (!accountMap.has(account.providerId)) {
        accountMap.set(account.providerId, []);
      }
      accountMap.get(account.providerId).push(account);
    }
    const activeProviderMap = /* @__PURE__ */ new Map();
    for (const provider of enabledProviders) {
      const providerAccounts = accountMap.get(provider.id) || [];
      const hasActiveAccounts = providerAccounts.some((a) => a.status === "active");
      activeProviderMap.set(provider.id, hasActiveAccounts);
    }
    for (const provider of enabledProviders) {
      const catalogue = catalogueMap[provider.id] || [];
      if (catalogue.length === 0) {
        continue;
      }
      const providerAccounts = accountMap.get(provider.id) || [];
      const hasActiveAccounts = activeProviderMap.get(provider.id) || false;
      for (const model of catalogue) {
        const modelId = `${provider.id}-${model.displayName}`;
        const status = !model.served ? "stopped" : hasActiveAccounts ? "available" : "unavailable";
        addedModelNames.add(model.displayName);
        const free = freeFlags[model.actualModelId] ?? freeFlags[model.displayName];
        const weight = weightFlags[model.actualModelId] ?? weightFlags[model.displayName];
        const supportsImage = modalityFlags[model.actualModelId] ?? modalityFlags[model.displayName];
        models.push({
          id: modelId,
          name: model.displayName,
          providerId: provider.id,
          providerName: provider.name,
          accountId: providerAccounts[0]?.id,
          accountName: providerAccounts[0]?.name,
          status,
          served: model.served,
          source: model.source,
          modality: toModality(supportsImage),
          free,
          weight
        });
      }
    }
    for (const mapping of modelMappings) {
      if (!addedModelNames.has(mapping.requestModel) && !catalogueNames.has(mapping.requestModel)) {
        const owner = providers.find((p) => p.id === mapping.preferredProviderId);
        models.push({
          id: `mapping-${mapping.requestModel}`,
          name: mapping.requestModel,
          providerId: owner ? owner.id : "mapping",
          providerName: owner ? owner.name : t("models.modelMapping") || "Model Mapping",
          accountId: mapping.preferredAccountId,
          accountName: mapping.preferredAccountId ? accounts.find((a) => a.id === mapping.preferredAccountId)?.name : void 0,
          status: mapping.disabled === true ? "stopped" : owner ? activeProviderMap.get(owner.id) ? "available" : "unavailable" : "available",
          served: mapping.disabled !== true,
          alias: mapping.requestModel,
          modality: "unknown"
        });
      }
    }
    return models;
  }, [providers, accounts, modelMappings, catalogueMap, freeFlags, weightFlags, modalityFlags, t]);
  const filteredModels = reactExports.useMemo(() => {
    let filtered = modelList;
    if (selectedProvider !== "all") {
      filtered = filtered.filter((m) => m.providerId === selectedProvider);
    }
    if (modalityFilter !== "all") {
      filtered = filtered.filter((m) => m.modality === modalityFilter);
    }
    if (costFilter !== "all") {
      filtered = filtered.filter((m) => costBucketOf(m.weight, m.free === true) === costFilter);
    }
    if (servedFilter !== "all") {
      filtered = filtered.filter((m) => servedFilter === "served" ? m.served : !m.served);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) => m.name.toLowerCase().includes(query) || m.providerName.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [modelList, selectedProvider, modalityFilter, costFilter, servedFilter, searchQuery]);
  reactExports.useEffect(() => {
    setCurrentPage(1);
    setSelectedModels(/* @__PURE__ */ new Set());
    setSelectAll(false);
  }, [selectedProvider, modalityFilter, costFilter, servedFilter, searchQuery]);
  const totalPages = reactExports.useMemo(() => {
    return Math.ceil(filteredModels.length / PAGE_SIZE);
  }, [filteredModels.length]);
  const paginatedModels = reactExports.useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredModels.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredModels, currentPage]);
  const providerOptions = reactExports.useMemo(() => {
    const enabledProviders = providers.filter((p) => p.enabled);
    const options = [
      { value: "all", label: t("models.allProviders") },
      ...enabledProviders.map((p) => ({ value: p.id, label: p.name }))
    ];
    if (modelList.some((m) => m.providerId === "mapping")) {
      options.push({ value: "mapping", label: t("models.modelMapping") || "Model Mapping" });
    }
    return options;
  }, [providers, modelList, t]);
  reactExports.useEffect(() => {
    if (!providerOptions.some((option) => option.value === selectedProvider)) {
      setSelectedProvider("all");
    }
  }, [providerOptions, selectedProvider]);
  const handleSelectAll = reactExports.useCallback(() => {
    const newSelectAll = !selectAll;
    setSelectAll(newSelectAll);
    setSelectedModels(newSelectAll ? new Set(filteredModels.map((m) => m.id)) : /* @__PURE__ */ new Set());
  }, [selectAll, filteredModels]);
  const handleSelectModel = reactExports.useCallback((modelId) => {
    const newSelected = new Set(selectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setSelectedModels(newSelected);
    setSelectAll(newSelected.size === filteredModels.length);
  }, [selectedModels, filteredModels.length]);
  const changeServed = reactExports.useCallback(async (rows, served) => {
    const namesByProvider = /* @__PURE__ */ new Map();
    const aliasNames = [];
    for (const row of rows) {
      if (row.alias !== void 0) {
        aliasNames.push(row.alias);
        continue;
      }
      if (row.source === void 0) continue;
      const names = namesByProvider.get(row.providerId) || [];
      names.push(row.name);
      namesByProvider.set(row.providerId, names);
    }
    if (namesByProvider.size === 0 && aliasNames.length === 0) return true;
    setServing(true);
    try {
      const nextCatalogue = { ...catalogueMap };
      for (const [providerId, names] of namesByProvider) {
        const result = await window.electronAPI.providers.setModelsServed(providerId, names, served);
        if (!result.success) {
          toast({
            title: t("common.error"),
            description: result.error || t("models.serveChangeFailed"),
            variant: "destructive"
          });
          return false;
        }
        nextCatalogue[providerId] = result.catalogue;
      }
      setCatalogueMap(nextCatalogue);
      if (aliasNames.length > 0) {
        const current = await window.electronAPI.config.get();
        const record = { ...current.modelMappings };
        for (const name of aliasNames) {
          const existing = record[name];
          if (existing === void 0) continue;
          record[name] = { ...existing, disabled: served ? void 0 : true };
        }
        const updated = await window.electronAPI.config.update({ modelMappings: record });
        if (!updated) {
          toast({
            title: t("common.error"),
            description: t("models.serveChangeFailed"),
            variant: "destructive"
          });
          return false;
        }
        setModelMappings(Object.values(record));
      }
      setModelsLastUpdated(Date.now());
      return true;
    } finally {
      setServing(false);
    }
  }, [catalogueMap, setModelMappings, setModelsLastUpdated, t, toast]);
  const handleToggleServed = reactExports.useCallback((model, served) => {
    changeServed([model], served);
  }, [changeServed]);
  const handleServeOnlySelected = reactExports.useCallback(async () => {
    const selected = new Set(selectedModels);
    const started = await changeServed(modelList.filter((m) => selected.has(m.id)), true);
    if (!started) return;
    const stopped = await changeServed(
      modelList.filter((m) => (m.source !== void 0 || m.alias !== void 0) && !selected.has(m.id)),
      false
    );
    if (!stopped) return;
    toast({
      title: t("models.serveOnlyDone"),
      description: t("models.serveOnlyDoneDesc", { count: selected.size })
    });
    setSelectedModels(/* @__PURE__ */ new Set());
    setSelectAll(false);
  }, [changeServed, modelList, selectedModels, t, toast]);
  const handleCopySelected = reactExports.useCallback(async () => {
    const selectedModelNames = filteredModels.filter((m) => selectedModels.has(m.id)).map((m) => m.name);
    if (selectedModelNames.length === 0) {
      toast({
        title: t("models.noModelsFound"),
        description: t("models.noModelsDesc"),
        variant: "destructive"
      });
      return;
    }
    const text = selectedModelNames.join(",");
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: t("models.copySuccess"),
        description: t("models.copySuccessDesc", { count: selectedModelNames.length })
      });
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast({
        title: t("common.error"),
        description: t("common.error"),
        variant: "destructive"
      });
    }
  }, [filteredModels, selectedModels, t]);
  const handleCopyAll = reactExports.useCallback(async () => {
    if (filteredModels.length === 0) {
      toast({
        title: t("models.noModelsFound"),
        description: t("models.noModelsDesc"),
        variant: "destructive"
      });
      return;
    }
    const text = filteredModels.map((m) => m.name).join(",");
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: t("models.copySuccess"),
        description: t("models.copySuccessDesc", { count: filteredModels.length })
      });
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast({
        title: t("common.error"),
        description: t("common.error"),
        variant: "destructive"
      });
    }
  }, [filteredModels, t]);
  const handlePageChange = reactExports.useCallback((newPage) => {
    setCurrentPage(newPage);
    setSelectedModels(/* @__PURE__ */ new Set());
    setSelectAll(false);
  }, []);
  if (modelList.length === 0) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Cpu, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("models.modelList") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: t("models.totalModels", { count: 0 }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("models.description") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty-state-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Cpu, { className: "h-5 w-5" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-title", children: t("models.noModelsFound") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-hint", children: t("models.noModelsDesc") })
      ] }) })
    ] });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Cpu, { className: "h-[15px] w-[15px] text-[var(--text-muted)]" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("models.modelList") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: t("models.servedOfTotal", {
          served: modelList.filter((m) => m.served).length,
          total: modelList.length
        }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("models.description") })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative flex-1 min-w-[220px]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Search, { className: "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Input,
            {
              placeholder: t("models.searchModels"),
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
              className: "pl-9"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: selectedProvider, onValueChange: setSelectedProvider, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "w-[200px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectContent, { children: providerOptions.map((option) => /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: option.value, children: option.label }, option.value)) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Select,
          {
            value: modalityFilter,
            onValueChange: (value) => setModalityFilter(value),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "w-[180px]", title: t("models.modalityHint"), children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "all", children: t("models.allTypes") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "multimodal", children: t("models.typeMultimodal") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "text", children: t("models.typeText") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "unknown", children: t("models.typeUnknown") })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Select,
          {
            value: costFilter,
            onValueChange: (value) => setCostFilter(value),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "w-[180px]", title: t("models.costHint"), children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "all", children: t("models.allCosts") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "free", children: t("models.costFreeOnly") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "below-base", children: t("models.costBelowBase") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "base", children: t("models.costBase") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "above-base", children: t("models.costAboveBase") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "unknown", children: t("models.costUnknown") })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Select,
          {
            value: servedFilter,
            onValueChange: (value) => setServedFilter(value),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "w-[160px]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "all", children: t("models.allServeStates") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "served", children: t("models.servedOnly") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "stopped", children: t("models.stoppedOnly") })
              ] })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "ghost",
              size: "sm",
              onClick: handleSelectAll,
              className: "h-8 px-2",
              children: [
                selectAll ? /* @__PURE__ */ jsxRuntimeExports.jsx(Check, { className: "h-4 w-4 mr-2" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Square, { className: "h-4 w-4 mr-2" }),
                t("models.selectAll")
              ]
            }
          ),
          selectedModels.size > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "secondary", className: "text-xs", children: t("models.selectedModels", { count: selectedModels.size }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: handleServeOnlySelected,
              disabled: selectedModels.size === 0 || serving,
              children: [
                serving ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 mr-2 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, { className: "h-4 w-4 mr-2" }),
                t("models.serveOnlySelected")
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: handleCopySelected,
              disabled: selectedModels.size === 0,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Copy, { className: "h-4 w-4 mr-2" }),
                t("models.copySelected")
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: handleCopyAll,
              disabled: filteredModels.length === 0,
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Copy, { className: "h-4 w-4 mr-2" }),
                t("models.copyAll")
              ]
            }
          )
        ] })
      ] }),
      paginatedModels.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "border rounded-lg", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Table, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(TableRow, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "w-[50px]" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.modelName") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.provider") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.account") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.status") })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableBody, { children: paginatedModels.map((model) => /* @__PURE__ */ jsxRuntimeExports.jsx(
            ModelRow,
            {
              model,
              isSelected: selectedModels.has(model.id),
              onSelect: handleSelectModel,
              t,
              credits,
              onToggleServed: handleToggleServed
            },
            model.id
          )) })
        ] }) }),
        totalPages > 1 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-center gap-4 py-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: () => handlePageChange(currentPage - 1),
              disabled: currentPage === 1,
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronLeft, { className: "h-4 w-4" })
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm", children: t("models.pageInfo", {
            current: currentPage,
            total: totalPages
          }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: () => handlePageChange(currentPage + 1),
              disabled: currentPage === totalPages,
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronRight, { className: "h-4 w-4" })
            }
          )
        ] })
      ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty-state-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Database, { className: "h-5 w-5" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-title", children: t("models.noModelsFound") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "empty-state-hint", children: modelList.length > 0 ? t("models.noMatchDesc") : t("models.noModelsDesc") })
      ] })
    ] })
  ] });
}
const STATUS_LABEL_KEYS = {
  measured: "models.metadata.probeStatusMeasured",
  inconclusive: "models.metadata.probeStatusInconclusive",
  suspect: "models.metadata.probeStatusSuspect",
  deferred: "models.metadata.probeStatusDeferred",
  skipped: "models.metadata.probeStatusSkipped"
};
const PROBE_PHASE_LABEL_KEYS = {
  prepare: "models.metadata.probePhasePrepare",
  tier: "models.metadata.probePhaseTier",
  awaiting: "models.metadata.probePhaseAwaiting",
  done: "models.metadata.probePhaseDone",
  cancelled: "models.metadata.probePhaseCancelled"
};
const PROBE_FAILURE_LABEL_KEYS = {
  network: "models.metadata.probeErrorNetwork",
  auth: "models.metadata.probeErrorAuth",
  "rate-limit": "models.metadata.probeErrorRateLimit",
  timeout: "models.metadata.probeErrorTimeout",
  upstream: "models.metadata.probeErrorUpstream",
  unknown: "models.metadata.probeErrorUnknown"
};
function formatBound(atLeast, below) {
  const parts = [];
  if (atLeast !== void 0) parts.push(`≥${formatTokens(atLeast)}`);
  if (below !== void 0) parts.push(`<${formatTokens(below)}`);
  return parts.join(", ");
}
function rowKey(providerId, displayName) {
  return `${providerId}\0${displayName}`;
}
function isDeclared(fact) {
  return fact.state === "known" && fact.confidence === "declared";
}
function scopeFact(row, scope) {
  return scope === "context" ? row.contextTokens : row.maxOutputTokens;
}
function planFor(row, scope) {
  const fact = scopeFact(row, scope);
  const familyHint = familyRuleLayer(row.actualModelId)?.hint;
  const hintTokens = fact.state === "known" ? fact.value : scope === "context" ? familyHint?.contextTokens : familyHint?.maxOutputTokens;
  const hintSource = fact.state === "known" ? "declared" : hintTokens === void 0 ? void 0 : "family-rule";
  return scope === "context" ? planContextProbe({ hintTokens, hintSource }) : planOutputProbe({ hintTokens, hintSource });
}
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}
function ModelMetadataPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [report, setReport] = reactExports.useState(null);
  const [loading, setLoading] = reactExports.useState(true);
  const [error, setError] = reactExports.useState(null);
  const [probing, setProbing] = reactExports.useState(null);
  const [dialog, setDialog] = reactExports.useState(null);
  const [force, setForce] = reactExports.useState(false);
  const [running, setRunning] = reactExports.useState(false);
  const [jobSnapshot, setJobSnapshot] = reactExports.useState(null);
  const [tick, setTick] = reactExports.useState(0);
  const [lastScope, setLastScope] = reactExports.useState(null);
  const runningModeRef = reactExports.useRef(null);
  const [probeWithBatch, setProbeWithBatch] = reactExports.useState(false);
  const [batchSnapshot, setBatchSnapshot] = reactExports.useState(null);
  const [batchEstimate, setBatchEstimate] = reactExports.useState(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = reactExports.useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = reactExports.useState(false);
  const [batchStarting, setBatchStarting] = reactExports.useState(false);
  const [catalogStatuses, setCatalogStatuses] = reactExports.useState([]);
  const [catalogErrors, setCatalogErrors] = reactExports.useState({});
  const [catalogAttempts, setCatalogAttempts] = reactExports.useState({});
  const [refreshingCatalog, setRefreshingCatalog] = reactExports.useState(null);
  const [catalogDialog, setCatalogDialog] = reactExports.useState(null);
  const [mirrorUrl, setMirrorUrl] = reactExports.useState("");
  const [mirrorSaving, setMirrorSaving] = reactExports.useState(false);
  const loadCatalog = reactExports.useCallback(async () => {
    if (!window.electronAPI?.providers?.getCatalogStatuses) return;
    try {
      setCatalogStatuses(await window.electronAPI.providers.getCatalogStatuses());
    } catch {
    }
  }, []);
  reactExports.useEffect(() => {
    const api = window.electronAPI;
    if (!api?.config?.get) return;
    void api.config.get().then((config) => setMirrorUrl(config.catalogMirrorUrl ?? "")).catch(() => void 0);
  }, []);
  const saveMirrorUrl = reactExports.useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.config?.update) return;
    const mirror = sanitizeCatalogMirrorUrl(mirrorUrl);
    if (mirror === void 0) {
      toast({ title: t("models.metadata.catalogMirrorInvalid"), variant: "destructive" });
      return;
    }
    setMirrorSaving(true);
    try {
      const saved = await api.config.update({ catalogMirrorUrl: mirror });
      if (!saved) {
        toast({ title: t("models.metadata.catalogMirrorInvalid"), variant: "destructive" });
        return;
      }
      setMirrorUrl(mirror);
      toast({ title: t("models.metadata.catalogMirrorSaved") });
    } finally {
      setMirrorSaving(false);
    }
  }, [mirrorUrl, t, toast]);
  const refreshCatalogSource = reactExports.useCallback(
    async (source) => {
      if (!window.electronAPI?.providers?.refreshCatalog) return;
      setRefreshingCatalog(source);
      try {
        const result = await window.electronAPI.providers.refreshCatalog(source);
        setCatalogStatuses(result.statuses);
        if (result.attempts && result.attempts.length > 0) {
          setCatalogAttempts((current) => ({ ...current, [source]: result.attempts }));
        }
        if (result.success) {
          setCatalogErrors((current) => {
            if (!current[source]) return current;
            const next = { ...current };
            delete next[source];
            return next;
          });
          toast({
            title: t("models.metadata.catalogRefreshDone"),
            description: result.usedEndpoint ? `${CATALOG_SOURCE_META[source].label} · ${result.usedEndpoint}` : CATALOG_SOURCE_META[source].label
          });
        } else {
          const message = result.error ?? "";
          setCatalogErrors((current) => ({ ...current, [source]: message }));
          toast({
            title: t("models.metadata.catalogRefreshFailed"),
            description: `${message} · ${t("models.metadata.catalogKeptOld")}`,
            variant: "destructive"
          });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setCatalogErrors((current) => ({ ...current, [source]: message }));
        toast({
          title: t("models.metadata.catalogRefreshFailed"),
          description: `${message} · ${t("models.metadata.catalogKeptOld")}`,
          variant: "destructive"
        });
      } finally {
        setRefreshingCatalog(null);
      }
    },
    [t, toast]
  );
  const load = reactExports.useCallback(async () => {
    if (!window.electronAPI?.providers?.getModelMetadata) {
      setError(t("models.metadata.unavailable"));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.providers.getModelMetadata();
      if ("success" in result && result.success === false) {
        setError(result.error);
        setReport(null);
      } else {
        setReport(result);
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("models.metadata.unavailable"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  reactExports.useEffect(() => {
    void load();
    void loadCatalog();
  }, [load, loadCatalog]);
  reactExports.useEffect(() => {
    const api = window.electronAPI?.providers;
    if (!api?.onProbeProgress) return;
    const unsubscribe = api.onProbeProgress((event) => {
      const snapshot = event;
      setJobSnapshot(snapshot);
      setTick((current) => current + 1);
      if (runningModeRef.current === "single" && snapshot.jobId !== "" && (snapshot.status === "done" || snapshot.status === "failed" || snapshot.status === "cancelled")) {
        setRunning(false);
        setProbing(null);
        runningModeRef.current = null;
      }
    });
    return unsubscribe;
  }, []);
  reactExports.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((current) => current + 1), 1e3);
    return () => clearInterval(timer);
  }, [running]);
  const closeDialog = reactExports.useCallback(() => {
    setDialog(null);
    setForce(false);
  }, []);
  const describeResult = reactExports.useCallback(
    (status, reason, atLeast, below) => {
      const label = t(STATUS_LABEL_KEYS[status] ?? "models.metadata.probeStatusInconclusive");
      if (status === "measured" && (atLeast !== void 0 || below !== void 0)) {
        const range = formatBound(atLeast, below);
        return `${label} · ${t("models.metadata.probeRangeLabel", { range })}`;
      }
      return reason ? `${label} · ${t("models.metadata.probeReasonLabel", { reason })}` : label;
    },
    [t]
  );
  const runOne = reactExports.useCallback(
    async (row, scope) => {
      if (!window.electronAPI?.providers?.probeModel) return;
      const key = rowKey(row.providerId, row.displayName);
      setProbing(key);
      setLastScope(scope);
      try {
        const response = await window.electronAPI.providers.probeModel(
          row.providerId,
          row.displayName,
          scope,
          force
        );
        if (!response.success || !response.result) {
          toast({
            title: t("models.metadata.probeFailed"),
            description: response.error ?? row.displayName,
            variant: "destructive"
          });
          return;
        }
        const result = response.result;
        const range = scope === "context" ? result.row?.contextRange : scope === "output" ? result.row?.maxOutputRange : void 0;
        if (result.status === "inconclusive" && result.reason?.includes("已取消")) {
          toast({
            title: t("models.metadata.probeCancelled"),
            description: `${row.displayName} · ${result.reason}`
          });
          return;
        }
        const detail = scope === "capability" ? t("models.metadata.probeSuccess") : describeResult(result.status, result.reason, range?.atLeast, range?.below);
        toast({
          title: t("models.metadata.probeSuccess"),
          description: `${row.displayName} · ${detail}`
        });
        await load();
      } finally {
        setProbing(null);
      }
    },
    [describeResult, force, load, t, toast]
  );
  const handleRunSingle = reactExports.useCallback(
    async (scope) => {
      if (!dialog || dialog.mode !== "single") return;
      runningModeRef.current = "single";
      setRunning(true);
      setJobSnapshot(null);
      try {
        await runOne(dialog.row, scope);
      } finally {
        setRunning(false);
        runningModeRef.current = null;
      }
    },
    [dialog, runOne]
  );
  const openSingle = reactExports.useCallback(async (row) => {
    setForce(false);
    setLastScope(null);
    setJobSnapshot(null);
    setRunning(false);
    setDialog({ mode: "single", row });
    const api = window.electronAPI?.providers;
    if (!api?.getProbeJobs) return;
    try {
      const jobs = await api.getProbeJobs();
      const active = jobs.find(
        (job) => job.status === "running" && job.providerId === row.providerId && job.displayName === row.displayName
      );
      if (active) {
        runningModeRef.current = "single";
        setJobSnapshot(active);
        setRunning(true);
        setProbing(rowKey(row.providerId, row.displayName));
      }
    } catch {
    }
  }, []);
  const cancelActiveProbe = reactExports.useCallback(async () => {
    const jobId = jobSnapshot?.jobId;
    if (!jobId || !window.electronAPI?.providers?.cancelProbe) return;
    await window.electronAPI.providers.cancelProbe(jobId);
  }, [jobSnapshot?.jobId]);
  reactExports.useEffect(() => {
    const api = window.electronAPI?.providers;
    if (!api?.getCatalogBatchJobs) return;
    void api.getCatalogBatchJobs().then((jobs) => {
      if (jobs.length > 0) setBatchSnapshot(jobs[0]);
    }).catch(() => void 0);
  }, []);
  reactExports.useEffect(() => {
    const api = window.electronAPI?.providers;
    if (!api?.onCatalogBatchProgress) return;
    return api.onCatalogBatchProgress((snapshot) => setBatchSnapshot(snapshot));
  }, []);
  const batchRefreshedRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    const snapshot = batchSnapshot;
    if (!snapshot) return;
    if (snapshot.status !== "done" && snapshot.status !== "cancelled" && snapshot.status !== "failed") {
      return;
    }
    if (batchRefreshedRef.current === snapshot.jobId) return;
    batchRefreshedRef.current = snapshot.jobId;
    void load();
    void loadCatalog();
  }, [batchSnapshot, load, loadCatalog]);
  const startBatch = reactExports.useCallback(
    async (probe, retryFailedOf) => {
      const api = window.electronAPI?.providers;
      if (!api?.startCatalogBatch) return;
      setBatchStarting(true);
      try {
        const result = await api.startCatalogBatch({ probe, retryFailedOf });
        if (!result.success || !result.snapshot) {
          toast({
            title: t("models.metadata.batchFailed"),
            description: result.error ?? t("models.metadata.batchNoTargets"),
            variant: "destructive"
          });
          return;
        }
        setBatchSnapshot(result.snapshot);
        setBatchConfirmOpen(false);
        setBatchDialogOpen(true);
      } catch (cause) {
        toast({
          title: t("models.metadata.batchFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
          variant: "destructive"
        });
      } finally {
        setBatchStarting(false);
      }
    },
    [t, toast]
  );
  const openBatch = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    if (!api) return;
    try {
      const jobs = await api.getCatalogBatchJobs?.();
      const active = jobs?.find(
        (job) => job.status === "running" || job.status === "paused"
      );
      if (active) {
        setBatchSnapshot(active);
        setBatchDialogOpen(true);
        return;
      }
    } catch {
    }
    if (!probeWithBatch) {
      await startBatch(false);
      return;
    }
    setBatchStarting(true);
    try {
      const estimate = await api.estimateCatalogBatch?.();
      if (!estimate) return;
      setBatchEstimate(estimate);
      setBatchConfirmOpen(true);
    } finally {
      setBatchStarting(false);
    }
  }, [probeWithBatch, startBatch]);
  const pauseBatch = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    const jobId = batchSnapshot?.jobId;
    if (!api?.pauseCatalogBatch || !jobId) return;
    await api.pauseCatalogBatch(jobId);
  }, [batchSnapshot?.jobId]);
  const resumeBatch = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    const jobId = batchSnapshot?.jobId;
    if (!api?.resumeCatalogBatch || !jobId) return;
    await api.resumeCatalogBatch(jobId);
  }, [batchSnapshot?.jobId]);
  const cancelBatch = reactExports.useCallback(async () => {
    const api = window.electronAPI?.providers;
    const jobId = batchSnapshot?.jobId;
    if (!api?.cancelCatalogBatch || !jobId) return;
    await api.cancelCatalogBatch(jobId);
  }, [batchSnapshot?.jobId]);
  const batchActive = batchSnapshot !== null && (batchSnapshot.status === "running" || batchSnapshot.status === "paused");
  const batchRunning = batchSnapshot !== null && batchSnapshot.status === "running";
  reactExports.useEffect(() => {
    if (!batchActive) return;
    const timer = setInterval(() => setTick((current) => current + 1), 1e3);
    return () => clearInterval(timer);
  }, [batchActive]);
  const activeJob = jobSnapshot && dialog?.mode === "single" && jobSnapshot.providerId === dialog.row.providerId && jobSnapshot.displayName === dialog.row.displayName ? jobSnapshot : null;
  const elapsedSeconds = activeJob ? Math.max(0, Math.round((Date.now() - Date.parse(activeJob.startedAt)) / 1e3)) : 0;
  if (loading && !report) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex items-center justify-center gap-2 py-16 text-muted-foreground", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
      t("models.metadata.loading")
    ] }) });
  }
  if (error && !report) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col items-center gap-3 py-16", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-destructive", children: error }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", size: "sm", onClick: () => void load(), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "mr-2 h-4 w-4" }),
        t("models.metadata.retry")
      ] })
    ] }) });
  }
  if (!report) return null;
  const gapKinds = report.totals.routingIncompleteByKind ?? {
    adoptable: 0,
    "missing-field": 0,
    "no-candidate": 0,
    "not-chat": 0
  };
  const coverageRows = METADATA_ATTRIBUTES.map((attribute) => ({
    attribute,
    ...report.coverage[attribute],
    gap: report.coverageGaps[attribute],
    critical: ROUTING_METADATA_ATTRIBUTES.includes(attribute)
  }));
  const batchAvailable = report.queue.length > 0;
  const batchElapsedMs = batchSnapshot ? batchActive ? Math.max(batchSnapshot.elapsedMs, Date.now() - new Date(batchSnapshot.startedAt).getTime()) : batchSnapshot.elapsedMs : 0;
  const batchPercent = batchSnapshot && batchSnapshot.totalModels > 0 ? Math.min(100, Math.round(batchSnapshot.processedModels / batchSnapshot.totalModels * 100)) : 0;
  const batchBackoffSeconds = batchSnapshot?.backoffUntil ? Math.max(0, Math.ceil((new Date(batchSnapshot.backoffUntil).getTime() - Date.now()) / 1e3)) : 0;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { className: "flex flex-row items-start justify-between gap-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("models.metadata.coverageTitle") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("models.metadata.coverageDesc") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex shrink-0 flex-col items-end gap-2", children: [
          batchAvailable && /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "checkbox",
                checked: probeWithBatch,
                disabled: batchActive,
                onChange: (event) => setProbeWithBatch(event.target.checked)
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-right", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-foreground", children: t("models.metadata.batchProbeToggle") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block", children: t("models.metadata.batchProbeToggleHint") })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
            batchAvailable && /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                variant: "secondary",
                size: "sm",
                disabled: batchStarting,
                onClick: () => void openBatch(),
                children: [
                  batchStarting || batchActive && batchRunning ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Radar, { className: "mr-2 h-4 w-4" }),
                  batchActive ? t("models.metadata.batchViewProgress") : t("models.metadata.batchAll")
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", size: "sm", onClick: () => void load(), disabled: loading, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: `mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}` }),
              t("models.metadata.refresh")
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-lg border p-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("models.metadata.totalModels") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-2xl font-semibold", children: report.totals.models })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-lg border p-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("models.metadata.routingComplete") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-2xl font-semibold text-success", children: report.totals.routingComplete }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("models.metadata.fullyAnnotatedHint", { count: report.totals.fullyAnnotated }) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-lg border p-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("models.metadata.routingIncomplete") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-2xl font-semibold text-warning", children: report.totals.routingIncomplete }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-1 space-y-0.5 text-[11px] text-muted-foreground", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.gapKindAdoptable", { count: gapKinds.adoptable }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.gapKindMissingField", { count: gapKinds["missing-field"] }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.gapKindNoCandidate", { count: gapKinds["no-candidate"] }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.gapKindNotChat", { count: gapKinds["not-chat"] }) })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-2", children: coverageRows.map((row) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "w-32 shrink-0 text-sm", children: [
            t(ATTRIBUTE_LABEL_KEYS[row.attribute]),
            !row.critical && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-1 text-[10px] text-muted-foreground", children: t("models.metadata.referenceAttribute") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-2 flex-1 overflow-hidden rounded-full bg-muted", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "div",
            {
              className: "h-full rounded-full bg-primary transition-all",
              style: { width: `${Math.round(row.rate * 100)}%` }
            }
          ) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "w-40 shrink-0 text-right text-xs text-muted-foreground", children: [
            Math.round(row.rate * 100),
            "% · ",
            row.known,
            "/",
            row.applicable,
            row.notApplicable > 0 && ` · ${t("models.metadata.notApplicable", { count: row.notApplicable })}`
          ] })
        ] }, row.attribute)) })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("models.metadata.catalogTitle") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("models.metadata.catalogDesc") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-3", children: [
        CATALOG_SOURCES.map((source) => {
          const meta = CATALOG_SOURCE_META[source];
          const status = catalogStatuses.find((item) => item.source === source);
          const refreshing = refreshingCatalog === source;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-lg border p-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 space-y-1", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-sm font-medium", children: meta.label }),
                  status ? /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-success", children: t("models.metadata.catalogReady", { count: status.entryCount }) }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-warning", children: t("models.metadata.catalogNotFetched") }),
                  status?.builtin && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-info", children: t("models.metadata.catalogBuiltinBadge", {
                    date: formatDate(status.fetchedAt)
                  }) })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "break-all text-[11px] text-muted-foreground", children: status?.sourceUrl ?? meta.sourceUrl })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  className: "shrink-0",
                  disabled: refreshingCatalog !== null,
                  onClick: () => void refreshCatalogSource(source),
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: `mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}` }),
                    refreshing ? t("models.metadata.catalogRefreshing") : t("models.metadata.catalogRefresh")
                  ]
                }
              )
            ] }),
            status && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 space-y-0.5 text-[11px] text-muted-foreground", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: status.builtin ? t("models.metadata.catalogBuiltinFetchedAt", {
                date: formatDate(status.fetchedAt)
              }) : t("models.metadata.catalogFetchedAt", {
                time: new Date(status.fetchedAt).toLocaleString()
              }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.catalogLicense", { license: status.license }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.catalogAttribution", {
                attribution: status.attribution
              }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "break-all", children: t("models.metadata.catalogHash", { hash: status.contentHash.slice(0, 12) }) })
            ] }),
            source === "litellm" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 space-y-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "input",
                  {
                    className: "h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs",
                    value: mirrorUrl,
                    placeholder: "https://example.com/model_prices_and_context_window.json",
                    onChange: (event) => setMirrorUrl(event.target.value)
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsxs(
                  Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: mirrorSaving,
                    onClick: () => void saveMirrorUrl(),
                    children: [
                      mirrorSaving ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-3.5 w-3.5 animate-spin" }) : null,
                      t("models.metadata.catalogMirrorSave")
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.catalogMirrorHint") })
            ] }),
            catalogAttempts[source] && catalogAttempts[source].length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 space-y-0.5 rounded-md border bg-muted/30 px-2 py-1 text-[11px]", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "font-medium text-muted-foreground", children: t("models.metadata.catalogEndpointAttempts") }),
              catalogAttempts[source].map((attempt) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-1.5", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: t(`models.metadata.catalogEndpoint_${attempt.label}`) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: attempt.status !== void 0 ? `HTTP ${attempt.status}` : t("models.metadata.catalogEndpointFailed") }),
                attempt.errorKind && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t(`models.metadata.catalogErrorKind_${attempt.errorKind}`) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: formatDuration(attempt.elapsedMs) }),
                attempt.bytes !== void 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
                  attempt.bytes,
                  " B"
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "break-all text-muted-foreground", children: attempt.url }),
                attempt.error && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-destructive", children: attempt.error })
              ] }, attempt.url))
            ] }),
            catalogErrors[source] && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive", children: [
              t("models.metadata.catalogSourceError", {
                error: catalogErrors[source] ?? ""
              }),
              status?.builtin ? ` · ${t("models.metadata.catalogUsingBuiltin", {
                date: formatDate(status.fetchedAt)
              })}` : ""
            ] })
          ] }, source);
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.catalogLicenseNotice") })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: t("models.metadata.queueTitle") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(CardDescription, { children: t("models.metadata.queueDesc") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { children: [
        report.queue.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "py-10 text-center text-sm text-muted-foreground", children: t("models.metadata.emptyQueue") }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(Table, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(TableRow, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.metadata.columnModel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.metadata.columnContext") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.metadata.columnMaxOutput") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { children: t("models.metadata.columnMissing") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "text-right", children: t("models.metadata.columnCalls") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "text-right", children: t("models.metadata.columnActions") })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableBody, { children: report.queue.slice(0, 50).map((row) => {
            const key = rowKey(row.providerId, row.displayName);
            return /* @__PURE__ */ jsxRuntimeExports.jsxs(TableRow, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-0.5", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "rounded bg-muted px-2 py-1 text-sm", children: row.displayName }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[11px] text-muted-foreground", children: row.providerId })
              ] }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(FactCell, { fact: row.contextTokens, t }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(FactCell, { fact: row.maxOutputTokens, t }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-1", children: [
                !row.critical && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-muted-foreground", children: t("models.metadata.referenceOnlyBadge") }),
                row.gapKind === "not-chat" && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-muted-foreground", children: t("models.metadata.gapKindNotChatBadge") }),
                row.gapKind === "no-candidate" && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "text-muted-foreground", children: t("models.metadata.gapKindNoCandidateBadge") }),
                row.missing.filter((attribute) => attribute !== "contextTokens" && attribute !== "maxOutputTokens").slice(0, 4).map((attribute) => /* @__PURE__ */ jsxRuntimeExports.jsx(
                  Badge,
                  {
                    variant: "outline",
                    className: row.critical ? "text-warning" : "text-muted-foreground",
                    children: t(ATTRIBUTE_LABEL_KEYS[attribute])
                  },
                  attribute
                )),
                row.missing.length > 4 && /* @__PURE__ */ jsxRuntimeExports.jsxs(Badge, { variant: "outline", children: [
                  "+",
                  row.missing.length - 4
                ] })
              ] }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "text-right text-sm", children: row.calls }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "text-right", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-end gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs(
                  Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: running || batchActive,
                    onClick: () => setCatalogDialog(row),
                    children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx(Database, { className: "mr-2 h-4 w-4" }),
                      t("models.metadata.annotate")
                    ]
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsxs(
                  Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: batchActive || running && probing !== key,
                    onClick: () => void openSingle(row),
                    children: [
                      probing === key ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Radar, { className: "mr-2 h-4 w-4" }),
                      probing === key ? t("models.metadata.probing") : t("models.metadata.probe")
                    ]
                  }
                )
              ] }) })
            ] }, key);
          }) })
        ] }),
        report.queue.length > 50 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "pt-3 text-xs text-muted-foreground", children: t("models.metadata.queueTruncated", { shown: 50, total: report.queue.length }) })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: dialog !== null, onOpenChange: (open) => !open ? closeDialog() : void 0, children: /* @__PURE__ */ jsxRuntimeExports.jsx(DialogContent, { className: "max-w-xl max-h-[85vh] overflow-y-auto", children: dialog?.mode === "single" && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("models.metadata.probeDialogTitle", { model: dialog.row.displayName }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("models.metadata.probeDialogDesc") })
      ] }),
      activeJob && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 rounded-md border border-info/40 bg-info/5 p-3 text-xs", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-info", children: activeJob.phase === "tier" || activeJob.phase === "awaiting" ? t(
            activeJob.phase === "tier" ? "models.metadata.probePhaseTier" : "models.metadata.probePhaseAwaiting",
            {
              index: activeJob.tierIndex ?? 0,
              count: activeJob.tierCount ?? 0,
              tokens: formatTokens(activeJob.tierTokens ?? 0)
            }
          ) : t(PROBE_PHASE_LABEL_KEYS[activeJob.phase]) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tabular-nums text-muted-foreground", children: t("models.metadata.probeElapsed", { seconds: elapsedSeconds }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2 text-muted-foreground", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("models.metadata.probeRequestsSent", {
            sent: activeJob.requestsSent,
            limit: activeJob.requestLimit
          }) }),
          running && /* @__PURE__ */ jsxRuntimeExports.jsx(
            Button,
            {
              size: "sm",
              variant: "outline",
              className: "h-6 px-2 text-xs",
              onClick: () => void cancelActiveProbe(),
              children: t("models.metadata.probeStop")
            }
          )
        ] }),
        activeJob.requestLimit > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-1 w-full overflow-hidden rounded bg-muted", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: "h-full bg-info transition-all",
            style: {
              width: `${Math.min(
                100,
                Math.round(activeJob.requestsSent / Math.max(1, activeJob.requestLimit) * 100)
              )}%`
            }
          }
        ) }),
        activeJob.errorKind && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-destructive", children: [
          t(PROBE_FAILURE_LABEL_KEYS[activeJob.errorKind]),
          activeJob.message ? ` · ${activeJob.message}` : ""
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-start gap-2 rounded-md border p-3 text-sm", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "checkbox",
            className: "mt-1",
            checked: force,
            disabled: running,
            onChange: (event) => setForce(event.target.checked)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: t("models.metadata.forceProbe") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-xs text-muted-foreground", children: t("models.metadata.forceProbeHint") })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3", children: [
        ["context", "output"].map((scope) => {
          const fact = scopeFact(dialog.row, scope);
          const declared = isDeclared(fact);
          const plan = planFor(dialog.row, scope);
          const blocked = declared && !force;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-md border p-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-sm font-medium", children: scope === "context" ? t("models.metadata.probeContextScope") : t("models.metadata.probeOutputScope") }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-1", children: /* @__PURE__ */ jsxRuntimeExports.jsx(FactCell, { fact, t }) })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  size: "sm",
                  variant: "outline",
                  disabled: running || blocked || plan.requestCount === 0,
                  onClick: () => void handleRunSingle(scope),
                  children: t("models.metadata.probe")
                }
              )
            ] }),
            blocked ? /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "mt-2 text-xs text-success", children: [
              t("models.metadata.probeDeclared"),
              fact.state === "known" ? ` · ${t("models.metadata.probeDeclaredSource", { source: t(SOURCE_LABEL_KEYS[fact.source] ?? "") })}` : ""
            ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "mt-2 text-xs text-muted-foreground", children: [
              t("models.metadata.probeEstimate", {
                requests: plan.requestCount,
                tokens: formatTokens(plan.estimatedInputTokens + plan.estimatedOutputTokens)
              }),
              " · ",
              t("models.metadata.probeEstimateSplit", {
                input: formatTokens(plan.estimatedInputTokens),
                output: formatTokens(plan.estimatedOutputTokens)
              })
            ] })
          ] }, scope);
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border p-3", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-sm font-medium", children: t("models.metadata.probeCapabilityScope") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-xs text-muted-foreground", children: t("models.metadata.probeEstimate", { requests: 3, tokens: 144 }) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Button,
            {
              size: "sm",
              variant: "outline",
              disabled: running,
              onClick: () => void handleRunSingle("capability"),
              children: t("models.metadata.probe")
            }
          )
        ] }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
        activeJob && !running && lastScope && (activeJob.status === "failed" || activeJob.status === "cancelled" || activeJob.result?.status === "inconclusive") && /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", onClick: () => void handleRunSingle(lastScope), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, { className: "mr-2 h-4 w-4" }),
          t("models.metadata.probeRetry")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", onClick: closeDialog, children: t("models.metadata.probeClose") })
      ] })
    ] }) }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: batchDialogOpen && batchSnapshot !== null,
        onOpenChange: (open) => !open ? setBatchDialogOpen(false) : void 0,
        children: /* @__PURE__ */ jsxRuntimeExports.jsx(DialogContent, { className: "max-w-xl max-h-[85vh] overflow-y-auto", children: batchSnapshot && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("models.metadata.batchProgressTitle") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogDescription, { children: [
              t(`models.metadata.batchPhase_${batchSnapshot.phase}`),
              batchSnapshot.status === "paused" ? ` · ${t("models.metadata.batchPausedLabel")}` : ""
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("models.metadata.batchProcessed", {
                  done: batchSnapshot.processedModels,
                  total: batchSnapshot.totalModels,
                  percent: batchPercent
                }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tabular-nums text-muted-foreground", children: t("models.metadata.batchElapsed", { time: formatDuration(batchElapsedMs) }) })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-1 h-1.5 w-full overflow-hidden rounded bg-muted", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
                "div",
                {
                  className: "h-full bg-info transition-all",
                  style: { width: `${batchPercent}%` }
                }
              ) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
                  t("models.metadata.batchCurrentModel"),
                  " · ",
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-foreground", children: batchSnapshot.currentModel ?? "—" }),
                  batchSnapshot.currentStatus ? ` · ${t(`models.metadata.batchStatus_${batchSnapshot.currentStatus}`)}` : ""
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tabular-nums", children: t("models.metadata.batchEta", {
                  time: batchSnapshot.estimatedRemainingMs === void 0 ? "—" : formatDuration(batchSnapshot.estimatedRemainingMs)
                }) })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-2 rounded-md border p-3 text-center", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-lg font-semibold text-success", children: batchSnapshot.success }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.batchSuccess") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-lg font-semibold", children: batchSnapshot.skipped }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.batchSkippedCount") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-lg font-semibold text-destructive", children: batchSnapshot.failed }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.batchFailedCount") })
              ] })
            ] }),
            batchSnapshot.skippedDisabled > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("models.metadata.batchSkippedDisabled", {
              count: batchSnapshot.skippedDisabled
            }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 text-xs text-muted-foreground", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.batchAdopted", {
                fields: batchSnapshot.adoptedFields,
                exact: batchSnapshot.exactAdoptedModels,
                alias: batchSnapshot.aliasAdoptedModels.length
              }) }),
              batchSnapshot.measuredFields > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.batchMeasuredFields", {
                count: batchSnapshot.measuredFields
              }) }),
              batchSnapshot.aliasAdoptedModels.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "break-all", children: t("models.metadata.batchAliasAdopted", {
                models: batchSnapshot.aliasAdoptedModels.slice(0, 8).join("、")
              }) }),
              batchSnapshot.familyCandidates > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.batchFamilyCandidates", {
                count: batchSnapshot.familyCandidates
              }) }),
              batchSnapshot.probeEnabled && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.batchProbeUsage", {
                sent: batchSnapshot.requestsSent,
                limit: batchSnapshot.requestLimit
              }) })
            ] }),
            batchBackoffSeconds > 0 && batchSnapshot.status === "running" && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-xs text-warning", children: t("models.metadata.batchBackoff", { seconds: batchBackoffSeconds }) }),
            batchSnapshot.lastError && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive", children: batchSnapshot.lastError }),
            batchSnapshot.failedModels.length > 0 && (batchSnapshot.status === "done" || batchSnapshot.status === "cancelled" || batchSnapshot.status === "failed") && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5 rounded-md border p-2 text-xs", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "font-medium", children: t("models.metadata.batchFailedList") }),
              batchSnapshot.failedModels.slice(0, 8).map((failure) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-1.5", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: failure.displayName }),
                failure.error && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "break-all text-destructive", children: failure.error })
              ] }, `${failure.providerId}:${failure.displayName}`))
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
            batchSnapshot.status === "running" && /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => void pauseBatch(), children: t("models.metadata.batchPause") }),
            batchSnapshot.status === "paused" && /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => void resumeBatch(), children: t("models.metadata.batchResume") }),
            batchActive && /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "destructive", onClick: () => void cancelBatch(), children: t("models.metadata.batchCancelRun") }),
            !batchActive && batchSnapshot.failedModels.length > 0 && batchSnapshot.status !== "failed" && /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                variant: "outline",
                disabled: batchStarting,
                onClick: () => void startBatch(batchSnapshot.probeEnabled, batchSnapshot.jobId),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, { className: "mr-2 h-4 w-4" }),
                  t("models.metadata.batchRetryFailed")
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", onClick: () => setBatchDialogOpen(false), children: t("models.metadata.probeClose") })
          ] })
        ] }) })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Dialog,
      {
        open: batchConfirmOpen && batchEstimate !== null,
        onOpenChange: (open) => !open ? setBatchConfirmOpen(false) : void 0,
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-md", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("models.metadata.batchConfirmTitle") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("models.metadata.batchConfirmDesc") })
          ] }),
          batchEstimate && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1 rounded-md border p-3 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.batchModels", {
              selected: batchEstimate.models,
              total: batchEstimate.models + batchEstimate.skippedDisabled
            }) }),
            batchEstimate.skippedDisabled > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-xs text-muted-foreground", children: t("models.metadata.batchSkippedDisabled", {
              count: batchEstimate.skippedDisabled
            }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-xs text-muted-foreground", children: [
              t("models.metadata.batchFields", { count: batchEstimate.fields }),
              " · ",
              t("models.metadata.batchMatchBreakdown", {
                exact: batchEstimate.exactModels,
                alias: batchEstimate.aliasModels,
                family: batchEstimate.familyCandidates
              })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: t("models.metadata.batchProbeModels", { count: batchEstimate.probeModels }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              t("models.metadata.probeRequests", { count: batchEstimate.requests }),
              " · ",
              t("models.metadata.probeTokens", {
                tokens: formatTokens(batchEstimate.tokens)
              })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] text-muted-foreground", children: t("models.metadata.batchConfirmOnce") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", onClick: () => setBatchConfirmOpen(false), children: t("models.metadata.batchConfirmCancel") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              Button,
              {
                disabled: batchStarting,
                onClick: () => void startBatch(true),
                children: [
                  batchStarting ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Radar, { className: "mr-2 h-4 w-4" }),
                  t("models.metadata.batchConfirmStart")
                ]
              }
            )
          ] })
        ] })
      }
    ),
    catalogDialog && /* @__PURE__ */ jsxRuntimeExports.jsx(
      ModelAnnotationDialog,
      {
        providerId: catalogDialog.providerId,
        displayName: catalogDialog.displayName,
        onClose: () => setCatalogDialog(null),
        onChanged: () => void load()
      }
    )
  ] });
}
function Models() {
  const { t } = useTranslation();
  const { fetchAppConfig } = useProxyStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = reactExports.useState(tabFromUrl || "list");
  const hasLoadedRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    fetchAppConfig();
  }, [fetchAppConfig]);
  reactExports.useEffect(() => {
    if (tabFromUrl && ["list", "mapping", "metadata"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);
  const handleTabChange = (value) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-2xl font-bold tracking-tight", children: t("models.title") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-muted-foreground", children: t("models.description") })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Tabs, { value: activeTab, onValueChange: handleTabChange, className: "w-full", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsList, { className: "grid h-auto w-full grid-cols-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "list", className: "flex items-center gap-2 py-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Database, { className: "h-4 w-4" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hidden sm:inline", children: t("models.modelList") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "mapping", className: "flex items-center gap-2 py-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(ArrowRight, { className: "h-4 w-4" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hidden sm:inline", children: t("models.modelMapping") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(TabsTrigger, { value: "metadata", className: "flex items-center gap-2 py-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(ListChecks, { className: "h-4 w-4" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hidden sm:inline", children: t("models.metadataTab") })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "list", className: "mt-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ModelList, {}) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "mapping", className: "mt-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ModelMappingConfig, {}) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(TabsContent, { value: "metadata", className: "mt-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ModelMetadataPanel, {}) })
    ] })
  ] });
}
export {
  Models,
  Models as default
};
