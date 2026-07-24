// analyze-bugs.mjs — 对 Bug 列表调用 Qwen-Max 进行回溯深度分析
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { request } from 'https';
import { join, resolve } from 'path';

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com';
const DASHSCOPE_PATH = '/compatible-mode/v1/chat/completions';
const MAX_RETRIES = 2;
const TIMEOUT_MS = 60000;

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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      timeout: TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('API request timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function buildAnalyzePrompt(bug, smokeCases) {
  const tagSummary = (bug.tags || []).map(t =>
    `${t.dimension}: ${t.trigger || ''} (置信度: ${t.confidence})`
  ).join('\n');

  const caseSummary = (smokeCases.cases || []).map(c =>
    `[${c.module || ''}] ${c.title}`
  ).join('\n');

  const moduleSet = new Set((smokeCases.cases || []).map(c => c.module).filter(Boolean));
  const moduleDistribution = [...moduleSet].map(m => {
    const count = (smokeCases.cases || []).filter(c => c.module === m).length;
    return `${m}: ${count}条`;
  }).join(', ');

  return `你是资深测试架构师和产品分析师。针对以下 Bug 进行深度回溯分析：

【Bug 信息】
- 标题: ${bug.title}
- 描述: ${bug.description || '无'}
- 复现步骤: ${bug.steps || '无'}
- 规则预分类: ${tagSummary || '无预分类'}

【该版本冒烟用例摘要】
- 总用例数: ${smokeCases.total || 0}
- 模块分布: ${moduleDistribution || '未知'}
- 用例列表:
${caseSummary || '无'}

请分析并输出严格 JSON（不要包含 markdown 代码块标记）：

{
  "root_cause": "根本原因（1-2句话，中文）",
  "why_smoke_missed": "为什么冒烟用例没测出来（具体分析冒烟用例的盲区）",
  "dev_blind_spot": "开发时哪个方面没考虑到（从开发视角分析思维盲区）",
  "doc_gap": "产品文档缺少什么描述/规则/约束",
  "doc_supplement_suggestion": {
    "chapter": "建议补充到产品文档的章节名",
    "content": "建议补充的具体内容和交互规则描述"
  },
  "smoke_supplement": {
    "module": "模块名",
    "scenario": "用例场景描述",
    "priority": "P0/P1/P2",
    "precondition": "前置条件",
    "steps": "操作步骤（分步描述）",
    "expected": "预期结果"
  },
  "dimension_confirm": {
    "COVERAGE_GAP": true或false,
    "BOUNDARY": true或false,
    "STATE_DEP": true或false,
    "MULTI_MODULE": true或false,
    "ENV_DIFF": true或false,
    "UNEXPECTED_PATH": true或false
  }
}`;
}

async function analyzeBug(bug, smokeCases, apiKey) {
  const prompt = buildAnalyzePrompt(bug, smokeCases);
  const body = {
    model: 'qwen-max',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 4096
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await apiRequest(body, apiKey);
      const content = data.choices?.[0]?.message?.content || '';
      const m = content.match(/```json\s*([\s\S]*?)\s*```/)
            || content.match(/```\s*([\s\S]*?)\s*```/)
            || content.match(/(\{[\s\S]*\})/);
      if (m) return JSON.parse(m[1]);
      throw new Error(`JSON parse failed: ${content.substring(0, 200)}`);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.error(`  重试 ${attempt + 1}/${MAX_RETRIES}: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      return {
        bugId: bug.bugId,
        root_cause: 'AI 分析失败',
        why_smoke_missed: 'AI 分析不可用',
        dev_blind_spot: 'AI 分析不可用',
        doc_gap: 'AI 分析不可用',
        doc_supplement_suggestion: { chapter: '', content: 'AI 分析不可用' },
        smoke_supplement: { module: '', scenario: '', priority: 'P2', precondition: '', steps: '', expected: '' },
        dimension_confirm: {},
        error: err.message
      };
    }
  }
}

async function main() {
  const input = await loadInput();
  const { version, bugs, smokeCases, dashscopeApiKey, outputDir } = input;

  if (!bugs || bugs.length === 0) {
    console.log(JSON.stringify({ success: true, version, analyzed: 0, results: [] }));
    return;
  }

  if (!dashscopeApiKey) {
    console.error(JSON.stringify({ success: false, error: '缺少 dashscope_api_key，请在 lg-config.json 中配置' }));
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (let i = 0; i < bugs.length; i++) {
    const bug = bugs[i];
    console.error(`[${i + 1}/${bugs.length}] 分析 Bug: ${bug.title}`);
    const result = await analyzeBug(bug, smokeCases, dashscopeApiKey);
    results.push(result);

    const safeName = (bug.bugId || `bug-${i}`).replace(/[/\\?%*:|"<>]/g, '-');
    writeFileSync(join(outputDir, `${safeName}.json`), JSON.stringify(result, null, 2), 'utf-8');
    console.error(`  根因: ${result.root_cause?.substring(0, 60) || 'N/A'}`);
  }

  console.log(JSON.stringify({ success: true, version, analyzed: results.length, results }));
}

main();
