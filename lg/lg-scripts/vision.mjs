// .claude/skills/modao-plan/vision.mjs
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { request } from 'https';
import { join, resolve } from 'path';

const CONFIG_PATH = join(process.env.MODOA_PROJECT_DIR || process.cwd(), '.claude', 'config', 'lg-config.json');
const DASHSCOPE_HOST = 'dashscope.aliyuncs.com';
const DASHSCOPE_PATH = '/compatible-mode/v1/chat/completions';
const MAX_RETRIES = 2;

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error(JSON.stringify({ success: false, error: '配置文件未找到，请先运行 /modao-plan init' }));
    process.exit(1);
  }
}

function imageToBase64(filePath) {
  const data = readFileSync(filePath);
  return `data:image/png;base64,${data.toString('base64')}`;
}

function buildPrompt(pageIndex, totalPages, mode = 'design') {
  const pageHint = totalPages > 1 ? `\n注意：这是第 ${pageIndex + 1}/${totalPages} 张截图，可能是一个长页面的分段。` : '';

  let prompt = `你是一个产品需求文档分析专家。请分析这张墨刀(Mockplus/Modao)原型图截图，提取以下信息并以JSON格式返回。${pageHint}

## 提取要求

### 1. 版本信息与页面概况
- 版本号、更新日期（如可见）
- 页面名称和功能描述

### 2. 布局区域 (layout_zones)
将页面按空间划分区域，描述每个区域的相对位置和包含的子元素。
- zone: 区域名称（如 sidebar / header / main_content / footer / dialog）
- position: 相对位置（如 left / top / right / bottom / center）
- width_ratio: 宽度占比描述（如"窄列，约15%"、"宽列，约85%"）
- layout: 内部排列方向（如"垂直排列，从上到下"、"水平排列，从左到右"）
- children: 该区域包含的元素名称列表

### 3. 组件树 (component_tree)
用嵌套结构描述页面组件层级关系。根节点为页面容器，逐层描述父子嵌套。
- component: 组件类型描述（如 SearchCard / TableCard / a-input / a-button / a-modal）
- label: 组件的标签文字
- placeholder: 输入框占位符
- type: 按钮类型（primary / default / danger）
- position: 组件在父容器中的位置
- children: 子组件列表（可为空数组）
- has_action_bar: 布尔值，表格组件是否有操作按钮区
- action_buttons: 操作按钮的组件树数组（如表格上方的新增按钮）
- has_pagination: 布尔值，是否有分页
- pagination_position: 分页位置（如"表格下方右侧"）

### 4. UI元素 (ui_elements) — 保留的扁平列表
维护扁平元素列表以保持向后兼容，列出按钮、输入框、列表、卡片等主要组件类型。

### 5. 视觉样式描述 (visual_style)
用自然语言描述页面视觉风格，不要求精确hex色值。
- color_palette: 颜色描述数组，如 "主操作色：蓝色"、"页面背景：浅灰色"、"成功状态：绿色"
- typography: 字号描述数组，如 "页面标题：16px 加粗"、"表格内容：14px 常规"
- spacing: 间距描述数组，如 "搜索区与表格之间：约16px"
- border: 边框/阴影描述数组，如 "卡片：白色背景，浅阴影"

### 6. 组件结构细节 (component_details)
描述复杂组件的内部配置：
- 表格(table): target/columns[] (title/dataIndex/render描述/width/sortable)
- 弹窗(dialog): name/width/fields[] (label/type/required/default) 或 sections[]
- 表单(form): fields[] 数组，包含每个字段的 label/type/required/placeholder

### 7. 交互行为 (interactions)
箭头、连线、注释说明了什么交互逻辑。描述用户操作→系统响应。

### 8. 标注关联 (annotations) ⚠️ 重要
产品图片中常见标注形式：
- 数字序号标注（①②③…标记在UI元素旁，页面侧边/底部有对应描述）
- 红色圆圈标注（红色圆圈+数字指向特定元素，旁边有描述文字）
- 要点补充说明（以 · 或 - 开头的列表项，补充业务规则）

对每个标注提取：
- marker: 标注标记（如 "⑥"、"红色圆圈①"、"·"）
- marker_type: 标注类型（"数字序号标注" / "红色圆圈标注" / "要点补充说明"）
- target: 标注指向的UI元素名称
- parent_component: 目标元素所在的父组件（页面/弹窗名称）
- annotation_type: 标注内容类型
  - "validation" → 字段校验规则
  - "constraint" → 字段输入约束（maxlength/pattern等）
  - "business_logic" → 业务判断逻辑
  - "interaction" → 交互行为说明
  - "display" → 展示规则
- content: 标注的完整描述文字（一字不动提取）
- rules: 如能从描述中推断出具体规则，以键值对表示
  - 如 {"required": true, "type": "integer", "min": 1, "max": 999999}
  - 如 {"maxlength": 10, "pattern_desc": "汉字、数字、字母、符号"}
  - 无法推断则填 null

### 9. 状态描述 (states)
列出页面上有多状态变体的元素（标签、开关、按钮等）
- element: 元素名称
- component: 对应的Ant Design组件（a-tag / a-switch / a-button）
- variants: 状态变体数组 [{state: "状态名", color: "颜色", text: "显示文字"}]

### 10. 文案内容 (text_content)
页面上所有可见的UI文字（提示、占位符、按钮文字、表格列头等）。
注意：标注描述文字不要放这里，放在 annotations 中。

## 输出格式
\`\`\`json
{
  "version": "版本号或null",
  "pages": [
    {
      "name": "页面名称",
      "description": "功能描述（1-3句话）",
      "layout_zones": [
        {
          "zone": "区域名称",
          "position": "left/top/right/bottom/center",
          "width_ratio": "宽度占比描述",
          "layout": "内部排列方向描述",
          "children": ["子元素名称数组"]
        }
      ],
      "component_tree": {
        "component": "根容器组件",
        "children": [
          {
            "component": "子组件",
            "label": "标签",
            "placeholder": "占位符（如有）",
            "type": "类型（如有）",
            "position": "位置描述",
            "children": [],
            "has_action_bar": false,
            "action_buttons": [],
            "has_pagination": false,
            "pagination_position": ""
          }
        ]
      },
      "ui_elements": ["扁平元素列表，保持向后兼容"],
      "visual_style": {
        "color_palette": ["颜色描述数组"],
        "typography": ["字号描述数组"],
        "spacing": ["间距描述数组"],
        "border": ["边框描述数组"]
      },
      "component_details": [
        {
          "type": "table/dialog/form",
          "target": "目标组件名称",
          "columns": [{"title": "...", "dataIndex": "...", "render": "...", "width": "...", "sortable": false}],
          "fields": [{"label": "...", "type": "...", "required": false}],
          "sections": [{"name": "...", "fields": ["..."]}]
        }
      ],
      "interactions": ["交互行为描述"],
      "annotations": [
        {
          "marker": "⑥",
          "marker_type": "数字序号标注",
          "target": "目标UI元素",
          "parent_component": "所在父组件",
          "annotation_type": "validation/constraint/business_logic/interaction/display",
          "content": "完整描述文字",
          "rules": {}
        }
      ],
      "states": [
        {
          "element": "元素名称",
          "component": "a-tag/a-switch/a-button",
          "variants": [{"state": "状态名", "color": "颜色", "text": "显示文字"}]
        }
      ],
      "text_content": ["UI文字内容"]
    }
  ],
  "confidence": "high/medium/low",
  "notes": ""
}
\`\`\``;

  // D2C 精度增强
  if (mode === 'd2c') {
    prompt += `

## D2C 精度增强指令
本图片用于设计稿高还原代码生成，请在 visual_style 字段中提供更精确的数值描述：

### color_palette 精度要求
- 尽量给出具体色值描述，如 "主色 #FF6684 玫红"、"背景 #f4f5f8 浅灰"
- 半透明色尽量给出 rgba 描述，如 "半透明黑色遮罩 rgba(0,0,0,0.5)"
- 渐变给出起止色 + 方向，如 "linear-gradient(135deg, #FF0E4B 5%, #FF6595 97%)"

### typography 精度要求
- 给出精确字重数值：300(Light) / 400(Regular) / 500(Medium) / 600(SemiBold) / 700(Bold)
- 给出字号 + 字重，如 "标题 32rpx 字重600"、"正文 28rpx 字重400"

### spacing 精度要求
- 给出四方向间距，如 "卡片内边距 30rpx 20rpx"（上下30 左右20）
- 元素间间距如 "垂直间距 20rpx"、"水平间距 16rpx"

### border 精度要求
- 圆角给出精确值，如 "统一圆角 24rpx" 或 "左上8px 右上8px 右下0 左下0"
- 阴影给出完整参数，如 "0rpx 4px 20rpx rgba(0,0,0,0.04)"
- 边框给出粗细+样式+颜色，如 "1rpx solid #ddd"

如果截图分辨率不够精确识别像素值，请在 notes 中说明不确定的部分。`;
  }

  prompt += `

## 规则
- 如果截图中某信息不可见或不明确，字段填 null 或空数组 []，不要编造
- 文字内容一字不动原样提取
- 忽略墨刀编辑器自身的工具栏、侧边栏UI
- 只分析设计内容区域
- layout_zones 至少要能区分 sidebar、main_content、dialog 等大区
- annotations 必须将标注标记与目标UI元素关联，不能丢失关联关系
- component_tree 必须有层级嵌套，不能是扁平列表`;

  return prompt;
}

