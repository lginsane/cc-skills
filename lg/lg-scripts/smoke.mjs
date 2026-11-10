// smoke.mjs — 基于 analyze + vision 数据生成标准冒烟测试用例
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { request } from 'https';
import { join, resolve } from 'path';

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com';
const DASHSCOPE_PATH = '/compatible-mode/v1/chat/completions';
const MAX_RETRIES = 2;

function loadConfig() {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  return JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-config.json'), 'utf-8'));
}

function loadInput() {
  const chunks = [];
  return new Promise((resolve, reject) => {
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
  });
}

// 读取 vision 数据，构建 pageName → vision 映射
function loadVisionData(config, version) {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const visionDir = config.vision_dir
    ? resolve(cwd, config.vision_dir, version)
    : resolve(cwd, './.lg-docs/vision/', version);
  if (!existsSync(visionDir)) { console.error(`[vision] 目录不存在: ${visionDir}`); return {}; }

  const files = readdirSync(visionDir).filter(f => f.endsWith('.json'));
  const map = {};
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(visionDir, f), 'utf-8'));
      const pages = raw.pages || [];
      for (const p of pages) {
        const name = p.name || raw._pageName || '';
        if (name) map[name] = p;
      }
    } catch (e) { console.error(`[vision] 解析失败: ${f} — ${e.message}`); }
  }
  console.error(`[vision] 加载 ${Object.keys(map).length} 个页面 (${files.length} 文件)`);
  return map;
}

// 从 vision 数据中提取对冒烟有用的结构化信息
function extractVisionContext(visionPage) {
  if (!visionPage) return '';
  const parts = [];

  // 1. 组件详情：表格列、表单字段、弹窗结构 → 精确到字段级
  const cd = visionPage.component_details;
  if (Array.isArray(cd) && cd.length > 0) {
    const items = [];
    for (const c of cd) {
      if (c.type === 'table' && c.columns) {
        const cols = c.columns.map(col =>
          `${col.title}(${col.render || '文本'}${col.sortable ? ',可排序' : ''})`
        ).join('、');
        items.push(`表格[${c.target || ''}]: 列=[${cols}]`);
      }
      if ((c.type === 'form' || c.type === 'dialog') && c.fields) {
        const fields = c.fields.map(f =>
          `${f.label}(${f.type},${f.required ? '必填' : '选填'}${f.placeholder ? ',placeholder:' + f.placeholder : ''}${f.options ? ',选项:' + f.options.join('/') : ''})`
        ).join('; ');
        items.push(`${c.type === 'dialog' ? '弹窗' : '表单'}[${c.target || ''}]: 字段=[${fields}]`);
      }
    }
    if (items.length > 0) parts.push(`## UI组件结构\n${items.join('\n')}`);
  }

  // 2. 标注规则：校验规则、业务约束、交互规则 → 精确到规则级
  const ann = visionPage.annotations;
  if (Array.isArray(ann) && ann.length > 0) {
    const items = ann.map(a => {
      const rule = a.rules ? ` (规则:${JSON.stringify(a.rules)})` : '';
      return `[${a.annotation_type || '规则'}] ${a.target || ''}: ${a.content || ''}${rule}`;
    });
    parts.push(`## 标注规则/业务约束\n${items.join('\n')}`);
  }

  // 3. 交互流程
  const interactions = visionPage.interactions;
  if (Array.isArray(interactions) && interactions.length > 0) {
    const items = interactions.map(i =>
      typeof i === 'string' ? i : `${i.trigger || ''} → ${i.action || i.effect || ''}`
    );
    parts.push(`## 交互流程\n${items.join('\n')}`);
  }

  // 4. 多状态变体
  const states = visionPage.states;
  if (Array.isArray(states) && states.length > 0) {
    const items = states.map(s =>
      typeof s === 'string' ? s : `${s.state || s.name || ''}: ${s.description || s.effect || ''}`
    );
    parts.push(`## 状态变体\n${items.join('\n')}`);
  }

  return parts.join('\n\n');
}

