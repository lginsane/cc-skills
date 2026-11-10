// schedule.mjs — 基于 vision + smoke + 组件库生成前端开发排期表
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { request } from 'https';
import { join, resolve, basename } from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { homedir } from 'os';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

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
    process.stdin.on('error', reject);
  });
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

// ─── vision 数据读取 ───

function loadVisionData(config, version) {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const visionDir = config.vision_dir
    ? resolve(cwd, config.vision_dir, version)
    : resolve(cwd, './.lg-docs/vision/', version);

  if (!existsSync(visionDir)) {
    console.error(`[schedule] vision 目录不存在: ${visionDir}`);
    return {};
  }

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
    } catch (e) {
      console.error(`[schedule] vision 解析失败: ${f} — ${e.message}`);
    }
  }
  console.error(`[schedule] vision: 加载 ${Object.keys(map).length} 个页面 (${files.length} 文件)`);
  return map;
}

function extractVisionScheduleContext(visionPage) {
  if (!visionPage) return '';
  const parts = [];

  const cd = visionPage.component_details;
  if (Array.isArray(cd) && cd.length > 0) {
    const items = [];
    for (const c of cd) {
      if (c.type === 'table' && c.columns) {
        const cols = c.columns.map(col =>
          `${col.title}(${col.render || col.type || '文本'}${col.sortable ? ',可排序' : ''}${col.width ? ',宽' + col.width : ''})`
        ).join(' | ');
        items.push(`表格[${c.target || '列表'}]: ${c.columns.length}列 → ${cols}`);
      }
      if ((c.type === 'form' || c.type === 'dialog') && c.fields) {
        const fields = c.fields.map(f =>
          `${f.label}(${f.type || 'input'},${f.required ? '必填' : '选填'}${f.rules ? ',规则:' + JSON.stringify(f.rules) : ''})`
        ).join(' | ');
        items.push(`${c.type === 'dialog' ? '弹窗' : '表单'}[${c.target || '表单'}]: ${c.fields.length}字段 → ${fields}`);
      }
      if ((c.type === 'form' || c.type === 'dialog') && c.sections) {
        items.push(`表单分组: ${c.sections.map(s => s.title || s.name).join(' → ')}`);
      }
    }
    if (items.length > 0) parts.push(`## UI组件结构\n${items.join('\n')}`);
  }

  const ann = visionPage.annotations;
  if (Array.isArray(ann) && ann.length > 0) {
    const validationRules = ann.filter(a => a.annotation_type === 'validation' || a.annotation_type === 'constraint');
    const businessRules = ann.filter(a => a.annotation_type === 'business_logic');
    const interactionRules = ann.filter(a => a.annotation_type === 'interaction');
    const items = [];
    if (validationRules.length > 0) {
      items.push(`校验规则(${validationRules.length}条): ${validationRules.map(a =>
        `${a.target}: ${a.content || ''}${a.rules ? ' ' + JSON.stringify(a.rules) : ''}`
      ).join('; ')}`);
    }
    if (businessRules.length > 0) {
      items.push(`业务规则(${businessRules.length}条): ${businessRules.map(a => a.content).join('; ')}`);
    }
    if (interactionRules.length > 0) {
      items.push(`交互规则(${interactionRules.length}条): ${interactionRules.map(a =>
        `${a.trigger || ''} → ${a.action || a.effect || ''}`
      ).join('; ')}`);
    }
    if (items.length > 0) parts.push(`## 标注规则\n${items.join('\n')}`);
  }

  const interactions = visionPage.interactions;
  if (Array.isArray(interactions) && interactions.length > 0) {
    const items = interactions.map(i =>
      typeof i === 'string' ? i : `${i.trigger || ''} → ${i.action || i.effect || ''}`
    );
    parts.push(`## 交互流程\n${items.join('\n')}`);
  }

  const states = visionPage.states;
  if (Array.isArray(states) && states.length > 0) {
    const items = states.map(s =>
      typeof s === 'string' ? s : `${s.state || s.name || ''}: ${s.description || s.effect || ''}`
    );
    parts.push(`## 状态变体(${states.length}种)\n${items.join('\n')}`);
  }

  return parts.join('\n\n');
}

// ─── smoke 数据读取 ───