function buildModalPrompt(pageIndex, totalPages) {
  return `你是产品需求文档分析专家。这张截图是弹窗/模态框页面。

## ⚠️ 关键规则：弹窗识别与背景忽略

1. **遮罩层检测**：如果页面存在半透明灰色/黑色遮罩层覆盖在背景内容之上，说明这是一个弹窗/模态框。
2. **只分析弹窗内容**：弹窗通常是一个白色/浅色矩形卡片，位于遮罩层之上、屏幕居中位置。只提取这个卡片内的内容。
3. **忽略遮罩层下方**：遮罩层下方被覆盖的页面内容（表格/按钮/侧边栏等）一律不分析。即使弹窗外的元素可见，也视为不可交互的背景。
4. **弹窗边界**：弹窗以最外层的白色卡片边框为界，内部所有字段、按钮、表格都属于弹窗内容。

## 提取要求

### 1. 弹窗基本信息
- 弹窗标题 (name)
- 功能描述 (description, 1-2句话)
- 弹窗大致宽度 (width, 如 "约600px" / "约800px")

### 2. 弹窗布局区域 (layout_zones)
描述弹窗内部的空间划分，通常包括 header/body/footer：
- header: 弹窗标题栏
- body: 表单内容区
- footer: 底部按钮区

### 3. 表单字段 (component_details)
以 dialog 类型描述：
- fields: 字段数组 [{label, type (a-input/a-input-password/a-select/a-radio-group/a-checkbox-group/a-textarea/a-input-number), required, placeholder, default}]
- 如有分组，用 sections: [{name, fields[]}]

### 4. 按钮 (component_tree)
弹窗底部的操作按钮（确定/取消/其他）

### 5. 标注关联 (annotations)
弹窗中如有标注标记（①②③/红色圆圈），提取标注关联：
- marker/target/parent_component/annotation_type/content/rules

### 6. 校验规则
从标注或可见的必填标记(*)、格式提示中提取

## 输出格式
\`\`\`json
{
  "version": null,
  "pages": [{
    "name": "弹窗名称",
    "description": "功能描述",
    "layout_zones": [
      {"zone": "header", "position": "top", "children": ["弹窗标题"]},
      {"zone": "body", "position": "center", "layout": "垂直排列", "children": ["表单字段"]},
      {"zone": "footer", "position": "bottom", "children": ["确定按钮", "取消按钮"]}
    ],
    "component_tree": {
      "component": "a-modal",
      "children": []
    },
    "visual_style": {
      "color_palette": [],
      "typography": [],
      "spacing": [],
      "border": []
    },
    "component_details": [{
      "type": "dialog",
      "name": "弹窗名称",
      "width": "约600px",
      "fields": [],
      "sections": []
    }],
    "interactions": [],
    "annotations": [],
    "states": [],
    "text_content": []
  }],
  "confidence": "high/medium/low"
}
\`\`\`

## 规则
- 只描述弹窗内容，不描述背景页面
- 如果信息不可见，字段填 null 或空数组`;
}

