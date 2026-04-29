#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const { loadAppConfig } = require('./config.cjs');

const APP_ROOT = path.resolve(__dirname, '..');
const APP_CONFIG = loadAppConfig();
const RUNTIME_CONFIG = APP_CONFIG.runtime || {};
const FILTER_CONFIG = APP_CONFIG.filters || {};
const SCOPE_FLAGS = APP_CONFIG.scopes || {};
const OUTPUT_DIR = path.resolve(
  process.env.ZARA_OUTPUT_DIR || RUNTIME_CONFIG.outputDir || path.join(APP_ROOT, 'output')
);
const PROFILE_DIR = path.resolve(
  process.env.ZARA_PROFILE_DIR || RUNTIME_CONFIG.profileDir || path.join(APP_ROOT, '.playwright-zara-profile')
);
const BROWSER_CHANNEL = process.env.ZARA_BROWSER_CHANNEL || RUNTIME_CONFIG.browserChannel || 'chrome';
const DEFAULT_HEADLESS =
  process.env.ZARA_HEADLESS === '1' ? true : Boolean(RUNTIME_CONFIG.headless);
const WOMEN_NEW_URL = 'https://www.zara.com/me/en/woman-new-in-l1180.html?v1=2546081';
const WOMEN_CATEGORIES_URL = 'https://www.zara.com/me/en/categories?categoryId=1881757&categorySeoId=1000&ajax=true';
const BASE_SCOPE_CONFIGS = [
  { id: 'women_new', sheetPrefix: 'new', label: 'Women -> The New', type: 'listing_url', url: WOMEN_NEW_URL },
  { id: 'women_full', sheetPrefix: 'full', label: 'Women -> Full Catalog', type: 'women_full' }
];
const STATE_FILE = path.join(OUTPUT_DIR, 'zara-montenegro-state.json');
const NAV_TIMEOUT_MS = 90000;
const LIST_WAIT_MS = 12000;
const PRODUCT_WAIT_MS = 1200;
const CATALOG_STORE_ID = 11714;

const COLOR_KEYWORDS = (FILTER_CONFIG.colorKeywords || []).map((v) => String(v).toLowerCase());
const TARGET_FABRICS = (FILTER_CONFIG.targetFabrics || []).map((v) => String(v).toLowerCase());
const MIXED_MAIN_MIN_TARGET_PERCENT = Number(FILTER_CONFIG.mixedMainMinTargetPercent ?? 70);
const REQUIRED_SIZE = String(FILTER_CONFIG.requiredSize || 'S').toUpperCase();
const REQUIRE_MONTENEGRO_IN_STOCK = FILTER_CONFIG.requireMontenegroInStock !== false;
const REJECT_DO_NOT_WASH = FILTER_CONFIG.rejectDoNotWash !== false;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowTimestamp() {
  return new Date().toISOString().replace(/[:]/g, '-');
}

function normalizeSpace(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return normalizeSpace(value).toLowerCase();
}

function safeWriteJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function mapLimit(items, limit, mapper) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function parseJsonScripts(scriptContents) {
  const parsed = [];
  for (const raw of scriptContents) {
    if (!raw || typeof raw !== 'string') continue;
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      // Ignore malformed scripts.
    }
  }
  return parsed;
}

function collectItemListObjects(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectItemListObjects(item, out);
    return;
  }
  if (obj['@type'] === 'ItemList' && Array.isArray(obj.itemListElement)) {
    out.push(obj);
  }
  for (const value of Object.values(obj)) {
    collectItemListObjects(value, out);
  }
}

function extractProductLinksFromItemLists(itemLists) {
  const links = [];
  for (const itemList of itemLists) {
    for (const element of itemList.itemListElement || []) {
      const item = element?.item || {};
      const offerUrl = item?.offers?.url;
      const itemUrl = item?.url;
      const candidate = offerUrl || itemUrl || '';
      if (!candidate) continue;
      if (!/-p\d+\.html/.test(candidate)) continue;
      links.push(candidate);
    }
  }
  return Array.from(new Set(links));
}

function parseColorFromText(text) {
  const match = text.match(/\n([A-Z][A-Z\s]+)\s\|\s\d{3,4}\/\d{3,4}\/\d{2,4}/);
  if (match) return normalizeSpace(match[1]);

  const titleColor = text.match(/-\s*([A-Za-z\s]+)\s*\|\s*ZARA/i);
  if (titleColor) return normalizeSpace(titleColor[1]);
  return '';
}