function loadSmokeData(config, version) {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const smokeDir = config.smoke_cases_dir
    ? resolve(cwd, config.smoke_cases_dir, version)
    : resolve(cwd, './.lg-docs/smoke/', version);

  if (!existsSync(smokeDir)) {
    console.error(`[schedule] smoke 目录不存在: ${smokeDir}`);
    return null;
  }

  const xlsxFiles = readdirSync(smokeDir).filter(f => f.endsWith('.xlsx'));
  const jsonFiles = readdirSync(smokeDir).filter(f => f.endsWith('.json'));
  const moduleStats = {};

  for (const f of xlsxFiles) {
    try {
      const wb = XLSX.readFile(join(smokeDir, f));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3) continue;
        // 冒烟 xlsx 格式: # | 用例 | 优先级 | 模块 | 前置条件 | 预期结果
        const priority = String(row[2] || '').trim();
        const moduleName = String(row[3] || '未分类').trim();
        if (!moduleStats[moduleName]) moduleStats[moduleName] = { P0: 0, P1: 0, P2: 0, total: 0 };
        if (priority.includes('P0')) moduleStats[moduleName].P0++;
        else if (priority.includes('P2')) moduleStats[moduleName].P2++;
        else moduleStats[moduleName].P1++;
        moduleStats[moduleName].total++;
      }
    } catch (e) {
      console.error(`[schedule] smoke xlsx 解析失败: ${f} — ${e.message}`);
    }
  }

  if (Object.keys(moduleStats).length === 0 && jsonFiles.length > 0) {
    for (const f of jsonFiles) {
      try {
        const data = JSON.parse(readFileSync(join(smokeDir, f), 'utf-8'));
        const cases = data.cases || [];
        const moduleName = data.module || basename(f, '.json');
        if (!moduleStats[moduleName]) moduleStats[moduleName] = { P0: 0, P1: 0, P2: 0, total: 0 };
        for (const c of cases) {
          const p = c.priority || 'P1';
          if (p.includes('P0')) moduleStats[moduleName].P0++;
          else if (p.includes('P2')) moduleStats[moduleName].P2++;
          else moduleStats[moduleName].P1++;
          moduleStats[moduleName].total++;
        }
      } catch (e) {
        console.error(`[schedule] smoke JSON 解析失败: ${f} — ${e.message}`);
      }
    }
  }

  if (Object.keys(moduleStats).length > 0) {
    const total = Object.values(moduleStats).reduce((s, m) => s + m.total, 0);
    console.error(`[schedule] smoke: ${Object.keys(moduleStats).length} 个模块, ${total} 条用例`);
    return moduleStats;
  }

  console.error('[schedule] smoke: 无数据（将跳过冒烟加权）');
  return null;
}

// ─── 组件库扫描 ───

function loadComponentContext(config) {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const parts = [];

  const mapPath = join(cwd, '.claude', 'config', 'lg-components-map.json');
  if (existsSync(mapPath)) {
    try {
      const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
      const publicComps = map.public || {};
      const businessComps = map.business || {};
      const items = [];
      for (const [group, comps] of Object.entries(publicComps)) {
        for (const [name, info] of Object.entries(comps)) {
          items.push(`- ${name}: ${info.description || ''} (${info.path || ''})`);
        }
      }
      for (const [group, comps] of Object.entries(businessComps)) {
        for (const [name, info] of Object.entries(comps)) {
          items.push(`- ${name}: ${info.description || ''} (${info.path || ''})`);
        }
      }
      if (items.length > 0) {
        parts.push(`## 已有项目组件 (lg-components-map.json, ${items.length}个)\n${items.join('\n')}`);
      }
    } catch (e) {
      console.error(`[schedule] 组件映射表解析失败: ${e.message}`);
    }
  }

  const compDir = join(cwd, 'src', 'components');
  if (existsSync(compDir)) {
    const scanDir = (dir, prefix = '') => {
      const result = [];
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
            result.push(`${prefix}${e.name}/`);
            result.push(...scanDir(join(dir, e.name), prefix + '  '));
          } else if (e.isFile() && (e.name.endsWith('.vue') || e.name.endsWith('.jsx') || e.name.endsWith('.tsx'))) {
            result.push(`${prefix}${e.name}`);
          }
        }
      } catch (_) { /* skip permission errors */ }
      return result;
    };
    const files = scanDir(compDir);
    if (files.length > 0) {
      const displayFiles = files.length > 80
        ? files.slice(0, 80).join('\n') + `\n... 共 ${files.length} 个组件文件（已截断）`
        : files.join('\n');
      parts.push(`## 项目组件目录 (src/components/, ${files.length}个文件)\n${displayFiles}`);
    }
  }

  const claudePath = join(cwd, 'CLAUDE.md');
  if (existsSync(claudePath)) {
    try {
      const content = readFileSync(claudePath, 'utf-8');
      const techMatch = content.match(/-\s*\*\*Vue 3[^*]+\*\*/);
      const frameworkMatch = content.match(/-\s*\*\*Ant Design Vue[^*]+\*\*/);
      if (techMatch || frameworkMatch) {
        parts.push(`## 项目技术栈\n${[techMatch, frameworkMatch].filter(Boolean).map(m => m[0]).join('\n')}`);
      }
    } catch (_) { /* skip */ }
  }

  return parts.join('\n\n');
}

