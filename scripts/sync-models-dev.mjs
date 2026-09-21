/**
 * 从 models.dev 目录生成 ZCode Built-in Provider Config 的模板层与模板模型规则层。
 *
 * 定位：构建期一次性生成 + diff 报告，不覆盖 config/provider/zcode-builtin.json。
 * 运行时会话由 NodeZCodeBuiltinProviderConfigSource 的 Bundled/Active/Remote 机制负责，
 * 本脚本只回答一个问题——「如果模型层完全上游化，现有配置会变成什么样」。
 *
 *   bun scripts/sync-models-dev.mjs                # 拉取 https://models.dev/api.json
 *   MODELS_DEV_API_JSON=./api.json bun scripts/sync-models-dev.mjs   # 用本地快照，可复现
 *
 * 供应商范围：上游所有能映射到现有 api.type 枚举的条目。
 * NPM_TO_API_TYPE 未覆盖的 npm（@ai-sdk/google、@ai-sdk/azure、@ai-sdk/amazon-bedrock 等）
 * 无法用现有协议表达，直接排除——把它们默认成 openai-chat-completions 会造出连不通的端点。
 *
 * 生成范围（其余规则族原样搬运，它们是与上游无关的 ZCode 自有分层）：
 *   - config.providerConfigRules.templateRules    models.dev provider entry -> 模板
 *   - config.modelConfigRules.templateModelRules  models.dev model -> 模板模型规则
 *
 * 不在本脚本内解决（报告里逐项列出）：
 *   - reasoningLevel.map：models.dev 只给 shape 与 values，不给请求体序列化方式。
 *     序列化由 modelApiRules/providerSiteRules 按协议与站点匹配提供，原样搬运。
 *   - logo：models.dev 提供 /logos/{provider}.svg，需要单独的构建期落地步骤。
 *   - supportsNativeWebSearch / supportsMidConversationSystem / requiresMfjsToolSchema：
 *     上游没有这三个字段，继续由 catch-all 与手写补丁提供。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_URL = process.env.OPENCODE_MODELS_URL || "https://models.dev";
const EXISTING_CONFIG = resolve(REPO_ROOT, "config/provider/zcode-builtin.json");
const OUTPUT_CONFIG = resolve(REPO_ROOT, "config/provider/zcode-builtin.models-dev.json");
const OUTPUT_REPORT = resolve(REPO_ROOT, "config/provider/models-dev-sync-report.md");

/** 已知有问题或与现有条目重复的上游 provider；预留排除位。 */
const EXCLUDED_PROVIDERS = new Set([]);

/** models.dev 的 npm 字段决定协议；这是 opencode 在 provider.ts 里使用的同一信号。 */
const NPM_TO_API_TYPE = {
  "@ai-sdk/openai-compatible": "openai-chat-completions",
  "@ai-sdk/openai": "openai-responses",
  "@ai-sdk/anthropic": "anthropic-messages",
  "@ai-sdk/xai": "openai-responses",
  "@openrouter/ai-sdk-provider": "openai-chat-completions",
};

/** 上游 api 为 null 的第一方 SDK provider，用 SDK 默认端点补齐。 */
const DEFAULT_BASE_URL = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  xai: "https://api.x.ai/v1",
};

/**
 * 旧 templateId -> models.dev provider id。
 * 只用于生成时继承模型 ID 的大小写写法：不同厂商对同一个模型名的写法不同
 * （智谱用 GLM-5.3，opencode-go 用 glm-5.3），必须按模板独立映射，不能全局共享。
 */
const LEGACY_TEMPLATE_IDS = {
  zai: ["zai-standard-api"],
  "zai-coding-plan": ["zai-api"],
  zhipuai: ["bigmodel-standard-api"],
  "zhipuai-coding-plan": ["bigmodel-api"],
  moonshotai: ["moonshot-kimi"],
  minimax: ["minimax"],
  deepseek: ["deepseek"],
  "alibaba-cn": ["qwen-alibaba-model-studio-cn"],
  alibaba: ["qwen-alibaba-model-studio-intl"],
  xiaomi: ["xiaomi-mimo"],
  openai: ["openai"],
  anthropic: ["anthropic"],
  xai: ["xai"],
  openrouter: ["openrouter"],
  "opencode-go": ["opencode-go-chat", "opencode-go-messages", "opencode-go-responses"],
  opencode: ["opencode-zen-chat", "opencode-zen-messages", "opencode-zen-responses"],
};