function parseCompositionLines(compositionSection) {
  const mainLabels = ['outer shell', 'main fabric', 'shell'];
  const secondaryLabels = ['lining', 'secondary fabric', 'inner shell', 'coating', 'filling', 'embroidery', 'details'];
  const tokenRegex =
    /(outer shell|main fabric|secondary fabric|inner shell|coating|filling|embroidery|details|lining|shell)|(\d{1,3})%\s*([A-Za-z][A-Za-z\s-]+)/gi;
  const lines = [];
  const chunks = String(compositionSection || '')
    .split(/\n+/)
    .map((part) => normalizeSpace(part))
    .filter(Boolean);
  let currentSection = 'unknown';

  for (const chunk of chunks) {
    let match;
    while ((match = tokenRegex.exec(chunk)) !== null) {
      const sectionLabel = lower(match[1] || '');
      if (sectionLabel) {
        if (mainLabels.includes(sectionLabel)) currentSection = 'main';
        else if (secondaryLabels.includes(sectionLabel)) currentSection = 'secondary';
        continue;
      }
      const percent = Number(match[2]);
      const material = normalizeSpace(match[3]);
      lines.push({ percent, material, section: currentSection });
    }
    tokenRegex.lastIndex = 0;
  }
  return lines;
}

function collectProductObjectsFromLdJson(ldObjects) {
  const products = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node['@type'] === 'Product') {
      products.push(node);
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const obj of ldObjects) walk(obj);
  return products;
}

function getTargetFabricPercent(compositionLines) {
  let percent = 0;
  for (const line of compositionLines) {
    const material = lower(line.material);
    const isMatch = TARGET_FABRICS.some((fabric) => material.includes(fabric));
    if (isMatch) percent += line.percent;
  }
  return percent;
}

function evaluateComposition(compositionLines) {
  const mainLines = compositionLines.filter((line) => line.section === 'main');
  const secondaryLines = compositionLines.filter((line) => line.section === 'secondary');
  const unknownLines = compositionLines.filter((line) => line.section !== 'main' && line.section !== 'secondary');
  const unknownPercentTotal = unknownLines.reduce((sum, line) => sum + (Number(line.percent) || 0), 0);
  let linesForMainRule = mainLines;
  let mode = 'main_only_strict';
  let reason = 'passed';
  let passed = true;

  if (mainLines.length === 0) {
    if (secondaryLines.length === 0 && unknownLines.length > 0) {
      if (unknownPercentTotal > 110) {
        linesForMainRule = [];
        passed = false;
        reason = 'ambiguous_unknown_sections';
        mode = 'unknown_ambiguous_rejected';
      } else {
        linesForMainRule = unknownLines;
        mode = 'unknown_as_main_single_block';
      }
    } else {
      linesForMainRule = [];
      passed = false;
      reason = 'missing_main_fabric';
    }
  }

  const targetFabricPercent = getTargetFabricPercent(linesForMainRule);
  const targetFabricPercentSecondary = getTargetFabricPercent(secondaryLines);
  const nonZeroLines = linesForMainRule.filter((line) => Number(line.percent) > 0);
  const mixedMainFabric = nonZeroLines.length > 1;
  const containsTargetFabric = targetFabricPercent > 0;

  if (passed && !containsTargetFabric) {
    passed = false;
    reason = 'target_fabric_not_in_main';
  } else if (passed && mixedMainFabric && targetFabricPercent <= MIXED_MAIN_MIN_TARGET_PERCENT) {
    passed = false;
    reason = `mixed_main_target_fabric_le_${MIXED_MAIN_MIN_TARGET_PERCENT}`;
  }

  return {
    targetFabricPercent,
    targetFabricPercentSecondary,
    mixedMainFabric,
    containsTargetFabric,
    mode,
    passed,
    reason,
    mainFabricRaw: linesForMainRule.map((line) => `${line.percent}% ${line.material}`).join('; '),
    secondaryFabricRaw: secondaryLines.map((line) => `${line.percent}% ${line.material}`).join('; '),
    unknownSectionRaw: unknownLines.map((line) => `${line.percent}% ${line.material}`).join('; ')
  };
}

function matchColor(colorValue) {
  const color = lower(colorValue);
  if (!color) return false;
  return COLOR_KEYWORDS.some((keyword) => color.includes(keyword));
}

function evaluateColor(colorValue) {
  const normalizedColor = lower(colorValue);
  const matchedKeywords = COLOR_KEYWORDS.filter((keyword) => normalizedColor.includes(keyword));
  let bucket = 'none';
  if (matchedKeywords.some((keyword) => ['melange', 'grey', 'light grey'].includes(keyword))) bucket = 'grey';
  if (matchedKeywords.some((keyword) => ['light blue', 'sky blue', 'ice blue'].includes(keyword))) bucket = 'blue';
  if (matchedKeywords.some((keyword) => ['greenish', 'sage', 'sea green'].includes(keyword))) bucket = 'green';
  return {
    sourceColor: colorValue || '',
    normalizedColor,
    matchedKeywords,
    bucket,
    passed: matchedKeywords.length > 0
  };
}

function matchComposition(targetFabricPercent) {
  return targetFabricPercent > MIXED_MAIN_MIN_TARGET_PERCENT;
}

function hasRequiredSize(sizeTokens) {
  return sizeTokens.includes(REQUIRED_SIZE);
}

function parseSizeTokens(text) {
  const blockMatch = text.match(/(?:SIZE|SIZES|ADD)\s*([\s\S]{0,600})/i);
  const block = blockMatch ? blockMatch[1] : text;
  const tokens = [];
  const regex = /\b(XXS|XS|S|M|L|XL|XXL)\b/g;
  let match;
  while ((match = regex.exec(block)) !== null) {
    tokens.push(match[1].toUpperCase());
  }
  return Array.from(new Set(tokens));
}

