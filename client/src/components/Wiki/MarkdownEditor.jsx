import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// frontmatter 字段中文名映射
const FIELD_LABELS = {
  id: 'ID',
  title: '标题',
  source: '来源平台',
  author: '作者',
  url: '原始链接',
  category: '分类',
  tags: '标签',
  summary: '摘要',
  description: '检索描述',
  collected_at: '采集时间',
  ai_source: 'AI 分类依据',
  ai_confidence: '置信度',
};

const PLATFORM_LABELS = {
  bilibili: 'B站',
  douyin: '抖音',
  xiaohongshu: '小红书',
  wechat: '微信公众号',
};

const AI_SOURCE_LABELS = {
  full_content: '基于完整内容',
  partial_content: '基于部分内容',
  title_only: '仅基于标题',
  keyword_fallback: '关键词降级',
  rule_filter: '规则过滤',
};

const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' };

// 解析 frontmatter（--- ... ---）与正文
function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1], body: m[2] };
}

// 简易 YAML 解析（只处理 key: value 和 key: [a, b]）
function parseFrontmatter(yaml) {
  const fields = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    let value = raw.trim();
    // 标签数组 [a, b]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    fields[key] = value;
  }
  return fields;
}

export default function MarkdownEditor({ filePath, content, onSave, onDelete, onReextract, reextracting }) {
  const [draft, setDraft] = useState(content);
  const [mode, setMode] = useState('edit'); // 'edit' | 'preview'
  const [dirty, setDirty] = useState(false);

  // 切换文件时重置草稿
  useEffect(() => {
    setDraft(content);
    setDirty(false);
  }, [filePath, content]);

  const handleChange = (val) => {
    setDraft(val);
    setDirty(val !== content);
  };

  const handleSave = () => {
    onSave(draft);
    setDirty(false);
  };

  const isProtected = ['AGENTS.md', 'index.md', 'log.md', 'templates/article.md'].includes(
    filePath
  );

  // 预览模式：解析 frontmatter 为结构化卡片，正文走 markdown 渲染
  const { fmFields, body } = useMemo(() => {
    const { frontmatter, body } = splitFrontmatter(draft);
    return { fmFields: frontmatter ? parseFrontmatter(frontmatter) : null, body };
  }, [draft]);

  return (
    <div className="md-editor">
      <div className="md-editor-toolbar">
        <div className="md-file-path" title={filePath}>
          {filePath}
          {dirty && <span style={{ color: 'var(--color-warning)', marginLeft: 6 }}>● 未保存</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="md-mode-tabs">
            <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
              ✏️ 编辑
            </button>
            <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
              👁️ 预览
            </button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!dirty}>
            💾 保存
          </button>
          {onReextract && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onReextract}
              disabled={reextracting}
              title="重新提取正文 + AI 生成 description"
            >
              {reextracting ? '⏳ 提取中' : '🔄 重新提取'}
            </button>
          )}
          {!isProtected && (
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              🗑️ 删除
            </button>
          )}
        </div>
      </div>

      <div className="md-editor-body">
        {mode === 'edit' ? (
          <textarea
            className="md-textarea"
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            placeholder="在此输入 Markdown 内容..."
          />
        ) : (
          <div className="md-preview markdown-body">
            {fmFields ? (
              <div className="md-frontmatter-card">
                <div className="md-frontmatter-title">📋 元信息</div>
                <div className="md-frontmatter-grid">
                  {Object.keys(fmFields).map((key) => {
                    const value = fmFields[key];
                    const label = FIELD_LABELS[key] || key;
                    let display = value;
                    if (key === 'source' && PLATFORM_LABELS[value]) display = PLATFORM_LABELS[value];
                    if (key === 'ai_source' && AI_SOURCE_LABELS[value]) display = AI_SOURCE_LABELS[value];
                    if (key === 'ai_confidence' && CONFIDENCE_LABELS[value]) display = CONFIDENCE_LABELS[value];
                    if (key === 'collected_at' && value) {
                      try { display = new Date(value).toLocaleString('zh-CN'); } catch { /* keep */ }
                    }
                    if (Array.isArray(value)) {
                      display = value.join('、');
                    }
                    return (
                      <div key={key} className="md-fm-row">
                        <span className="md-fm-label">{label}</span>
                        <span className="md-fm-value">{String(display) || '-'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || '（无正文）'}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