const MODALITY_KEYS = ["text", "audio", "image", "video", "pdf"];

async function loadCatalog() {
  if (process.env.MODELS_DEV_API_JSON) {
    const path = resolve(process.env.MODELS_DEV_API_JSON);
    console.log(`使用本地快照: ${path}`);
    return JSON.parse(await readFile(path, "utf8"));
  }
  console.log(`拉取目录: ${SOURCE_URL}/api.json`);
  const response = await fetch(`${SOURCE_URL}/api.json`);
  if (!response.ok) throw new Error(`models.dev 返回 ${response.status}`);
  return response.json();
}

/** 旧配置的 templateId -> (modelId 小写 -> 原写法)。入参是 providerConfigRules。 */
function collectLegacyCasing(providerConfigRules) {
  const byTemplate = new Map();
  for (const template of providerConfigRules.templateRules ?? []) {
    const models = new Map();
    for (const modelId of template.config?.builtinModelIds ?? []) {
      models.set(modelId.toLowerCase(), modelId);
    }
    byTemplate.set(template.templateId, models);
  }
  return byTemplate;
}

/**
 * ID 大小写基线必须取自「采纳上游化之前」的那份配置。
 * 直接读当前文件会在二次运行时丢失基线——生成产物已经把 templateId 换成上游 id，
 * LEGACY_TEMPLATE_IDS 里的旧 ID 再也不存在，继承数会静默变成 0，用户存量配置随即断裂。
 * 因此优先取 git HEAD 的版本；取不到才退回当前文件。
 */
async function loadCasingBaseline(existing) {
  const relative = "config/provider/zcode-builtin.json";
  try {
    const process = await import("node:child_process");
    const text = await new Promise((resolvePromise, reject) => {
      process.execFile(
        "git",
        ["show", `HEAD:${relative}`],
        { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout) => (error ? reject(error) : resolvePromise(stdout)),
      );
    });
    const baseline = JSON.parse(text);
    if (baseline?.config?.providerConfigRules?.templateRules?.length > 0) {
      return { source: `git HEAD:${relative}`, config: baseline.config.providerConfigRules };
    }
  } catch (error) {
    console.warn(`无法从 git HEAD 读取大小写基线，退回当前文件: ${error.message}`);
  }
  return { source: relative, config: existing.config.providerConfigRules };
}

/** 生成时保留 ZCode 现有 ID 大小写，避免存量 personal 配置与模型选择断裂。 */
function normalizeModelId(modelId, legacyCasing, providerId, stats) {
  for (const templateId of LEGACY_TEMPLATE_IDS[providerId] ?? []) {
    const legacy = legacyCasing.get(templateId)?.get(modelId.toLowerCase());
    if (legacy !== undefined) {
      if (legacy !== modelId) stats.casingNormalized += 1;
      return legacy;
    }
  }
  // 对该 provider 是新增模型：保留上游写法，不做跨厂商套用。
  stats.casingFromUpstream += 1;
  return modelId;
}

function resolveApiType(provider, report) {
  const apiType = NPM_TO_API_TYPE[provider.npm];
  if (apiType) return apiType;
  report.unmappedNpm.push({ id: provider.id, npm: provider.npm });
  return undefined;
}

function resolveBaseUrl(provider, report) {
  if (typeof provider.api === "string" && provider.api.trim()) {
    // 上游少数 provider 的 api 是模板串（含 ${VAR}），不是可直接使用的端点。
    // 直接写进配置会造出连不通的供应商，也会被 URL schema 拒绝；排除而不是猜一个值。
    if (provider.api.includes("${")) {
      report.templatedBaseUrl.push({ id: provider.id, baseUrl: provider.api });
      return undefined;
    }
    return provider.api;
  }
  const fallback = DEFAULT_BASE_URL[provider.id];
  if (fallback) {
    report.baseUrlFallback.push({ id: provider.id, baseUrl: fallback });
    return fallback;
  }
  report.missingBaseUrl.push(provider.id);
  return undefined;
}