function parseAvailability(text, buttonLabels) {
  const hasAddButton = buttonLabels.some((label) => label.includes('ADD'));
  const soldOutSignal = /SOLD OUT|OUT OF STOCK|UNAVAILABLE/i.test(text);
  return hasAddButton && !soldOutSignal;
}

function evaluateCare(careLines) {
  const normalized = (careLines || []).map((line) => normalizeSpace(line)).filter(Boolean);
  const fullText = lower(normalized.join('\n'));
  const hasDoNotWash = fullText.includes('do not wash');
  const washable = REJECT_DO_NOT_WASH ? !hasDoNotWash : true;
  return {
    washable,
    hasDoNotWash,
    reason: !REJECT_DO_NOT_WASH ? 'care_rule_disabled' : hasDoNotWash ? 'do_not_wash' : 'wash_allowed',
    careRaw: normalized.join('; ')
  };
}

async function acceptCookiesIfPresent(page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("ACCEPT ALL")',
    'button:has-text("Accept")',
    '#onetrust-accept-btn-handler'
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
  }
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && raw.scopes && typeof raw.scopes === 'object') return raw;
    if (raw && Array.isArray(raw.seenKeys)) {
      return {
        scopes: {
          women_new: {
            seenKeys: raw.seenKeys,
            updatedAt: raw.updatedAt || '',
            catalogCount: raw.catalogCount || raw.seenKeys.length
          },
          women_full: {
            seenKeys: [],
            updatedAt: '',
            catalogCount: 0
          }
        }
      };
    }
    return { scopes: {} };
  } catch {
    return { scopes: {} };
  }
}

function writeState(state) {
  ensureDir(path.dirname(STATE_FILE));
  safeWriteJson(STATE_FILE, state);
}

function collectProductCards(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectProductCards(item, out);
    return;
  }

  if (Array.isArray(node.commercialComponents)) {
    for (const component of node.commercialComponents) {
      if (!component || component.type !== 'Product') continue;
      const seo = component.seo || {};
      if (!seo.keyword || !seo.seoProductId) continue;
      const colorId = component.detail?.colors?.[0]?.id || 'na';
      const colorName = component.detail?.colors?.[0]?.name || component.colorList?.[0]?.name || '';
      const url = `https://www.zara.com/me/en/${seo.keyword}-p${seo.seoProductId}.html?v1=${seo.discernProductId || ''}`;
      const availability = lower(component.availability || component.detail?.colors?.[0]?.availability || '');

      out.push({
        key: `${seo.seoProductId}-${colorId}`,
        catentryId: component.id,
        seoProductId: String(seo.seoProductId),
        reference: component.reference || component.detail?.reference || '',
        name: component.name || '',
        color: colorName,
        priceEur: Number.isFinite(Number(component.price)) ? Number(component.price) / 100 : null,
        url,
        inStock: availability === 'in_stock'
      });
    }
  }

  for (const value of Object.values(node)) {
    collectProductCards(value, out);
  }
}

async function fetchCatalogCardsFromListingUrl(context, listingUrl) {
  const page = await context.newPage();
  let productsPayload = null;

  page.on('response', async (response) => {
    if (!/\/category\/\d+\/products\?ajax=true/.test(response.url())) return;
    const text = await response.text().catch(() => '');
    if (!text) return;
    try {
      productsPayload = JSON.parse(text);
    } catch {
      // Ignore malformed payloads.
    }
  });

  await page.goto(listingUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT_MS
  });
  await acceptCookiesIfPresent(page);
  await page.waitForTimeout(LIST_WAIT_MS);

  if (!productsPayload) {
    await page.close();
    throw new Error('Could not capture full catalog payload from Zara listing endpoint.');
  }

  const cards = [];
  collectProductCards(productsPayload, cards);
  await page.close();

  const byKey = new Map();
  for (const card of cards) {
    if (!byKey.has(card.key)) byKey.set(card.key, card);
  }
  return Array.from(byKey.values());
}

function findWomenRootCategory(categories) {
  const list = Array.isArray(categories) ? categories : [];
  return (
    list.find((cat) => Number(cat?.id) === 1881757 && String(cat?.sectionName || '').toUpperCase() === 'WOMAN') ||
    list.find((cat) => String(cat?.sectionName || '').toUpperCase() === 'WOMAN') ||
    null
  );
}

function collectCategoryIds(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectCategoryIds(item, out);
    return;
  }
  if (Number.isFinite(Number(node.id))) out.add(Number(node.id));
  if (Array.isArray(node.subcategories)) {
    for (const sub of node.subcategories) collectCategoryIds(sub, out);
  }
}

