#!/usr/bin/env node

/**
 * lg-dsl / dsl.mjs
 *
 * 处理 MasterGo DSL 原始数据：
 *   1. 读取 raw DSL JSON
 *   2. 检测 componentType + role
 *   3. 提取 layout_zones / component_details / visual_style / icons
 *   4. 按 designName 聚类 pages
 *   5. 匹配原型截图
 *   6. 应用合并规则生成 outputs
 *   7. 输出 extracted/ JSON + page-mapping.json
 *
 * 用法:
 *   echo '{"version":"1.4.6","designs":[...]}' | node dsl.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { collectRequirementIndex, matchRequirementPage, summarizeRequirement, matchDesignRequirement, matchDesignAnalyzeSmoke, extractKeywords } from './dsl-requirement.mjs';
import { readInput, guard, guardPaths, guardDesigns, dedupeDesigns, SCHEMAS } from './input-guard.mjs';

// ============================================================
// 1. 检测 componentType
// ============================================================

const ROLE_CREATE_KEYWORDS = ['新增', '添加', '新建', '创建', 'create', 'add', 'new'];
const ROLE_EDIT_KEYWORDS   = ['编辑', '修改', '变更', 'edit', 'modify', 'update'];
const ROLE_VIEW_KEYWORDS   = ['查看', '详情', '预览', 'view', 'detail', 'preview'];

function detectRole(designName) {
  const lower = designName.toLowerCase();
  for (const kw of ROLE_CREATE_KEYWORDS) if (lower.includes(kw)) return 'create';
  for (const kw of ROLE_EDIT_KEYWORDS)   if (lower.includes(kw)) return 'edit';
  for (const kw of ROLE_VIEW_KEYWORDS)   if (lower.includes(kw)) return 'view';
  return null;
}

/**
 * 从 DSL 中递归收集所有节点
 */
function collectAllNodes(nodes, result = []) {
  for (const node of nodes) {
    result.push(node);
    if (node.children) collectAllNodes(node.children, result);
    if (node.nodes)    collectAllNodes(node.nodes, result);
  }
  return result;
}

/**
 * 检测 DSL 中是否包含表格结构
 * 特征：多个 TEXT 节点在同一 GROUP 内水平排列，数量 >= 5
 */
function hasTableStructure(dsl) {
  if (!dsl.sections && !dsl.nodes) return false;

  const allNodes = dsl.sections
    ? dsl.sections.flatMap(s => collectAllNodes(s.dsl?.nodes || []))
    : collectAllNodes(dsl.nodes || []);

  // 检查 rowTexts 是否包含表格列特征
  if (dsl.sections) {
    for (const s of dsl.sections) {
      const rowTexts = s.rowTexts || s.dsl?.rowTexts || [];
      // 表头一般有 5+ 列
      if (rowTexts.length >= 5) return true;
    }
  }

  // 检查 GROUP 内是否有大量 TEXT 子节点
  for (const node of allNodes) {
    if ((node.type === 'GROUP' || node.type === 'FRAME') && node.children) {
      const textChildren = node.children.filter(c => c.type === 'TEXT');
      if (textChildren.length >= 5) return true;
    }
  }

  return false;
}

/**
 * 检测 DSL 中是否包含表单控件
 * 特征：包含 INPUT、SELECT、Date-Picker 等命名的 FRAME
 */
function hasFormControls(dsl) {
  if (!dsl.sections && !dsl.nodes) return false;

  const allNodes = dsl.sections
    ? dsl.sections.flatMap(s => collectAllNodes(s.dsl?.nodes || []))
    : collectAllNodes(dsl.nodes || []);

  for (const node of allNodes) {
    const name = (node.name || '').toLowerCase();
    if (name.includes('input') || name.includes('select') ||
        name.includes('picker') || name.includes('date') ||
        name.includes('form')   || name.includes('button') ||
        name.includes('checkbox') || name.includes('radio') ||
        name.includes('textarea')) {
      return true;
    }
  }

  return false;
}