function apiRequest(body, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = request({
      hostname: DASHSCOPE_HOST,
      path: DASHSCOPE_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`API ${res.statusCode}: ${data.substring(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function analyzeImage(imagePath, pageIndex, totalPages, apiKey, pageType = 'design', mode = 'design') {
  const base64Image = imageToBase64(imagePath);
  const prompt = pageType === 'flowchart' ? buildFlowchartPrompt(pageIndex, totalPages)
    : pageType === 'modal' ? buildModalPrompt(pageIndex, totalPages)
    : buildPrompt(pageIndex, totalPages, mode);

  const body = {
    model: 'qwen-vl-max',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: base64Image } },
          { type: 'text', text: prompt }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 30720
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await apiRequest(body, apiKey);
      const content = data.choices?.[0]?.message?.content || '';

      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      throw new Error(`无法解析 Qwen-VL 返回的 JSON: ${content.substring(0, 200)}`);

    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      return { error: err.message, pageIndex };
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let imagePaths = [];
  let version = 'unknown';
  let pageMapping = {}; // { filename: { pageName, pageType } }
  let mode = 'design';

  if (args.length > 0) {
    imagePaths = args;
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString());
      imagePaths = input.screenshots || [];
      version = input.version || 'unknown';
      pageMapping = input.pageMapping || {};
      mode = input.mode || 'design';
    } catch {
      console.error(JSON.stringify({ success: false, error: '无法解析输入' }));
      process.exit(1);
    }
  }

  if (imagePaths.length === 0) {
    console.error(JSON.stringify({ success: false, error: '没有提供截图路径' }));
    process.exit(1);
  }

  const config = loadConfig();
  const apiKey = config.dashscope_api_key;

  if (!apiKey || apiKey === 'sk-xxx') {
    console.error(JSON.stringify({ success: false, error: '请先配置 dashscope_api_key' }));
    process.exit(1);
  }

  // Setup identify cache dir
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const identifyDir = config.vision_dir
    ? resolve(cwd, config.vision_dir, version)
    : resolve(cwd, './.lg-docs/vision/', version);
  mkdirSync(identifyDir, { recursive: true });

  const results = [], warnings = [], skipped = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    const fileName = imgPath.split('/').pop();

    // Check cache
    const cacheFile = join(identifyDir, fileName.replace(/\.(png|jpg|jpeg|gif)$/i, '.json'));
    if (existsSync(cacheFile)) {
      console.error(`跳过 (已缓存): ${fileName}`);
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'));
        results.push(cached);
        skipped.push(fileName);
        continue;
      } catch (_) { /* re-analyze if cache corrupt */ }
    }

    console.error(`正在识别第 ${i + 1}/${imagePaths.length} 张: ${fileName}`);

    const pageInfo = pageMapping[fileName] || {};
    const pageType = pageInfo.type || 'design';

    const result = await analyzeImage(imgPath, i, imagePaths.length, apiKey, pageType, mode);
    if (result.error) {
      warnings.push(`${fileName} 识别失败: ${result.error}`);
    } else {
      // Attach image reference
      result._sourceImage = fileName;
      result._imagePath = imgPath;
      result._pageName = pageInfo.name || '';
      result._pageType = pageType;

      // Save cache
      try { writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf-8'); } catch (_) {}
      results.push(result);
    }
  }

  if (results.length === 0) {
    console.error(JSON.stringify({
      success: false, error: '所有截图识别失败', warnings
    }));
    process.exit(1);
  }

  const merged = {
    success: true,
    version: results.find(r => r.version)?.version || version,
    pages: results.flatMap(r => r.pages || []).filter(p => p.name),
    confidence: results.every(r => r.confidence === 'high') ? 'high'
      : results.some(r => r.confidence === 'low') ? 'low' : 'medium',
    warnings,
    skipped: skipped.length > 0 ? skipped : undefined,
    _totalImages: imagePaths.length,
    _analyzed: imagePaths.length - skipped.length,
    _cached: skipped.length,
    identifyDir
  };

  // 向后兼容：如果 pages 中缺少新字段，补充默认空值
  merged.pages = merged.pages.map(page => ({
    layout_zones: [],
    component_tree: null,
    visual_style: { color_palette: [], typography: [], spacing: [], border: [] },
    component_details: [],
    annotations: [],
    states: [],
    ...page  // 实际数据覆盖默认值
  }));

  console.log(JSON.stringify(merged, null, 2));
}

main();
