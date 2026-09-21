/**
 * 将 ZCode Built-in Release 从「全量内置」转为「provider 保留、模型实时拉取」。
 *
 * 模型名单不再内置，改为用户在创建供应商时通过 GET {baseUrl}/models 实时拉取：
 *   - 193 个模板的 builtinModelIds（6118 个模型 ID）全部移除
 *   - templateModelRules（6118 条模型参数规则）全部移除
 *   - 8 个 zhipu-account providerRules 保留模型名单：账号体系不走 api-key，
 *     没有 /models 端点可拉取，必须继续内置
 *   - 正则分层（modelRules / modelApiRules / providerSiteRules）与
 *     builtinProviderModelRules 原样保留：它们是 ZCode 自有协议层，与模型名单无关
 *
 * 模板 logo 用 models.dev 的 /logos/{templateId}.svg 远程 URL 表达：
 *   - 193 个模板全部没有本地打包素材，占位符不具辨识度
 *   - 已有 builtin logo 的模板（zai、openai 等）保持本地素材不变
 *   - 远程 URL 由 ProviderLogo 的 onError 回退到占位符，不阻断渲染
 *
 *   node scripts/slim-zcode-builtin.mjs
 *   node scripts/slim-zcode-builtin.mjs --dry-run
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(REPO_ROOT, "config/provider/zcode-builtin.json");

const MODELS_DEV_LOGO_BASE_URL = "https://models.dev/logos";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const text = await readFile(CONFIG_PATH, "utf8");
  const release = JSON.parse(text);

  const templateRules = release.config.providerConfigRules.templateRules;
  const providerRules = release.config.providerConfigRules.providerRules;
  const modelConfigRules = release.config.modelConfigRules;

  // 统计瘦身前大小。
  let removedModelIds = 0;
  let removedTemplateModelRules = 0;
  let keptProviderModelIds = 0;
  let remoteLogos = 0;

  for (const template of templateRules) {
    const config = template.config ?? {};

    // 1. 移除 builtinModelIds——模型改为创建时实时拉取。
    if (Array.isArray(config.builtinModelIds)) {
      removedModelIds += config.builtinModelIds.length;
      delete config.builtinModelIds;
    }

    // 2. 没有本地素材的模板用 models.dev 远程 logo；已有 builtin logo 的不覆盖。
    if (config.logo === undefined) {
      config.logo = {
        type: "remote",
        url: `${MODELS_DEV_LOGO_BASE_URL}/${template.templateId}.svg`,
      };
      remoteLogos += 1;
    }
  }

  // 3. 清空 templateModelRules——没有内置模型名单就不需要模型参数。
  if (Array.isArray(modelConfigRules.templateModelRules)) {
    removedTemplateModelRules = modelConfigRules.templateModelRules.length;
    modelConfigRules.templateModelRules = [];
  }

  // 4. zhipu-account providerRules 保留 builtinModelIds：账号体系无 /models 端点。
  for (const provider of providerRules) {
    const ids = provider.config?.builtinModelIds;
    if (Array.isArray(ids)) keptProviderModelIds += ids.length;
  }

  // 5. revision +1：内容变化必须让 Active 缓存识别为过期。
  release.revision = release.revision + 1;

  const output = `${JSON.stringify(release, null, 2)}\n`;
  const beforeBytes = Buffer.byteLength(text, "utf8");
  const afterBytes = Buffer.byteLength(output, "utf8");

  console.log(`模板 builtinModelIds 移除: ${removedModelIds} 个模型 ID`);
  console.log(`templateModelRules 移除: ${removedTemplateModelRules} 条规则`);
  console.log(`远程 logo 生成: ${remoteLogos} 个模板`);
  console.log(`zhipu-account 保留模型: ${keptProviderModelIds} 个模型 ID`);
  console.log(`revision: ${release.revision - 1} -> ${release.revision}`);
  console.log(
    `文件大小: ${(beforeBytes / 1024 / 1024).toFixed(2)}MB -> ${(afterBytes / 1024).toFixed(0)}KB`,
  );

  if (DRY_RUN) {
    console.log("dry-run，不写入文件");
    return;
  }

  await writeFile(CONFIG_PATH, output, "utf8");
  console.log(`已写入: ${CONFIG_PATH}`);
}

await main();
