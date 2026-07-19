import { useState, useEffect } from 'react';
import { knowledgeApi } from '../../api';

const PLATFORM_LABELS = {
  bilibili: 'B站',
  douyin: '抖音',
  xiaohongshu: '小红书',
  wechat: '微信公众号',
};

// AI 来源标签的可读映射 + 颜色（借鉴 obsidian-wiki 的可追溯理念）
const AI_SOURCE_META = {
  full_content: { label: '基于完整内容', color: 'var(--color-success)' },
  partial_content: { label: '基于部分内容', color: 'var(--color-warning)' },
  title_only: { label: '仅基于标题', color: 'var(--color-text-muted)' },
  keyword_fallback: { label: '关键词降级', color: 'var(--color-text-muted)' },
  rule_filter: { label: '规则过滤', color: 'var(--color-danger)' },
};

const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' };

export default function EntryDetail({ entry, onClose, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [related, setRelated] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [showFullContent, setShowFullContent] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [reextractMsg, setReextractMsg] = useState('');

  // entry 切换时拉取相关收藏
  useEffect(() => {
    if (!entry || entry.is_valid !== 1) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    setRelatedLoading(true);
    knowledgeApi
      .getRelated(entry.id)
      .then((data) => { if (!cancelled) setRelated(data || []); })
      .catch(() => { if (!cancelled) setRelated([]); })
      .finally(() => { if (!cancelled) setRelatedLoading(false); });
    return () => { cancelled = true; };
  }, [entry?.id]);

  if (!entry) return null;

  const handleReextract = async () => {
    if (!confirm('重新提取该条目？会重新抓取正文并调用 AI 生成 description/分类，覆盖当前 md 文件。约需 10-30 秒。')) return;
    setReextracting(true);
    setReextractMsg('');
    try {
      const r = await knowledgeApi.reextract(entry.id);
      setReextractMsg(`✅ 完成：正文 ${r.contentLen} 字，已${r.mdPath ? '更新' : '生成'} md`);
      // 重新拉取详情刷新
      const detail = await knowledgeApi.getEntry(entry.id);
      onUpdate && onUpdate(detail);
    } catch (err) {
      setReextractMsg('❌ 失败: ' + err.message);
    } finally {
      setReextracting(false);
    }
  };

  const startEdit = () => {
    setForm({
      title: entry.title || '',
      summary: entry.summary || '',
      category_l1: entry.category_l1 || '',
      category_l2: entry.category_l2 || '',
      category_l3: entry.category_l3 || '',
      source_author: entry.source_author || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      const updated = await knowledgeApi.updateEntry(entry.id, form);
      onUpdate && onUpdate(updated);
      setEditing(false);
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定删除该条目？')) return;
    try {
      await knowledgeApi.deleteEntry(entry.id);
      onDelete && onDelete(entry.id);
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleToggleValid = async () => {
    try {
      const updated = await knowledgeApi.updateEntry(entry.id, {
        is_valid: entry.is_valid === 1 ? 0 : 1,
      });
      onUpdate && onUpdate(updated);
    } catch (err) {
      alert('操作失败: ' + err.message);
    }
  };

  const tags = Array.isArray(entry.tags) ? entry.tags : [];

  return (
    <div className="detail-panel">
      <div className="detail-header">
        {editing ? (
          <input
            className="form-input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            style={{ flex: 1, fontSize: 18, fontWeight: 700 }}
          />
        ) : (
          <div>
            <h2>{entry.title || '(无标题)'}</h2>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {entry.is_valid === 0 && <span className="badge badge-filtered">已过滤</span>}
              {entry.is_valid === 1 && <span className="badge badge-valid">有效知识</span>}
              <span className={`entry-platform platform-${entry.source_platform}`}>
                {PLATFORM_LABELS[entry.source_platform] || entry.source_platform}
              </span>
              {entry.ai_source && AI_SOURCE_META[entry.ai_source] && (
                <span
                  className="badge"
                  title={`AI 分类依据：${AI_SOURCE_META[entry.ai_source].label}`}
                  style={{ background: 'transparent', border: `1px solid ${AI_SOURCE_META[entry.ai_source].color}`, color: AI_SOURCE_META[entry.ai_source].color }}
                >
                  🔍 {AI_SOURCE_META[entry.ai_source].label}
                  {entry.ai_confidence && CONFIDENCE_LABELS[entry.ai_confidence] ? ` · 置信${CONFIDENCE_LABELS[entry.ai_confidence]}` : ''}
                </span>
              )}
            </div>
          </div>
        )}
        <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
      </div>

      <div className="detail-body">
        <div className="detail-field">
          <div className="detail-label">原始链接</div>
          <div className="detail-value">
            {entry.url ? (
              <a href={entry.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>
                {entry.url}
              </a>
            ) : '-'}
          </div>
        </div>

        <div className="detail-field">
          <div className="detail-label">原作者</div>
          <div className="detail-value">
            {editing ? (
              <input
                className="form-input"
                value={form.source_author}
                onChange={(e) => setForm({ ...form, source_author: e.target.value })}
              />
            ) : (entry.source_author || '-')}
          </div>
        </div>

        <div className="detail-field">
          <div className="detail-label">摘要</div>
          <div className="detail-value">
            {editing ? (
              <textarea
                className="form-textarea"
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            ) : (entry.summary || '-')}
          </div>
        </div>

        {entry.description && !editing && (
          <div className="detail-field">
            <div className="detail-label">检索描述（供问答助手预筛）</div>
            <div className="detail-value" style={{ background: 'var(--color-bg)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {entry.description}
            </div>
          </div>
        )}

        {entry.content_text && !editing && (
          <div className="detail-field">
            <div className="detail-label">完整正文 / 字幕</div>
            <div className="detail-value" style={{ whiteSpace: 'pre-wrap', maxHeight: showFullContent ? 'none' : '120px', overflow: 'hidden', position: 'relative' }}>
              {entry.content_text}
              {!showFullContent && entry.content_text.length > 200 && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: 'linear-gradient(transparent, var(--color-bg))' }} />
              )}
            </div>
            {entry.content_text.length > 200 && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => setShowFullContent((v) => !v)}
              >
                {showFullContent ? '收起 ▲' : `展开全部 (${entry.content_text.length} 字) ▼`}
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div className="detail-field">
            <div className="detail-label">一级分类</div>
            <div className="detail-value">
              {editing ? (
                <input
                  className="form-input"
                  value={form.category_l1}
                  onChange={(e) => setForm({ ...form, category_l1: e.target.value })}
                />
              ) : (entry.category_l1 || '-')}
            </div>
          </div>
          <div className="detail-field">
            <div className="detail-label">二级分类</div>
            <div className="detail-value">
              {editing ? (
                <input
                  className="form-input"
                  value={form.category_l2}
                  onChange={(e) => setForm({ ...form, category_l2: e.target.value })}
                />
              ) : (entry.category_l2 || '-')}
            </div>
          </div>
          <div className="detail-field">
            <div className="detail-label">三级分类</div>
            <div className="detail-value">
              {editing ? (
                <input
                  className="form-input"
                  value={form.category_l3}
                  onChange={(e) => setForm({ ...form, category_l3: e.target.value })}
                />
              ) : (entry.category_l3 || '-')}
            </div>
          </div>
        </div>

        {entry.filter_reason && (
          <div className="detail-field">
            <div className="detail-label">过滤原因</div>
            <div className="detail-value" style={{ color: 'var(--color-danger)' }}>{entry.filter_reason}</div>
          </div>
        )}

        <div className="detail-field">
          <div className="detail-label">采集时间</div>
          <div className="detail-value">{entry.collected_at ? new Date(entry.collected_at).toLocaleString('zh-CN') : '-'}</div>
        </div>

        {tags.length > 0 && (
          <div className="detail-field">
            <div className="detail-label">标签</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {tags.map((tag) => (
                <span key={tag} className="badge badge-valid">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {!editing && entry.is_valid === 1 && (
          <div className="detail-field">
            <div className="detail-label">相关收藏 🔗</div>
            {relatedLoading ? (
              <div className="detail-value" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>查找中...</div>
            ) : related.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {related.map((r) => (
                  <a
                    key={r.id}
                    href={r.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--color-bg-secondary)', borderRadius: 6, textDecoration: 'none', color: 'var(--color-text)' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>
                      <span style={{ color: 'var(--color-primary)', fontSize: 11, marginRight: 6 }}>{PLATFORM_LABELS[r.source_platform] || r.source_platform}</span>
                      {r.title}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {r.commonTags?.length > 0 && <span style={{ marginRight: 6 }}>+{r.commonTags.length} 标签</span>}
                      相关度 {r.relevanceScore}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="detail-value" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>暂无相关收藏</div>
            )}
          </div>
        )}
      </div>

      <div className="detail-actions">
        {editing ? (
          <>
            <button className="btn btn-primary" onClick={handleSave}>💾 保存</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={startEdit}>✏️ 编辑</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleReextract}
              disabled={reextracting}
            >
              {reextracting ? '⏳ 提取中...' : '🔄 重新提取'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleToggleValid}>
              {entry.is_valid === 1 ? '🚫 标记为无效' : '✅ 标记为有效'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>🗑️ 删除</button>
          </>
        )}
      </div>

      {reextractMsg && (
        <div style={{ padding: '8px 16px', fontSize: 13, background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
          {reextractMsg}
        </div>
      )}
    </div>
  );
}