// ─── AI Prompt + API 调用 ───

function buildSchedulePrompt(visionContexts, smokeStats, componentContext, version) {
  const visionSections = Object.entries(visionContexts)
    .map(([name, ctx]) => `### 页面: ${name}\n${ctx}`)
    .join('\n\n---\n\n');

  let smokeSection = '';
  if (smokeStats) {
    const items = Object.entries(smokeStats).map(([mod, stats]) =>
      `- ${mod}: P0=${stats.P0} P1=${stats.P1} P2=${stats.P2} 合计=${stats.total} (P0密度=${(stats.P0 / stats.total * 100).toFixed(0)}%)`
    ).join('\n');
    smokeSection = `## 冒烟用例分布\n${items}`;
  }

  return `## 项目信息
版本: ${version}
${componentContext}

${smokeSection}

## UI设计稿结构化数据
${visionSections}

## 任务
请基于以上所有信息，生成前端开发排期表 JSON。严格遵循以下规则：

### 任务拆解规则
1. 按 端 → 菜单 → 任务 三级结构组织
2. 每个页面自动拆解为: 布局+搜索、表格/列表、CRUD表单/弹窗、校验逻辑、空状态/异常兜底
3. **子组件拆分**: 遇到以下情况必须拆为独立子组件任务:
   - 表格列含图片/标签/链接/自定义渲染 → 独立列组件
   - 表单字段不是标准 input/select/date → 独立字段子组件
   - ≥2个页面复用的业务模块 → 独立公共组件
   - 第三方库集成(编辑器/图表/地图) → 独立集成任务
   - 需二次封装的 Ant Design 组件 → 独立封装任务
4. **存量复用**: 任务描述中注明可复用的已有组件/组件库组件

### 工时估算规则
5. 表格基准: ≤3列=2h, 4-6列=4h, 7-10列=6h, 11-15列=8h, 16+列=10h
6. 列类型加权(每列加计): 纯文字=0, 图片=+0.5h, 标签=+0.3h, 链接=+0.2h, 操作按钮2个+=+0.3h, 操作按钮3+个=+0.5h, 自定义渲染=+1.0h
7. 表单基准: ≤3字段=1.5h, 4-6字段=3h, 7-10字段=5h, 11-15字段=8h, 16+字段=10h
8. 字段类型加权(每字段加计): input/select=0, date/time=+0.3h, upload=+0.5h, number=+0.2h, 自定义字段=+1.5h(需另拆子组件)
9. 冒烟加权: 模块P0密度>30%时，该模块总工时×1.2
10. 存量折扣: 已有组件精确匹配→不计新建工时只计联调0.5h; Ant Design原生满足→不计; 需封装→独立任务2h
11. **每个任务必须给出工时理由**，说明列数/字段数/特殊处理的来源

### 输出格式
\`\`\`json
{
  "version": "${version}",
  "generatedAt": "${new Date().toISOString()}",
  "totalHours": 0,
  "端": [{
    "name": "管理端",
    "totalHours": 0,
    "菜单": [{
      "name": "模块名",
      "复用组件": ["已有组件名"],
      "subtotalHours": 0,
      "任务": [{
        "name": "任务名",
        "type": "页面|子组件|公共组件|集成|联调",
        "hours": 0,
        "reason": "工时理由"
      }]
    }]
  }]
}
\`\`\`
只输出 JSON，不要其他内容。`;
}

