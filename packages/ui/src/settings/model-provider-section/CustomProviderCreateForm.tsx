import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import type { ProviderApiType, ProviderSettingsTemplateView } from "@zcode/provider";
import {
  TID_MODEL_PROVIDER_BASE_URL_INPUT,
  TID_MODEL_PROVIDER_CUSTOM_CATALOG_ITEM,
  TID_MODEL_PROVIDER_CUSTOM_CATALOG_TRIGGER,
  TID_MODEL_PROVIDER_CUSTOM_CATALOG_SEARCH,
  TID_MODEL_PROVIDER_CUSTOM_FETCH_MODELS_BUTTON,
  TID_MODEL_PROVIDER_CUSTOM_FETCHED_MODEL_ITEM,
  TID_MODEL_PROVIDER_CUSTOM_SUBMIT_BUTTON,
  TID_MODEL_PROVIDER_TEMPLATE_BACK_BUTTON,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ApiKeyInput } from "./ApiKeyInput.js";
import { fetchProviderModelIds } from "./fetchProviderModels.js";
import { ProviderApiFormatSelect, resolveProviderConnectionApiFormatOptions } from "./ProviderApiFormatSelect.js";
import { ProviderLogo } from "./ProviderLogo.js";

/** 目录里没有目标供应商时的占位项；选中后所有字段都需要手填。 */
const MANUAL_ENTRY_VALUE = "__manual__";

/** 有针对性文案的失败码；其余走通用文案。 */
const KNOWN_FETCH_ERROR_CODES = new Set([
  "missing-base-url",
  "invalid-base-url",
  "invalid-json",
  "unexpected-shape",
  "empty",
  "http-401",
  "http-403",
  "http-404",
  "http-429",
]);

export interface CustomProviderCreateSubmit {
  /** 目录条目被选中时带上 templateId，让模板模型规则继续生效。 */
  readonly templateId?: string;
  readonly providerName: string;
  readonly api: { readonly type: ProviderApiType; readonly baseUrl: string };
  readonly apiKey: string;
  /** 需要显式添加的模型；模板已继承的不在此列。 */
  readonly modelIds: readonly string[];
}

/**
 * 自定义供应商创建表单。
 *
 * 目录（templates）即供应商清单：选中条目会预填 api 格式与 baseUrl，
 * 并带上 templateId 让模板模型规则继续为该供应商的模型提供参数；
 * 选「手动填写」则完全自建。api key 一律由用户填写，
 * 「自动拉取模型」用该 key 从端点实时取模型名单，避免等待上游目录更新。
 */
