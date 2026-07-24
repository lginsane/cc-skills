// analyze.mjs — 对 identify-content 调用 Qwen-Max 进行异常边界分析
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
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

async function analyzePage(pageData, apiKey) {
  const { name, description, interactions, text_content } = pageData;
  const context = [
    `页面名称: ${name}`,
    `功能描述: ${description || ''}`,
    `交互说明: ${(interactions || []).join('; ')}`,
    `文案内容: ${(text_content || []).join(' | ')}`
  ].join('\n');

  const prompt = `你是产品需求分析专家。分析以下设计稿信息，全面提取所有潜在风险和测试点。

${context}

## 输出格式
\`\`\`json
{
  "page": "${name}",
  "edge_cases": [
    { "scenario": "场景名", "type": "异常|空状态|并发|删除确认", "trigger": "触发条件", "expected": "预期行为" }
  ],
  "boundary_conditions": [
    { "field": "字段名", "limit": "限制条件", "type": "类型(长度/格式/数值/唯一性/枚举/排序)" }
  ],
  "state_dependencies": [
    { "state": "状态名", "effect": "影响", "message": "提示文案" }
  ],
  "confirmation_dialogs": [
    { "trigger": "触发操作", "message": "弹窗文案" }
  ],
  "unexpected_paths": [
    { "path": "非预期操作", "scenario": "触发场景", "risk": "可能的问题" }
  ],
  "test_checklist": ["具体可执行的测试项"]
}
\`\`\`

## 提取规则

### edge_cases（异常场景）
- 输入错误格式 → 提示文案
- 空状态展示 → 缺省图/引导文案
- 删除操作 → 是否需要二次确认
- 多人并发操作 → 数据冲突风险
- 网络异常 → 超时/失败提示

### boundary_conditions（边界条件）
- 数值范围：最小值、最大值、0值、负数
- 长度限制：最少字、最多字
- 格式校验：邮箱、手机号、URL
- 唯一性：名称/ID不可重复
- 排序规则：默认排序、自定义排序
- 数量限制：文件上传数、批量操作上限

### unexpected_paths（非预期操作路径）
- 浏览器后退/前进 → 表单数据丢失
- F5刷新页面 → 未保存数据丢失
- 分页跳转 → 编辑后回到当前页还是第一页
- 双击/快速点击 → 重复提交
- 大量数据操作 → 页面性能/刷新
- 多选取消 → 能否选择性取消

## 规则
- 从文案中提取所有校验规则、错误提示、边界值
- 识别状态切换导致的权限/行为变化
- 推测非预期用户操作可能导致的问题
- 测试项要具体可执行，包含操作和预期结果
- 如果某类别无内容，返回空数组`;

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
      const m = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (m) return JSON.parse(m[1]);
      throw new Error(`JSON parse failed: ${content.substring(0, 200)}`);
    } catch (err) {
      if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      return { page: name, error: err.message };
    }
  }
}

async function main() {
  const input = await loadInput();
  const { version, pages } = input;
  if (!pages || pages.length === 0) { console.error('{"success":false,"error":"无页面数据"}'); process.exit(1); }

  const config = loadConfig();
  const apiKey = config.dashscope_api_key;
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const analyzeDir = config.analysis_dir
    ? resolve(cwd, config.analysis_dir, version || 'unknown')
    : resolve(cwd, './.lg-docs/analysis/', version || 'unknown');
  mkdirSync(analyzeDir, { recursive: true });

  const results = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    console.error(`[${i + 1}/${pages.length}] 分析: ${p.name}`);
    const result = await analyzePage(p, apiKey);
    results.push(result);

    const safeName = p.name.replace(/[/\\?%*:|"<>]/g, '-');
    writeFileSync(join(analyzeDir, `${i + 1}_${safeName}.json`), JSON.stringify(result, null, 2), 'utf-8');
    console.error(`  边界: ${result.boundary_conditions?.length || 0} | 异常: ${result.edge_cases?.length || 0} | 测试: ${result.test_checklist?.length || 0}`);
  }

  console.log(JSON.stringify({ success: true, version, analyzed: results.length, results, analyzeDir }, null, 2));
}

main();
