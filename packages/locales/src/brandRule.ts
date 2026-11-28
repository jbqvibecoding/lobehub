/**
 * Biber's rule for upstream's product name in interface copy. Shared by the runtime rewrite of
 * translations (`brandPostProcessor.ts`) and the rewrite of the locale files after each merge
 * from upstream (`scripts/brand/rename-product.ts`), so the two cannot disagree.
 *
 * `LobeHub` (and its pre-rename name `LobeChat`) becomes Biber, except where it names a LobeHub
 * service Biber still points to: LobeHub Cloud, the Community, the Market and its skills, and the
 * CLI. Those are kept in three ways:
 *
 * - by the words after the name, in the languages the locales use (`LobeHub Cloud`,
 *   `LobeHub 市场`, `LobeHub 클라우드`);
 * - by key, for copy whose meaning is a LobeHub service without the words saying so
 *   (`LobeHub Official Skill`, the CLI description) — {@link KEPT_BY_MEANING};
 * - by key, for copy whose English names only LobeHub services. Translations put the name in
 *   other places (`Pazara на LobeHub`, `سوق LobeHub`), so the English decides for every
 *   language. `rename-product` works these out from the English and writes them to
 *   `brandKeptKeys.ts`, because the runtime does not have the English loaded.
 *
 * `@LobeHub` is a social handle and is always kept, and so is the name inside an identifier
 * (`LobeHubModelDeprecated`).
 */

/** The services named right after `LobeHub`, in the words the locales use for them. */
const SERVICE_AFTER =
  /^(?:[\s\-‑]*(?:[Cc]loud|CLI|[Cc]ommunity|[Mm]arket(?:place)?|Marktplatz|[Ss]kills?|Bulut)\b|\s*(?:社区|社群|市场|市集|技能|云|雲|クラウド|マーケット|コミュニティ|スキル|클라우드|마켓|커뮤니티|스킬|Облак))/;

const WORD_CHAR = /\w/;

/** Every place upstream's product name appears in copy, apart from social handles. */
export const PRODUCT_NAME = /(?<!@)(LobeHub|LobeChat)/g;

/**
 * Copy kept by key (`namespace:key`) because what it names is a LobeHub service, though its
 * words do not say so. Applies to every language.
 */
export const KEPT_BY_MEANING: readonly string[] = [
  // The Market: submitting to it, its scans, official services and skills, its sign-in
  'discover:createGuide.func1.title',
  'discover:mcp.details.githubBadge.desc',
  'discover:mcp.details.deployment.platform.steps.lobeChat',
  'discover:models.providerInfo.officialTooltip',
  'discover:skills.details.sidebar.platform.layout.lobehub',
  'discover:skills.details.sidebar.platform.steps.lobehub',
  'discover:marketplaceAgents.detail.noticeCommunity',
  'discover:marketplaceAgents.detail.noticeVerified',
  'discover:marketplaceAgents.detail.sourceVerified',
  'marketAuth:messages.authorized',
  'marketAuth:callback.titles.loading',
  'plugin:protocolInstall.official.badge',
  'plugin:protocolInstall.official.description',
  'plugin:store.tabs.old',
  'setting:skillStore.tabs.lobehub',
  'setting:connectorMarket.section.lobehub',
  'setting:tools.builtins.lobe-skill-store.description',
  // The CLI and the LobeHub platform it manages
  'setting:settingSystemTools.tools.lobehub.desc',
  'setting:tools.builtins.lobehub.title',
  'setting:tools.builtins.lobehub.description',
  // LobeHub Cloud
  'desktop-onboarding:screen5.methods.cloud.name',
  'desktop-onboarding:screen5.methods.cloud.description',
  'desktop-onboarding:screen5.actions.signInCloud',
  'electron:sync.lobehubCloud.title',
  // A request mailed to the LobeHub team for a lobehub.com workspace address
  'setting:workspace.slugBrandApply.mailBody',
];

/** Whether the name matched at `offset` in `text` stays as it is. */
export const isKeptProductName = (text: string, offset: number, name: string): boolean => {
  const after = text.slice(offset + name.length);

  return (
    WORD_CHAR.test(text.charAt(offset - 1)) ||
    WORD_CHAR.test(after.charAt(0)) ||
    SERVICE_AFTER.test(after)
  );
};

/**
 * What the name matched at `offset` in `text` becomes. A kept service under the pre-rename name
 * reads as today's name (`LobeChat Cloud` → `LobeHub Cloud`).
 */
export const rebrandedProductNameAt = (
  text: string,
  offset: number,
  name: string,
  brand: string,
): string => {
  if (!isKeptProductName(text, offset, name)) return brand;

  return name === 'LobeChat' && SERVICE_AFTER.test(text.slice(offset + name.length))
    ? 'LobeHub'
    : name;
};

/** Rename upstream's product name in one piece of copy. */
export const rebrandProductName = (text: string, brand: string): string =>
  text.replaceAll(PRODUCT_NAME, (name: string, _name: string, offset: number) =>
    rebrandedProductNameAt(text, offset, name, brand),
  );

/**
 * Whether English copy names only LobeHub services, so every translation of it keeps the name.
 * Copy that also names the brand is left to the per-word rule in other languages.
 */
export const namesOnlyKeptServices = (english: string, brand: string): boolean =>
  !english.includes(brand) &&
  english.match(PRODUCT_NAME) !== null &&
  rebrandProductName(english, brand) === english;
