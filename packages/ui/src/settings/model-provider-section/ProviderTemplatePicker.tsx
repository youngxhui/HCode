import type { ProviderSettingsView } from "@zcode/services";
import { ArrowLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { resolveProviderTemplateName } from "@zcode/provider";
import { useMemo, useState, type ReactNode } from "react";
import {
  TID_MODEL_PROVIDER_TEMPLATE_BACK_BUTTON,
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_MODEL_PROVIDER_TEMPLATE_PICKER,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { ProviderLogo } from "./ProviderLogo.js";
import { CustomProviderCreateForm, type CustomProviderCreateSubmit } from "./CustomProviderCreateForm.js";
import { useProviderDetailFeedback } from "./ProviderDetailFeedback.js";

type ProviderTemplateCreate = (templateId: string) => Promise<void>;
type CustomProviderCreate = (input: CustomProviderCreateSubmit) => Promise<void>;

/**
 * 供应商模板选择器。
 *
 * 模板层完全来自 models.dev 目录，条目上百，因此搜索是主交互而非附属：
 * 输入框常驻，未输入时展示全部条目（可滚动），输入后按名称与 id 过滤。
 * 自定义创建走独立表单，不在此网格内。
 */
export function ProviderTemplatePicker({
  templates,
  onBack,
  onCreateFromTemplate,
  onCreateCustom,
  creating,
}: {
  templates: ProviderSettingsView["providerTemplates"];
  onBack: () => void;
  onCreateFromTemplate: ProviderTemplateCreate;
  onCreateCustom: CustomProviderCreate;
  creating: boolean;
}) {
  const { intl, locale } = useZCodeIntl();
  const { dismissFeedback, showFeedback } = useProviderDetailFeedback();
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visibleTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return templates;
    return templates.filter((template) => {
      const label = resolveProviderTemplateName(template.templateId, template, locale).toLowerCase();
      return label.includes(normalized) || template.templateId.toLowerCase().includes(normalized);
    });
  }, [locale, query, templates]);

  const createWithFeedback = async (create: () => Promise<void>) => {
    const feedbackKey = "provider-template-create";
    dismissFeedback(feedbackKey);
    try {
      await create();
    } catch (error) {
      // Template 创建失败过去只写日志，用户留在选择页却看不到任何结果。
      // 失败继续留在当前页，并复用详情栏底部反馈横幅提供同一次创建的重试入口。
      // 完整 Schema issues 只进入统一 UI 日志；横幅保持可读摘要，避免原始数组撑满详情区。
      logger.error("[ProviderTemplatePicker] 创建供应商失败", error);
      const retry = () => void createWithFeedback(create);
      showFeedback({
        key: feedbackKey,
        state: "failure",
        message: intl.formatMessage({ id: "settings.modelProvider.templateCreateFailed" }),
        actionLabel: intl.formatMessage({ id: "settings.modelProvider.templateCreateRetry" }),
        onAction: retry,
        dismissible: true,
      });
    }
  };

  // 自定义创建不再是「一键建空壳」：打开表单让用户选目录条目、确认 api 格式、
  // 填 key 并拉取模型名单，再一次性提交完整配置。
  if (customFormOpen) {
    return (
      <CustomProviderCreateForm
        templates={templates}
        creating={creating}
        onBack={() => setCustomFormOpen(false)}
        onSubmit={async (input) => {
          await createWithFeedback(() => onCreateCustom(input));
          setCustomFormOpen(false);
        }}
      />
    );
  }

  return (
    <section className="space-y-5" data-testid={TID_MODEL_PROVIDER_TEMPLATE_PICKER}>
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
          {intl.formatMessage({ id: "settings.modelProvider.templatePickerTitle" })}
        </h2>
      </div>

      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtlest"
          aria-hidden="true"
        />
        <Input
          type="search"
          size="lg"
          className="pl-9"
          value={query}
          placeholder={intl.formatMessage({ id: "settings.modelProvider.templatePickerSearch" })}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.templatePickerSearch" })}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        <ProviderTemplateCard
          label={intl.formatMessage({ id: "settings.modelProvider.createCustomProvider" })}
          disabled={creating}
          testId={testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "custom")}
          icon={
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover">
              <PlusIcon className="size-4" aria-hidden="true" />
            </span>
          }
          onClick={() => setCustomFormOpen(true)}
        />
        {visibleTemplates.map((template) => {
          const label = resolveProviderTemplateName(template.templateId, template, locale);
          return (
            <ProviderTemplateCard
              key={template.templateId}
              label={label}
              disabled={creating}
              testId={testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, template.templateId)}
              icon={
                <span className="flex size-9 shrink-0 items-center justify-center">
                  <ProviderLogo logo={template.config.logo} className="size-8" />
                </span>
              }
              onClick={() =>
                void createWithFeedback(() => onCreateFromTemplate(template.templateId))
              }
            />
          );
        })}
        {visibleTemplates.length === 0 ? (
          <p className="px-1 py-6 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.templatePickerEmpty" })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ProviderTemplateCard({
  label,
  disabled,
  testId: cardTestId,
  icon,
  onClick,
}: {
  label: string;
  disabled: boolean;
  testId: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <ControlHintTooltip title={label}>
      <button
        type="button"
        data-testid={cardTestId}
        disabled={disabled}
        onClick={onClick}
        className="flex min-h-16 min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors outline-none hover:border-border-hover hover:bg-hover focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
      >
        {icon}
        <span className="min-w-0 flex-1 break-words text-ui-base font-medium">{label}</span>
        <ChevronRightIcon className="size-4 shrink-0 text-foreground-subtlest" aria-hidden="true" />
      </button>
    </ControlHintTooltip>
  );
}