async function fetchWomenFullCards(context) {
  const categoriesResp = await context.request.get(WOMEN_CATEGORIES_URL);
  if (!categoriesResp.ok()) throw new Error('Could not load Women categories tree.');
  const categoriesJson = await categoriesResp.json().catch(() => null);
  const womenRoot = findWomenRootCategory(categoriesJson?.categories);
  if (!womenRoot) throw new Error('Could not locate Women root category.');

  const categoryIds = new Set();
  collectCategoryIds(womenRoot, categoryIds);

  const cards = [];
  for (const categoryId of categoryIds) {
    const productsUrl = `https://www.zara.com/me/en/category/${categoryId}/products?ajax=true`;
    const response = await context.request.get(productsUrl);
    if (!response.ok()) continue;
    const payload = await response.json().catch(() => null);
    if (!payload) continue;
    collectProductCards(payload, cards);
  }

  const byKey = new Map();
  for (const card of cards) {
    if (!byKey.has(card.key)) byKey.set(card.key, card);
  }
  return Array.from(byKey.values());
}

async function parseProduct(context, productCard) {
  const page = await context.newPage();
  await page.goto(productCard.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(PRODUCT_WAIT_MS);

  const snapshot = await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText : '';
    const title = document.title || '';
    const name = (document.querySelector('h1')?.textContent || '').trim();
    const buttonLabels = Array.from(document.querySelectorAll('button,[role="button"]'))
      .map((el) => (el.textContent || '').toUpperCase().replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const ldJsonScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((node) => node.textContent || '');
    return {
      title,
      name,
      bodyText,
      catentryId: window.zara?.analyticsData?.catentryId || null,
      buttonLabels,
      ldJsonScripts
    };
  });

  const parsedLdJson = parseJsonScripts(snapshot.ldJsonScripts || []);
  const productObjects = collectProductObjectsFromLdJson(parsedLdJson);
  const firstProduct = productObjects[0] || {};

  let compositionLines = [];
  let careLines = [];
  /** Percentages and materials only from PDP extra-detail (same data as product detail page). */
  let compositionSource = 'missing_catentry';
  let careSource = 'missing_catentry';
  const catentryId = snapshot.catentryId || productCard.catentryId || null;

  if (catentryId) {
    compositionSource = 'extra_detail_empty';
    const extraUrl = `https://www.zara.com/me/en/product/id/${catentryId}/extra-detail?ajax=true`;
    const extraResp = await page.request.get(extraUrl);
    if (!extraResp.ok()) {
      compositionSource = 'extra_detail_request_failed';
    } else {
      const extraJson = await extraResp.json().catch(() => null);
      if (!Array.isArray(extraJson)) {
        compositionSource = 'extra_detail_payload_invalid';
      } else {
        const materialSection = extraJson.find((section) => section?.sectionType === 'materials');
        const paragraphTexts = (materialSection?.components || [])
          .map((component) => normalizeSpace(component?.text?.value || ''))
          .filter(Boolean);
        if (paragraphTexts.length === 0) {
          compositionSource = 'extra_detail_no_paragraphs';
        } else {
          compositionLines = parseCompositionLines(paragraphTexts.join('\n'));
          compositionSource =
            compositionLines.length > 0 ? 'extra_detail' : 'extra_detail_unparsed';
        }

        const careSection = extraJson.find((section) => section?.sectionType === 'care');
        const careTexts = (careSection?.components || [])
          .map((component) => normalizeSpace(component?.text?.value || ''))
          .filter(Boolean);
        if (careTexts.length > 0) {
          careLines = careTexts;
          careSource = 'extra_detail';
        } else {
          careSource = 'extra_detail_no_care_section';
        }
      }
    }
  }

  let montenegroAvailable = false;
  if (catentryId) {
    const availabilityUrl = `https://www.zara.com/itxrest/1/catalog/store/${CATALOG_STORE_ID}/product/id/${catentryId}/availability`;
    const availabilityResp = await page.request.get(availabilityUrl);
    if (availabilityResp.ok()) {
      const availabilityJson = await availabilityResp.json().catch(() => null);
      const skuAvailability = Array.isArray(availabilityJson?.skusAvailability)
        ? availabilityJson.skusAvailability
        : [];
      montenegroAvailable = skuAvailability.some((sku) => lower(sku.availability) === 'in_stock');
    }
  }

  await page.close();

  const text = snapshot.bodyText || '';
  const hasDoNotWashInBody = /do not wash/i.test(text);
  if (hasDoNotWashInBody && !careLines.some((line) => /do not wash/i.test(line))) {
    careLines = [...careLines, 'Do not wash'];
    careSource = careLines.length > 1 ? `${careSource}+body_do_not_wash` : 'body_text_fallback';
  }
  const compositionEval = evaluateComposition(compositionLines);
  const careEval = evaluateCare(careLines);

  const sizeSMatchFromLdJson = productObjects.some((product) => {
    const size = String(product?.size || '').toUpperCase();
    const availability = String(product?.offers?.availability || '').toLowerCase();
    return size === REQUIRED_SIZE && availability.includes('instock');
  });
  const sizeTokens = productObjects
    .map((product) => String(product?.size || '').toUpperCase())
    .filter(Boolean);
  const sizeSMatchFromText = hasRequiredSize(sizeTokens.length ? sizeTokens : parseSizeTokens(text.toUpperCase()));
  const sizeSMatch = sizeSMatchFromLdJson || sizeSMatchFromText;

  const color = normalizeSpace(firstProduct.color || productCard.color || parseColorFromText(`\n${text}\n${snapshot.title}`));
  const orderAvailable = montenegroAvailable || productCard.inStock || parseAvailability(text, snapshot.buttonLabels || []);
  const priceValue = Number(firstProduct?.offers?.price);
  const priceEur = Number.isFinite(priceValue) ? priceValue : productCard.priceEur;

  const colorMatch = matchColor(color);
  const compositionMatch = compositionEval.passed;
  const careMatch = careEval.washable;
  const sizeSAvailable = sizeSMatch;
  const montenegroOrderAvailable = REQUIRE_MONTENEGRO_IN_STOCK ? orderAvailable : true;

  return {
    scannedAt: new Date().toISOString(),
    key: productCard.key,
    url: productCard.url,
    name: snapshot.name || productCard.name || normalizeSpace(snapshot.title.replace(/\|\s*ZARA.*$/i, '')),
    color,
    priceEur,
    compositionRaw: compositionLines.map((line) => `${line.percent}% ${line.material}`).join('; '),
    compositionSource,
    mainFabricRaw: compositionEval.mainFabricRaw,
    secondaryFabricRaw: compositionEval.secondaryFabricRaw,
    unknownSectionRaw: compositionEval.unknownSectionRaw,
    targetFabricPercent: compositionEval.targetFabricPercent,
    targetFabricPercentSecondary: compositionEval.targetFabricPercentSecondary,
    compositionMode: compositionEval.mode,
    compositionReason: compositionEval.reason,
    requiredSize: REQUIRED_SIZE,
    careRaw: careEval.careRaw,
    careSource,
    washable: careEval.washable,
    careReason: careEval.reason,
    mixedMainFabric: compositionEval.mixedMainFabric,
    containsTargetFabric: compositionEval.containsTargetFabric,
    sizeTokens,
    sizeSAvailable,
    montenegroAvailable: montenegroOrderAvailable,
    matches: {
      colorMatch,
      compositionMatch,
      careMatch,
      sizeSMatch,
      montenegroAvailable: montenegroOrderAvailable
    },
    matched: colorMatch && compositionMatch && careMatch && sizeSMatch && montenegroOrderAvailable
  };
}