function detectComponentType(dsl, designName) {
  const hasTable = hasTableStructure(dsl);
  const hasForm  = hasFormControls(dsl);

  if (hasTable && hasForm)  return 'list';   // 列表页 = 表格 + 筛选表单
  if (hasTable)             return 'list';
  if (hasForm)              return 'form';

  // 兜底：从设计稿名称推断
  const lower = designName.toLowerCase();
  if (lower.includes('列表') || lower.includes('list')) return 'list';
  if (lower.includes('表单') || lower.includes('form')) return 'form';
  if (lower.includes('详情') || lower.includes('detail') || lower.includes('查看')) return 'detail';

  return 'unknown';
}

// ============================================================
// 2. 提取 structured DSL
// ============================================================

/**
 * 从 sections 中提取布局区域
 * 坐标来源优先级：section 顶层 x/y/width/height（若有）→ section.dsl.nodes 首节点 layoutStyle
 */
function extractLayoutZones(sections) {
  const zones = [];
  for (const s of sections) {
    const name = s.name || s.section?.name || '';
    if (name.includes('矩形') || name.includes('scrollbar') || name.includes('滚动条')) continue;

    let x = s.x || 0;
    let y = s.y || 0;
    let width = s.width || 0;
    let height = s.height || 0;

    // 兜底：从 section.dsl.nodes 首节点聚合坐标（section 顶层无坐标时）
    if (width === 0 && height === 0) {
      const nodes = s.dsl?.nodes || [];
      if (nodes.length > 0) {
        const ls = nodes[0].layoutStyle || {};
        width = ls.width || 0;
        height = ls.height || 0;
        x = ls.relativeX || 0;
        y = ls.relativeY || 0;
      }
    }

    zones.push({ name, x, y, width, height });
  }
  return zones;
}

/**
 * 从 sections 的 rowTexts 提取表格列定义
 * rowTexts 位于 section.dsl.rowTexts（嵌套结构）
 */
function extractTableColumns(sections) {
  // 找表头 section（通常 name 包含"表头"或 rowTexts 数量多）
  for (const s of sections) {
    const rowTexts = s.rowTexts || s.dsl?.rowTexts || [];
    if (rowTexts.length >= 5) {
      return rowTexts
        .filter(t => !t._placeholder && t.parentName)
        .map(t => ({
          title:       t.text,
          dataIndex:   textToDataIndex(t.text),
          width:       estimateColumnWidth(t.text),
        }));
    }
  }
  return [];
}

/**
 * 中文列名 → dataIndex（kebab-case）
 */
function textToDataIndex(text) {
  const map = {
    '平台':       'platform',
    '所属计划名称': 'planName',
    '商单ID':     'orderId',
    '达人昵称':    'nickname',
    '达人粉丝数':  'fansCount',
    '佣金(元)':   'commission',
    '作品提交时间': 'workSubmitTime',
    '商单完成时间': 'orderCompleteTime',
    '操作':       'action',
    '计划名称':    'planName',
    '商单状态':    'orderStatus',
    '创建时间':    'createTime',
    '更新时间':    'updateTime',
  };
  if (map[text]) return map[text];

  // 通用转换：中文 → 拼音首字母组合
  return text
    .replace(/[()（）]/g, '')
    .replace(/[一-龥]+/g, (m) => m.charAt(0).toLowerCase() + m.slice(1))
    .replace(/\s+/g, '');
}

function estimateColumnWidth(text) {
  const charWidth = 20; // 中文字符大约 20px
  return Math.max(text.length * charWidth + 20, 60);
}

/**
 * 提取筛选字段
 */
function extractFilterFields(sections) {
  const fields = [];
  for (const s of sections) {
    const rowTexts = s.rowTexts || s.dsl?.rowTexts || [];
    // 筛选区域特征：有 label + input/select 组合
    const labels = rowTexts.filter(t => !t._placeholder && t.parentName);
    if (labels.length >= 2 && labels.length <= 8) {
      for (const label of labels) {
        if (['导出', '搜索', '重置', '折叠筛选', '展开筛选'].includes(label.text)) continue;
        fields.push({
          label:  label.text,
          field:  textToDataIndex(label.text),
          widget: guessWidget(label.text),
          width:  172,
        });
      }
    }
  }
  return fields;
}