async function callAIForSchedule(prompt, apiKey) {
  const systemPrompt = '你是一个资深前端开发排期专家。你精通 Vue 3 + Ant Design Vue 技术栈，熟悉组件复用和工时估算。你必须基于真实业务数据（表格列数/字段数/校验规则/交互复杂度）逐任务估算工时，每个任务必须有明确的工时理由。';

  const body = {
    model: 'qwen-max',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 8192
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await apiRequest(body, apiKey);
      const content = data.choices?.[0]?.message?.content || '';
      const m = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (m) {
        const parsed = JSON.parse(m[1]);
        if (!parsed.端 || !Array.isArray(parsed.端)) {
          throw new Error('响应缺少"端"数组');
        }
        return parsed;
      }
      throw new Error(`JSON解析失败: ${content.substring(0, 200)}`);
    } catch (err) {
      console.error(`[schedule] AI调用尝试 ${attempt + 1}/${MAX_RETRIES + 1}: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// ─── main ───

async function main() {
  const input = await loadInput();
  const { version } = input;
  if (!version) { console.error('{"success":false,"error":"缺少 version 参数"}'); process.exit(1); }

  const config = loadConfig();
  const apiKey = config.dashscope_api_key;
  if (!apiKey) { console.error('{"success":false,"error":"lg-config.json 中缺少 dashscope_api_key"}'); process.exit(1); }

  // 1. 读取 vision
  const visionMap = loadVisionData(config, version);
  if (Object.keys(visionMap).length === 0) {
    console.error('{"success":false,"error":"vision 目录无数据，请先运行 lg-vision"}');
    process.exit(1);
  }
  const visionContexts = {};
  for (const [name, page] of Object.entries(visionMap)) {
    visionContexts[name] = extractVisionScheduleContext(page);
  }
  console.error(`[schedule] vision 上下文: ${Object.keys(visionContexts).length} 个页面`);

  // 2. 读取 smoke
  const smokeStats = loadSmokeData(config, version);

  // 3. 读取组件库
  const componentContext = loadComponentContext(config);
  console.error(`[schedule] 组件库上下文: ${componentContext.length} 字符`);

  // 4. AI Prompt + 调用
  const prompt = buildSchedulePrompt(visionContexts, smokeStats, componentContext, version);
  console.error(`[schedule] prompt 长度: ${prompt.length} 字符`);
  console.error('[schedule] 调用 Qwen-Max...');

  try {
    const scheduleJSON = await callAIForSchedule(prompt, apiKey);
    console.error(`[schedule] AI 响应: ${scheduleJSON.端?.length || 0} 个端, 总工时 ${scheduleJSON.totalHours || '?'}h`);

    // 5. 生成 xlsx
    const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
    const outputDir = config.schedule_dir
      ? resolve(cwd, config.schedule_dir, version)
      : resolve(cwd, './.lg-docs/docs/', version);

    const pythonScript = resolve(homedir(), '.claude', 'skills', 'lg-scripts', 'schedule-xlsx.py');
    const pythonInput = JSON.stringify({ scheduleJSON, outputDir, version });

    const py = spawn('python3', [pythonScript]);
    let pyStdout = '', pyStderr = '';
    py.stdout.on('data', d => pyStdout += d);
    py.stderr.on('data', d => pyStderr += d);

    py.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(pyStdout);
          console.error(`[schedule] xlsx 已生成: ${result.filePath}`);
          console.log(JSON.stringify({ success: true, version, filePath: result.filePath, totalHours: scheduleJSON.totalHours }));
        } catch (e) {
          console.error(`[schedule] Python 输出解析失败: ${e.message}`);
          console.log(JSON.stringify({ success: true, version, scheduleJSON, warning: 'xlsx 生成失败，JSON 已输出到 stdout' }));
        }
      } else {
        console.error(`[schedule] Python xlsx 生成失败 (exit ${code}): ${pyStderr}`);
        console.log(JSON.stringify({ success: true, version, scheduleJSON, warning: 'xlsx 生成失败，使用 JSON 降级' }));
      }
    });

    py.stdin.write(pythonInput);
    py.stdin.end();
  } catch (err) {
    console.error(`[schedule] AI 调用失败: ${err.message}`);
    console.log(JSON.stringify({ success: false, version, error: err.message }));
    process.exit(1);
  }
}

main();