function buildDecisionReason(item) {
  const reasons = [];
  if (!item?.matches?.colorMatch) reasons.push('color');
  if (!item?.matches?.compositionMatch) reasons.push('composition');
  if (!item?.matches?.careMatch) reasons.push('care');
  if (!item?.matches?.sizeSMatch) reasons.push(`size_${REQUIRED_SIZE}`);
  if (!item?.matches?.montenegroAvailable) reasons.push(REQUIRE_MONTENEGRO_IN_STOCK ? 'availability_ME' : 'availability_rule_disabled');
  return reasons.length ? `failed: ${reasons.join(', ')}` : 'passed';
}

function toAuditRow(item) {
  return {
    timestamp: item.scannedAt || '',
    name: item.name || '',
    url: item.url || '',
    color: item.color || '',
    color_source: item.colorEval?.sourceColor || item.color || '',
    color_normalized: item.colorEval?.normalizedColor || '',
    color_bucket: item.colorEval?.bucket || '',
    color_keywords: (item.colorEval?.matchedKeywords || []).join(', '),
    color_passed: item.colorEval?.passed ? 'yes' : 'no',
    composition_raw: item.compositionRaw || '',
    main_fabric_raw: item.mainFabricRaw || '',
    secondary_fabric_raw: item.secondaryFabricRaw || '',
    unknown_section_raw: item.unknownSectionRaw || '',
    composition_source: item.compositionSource || '',
    target_fabric_percent: item.targetFabricPercent ?? '',
    target_fabric_percent_secondary: item.targetFabricPercentSecondary ?? '',
    composition_mode: item.compositionMode || '',
    composition_reason: item.compositionReason || '',
    required_size: item.requiredSize || REQUIRED_SIZE,
    care_raw: item.careRaw || '',
    care_source: item.careSource || '',
    washable: item.washable ? 'yes' : 'no',
    care_reason: item.careReason || '',
    mixed_main_fabric: item.mixedMainFabric ? 'yes' : 'no',
    contains_target_fabric: item.containsTargetFabric ? 'yes' : 'no',
    composition_passed: item.matches?.compositionMatch ? 'yes' : 'no',
    size_tokens: (item.sizeTokens || []).join(', '),
    size_required_available: item.sizeSAvailable ? 'yes' : 'no',
    size_S_available: item.sizeSAvailable ? 'yes' : 'no',
    montenegro_available: item.montenegroAvailable ? 'yes' : 'no',
    final_matched: item.matched ? 'yes' : 'no',
    price_eur: item.priceEur == null ? '' : item.priceEur,
    decision: buildDecisionReason(item),
    error: item.error || ''
  };
}