function guessWidget(label) {
  if (label.includes('日期') || label.includes('时间')) return 'date-range';
  if (label.includes('状态') || label.includes('平台') || label.includes('类型')) return 'select';
  if (label.includes('ID') || label.includes('编号')) return 'input';
  return 'input';
}

/**
 * 聚合 sections 中嵌套的 dsl.styles（styles 位于 section[].dsl 内部）
 */
function aggregateStyles(sections) {
  const merged = {};
  for (const s of sections) {
    const dslStyles = s.dsl?.styles || {};
    for (const [key, val] of Object.entries(dslStyles)) {
      if (!merged[key]) merged[key] = val;
    }
  }
  return merged;
}

/**
 * 从 DSL styles 中提取颜色/字体/圆角
 */
function extractVisualStyle(styles) {
  const colors = {};
  const fonts  = {};
  const radius = {};

  if (!styles) return { colors, fonts, radius };

  for (const [key, val] of Object.entries(styles)) {
    if (!val || !val.value) continue;

    // 颜色提取
    if (key.startsWith('paint_')) {
      const v = Array.isArray(val.value) ? val.value[0] : val.value;
      if (typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'))) {
        const colorName = key.replace('paint_', '');
        colors[colorName] = { hex: v };
      }
    }

    // 字体提取
    if (key.startsWith('font_')) {
      const v = val.value;
      if (v && v.family) {
        const fontName = key.replace('font_', '');
        fonts[fontName] = {
          family:     v.family,
          size:       v.size,
          weight:     v.weight || v.style?.weight,
          lineHeight: v.lineHeight,
        };
      }
    }
  }

  // 从 sections 中提取圆角
  return { colors, fonts, radius };
}

/**
 * 提取图标引用
 */
function extractIcons(sections) {
  const icons = {};

  for (const s of sections) {
    const svgNodes = s.svgNodeCount || 0;
    if (svgNodes === 0) continue;

    // 从 DSL nodes 中找到 PATH 节点
    const allNodes = collectAllNodes(s.dsl?.nodes || []);
    for (const node of allNodes) {
      if (node.svgShortKey) {
        const name = node.svgName || node.name || 'icon';
        const key  = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        icons[key] = {
          svgShortKey: node.svgShortKey,
          width:  node.layoutStyle?.width  || 18,
          height: node.layoutStyle?.height || 18,
        };
      }
    }
  }

  return icons;
}

// ============================================================
// 3. 聚类 + 匹配 + 合并
// ============================================================

/**
 * 从 designName 提取页面前缀（去掉角色关键词）
 */
function extractPagePrefix(designName) {
  let prefix = designName;
  const allRoleKeywords = [...ROLE_CREATE_KEYWORDS, ...ROLE_EDIT_KEYWORDS, ...ROLE_VIEW_KEYWORDS,
    '列表', '折叠', '展开', '弹窗', '浮层', '模态', '对话框', '编辑态', '查看态'];

  for (const kw of allRoleKeywords) {
    const idx = prefix.indexOf(kw);
    if (idx > 0) prefix = prefix.substring(0, idx);
  }

  // 去掉末尾的分隔符
  return prefix.replace(/[-—–_\s]+$/, '').trim();
}

function toKebabCase(str) {
  return str
    .replace(/[()（）]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_—–]+/g, '-')
    .toLowerCase();
}

function clusterDesigns(designs) {
  const pageMap = new Map();

  for (const d of designs) {
    const prefix = extractPagePrefix(d.designName);
    if (!pageMap.has(prefix)) {
      pageMap.set(prefix, {
        pageId:   toKebabCase(prefix),
        pageName: prefix,
        designs:  [],
      });
    }
    pageMap.get(prefix).designs.push(d);
  }

  return Array.from(pageMap.values());
}