function apiRequest(body, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = request({
      hostname: DASHSCOPE_HOST, path: DASHSCOPE_PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function generateSmokeCases(moduleInfo, pageAnalysis, visionPage, apiKey) {
  const { module, tasks } = moduleInfo;
  const edge = pageAnalysis?.edge_cases || [];
  const boundary = pageAnalysis?.boundary_conditions || [];
  const states = pageAnalysis?.state_dependencies || [];
  const confirms = pageAnalysis?.confirmation_dialogs || [];
  const unexpected = pageAnalysis?.unexpected_paths || [];
  const checklist = pageAnalysis?.test_checklist || [];

  // 提取 vision 结构化上下文
  const visionCtx = extractVisionContext(visionPage);

  const context = [
    `模块: ${module}`,
    `涉及功能: ${tasks}`,
    `异常场景/空状态/并发: ${JSON.stringify(edge)}`,
    `边界条件/长度/格式/唯一性/排序/数量: ${JSON.stringify(boundary)}`,
    `状态依赖: ${JSON.stringify(states)}`,
    `确认弹窗: ${JSON.stringify(confirms)}`,
    `非预期操作路径(后退/刷新/分页/双击): ${JSON.stringify(unexpected)}`,
    `测试清单: ${JSON.stringify(checklist)}`,
    visionCtx ? `\n## 以下来自UI设计稿的结构化信息（用于生成精确到字段/规则级的用例）\n${visionCtx}` : ''
  ].join('\n');

  const prompt = `你是冒烟测试专家。根据以下模块的完整需求分析数据 + UI设计稿信息，生成标准冒烟测试用例。必须覆盖所有类别。

${context}

## 生成规则（必须逐类覆盖，不可遗漏）
- **主流程(P0)**: 从测试清单提取，结合UI组件结构中的表格列/表单字段/弹窗 → 每条至少1个用例，步骤中必须引用具体的UI元素名称（如"点击【新增】按钮"、"在【项目名称】输入框中输入"）
- **关键校验(P0)**: 从边界条件 + 标注规则提取 → 格式/唯一性/数值范围校验，标注规则中的 maxlength/required/pattern 必须生成对应校验用例
- **边界条件(P1)**: 从边界条件提取 → 最小值/最大值/0值/空值/超长/排序规则，结合表单字段定义精确到每个字段
- **状态流转(P1)**: 从状态依赖 + 状态变体提取 → 启停联动/多步骤缓存/并发刷新
- **异常处理(P1)**: 从异常场景提取 → 空状态/网络异常/删除确认
- **非预期路径(P1)**: 从非预期操作提取 → 后退/刷新/分页/双击/批量操作
- **UI细节(P2)**: 从确认弹窗 + 交互流程提取 → tooltip/文案准确性/按钮可见性

## 输出格式
\`\`\`json
{
  "module": "${module}",
  "cases": [
    {"scenario":"用例名称","priority":"P0","precondition":"前置条件","steps":"操作步骤","expected":"预期结果","source":"主流程|边界|状态|异常|非预期路径|UI"}
  ]
}
\`\`\`

## 规则
- 每个用例可执行、可验证
- 步骤用 → 连接，必须包含具体的UI元素名称（如按钮文案、输入框label、表格列名）
- 预期结果含具体提示文案
- 每个边界条件、状态依赖、非预期路径至少生成1条用例
- **标注规则(annotations)中的每条规则至少生成1条用例**`;

  const body = {
    model: 'qwen-max',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, max_tokens: 8192
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await apiRequest(body, apiKey);
      const content = data.choices?.[0]?.message?.content || '';
      const m = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (m) return JSON.parse(m[1]);
      throw new Error(`JSON parse failed: ${content.substring(0, 200)}`);
    } catch (err) {
      if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      return { module, error: err.message, cases: [] };
    }
  }
}

async function main() {
  const input = await loadInput();
  const { version, modules, analyses } = input;
  // Support both modes: explicit modules, or auto from analyses
  const moduleList = (modules && modules.length > 0) ? modules
    : (analyses || []).map(a => ({ module: a.page, page: a.page, tasks: a.description || a.page }));
  if (!moduleList || moduleList.length === 0) { console.error('{"success":false,"error":"无模块数据"}'); process.exit(1); }

  const config = loadConfig();
  const apiKey = config.dashscope_api_key;
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const smokeDir = config.smoke_cases_dir
    ? resolve(cwd, config.smoke_cases_dir, version || 'unknown')
    : resolve(cwd, './.lg-docs/smoke/', version || 'unknown');
  mkdirSync(smokeDir, { recursive: true });

  // Build page→analysis map
  const pageMap = {};
  (analyses || []).forEach(a => { pageMap[a.page] = a; });

  // Build page→vision map (fuzzy match)
  const visionMap = loadVisionData(config, version);

  // Fuzzy match: find vision page by name similarity
  function findVisionPage(pageName) {
    if (!pageName) return null;
    // exact match
    if (visionMap[pageName]) return visionMap[pageName];
    // substring match
    for (const [vName, vData] of Object.entries(visionMap)) {
      if (vName.includes(pageName) || pageName.includes(vName)) return vData;
    }
    return null;
  }

  const allCases = [];
  for (let i = 0; i < moduleList.length; i++) {
    const m = moduleList[i];
    const analysis = pageMap[m.page] || {};
    const vision = findVisionPage(m.page);
    const hasVision = vision ? '✓' : '✗';
    console.error(`[${i + 1}/${moduleList.length}] 生成: ${m.module} (vision:${hasVision})`);
    const result = await generateSmokeCases(m, analysis, vision, apiKey);
    writeFileSync(join(smokeDir, `${i + 1}_${m.module.replace(/[/\\?%*:|"<>]/g, '-')}.json`), JSON.stringify(result, null, 2), 'utf-8');
    if (result.cases) {
      result.cases.forEach(c => {
        c.module = c.module || m.module || result.module;
        c.precondition = c.precondition || '用户已登录系统';
        if (!c.steps && c.scenario) c.steps = '执行相关操作';
        if (!c.expected && c.scenario) c.expected = '操作成功，数据正确展示';
      });
      allCases.push(...result.cases);
    }
    console.error(`  用例: ${result.cases?.length || 0} 条`);
  }

  allCases.forEach((c, i) => { c.id = `SMK-${String(i + 1).padStart(4, '0')}`; });

  console.log(JSON.stringify({ success: true, version, totalCases: allCases.length, cases: allCases, smokeDir }, null, 2));
}

main();