function buildScopeSheets(scopeResult) {
  const { allProducts, matches, meta } = scopeResult;
  const matchRows = matches.map((item) => ({
    timestamp: item.scannedAt,
    name: item.name,
    url: item.url,
    color: item.color,
    color_bucket: item.colorEval?.bucket || '',
    color_keywords: (item.colorEval?.matchedKeywords || []).join(', '),
    composition_raw: item.compositionRaw,
    main_fabric_raw: item.mainFabricRaw || '',
    secondary_fabric_raw: item.secondaryFabricRaw || '',
    unknown_section_raw: item.unknownSectionRaw || '',
    composition_source: item.compositionSource || '',
    target_fabric_percent: item.targetFabricPercent,
    target_fabric_percent_secondary: item.targetFabricPercentSecondary ?? '',
    composition_reason: item.compositionReason || '',
    required_size: item.requiredSize || REQUIRED_SIZE,
    care_raw: item.careRaw || '',
    care_source: item.careSource || '',
    washable: item.washable ? 'yes' : 'no',
    care_reason: item.careReason || '',
    size_required_available: item.sizeSAvailable ? 'yes' : 'no',
    size_S_available: item.sizeSAvailable ? 'yes' : 'no',
    montenegro_available: item.montenegroAvailable ? 'yes' : 'no',
    price_eur: item.priceEur == null ? '' : item.priceEur,
    decision: buildDecisionReason(item)
  }));

  if (matchRows.length === 0) {
    matchRows.push({
      timestamp: new Date().toISOString(),
      name: '',
      url: '',
      color: '',
      color_bucket: '',
      color_keywords: '',
      composition_raw: '',
      main_fabric_raw: '',
      secondary_fabric_raw: '',
      unknown_section_raw: '',
      composition_source: '',
      target_fabric_percent: '',
      target_fabric_percent_secondary: '',
      composition_reason: '',
      required_size: REQUIRED_SIZE,
      care_raw: '',
      care_source: '',
      washable: '',
      care_reason: '',
      size_required_available: '',
      size_S_available: '',
      montenegro_available: '',
      price_eur: '',
      decision: 'no matches'
    });
  }

  const allRows = allProducts.map(toAuditRow);
  const colorStageRows = allProducts.filter((item) => item.colorEval?.passed).map(toAuditRow);
  const compositionStageRows = allProducts
    .filter((item) => item.colorEval?.passed && item.matches?.compositionMatch)
    .map(toAuditRow);
  const careStageRows = allProducts
    .filter((item) => item.colorEval?.passed && item.matches?.compositionMatch && item.matches?.careMatch)
    .map(toAuditRow);
  const sizeStageRows = allProducts
    .filter((item) => item.colorEval?.passed && item.matches?.compositionMatch && item.matches?.careMatch && item.matches?.sizeSMatch)
    .map(toAuditRow);
  const availabilityStageRows = allProducts
    .filter(
      (item) =>
        item.colorEval?.passed &&
        item.matches?.compositionMatch &&
        item.matches?.careMatch &&
        item.matches?.sizeSMatch &&
        item.matches?.montenegroAvailable
    )
    .map(toAuditRow);

  const summaryRows = [
    { metric: 'generated_at', value: meta.generatedAt },
    { metric: 'scope', value: meta.scope },
    { metric: 'first_run', value: meta.firstRun ? 'yes' : 'no' },
    { metric: 'full_rescan_requested', value: meta.fullRescanRequested ? 'yes' : 'no' },
    { metric: 'catalog_product_count', value: meta.catalogProductCount },
    { metric: 'processed_product_count', value: meta.processedProductCount },
    { metric: 'skipped_known_product_count', value: meta.skippedKnownProductCount },
    { metric: 'match_count', value: meta.matchCount },
    { metric: 'color_passed_count', value: meta.colorPassedCount },
    { metric: 'color_failed_count', value: meta.colorFailedCount },
    { metric: 'composition_passed_count', value: meta.compositionPassedCount },
    { metric: 'composition_failed_count', value: meta.compositionFailedCount },
    { metric: 'care_passed_count', value: meta.carePassedCount },
    { metric: 'care_failed_count', value: meta.careFailedCount },
    { metric: 'size_passed_count', value: meta.sizePassedCount },
    { metric: 'size_failed_count', value: meta.sizeFailedCount },
    { metric: 'availability_passed_count', value: meta.availabilityPassedCount },
    { metric: 'availability_failed_count', value: meta.availabilityFailedCount },
    { metric: 'stage_color_count', value: meta.stageColorCount },
    { metric: 'stage_composition_count', value: meta.stageCompositionCount },
    { metric: 'stage_care_count', value: meta.stageCareCount },
    { metric: 'stage_size_count', value: meta.stageSizeCount },
    { metric: 'stage_availability_count', value: meta.stageAvailabilityCount }
  ];

  for (const [bucket, count] of Object.entries(meta.colorBucketCounts || {})) {
    summaryRows.push({ metric: `color_bucket_${bucket}`, value: count });
  }
  for (const [keyword, count] of Object.entries(meta.colorKeywordCounts || {})) {
    summaryRows.push({ metric: `color_keyword_${keyword}`, value: count });
  }

  return { summaryRows, matchRows, allRows, colorStageRows, compositionStageRows, careStageRows, sizeStageRows, availabilityStageRows };
}