function inputFormat(modalities) {
  const format = {};
  for (const key of MODALITY_KEYS) format[`supports${cap(key)}`] = modalities.input.includes(key);
  return format;
}

function outputFormat(modalities) {
  return { supportsText: modalities.output.includes("text") };
}

function cap(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** models.dev 的 reasoning_options shape -> ZCode reasoningLevel.values；map 不在此生成。 */
function reasoningLevelValues(model, report) {
  const options = model.reasoning_options ?? [];
  const effort = options.find((option) => option.type === "effort");
  if (effort) {
    const values = (effort.values ?? []).map((value) => value ?? "none");
    const unique = [...new Set(values.includes("none") ? values : ["none", ...values])];
    report.reasoningShape.effort += 1;
    return unique;
  }
  if (options.some((option) => option.type === "toggle")) {
    report.reasoningShape.toggle += 1;
    return ["disabled", "enabled"];
  }
  if (options.some((option) => option.type === "budget_tokens")) {
    report.reasoningShape.budget += 1;
    return ["none", "high", "max"];
  }
  if (model.reasoning === true) {
    report.reasoningShape.flagOnly += 1;
    return ["disabled", "enabled"];
  }
  report.reasoningShape.none += 1;
  return undefined;
}

function modelRule(model, report) {
  const config = { enabled: true };
  const properties = {};
  if (model.limit?.context) properties.contextWindow = model.limit.context;
  if (model.modalities) {
    properties.inputFormat = inputFormat(model.modalities);
    properties.outputFormat = outputFormat(model.modalities);
  }
  if (typeof model.tool_call === "boolean") properties.supportsToolCall = model.tool_call;
  if (typeof model.structured_output === "boolean") {
    properties.supportsJsonSchemaOutput = model.structured_output;
  }
  if (Object.keys(properties).length > 0) config.properties = properties;

  const optionSpecs = {};
  if (model.limit?.output) optionSpecs.maxOutputTokens = { max: model.limit.output };
  const values = reasoningLevelValues(model, report);
  // 只生成 values；map 由 modelApiRules/providerSiteRules 按协议与站点匹配提供。
  // 匹配不到时落到 catch-all 的 "{}"，即该模型不暴露 reasoning 档位——
  // 与 opencode 对不支持组合的处理一致。
  if (values) optionSpecs.reasoningLevel = { values };
  if (Object.keys(optionSpecs).length > 0) config.optionSpecs = optionSpecs;
  return config;
}

function buildTemplate(provider, legacyCasing, stats, report) {
  const apiType = resolveApiType(provider, report);
  if (!apiType) return undefined;
  const baseUrl = resolveBaseUrl(provider, report);
  if (!baseUrl) return undefined;

  const models = Object.values(provider.models ?? {})
    .filter((model) => model.status !== "deprecated")
    .filter((model) => {
      if (model.status !== "alpha") return true;
      report.alphaHidden.push(`${provider.id}/${model.id}`);
      return false;
    });

  const builtinModelIds = [];
  const templateModelRules = [];
  for (const model of models) {
    const modelId = normalizeModelId(model.id, legacyCasing, provider.id, stats);
    builtinModelIds.push(modelId);
    templateModelRules.push({
      templateId: provider.id,
      modelId,
      config: modelRule(model, report),
    });
  }

  const template = {
    templateId: provider.id,
    // templateNameMap 在 providerTemplateDataSchema 里是必填，且 resolveProviderTemplateName
    // 直接读取该对象。上游只有单一 name（无翻译），现状 18/20 个模板的 zh-CN 与 en-US 本就相同，
    // 因此用上游 name 填 en-US 是等价替换，不是新增本地化能力。
    templateNameMap: { "en-US": provider.name ?? provider.id },
    config: {
      // 账号体系出局后 access 只剩 api-key；coding-plan 与标准端点由不同 provider entry 承载。
      access: { type: "api-key" },
      api: { type: apiType, baseUrl },
      builtinModelIds,
    },
  };
  stats.mappedTemplates += 1;
  return { template, templateModelRules };
}

/**
 * reasoning 的请求体序列化不在模板模型层，而在按协议/站点索引的正则层：
 *   modelApiRules      71/72 条含 map，按 modelMatch + apiTypeMatch 匹配
 *   providerSiteRules  29/52 条含 map，按 modelMatch + apiTypeMatch + baseUrlMatch 匹配
 *   templateModelRules   0/244 条含 map
 * 所以模板换协议时这一层会自动重新匹配——需要检查的是覆盖是否仍然存在。
 */
function analyzeReasoningCoverage(existing, templates) {
  const apiRules = existing.config.modelConfigRules.modelApiRules ?? [];
  const siteRules = existing.config.modelConfigRules.providerSiteRules ?? [];
  const matches = (pattern, value) => {
    if (typeof pattern !== "string") return false;
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  };
  const byApiType = new Map();
  for (const rule of apiRules) {
    for (const apiType of new Set(templates.map((item) => item.config.api.type))) {
      if (matches(rule.apiTypeMatch, apiType)) {
        byApiType.set(apiType, (byApiType.get(apiType) ?? 0) + 1);
      }
    }
  }
  const siteByApiType = new Map();
  for (const rule of siteRules) {
    for (const apiType of new Set(templates.map((item) => item.config.api.type))) {
      if (!matches(rule.apiTypeMatch, apiType)) continue;
      const covered = templates.some(
        (item) => item.config.api.type === apiType && matches(rule.baseUrlMatch, item.config.api.baseUrl),
      );
      if (covered) siteByApiType.set(apiType, (siteByApiType.get(apiType) ?? 0) + 1);
    }
  }
  return [...new Set(templates.map((item) => item.config.api.type))].map((apiType) => ({
    apiType,
    apiRules: byApiType.get(apiType) ?? 0,
    siteRules: siteByApiType.get(apiType) ?? 0,
    covered: (byApiType.get(apiType) ?? 0) > 0 || (siteByApiType.get(apiType) ?? 0) > 0,
  }));
}

async function validate(candidate) {
  const modulePath = pathToFileURL(
    resolve(REPO_ROOT, "packages/provider-node/src/zcode-builtin-release.ts"),
  ).href;
  // bun 可直接加载 TS；node 下退回 tsx（仓库现有构建脚本的同款入口）。
  const module = await import(modulePath).catch(async (error) => {
    console.warn(`bun 原生 TS 加载失败，退回 tsx: ${error.message}`);
    const { tsImport } = await import("tsx/esm/api");
    return tsImport(modulePath, import.meta.url);
  });
  const release = module.decodeZCodeBuiltinRelease(JSON.parse(JSON.stringify(candidate)));
  const serialized = release.config.modelConfigRules.toZCodeBuiltinJSON();
  const ruleCount = Object.values(serialized).reduce(
    (total, rules) => total + (Array.isArray(rules) ? rules.length : 0),
    0,
  );
  return {
    templates: release.config.providerTemplates.keys().length,
    providers: release.config.providers.keys().length,
    modelRules: ruleCount,
  };
}

function renderReport({
  rows,
  report,
  stats,
  validation,
  generatedCount,
  existingCount,
  coverage,
  skipped,
}) {
  const lines = [];
  lines.push("# models.dev 同步 diff 报告", "");
  lines.push(`- 模板：${existingCount} -> ${generatedCount}`);
  lines.push(`- 生成产物校验：${validation ? "通过 decodeZCodeBuiltinRelease" : "未执行"}`);
  if (validation) {
    lines.push(
      `  - templates=${validation.templates} providers=${validation.providers} modelRules=${validation.modelRules}`,
    );
  }
  lines.push("", "## 模型名单变化（仅列有增减的供应商）", "");
  lines.push("| provider | 旧 | 新 | 新增 | 移除 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.providerId} | ${row.before} | ${row.after} | +${row.added.length} | -${row.removed.length} |`,
    );
  }
  const unchanged = rows.filter((row) => row.added.length === 0 && row.removed.length === 0);
  if (unchanged.length > 0) {
    lines.push("", `其余 ${unchanged.length} 个供应商为新增条目，无存量模型可对比。`);
  }
  lines.push("", "### 上游缺失的存量模型（需要决定：保留补丁还是接受下线）", "");
  const missing = rows.filter((row) => row.removed.length > 0);
  if (missing.length === 0) lines.push("无");
  for (const row of missing) {
    lines.push(`- **${row.providerId}**: ${row.removed.join(", ")}`);
  }
  lines.push("", "## reasoningLevel", "");
  lines.push(`- shape 分布: ${JSON.stringify(report.reasoningShape)}`);
  lines.push(
    "- map 不在模板模型层（templateModelRules 0/244 含 map），而在 modelApiRules(71/72) 与",
    "  providerSiteRules(29/52) 按协议/站点匹配；换协议时这一层自动重新匹配，已原样搬运。",
  );
  lines.push("", "| api.type | api 级规则 | 站点级规则 | 覆盖 |", "| --- | --- | --- | --- |");
  for (const item of coverage) {
    lines.push(
      `| ${item.apiType} | ${item.apiRules} | ${item.siteRules} | ${item.covered ? "有" : "**无**"} |`,
    );
  }
  lines.push("", "## 排除与跳过", "");
  lines.push(`- npm 无法映射到现有 api.type（已排除）: ${skipped.unmappedNpm}`);
  lines.push(`- baseUrl 是模板串含 ${"${VAR}"}，无法直接使用（已排除）: ${skipped.templated}`);
  for (const item of report.templatedBaseUrl) lines.push(`  - ${item.id}: ${item.baseUrl}`);
  lines.push(`- 上游无 api 端点且无默认端点（已排除）: ${skipped.missingBaseUrl}`);
  lines.push(`- 无可用模型（已排除）: ${skipped.noModels}`);
  if (report.unmappedNpm.length > 0) {
    lines.push("", "被排除的 provider 及原因：");
    for (const item of report.unmappedNpm) lines.push(`  - ${item.id}: ${item.npm}`);
  }
  lines.push("", "## 需要人工决策的项", "");
  lines.push(`- baseUrl 用 SDK 默认端点补齐: ${report.baseUrlFallback.length}`);
  for (const item of report.baseUrlFallback) lines.push(`  - ${item.id}: ${item.baseUrl}`);
  lines.push(`- alpha 模型默认隐藏: ${report.alphaHidden.length}`);
  lines.push(`- modelId 沿用旧配置写法: ${stats.casingNormalized}，新增模型保留上游写法: ${stats.casingFromUpstream}`);
  lines.push("  - 同一供应商内会因此出现大小写混用；统一写法属于一次性迁移，需单独决策");
  lines.push("- logo: 上游提供 /logos/{provider}.svg，需单独构建期落地；本产物未生成 logo 字段");
  lines.push(
    "- supportsNativeWebSearch / supportsMidConversationSystem / requiresMfjsToolSchema: 上游无此字段，继续由 catch-all 提供",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [catalog, existingText] = await Promise.all([
    loadCatalog(),
    readFile(EXISTING_CONFIG, "utf8"),
  ]);
  const existing = JSON.parse(existingText);
  const casingBaseline = await loadCasingBaseline(existing);
  console.log(`ID 大小写基线: ${casingBaseline.source}`);
  const legacyCasing = collectLegacyCasing(casingBaseline.config);

  const report = {
    unmappedNpm: [],
    baseUrlFallback: [],
    missingBaseUrl: [],
    templatedBaseUrl: [],
    alphaHidden: [],
    reasoningShape: { effort: 0, toggle: 0, budget: 0, flagOnly: 0, none: 0 },
  };
  const stats = {
    mappedTemplates: 0,
    casingNormalized: 0,
    casingFromUpstream: 0,
  };
  const skipped = { unmappedNpm: 0, missingBaseUrl: 0, templated: 0, noModels: 0 };

  const templates = [];
  const templateModelRules = [];
  const generated = new Map();
  for (const [providerId, provider] of Object.entries(catalog)) {
    if (EXCLUDED_PROVIDERS.has(providerId)) continue;
    const liveModels = Object.values(provider.models ?? {}).filter(
      (model) => model.status !== "deprecated",
    );
    if (liveModels.length === 0) {
      skipped.noModels += 1;
      continue;
    }
    const result = buildTemplate(provider, legacyCasing, stats, report);
    if (!result) {
      if (NPM_TO_API_TYPE[provider.npm] === undefined) skipped.unmappedNpm += 1;
      else if (report.templatedBaseUrl.some((item) => item.id === providerId)) skipped.templated += 1;
      else skipped.missingBaseUrl += 1;
      continue;
    }
    templates.push(result.template);
    templateModelRules.push(...result.templateModelRules);
    generated.set(providerId, result.template);
  }

  const coverage = analyzeReasoningCoverage(existing, templates);

  const candidate = {
    schemaVersion: existing.schemaVersion,
    // 采纳产物就是一次新 Release。沿用旧 revision 会让两份不同内容共享同一个版本号，
    // 触发 applyRemoteRelease 的「相同 revision 对应不同内容」拒绝，也会让 Active 缓存
    // 无法据此判断自己已过期。
    revision: existing.revision + 1,
    config: {
      providerConfigRules: {
        templateRules: templates,
        // 账号体系按产品决策出局；此处原样搬运以便 diff 对照，采纳时删除。
        providerRules: existing.config.providerConfigRules.providerRules,
      },
      modelConfigRules: {
        // 正则分层与 catch-all 是 ZCode 自有层，原样搬运。
        modelRules: existing.config.modelConfigRules.modelRules,
        modelApiRules: existing.config.modelConfigRules.modelApiRules,
        providerSiteRules: existing.config.modelConfigRules.providerSiteRules,
        templateModelRules,
        builtinProviderModelRules: existing.config.modelConfigRules.builtinProviderModelRules,
      },
    },
  };

  const validation = await validate(candidate).catch((error) => {
    console.error(`产物校验失败: ${error.message}`);
    return null;
  });

  await mkdir(dirname(OUTPUT_CONFIG), { recursive: true });
  await writeFile(OUTPUT_CONFIG, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");

  const rows = diffModels(existing, generated);
  const markdown = renderReport({
    rows,
    report,
    stats,
    validation,
    generatedCount: templates.length,
    existingCount: existing.config.providerConfigRules.templateRules.length,
    coverage,
    skipped,
  });
  await writeFile(OUTPUT_REPORT, markdown, "utf8");

  console.log(markdown);
  console.log(`产物: ${OUTPUT_CONFIG}`);
  console.log(`报告: ${OUTPUT_REPORT}`);
  if (!validation) process.exitCode = 1;
}

/** 与存量模板按 provider 聚合对比模型名单增减。 */
function diffModels(existing, generated) {
  const legacyByProvider = new Map();
  for (const [providerId, templateIds] of Object.entries(LEGACY_TEMPLATE_IDS)) {
    for (const templateId of templateIds) legacyByProvider.set(templateId, providerId);
  }
  const legacyModels = new Map();
  for (const template of existing.config.providerConfigRules.templateRules ?? []) {
    const providerId = legacyByProvider.get(template.templateId) ?? template.templateId;
    const ids = legacyModels.get(providerId) ?? new Set();
    for (const modelId of template.config?.builtinModelIds ?? []) ids.add(modelId.toLowerCase());
    legacyModels.set(providerId, ids);
  }
  const rows = [];
  for (const [providerId, template] of generated) {
    const before = legacyModels.get(providerId) ?? new Set();
    const after = new Set(template.config.builtinModelIds.map((id) => id.toLowerCase()));
    rows.push({
      providerId,
      before: before.size,
      after: after.size,
      added: [...after].filter((id) => !before.has(id)),
      removed: [...before].filter((id) => !after.has(id)),
    });
  }
  return rows;
}

await main();