function matchScreenshots(pages, screenshotsDir) {
  if (!existsSync(screenshotsDir)) return pages;

  const files = readdirSync(screenshotsDir).filter(f =>
    /\.(png|jpg|jpeg|webp)$/i.test(f)
  );

  for (const page of pages) {
    let bestMatch = null;
    let bestScore = 0;

    for (const file of files) {
      const score = similarity(page.pageName, file);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = file;
      }
    }

    page.screenshot = bestMatch
      ? `screenshots/${basename(screenshotsDir)}/${bestMatch}`
      : null;
  }

  return pages;
}

/**
 * 简单相似度：两个字符串的最长公共子序列占比
 */
function similarity(a, b) {
  const s1 = a.toLowerCase().replace(/[^a-z0-9\p{Script=Han}]/gu, '');
  const s2 = b.toLowerCase().replace(/[^a-z0-9\p{Script=Han}]/gu, '');

  if (!s1 || !s2) return 0;

  // Jaccard-like similarity on character bigrams
  const bigrams1 = new Set();
  const bigrams2 = new Set();
  for (let i = 0; i < s1.length - 1; i++) bigrams1.add(s1.substring(i, i + 2));
  for (let i = 0; i < s2.length - 1; i++) bigrams2.add(s2.substring(i, i + 2));

  const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
  const union = new Set([...bigrams1, ...bigrams2]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * 应用合并规则，生成 outputs
 */
function generateOutputs(page) {
  const outputs = [];
  const designs = page.designs;

  // 按 componentType 分组
  const byType = {};
  for (const d of designs) {
    if (!byType[d.componentType]) byType[d.componentType] = [];
    byType[d.componentType].push(d);
  }

  // list → index.vue
  if (byType['list']) {
    const listDesigns = byType['list'];
    outputs.push({
      outputType:    'list-page',
      sourceDesigns: listDesigns.map(d => d.designId),
      outputPath:    `src/views/${page.pageDir || page.pageId}/index.vue`,
      template:      'list-page',
    });
  }

  // form → FormModal.vue（create + edit 合并）
  if (byType['form']) {
    const forms = byType['form'];
    const createDesigns = forms.filter(d => d.role === 'create');
    const editDesigns   = forms.filter(d => d.role === 'edit');
    const otherForms    = forms.filter(d => d.role !== 'create' && d.role !== 'edit');

    if (createDesigns.length > 0 || editDesigns.length > 0) {
      outputs.push({
        outputType:    'form-modal',
        sourceDesigns: [...createDesigns, ...editDesigns].map(d => d.designId),
        modes:         [
          ...(createDesigns.length > 0 ? ['create'] : []),
          ...(editDesigns.length   > 0 ? ['edit']   : []),
        ],
        outputPath:    `src/views/${page.pageDir || page.pageId}/components/FormModal.vue`,
        template:      'form-modal',
      });
    }

    // 无法合并的 form 单独输出
    for (const d of otherForms) {
      outputs.push({
        outputType:    'form-modal',
        sourceDesigns: [d.designId],
        modes:         [d.role || 'default'],
        outputPath:    `src/views/${page.pageDir || page.pageId}/components/${toPascalCase(d.designName)}.vue`,
        template:      'form-modal',
      });
    }
  }

  // detail → DetailDrawer.vue
  if (byType['detail']) {
    outputs.push({
      outputType:    'detail-drawer',
      sourceDesigns: byType['detail'].map(d => d.designId),
      outputPath:    `src/views/${page.pageDir || page.pageId}/components/DetailDrawer.vue`,
      template:      'detail-drawer',
    });
  }

  // unknown → 单独输出，标记需人工
  if (byType['unknown']) {
    for (const d of byType['unknown']) {
      outputs.push({
        outputType:    'unknown',
        sourceDesigns: [d.designId],
        outputPath:    `src/views/${page.pageDir || page.pageId}/components/${toPascalCase(d.designName)}.vue`,
        template:      'generic',
      });
    }
  }

  return outputs;
}

function toPascalCase(str) {
  return str
    .replace(/[^a-zA-Z0-9一-龥]/g, '-')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

// ============================================================
// 3.5 图片同步
// ============================================================

/**
 * 将 iconDir 下的 SVG 文件拷贝到项目的 imgDir/{pageDir}/ 目录
 * @param {string} iconDir - 图标源目录（.lg-docs/dsl/.../icons/）
 * @param {string} imgDir - 项目图片根目录（src/assets/）
 * @param {string} pageDir - 页面目录名（task-list）
 * @param {string} projectDir - 项目根目录
 * @returns {number} 拷贝的文件数
 */
function syncIcons(iconDir, imgDir, pageDir, projectDir) {
  if (!iconDir || !imgDir) return 0;

  const srcDir = join(projectDir, iconDir);
  if (!existsSync(srcDir)) return 0;

  const destDir = join(projectDir, imgDir, pageDir);
  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(srcDir).filter(f => /\.(svg|png|jpg|jpeg|webp|gif)$/i.test(f));
  let count = 0;

  for (const file of files) {
    const src  = join(srcDir, file);
    const dest = join(destDir, file);
    try {
      copyFileSync(src, dest);
      count++;
    } catch (e) {
      // 文件已存在或权限问题，跳过
    }
  }

  return count;
}

/**
 * 读取项目 lg-config.json
 */
function loadConfig() {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const configPath = join(cwd, '.claude', 'config', 'lg-config.json');
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`未找到项目配置 ${configPath}，请先运行 /lg-init 初始化项目配置`);
    }
    throw new Error(`读取项目配置失败 ${configPath}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`解析项目配置失败 ${configPath}: ${e.message}`);
  }
}

/**
 * 生成 page-mapping 的 pages 段（含需求关联键）
 */
export function buildPageMapping(pages, reqVersion) {
  return pages.map(p => ({
    pageId: p.pageId,
    pageName: p.pageName,
    pageDir: p.pageDir,
    screenshot: p.screenshot,
    requirementPage: p.requirementPage || '',
    requirementConfirmed: p.requirementConfirmed || false,
    requirementCandidates: p.requirementCandidates || [],
    requirementVersion: reqVersion || '',
    dataLinks: p.dataLinks || {},
    designs: p.designs.map(d => ({
      designId: d.designId,
      mastergoFileId: d.mastergoFileId,
      mastergoLayerId: d.mastergoLayerId,
      designName: d.designName,
      componentType: d.componentType,
      role: d.role,
      autoDetected: d.autoDetected,
      designRequirement: d.designRequirement || null,
    })),
    outputs: p.outputs.map(o => ({
      ...o,
      requirementLinks: o.requirementLinks || {},
    })),
  }));
}

/**
 * output 级需求聚合：取 sourceDesigns 中首个有 vision 的 design，analyze/smoke 同源聚合
 */
export function buildOutputRequirementLinks(output, designs) {
  const links = {};
  const sources = designs.filter(d => output.sourceDesigns.includes(d.designId));
  for (const d of sources) {
    const req = d.designRequirement || {};
    if (req.vision && !links.vision) links.vision = req.vision;
    if (d.analyzeLinks?.analyze && !links.analyze) links.analyze = d.analyzeLinks.analyze;
    if (d.analyzeLinks?.smoke && !links.smoke) links.smoke = d.analyzeLinks.smoke;
  }
  return links;
}

/**
 * page 级 dataLinks 兼容快照（从主 design 派生），供旧 lg-code 逻辑防御读取
 */
function buildPrimaryDataLinks(design) {
  const links = {};
  const req = design?.designRequirement;
  if (req?.vision) links.vision = req.vision;
  if (design?.analyzeLinks?.analyze) links.analyze = design.analyzeLinks.analyze;
  if (design?.analyzeLinks?.smoke) links.smoke = design.analyzeLinks.smoke;
  return links;
}

// ============================================================
// 4. 主流程
// ============================================================

async function main() {
  const input = await readInput(process.argv);
  guard(input, { version: SCHEMAS.version, requirementVersion: SCHEMAS.version });
  guardPaths(input, ['dslDir', 'screenshotsDir', 'imgDir']);
  const { version, designs: inputDesigns, dslDir, screenshotsDir, imgDir, requirementVersion } = input;

  if (!version)  throw new Error('缺少 version 参数');
  if (!dslDir)   throw new Error('缺少 dslDir 参数');

  const deduped = dedupeDesigns(inputDesigns || []);
  guardDesigns(deduped);
  if (deduped.length === 0) {
    console.log('⚠️ 没有需要处理的 designs');
    process.exit(0);
  }

  const projectDir = process.env.MODOA_PROJECT_DIR || process.cwd();
  const baseDir = join(projectDir, dslDir);

  // 4.1 处理每个 design：检测类型 + 提取结构化数据
  const designs = [];
  const warnings = [];

  for (const d of deduped) {
    const idxPath = join(projectDir, d.sectionIndexFile || `${dslDir}/${d.pageDir || 'unknown'}/section-index.json`);

    let sections = [];
    try {
      sections = JSON.parse(readFileSync(idxPath, 'utf8'));
    } catch (e) {
      warnings.push(`⚠️ 无法读取 section 索引: ${idxPath}`);
    }

    // v2: componentType 基于 designName 推断（无完整 DSL 节点时 fallback）
    const componentType = sections.length > 0 ? detectComponentType({ sections }, d.designName) : detectComponentType(null, d.designName);
    const role = d.role || detectRole(d.designName);

    // 从 section 索引提取布局区域（仅坐标，无组件详情）
    const layoutZones = extractLayoutZones(sections);

    // v2: 不生成 extracted JSON，不拷贝图片（lg-code 实时抓 MCP 时按需处理）
    if (sections.length > 0) {
      const pageDir = d.pageDir || 'unknown';
      const extractedPath = join(baseDir, pageDir, 'extracted', `${d.designId}.json`);
      mkdirSync(dirname(extractedPath), { recursive: true });
      writeFileSync(extractedPath, JSON.stringify({
        designId: d.designId,
        designName: d.designName,
        mastergoFileId: d.mastergoFileId,
        mastergoLayerId: d.mastergoLayerId,
        componentType,
        role,
        autoDetected: d.autoDetected !== false,
        layout_zones: layoutZones,
      }, null, 2), 'utf8');
    }

    designs.push({
      designId:        d.designId,
      mastergoFileId:  d.mastergoFileId,
      mastergoLayerId: d.mastergoLayerId,
      designName:      d.designName,
      componentType,
      role,
      autoDetected:    true,
    });
  }

  // 4.2 聚类 pages
  let pages = clusterDesigns(designs);

  // 4.3 匹配截图
  const ssDir = screenshotsDir
    ? join(projectDir, screenshotsDir)
    : join(projectDir, '.lg-docs', 'screenshots', version);
  pages = matchScreenshots(pages, ssDir);

  // 4.4 生成 outputs
  for (const page of pages) {
    // 从 inputDesigns 获取 pageDir
    const inputPage = inputDesigns.find(d => extractPagePrefix(d.designName) === page.pageName);
    page.pageDir = inputPage?.pageDir || page.pageId;
    page.outputs = generateOutputs(page);
  }

  // 4.4.5 需求数据关联（可选，design 级）
  let requirementSummary = null;
  if (requirementVersion) {
    const config = loadConfig();
    const reqIndex = collectRequirementIndex(projectDir, config, requirementVersion);
    for (const page of pages) {
      // 先计算 page 级主关联（供 design 回退）
      const pageReq = matchRequirementPage(page, reqIndex);
      page.requirementPage = pageReq.requirementPage;
      page.requirementConfirmed = pageReq.requirementConfirmed;
      page.dataLinks = pageReq.dataLinks;
      // 逐 design 匹配 + 回退
      for (const d of page.designs) {
        const visionReq = matchDesignRequirement(d, reqIndex.vision);
        // 仅无强意图的 design（如纯"列表"主视图）回退 page 主关联；有强意图但数据缺失的（如"查看图片"）诚实降级
        const designKeywords = extractKeywords(d.designName || '');
        if (!visionReq.requirementPage && page.requirementPage && designKeywords.strong.length === 0) {
          visionReq.requirementPage = page.requirementPage;
          visionReq.matchBy = 'page-fallback';
          visionReq.vision = page.dataLinks.vision || null;
          visionReq.coverage = { ...visionReq.coverage, vision: !!visionReq.vision };
        }
        const asmokeReq = matchDesignAnalyzeSmoke(d, reqIndex, visionReq.requirementPage);
        d.designRequirement = {
          requirementPage: visionReq.requirementPage,
          matchBy: visionReq.matchBy,
          vision: visionReq.vision,
          coverage: { ...visionReq.coverage, ...asmokeReq.coverage },
        };
        d.analyzeLinks = asmokeReq.links;
      }
      for (const o of page.outputs) {
        o.requirementLinks = buildOutputRequirementLinks(o, page.designs);
      }
    }
    requirementSummary = summarizeRequirement(pages);
  }

  // 4.5 生成 page-mapping.json
  const mapping = {
    version,
    generatedAt: new Date().toISOString(),
    pages: buildPageMapping(pages, requirementVersion),
  };

  const mappingPath = join(baseDir, 'page-mapping.json');
  mkdirSync(dirname(mappingPath), { recursive: true });
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf8');

  // 4.6 输出摘要
  console.log(`✅ /lg-dsl 完成\n`);
  console.log(`📐 迭代版本: ${version}`);
  console.log(`📋 处理 designs: ${designs.length} 个`);
  console.log(`📂 聚类 pages: ${pages.length} 个`);

  const totalIcons = designs.reduce((sum, d) => sum + (d.copiedIcons || 0), 0);
  if (totalIcons > 0) {
    console.log(`🖼️  同步图片: ${totalIcons} 个 → ${imgDir || '未配置'}`);
  }
  console.log('');

  for (const page of pages) {
    console.log(`📄 ${page.pageName} (${page.pageId})`);
    if (page.screenshot) {
      console.log(`   🖼️  截图: ${page.screenshot}`);
    } else {
      console.log(`   🖼️  截图: ⚠️ 未匹配`);
    }
    for (const d of page.designs) {
      const roleTag = d.role ? ` role=${d.role}` : '';
      const confirmTag = d.autoDetected ? ' ⚠️ 待确认' : ' ✅ 已确认';
      console.log(`   ├── ${d.designId}  ${d.componentType}${roleTag}${d.role ? confirmTag : ''}`);
    }
    for (const o of page.outputs) {
      const modes = o.modes ? ` [${o.modes.join(', ')}]` : '';
      const sources = o.sourceDesigns.join(', ');
      console.log(`   └── → ${o.outputType}${modes}  (${sources}) → ${o.outputPath}`);
    }
    console.log('');
  }

  if (requirementSummary) {
    console.log(`\n📋 需求关联 (reqVersion ${requirementVersion}):`);
    console.log(`   ✅ 已关联: ${requirementSummary.linked} 个 design`);
    console.log(`   ⚠️ 部分覆盖: ${requirementSummary.partial} 个 design（vision 有，analyze/smoke 缺）`);
    console.log(`   ⚠️ 未匹配: ${requirementSummary.missing} 个 design 无对应需求数据`);
  }

  if (warnings.length > 0) {
    console.log('⚠️ 警告:');
    warnings.forEach(w => console.log(`   ${w}`));
  }

  const needsConfirm = designs.filter(d => d.role && d.autoDetected).length;
  if (needsConfirm > 0) {
    console.log(`⚠️ 待确认: ${needsConfirm} 个 design 的 role 需人工验证`);
    console.log(`   → 请检查 ${mappingPath} 并修正 role 字段`);
  }

  console.log(`\n📋 生成文件:`);
  console.log(`   ${mappingPath}`);
  for (const d of designs) {
    console.log(`   ${d.extractedPath}`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch(e => {
    console.error(`❌ dsl.mjs 执行失败: ${e.message}`);
    process.exit(1);
  });
}