function writeXlsx(scopeResults, xlsxPath) {
  const workbook = XLSX.utils.book_new();

  for (const scopeResult of scopeResults) {
    const prefix = scopeResult.scope.sheetPrefix;
    const sheets = buildScopeSheets(scopeResult);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.summaryRows), `${prefix}_summary`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.matchRows), `${prefix}_matches`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.allRows), `${prefix}_all_catalog`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.colorStageRows), `${prefix}_color_stage`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.compositionStageRows), `${prefix}_composition_stage`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.careStageRows), `${prefix}_care_stage`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.sizeStageRows), `${prefix}_size_stage`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheets.availabilityStageRows), `${prefix}_availability_stage`);
  }

  const combinedSummary = scopeResults.map((scopeResult) => ({
    scope: scopeResult.scope.id,
    label: scopeResult.scope.label,
    catalog_product_count: scopeResult.meta.catalogProductCount,
    processed_product_count: scopeResult.meta.processedProductCount,
    match_count: scopeResult.meta.matchCount,
    stage_color_count: scopeResult.meta.stageColorCount,
    stage_composition_count: scopeResult.meta.stageCompositionCount,
    stage_care_count: scopeResult.meta.stageCareCount,
    stage_size_count: scopeResult.meta.stageSizeCount,
    stage_availability_count: scopeResult.meta.stageAvailabilityCount
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(combinedSummary), 'combined_summary');

  XLSX.writeFile(workbook, xlsxPath);
}

function buildQuickRejectedResult(productCard) {
  const colorEval = evaluateColor(productCard.color);
  const colorMatch = colorEval.passed;
  return {
    scannedAt: new Date().toISOString(),
    key: productCard.key,
    url: productCard.url,
    name: productCard.name,
    color: productCard.color,
    priceEur: productCard.priceEur,
    compositionRaw: '',
    mainFabricRaw: '',
    secondaryFabricRaw: '',
    unknownSectionRaw: '',
    compositionSource: 'not_fetched_color_gate',
    targetFabricPercent: 0,
    targetFabricPercentSecondary: 0,
    compositionReason: 'not_evaluated_color_gate',
    careRaw: '',
    careSource: 'not_evaluated_color_gate',
    washable: false,
    careReason: 'not_evaluated_color_gate',
    requiredSize: REQUIRED_SIZE,
    sizeTokens: [],
    sizeSAvailable: false,
    montenegroAvailable: productCard.inStock,
    matches: {
      colorMatch,
      compositionMatch: false,
      careMatch: false,
      sizeSMatch: false,
      montenegroAvailable: productCard.inStock
    },
    colorEval,
    matched: false
  };
}

async function runMonitor(options = {}) {
  ensureDir(OUTPUT_DIR);
  ensureDir(PROFILE_DIR);

  const browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: options.headless ?? DEFAULT_HEADLESS,
    channel: BROWSER_CHANNEL,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB'
  });

  try {
    const state = readState();
    if (!state.scopes || typeof state.scopes !== 'object') state.scopes = {};
    const scopeResults = [];

    const enabledScopes = BASE_SCOPE_CONFIGS.filter((scope) => {
      if (scope.id === 'women_new') return SCOPE_FLAGS.womenNew !== false;
      if (scope.id === 'women_full') return SCOPE_FLAGS.womenFull !== false;
      return true;
    });
    if (enabledScopes.length === 0) {
      throw new Error('No scopes enabled. Run "npm run configure" and enable at least one scope.');
    }

    for (const scope of enabledScopes) {
      let catalogCards = [];
      if (scope.type === 'listing_url') {
        catalogCards = await fetchCatalogCardsFromListingUrl(browserContext, scope.url);
      } else if (scope.type === 'women_full') {
        catalogCards = await fetchWomenFullCards(browserContext);
      } else {
        throw new Error(`Unknown scope type: ${scope.type}`);
      }

      const scopeState = state.scopes[scope.id] || { seenKeys: [] };
      const seenKeys = new Set(scopeState.seenKeys || []);
      const isFirstRun = seenKeys.size === 0 || Boolean(options.forceFullRescan);
      const cardsToProcess = isFirstRun
        ? catalogCards
        : catalogCards.filter((card) => !seenKeys.has(card.key));

      const parseConcurrency = scope.id === 'women_full' ? 8 : 4;
      const results = await mapLimit(cardsToProcess, parseConcurrency, async (card) => {
        try {
          const colorEval = evaluateColor(card.color);
          if (!colorEval.passed) return buildQuickRejectedResult(card);
          const parsed = await parseProduct(browserContext, card);
          parsed.colorEval = colorEval;
          return parsed;
        } catch (error) {
          return {
            scannedAt: new Date().toISOString(),
            key: card.key,
            url: card.url,
            color: card.color,
            colorEval: evaluateColor(card.color),
            compositionSource: 'parse_error',
            careSource: 'parse_error',
            error: error.message,
            matched: false
          };
        }
      });

      const matches = results.filter((item) => item.matched);
      const colorPassedCount = results.filter((item) => item.colorEval?.passed).length;
      const colorFailedCount = results.filter((item) => item.colorEval && !item.colorEval.passed).length;
      const compositionPassedCount = results.filter((item) => item.matches?.compositionMatch).length;
      const compositionFailedCount = results.filter((item) => !item.matches?.compositionMatch).length;
      const carePassedCount = results.filter((item) => item.matches?.careMatch).length;
      const careFailedCount = results.filter((item) => !item.matches?.careMatch).length;
      const sizePassedCount = results.filter((item) => item.matches?.sizeSMatch).length;
      const sizeFailedCount = results.filter((item) => !item.matches?.sizeSMatch).length;
      const availabilityPassedCount = results.filter((item) => item.matches?.montenegroAvailable).length;
      const availabilityFailedCount = results.filter((item) => !item.matches?.montenegroAvailable).length;
      const stageColorCount = results.filter((item) => item.colorEval?.passed).length;
      const stageCompositionCount = results.filter(
        (item) => item.colorEval?.passed && item.matches?.compositionMatch
      ).length;
      const stageCareCount = results.filter(
        (item) => item.colorEval?.passed && item.matches?.compositionMatch && item.matches?.careMatch
      ).length;
      const stageSizeCount = results.filter(
        (item) => item.colorEval?.passed && item.matches?.compositionMatch && item.matches?.careMatch && item.matches?.sizeSMatch
      ).length;
      const stageAvailabilityCount = results.filter(
        (item) =>
          item.colorEval?.passed &&
          item.matches?.compositionMatch &&
          item.matches?.careMatch &&
          item.matches?.sizeSMatch &&
          item.matches?.montenegroAvailable
      ).length;
      const colorBucketCounts = {};
      const colorKeywordCounts = {};
      for (const item of results) {
        const bucket = item.colorEval?.bucket || 'none';
        colorBucketCounts[bucket] = (colorBucketCounts[bucket] || 0) + 1;
        for (const keyword of item.colorEval?.matchedKeywords || []) {
          colorKeywordCounts[keyword] = (colorKeywordCounts[keyword] || 0) + 1;
        }
      }

      const meta = {
        generatedAt: new Date().toISOString(),
        scope: scope.label,
        firstRun: isFirstRun,
        fullRescanRequested: Boolean(options.forceFullRescan),
        catalogProductCount: catalogCards.length,
        processedProductCount: cardsToProcess.length,
        skippedKnownProductCount: Math.max(catalogCards.length - cardsToProcess.length, 0),
        matchCount: matches.length,
        colorPassedCount,
        colorFailedCount,
        compositionPassedCount,
        compositionFailedCount,
        carePassedCount,
        careFailedCount,
        sizePassedCount,
        sizeFailedCount,
        availabilityPassedCount,
        availabilityFailedCount,
        stageColorCount,
        stageCompositionCount,
        stageCareCount,
        stageSizeCount,
        stageAvailabilityCount,
        colorBucketCounts,
        colorKeywordCounts
      };

      scopeResults.push({ scope, allProducts: results, matches, meta });
      state.scopes[scope.id] = {
        seenKeys: catalogCards.map((card) => card.key),
        updatedAt: new Date().toISOString(),
        catalogCount: catalogCards.length
      };
    }

    const stamp = nowTimestamp();
    const jsonPath = path.join(OUTPUT_DIR, `zara-montenegro-scan-${stamp}.json`);
    const xlsxPath = path.join(OUTPUT_DIR, `zara-montenegro-matches-${stamp}.xlsx`);

    writeState(state);

    const combined = scopeResults.reduce(
      (acc, scopeResult) => {
        acc.catalogProductCount += scopeResult.meta.catalogProductCount;
        acc.processedProductCount += scopeResult.meta.processedProductCount;
        acc.matchCount += scopeResult.meta.matchCount;
        return acc;
      },
      { catalogProductCount: 0, processedProductCount: 0, matchCount: 0 }
    );

    safeWriteJson(jsonPath, {
      generatedAt: new Date().toISOString(),
      scopes: scopeResults.map((scopeResult) => ({
        id: scopeResult.scope.id,
        label: scopeResult.scope.label,
        meta: scopeResult.meta,
        products: scopeResult.allProducts
      })),
      combined
    });
    writeXlsx(scopeResults, xlsxPath);

    return {
      productCount: combined.processedProductCount,
      processedProductCount: combined.processedProductCount,
      catalogProductCount: combined.catalogProductCount,
      matchCount: combined.matchCount,
      scopeStats: scopeResults.map((scopeResult) => ({
        id: scopeResult.scope.id,
        label: scopeResult.scope.label,
        catalogProductCount: scopeResult.meta.catalogProductCount,
        processedProductCount: scopeResult.meta.processedProductCount,
        matchCount: scopeResult.meta.matchCount
      })),
      jsonPath,
      xlsxPath
    };
  } finally {
    await browserContext.close();
  }
}

module.exports = {
  runMonitor,
  OUTPUT_DIR
};