export function CustomProviderCreateForm({
  templates,
  creating,
  initialTemplateId,
  onBack,
  onSubmit,
}: {
  templates: readonly ProviderSettingsTemplateView[];
  creating: boolean;
  /** 从模板选择器进入时预选目录条目，省去用户重新搜索。 */
  initialTemplateId?: string;
  onBack: () => void;
  onSubmit: (input: CustomProviderCreateSubmit) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const initialTemplate = useMemo(
    () => templates.find((item) => item.templateId === initialTemplateId),
    [initialTemplateId, templates],
  );
  const [selected, setSelected] = useState<string>(initialTemplateId ?? MANUAL_ENTRY_VALUE);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [apiType, setApiType] = useState<ProviderApiType>(
    initialTemplate?.config.api?.type ?? "openai-chat-completions",
  );
  const [baseUrl, setBaseUrl] = useState(initialTemplate?.config.api?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<{ code: string; detail?: string } | null>(null);
  const [fetched, setFetched] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const selectedLabel = useMemo(() => {
    if (selected === MANUAL_ENTRY_VALUE) {
      return intl.formatMessage({ id: "settings.modelProvider.customCreate.catalogManual" });
    }
    const item = templates.find((entry) => entry.templateId === selected);
    return item?.templateNameMap["en-US"] ?? item?.templateId ?? selected;
  }, [intl, selected, templates]);

  const template = useMemo(
    () => templates.find((item) => item.templateId === selected),
    [selected, templates],
  );
  const inheritedModelIds = useMemo(
    () => new Set(template?.config.builtinModelIds ?? []),
    [template],
  );
  // 模板已继承的模型不需要重复添加；显式添加会触发「Model 已存在」。
  const addableModelIds = useMemo(
    () => fetched.filter((modelId) => !inheritedModelIds.has(modelId)),
    [fetched, inheritedModelIds],
  );

  // 切换目录条目时重置拉取结果：上一个端点的模型名单对新的 api/baseUrl 无意义。
  useEffect(() => {
    setFetched([]);
    setChecked(new Set());
    setFetchError(null);
  }, [selected]);

  const handleSelect = (value: string) => {
    setSelected(value);
    const next = templates.find((item) => item.templateId === value);
    setApiType(next?.config.api?.type ?? "openai-chat-completions");
    setBaseUrl(next?.config.api?.baseUrl ?? "");
  };

  const handleFetch = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const result = await fetchProviderModelIds({ baseUrl, apiType, apiKey });
      if (result.issue) {
        // 只对已知状态码给出针对性文案；其余（网络失败、5xx）走通用文案并带上细节。
        const separatorIndex = result.issue.indexOf(": ");
        setFetchError({
          code: separatorIndex >= 0 ? result.issue.slice(0, separatorIndex) : result.issue,
          detail: separatorIndex >= 0 ? result.issue.slice(separatorIndex + 2) : undefined,
        });
        setFetched([]);
        setChecked(new Set());
        return;
      }
      setFetched(result.modelIds);
      setChecked(new Set(result.modelIds));
    } finally {
      setFetching(false);
    }
  };

  const toggle = (modelId: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const canSubmit =
    !creating && !submitting && baseUrl.trim().length > 0 && apiKey.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        ...(template ? { templateId: template.templateId } : {}),
        providerName: template?.templateId ?? intl.formatMessage({ id: "settings.modelProvider.newProviderName" }),
        api: { type: apiType, baseUrl: baseUrl.trim() },
        apiKey: apiKey.trim(),
        modelIds: addableModelIds.filter((modelId) => checked.has(modelId)),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5" data-testid="model-provider-custom-create-form">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid={TID_MODEL_PROVIDER_TEMPLATE_BACK_BUTTON}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.templatePickerBack" })}
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
        </Button>
        <h2 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.modelProvider.customCreateTitle" })}
        </h2>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="custom-provider-catalog">
            {intl.formatMessage({ id: "settings.modelProvider.customCreate.catalog" })}
          </Label>
          {/* 目录条目上百，原生 Select 无法搜索；用 Popover + Command 组合框。 */}
          <Popover open={catalogOpen} onOpenChange={setCatalogOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="lg"
                role="combobox"
                aria-expanded={catalogOpen}
                className="w-full justify-between"
                data-testid={TID_MODEL_PROVIDER_CUSTOM_CATALOG_TRIGGER}
              >
                <span className="min-w-0 truncate">{selectedLabel}</span>
                <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.customCreate.catalogSearch",
                  })}
                  data-testid={TID_MODEL_PROVIDER_CUSTOM_CATALOG_SEARCH}
                />
                <CommandList className="max-h-72">
                  <CommandEmpty>
                    {intl.formatMessage({ id: "settings.modelProvider.templatePickerEmpty" })}
                  </CommandEmpty>
                  <CommandItem
                    value={MANUAL_ENTRY_VALUE}
                    onSelect={() => {
                      handleSelect(MANUAL_ENTRY_VALUE);
                      setCatalogOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selected === MANUAL_ENTRY_VALUE ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    {intl.formatMessage({ id: "settings.modelProvider.customCreate.catalogManual" })}
                  </CommandItem>
                  {templates.map((item) => (
                    <CommandItem
                      key={item.templateId}
                      value={`${item.templateId} ${item.templateNameMap["en-US"] ?? ""}`}
                      data-testid={testId(TID_MODEL_PROVIDER_CUSTOM_CATALOG_ITEM, item.templateId)}
                      onSelect={() => {
                        handleSelect(item.templateId);
                        setCatalogOpen(false);
                      }}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          selected === item.templateId ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <ProviderLogo logo={item.config.logo} className="size-5 shrink-0" />
                      <span className="min-w-0 truncate">
                        {item.templateNameMap["en-US"] ?? item.templateId}
                      </span>
                      <span className="ml-2 shrink-0 text-ui-sm text-foreground-subtlest">
                        {item.templateId}
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.customCreate.catalogHint" })}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-provider-api-format">
            {intl.formatMessage({ id: "settings.modelProvider.apiFormat" })}
          </Label>
          <ProviderApiFormatSelect
            apiFormatOptions={resolveProviderConnectionApiFormatOptions()}
            triggerId="custom-provider-api-format"
            value={apiType}
            onChange={setApiType}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-provider-base-url">
            {intl.formatMessage({ id: "settings.modelProvider.baseUrl" })}
          </Label>
          <Input
            id="custom-provider-base-url"
            size="lg"
            data-testid={TID_MODEL_PROVIDER_BASE_URL_INPUT}
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-provider-api-key">
            {intl.formatMessage({ id: "settings.modelProvider.apiKey" })}
          </Label>
          <ApiKeyInput
            value={apiKey}
            visible={apiKeyVisible}
            onChange={setApiKey}
            onBlur={() => undefined}
            onToggleVisibility={() => setApiKeyVisible((current) => !current)}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={fetching || !baseUrl.trim() || !apiKey.trim()}
            data-testid={TID_MODEL_PROVIDER_CUSTOM_FETCH_MODELS_BUTTON}
            onClick={() => void handleFetch()}
          >
            {fetching ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCwIcon className="size-4" aria-hidden="true" />
            )}
            {intl.formatMessage({ id: "settings.modelProvider.customCreate.fetchModels" })}
          </Button>
          {fetchError ? (
            <span role="alert" className="text-ui-sm text-destructive">
              {KNOWN_FETCH_ERROR_CODES.has(fetchError.code)
                ? intl.formatMessage({
                    id: `settings.modelProvider.customCreate.fetchError.${fetchError.code}`,
                  })
                : intl.formatMessage(
                    { id: "settings.modelProvider.customCreate.fetchError.generic" },
                    { detail: fetchError.detail ?? fetchError.code },
                  )}
            </span>
          ) : null}
        </div>

        {addableModelIds.length > 0 ? (
          <div className="space-y-2">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.modelProvider.customCreate.fetchedCount" },
                { count: addableModelIds.length },
              )}
            </span>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-input-border bg-input p-2">
              {addableModelIds.map((modelId) => (
                <label
                  key={modelId}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui-base hover:bg-hover"
                >
                  <Checkbox
                    checked={checked.has(modelId)}
                    onCheckedChange={() => toggle(modelId)}
                    data-testid={testId(TID_MODEL_PROVIDER_CUSTOM_FETCHED_MODEL_ITEM, modelId)}
                  />
                  <span className="min-w-0 flex-1 break-all">{modelId}</span>
                </label>
              ))}
            </div>
            {fetched.length > addableModelIds.length ? (
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({
                  id: "settings.modelProvider.customCreate.inheritedSkipped",
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!canSubmit}
          data-testid={TID_MODEL_PROVIDER_CUSTOM_SUBMIT_BUTTON}
          onClick={() => void handleSubmit()}
        >
          {intl.formatMessage({ id: "settings.modelProvider.customCreate.submit" })}
        </Button>
      </div>
    </section>
  );
}
