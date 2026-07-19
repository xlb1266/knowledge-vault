const PLATFORM_LABELS = {
  bilibili: 'B站',
  douyin: '抖音',
  xiaohongshu: '小红书',
  wechat: '微信公众号',
};

export default function EntryCard({ entry, selected, onSelect, onClick }) {
  const platformClass = `platform-${entry.source_platform}`;
  const platformLabel = PLATFORM_LABELS[entry.source_platform] || entry.source_platform;

  const categories = [entry.category_l1, entry.category_l2, entry.category_l3].filter(Boolean);

  return (
    <div
      className={`entry-card ${selected ? 'selected' : ''}`}
      onClick={(e) => {
        // 如果点击的是 checkbox，不触发卡片点击
        if (e.target.type === 'checkbox') return;
        onClick && onClick(entry);
      }}
    >
      <input
        type="checkbox"
        className="entry-checkbox"
        checked={selected}
        onChange={(e) => {
          e.stopPropagation();
          onSelect && onSelect(entry.id);
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="entry-info">
        <div className="entry-title">{entry.title || '(无标题)'}</div>
        <div className="entry-meta">
          <span className={`entry-platform ${platformClass}`}>{platformLabel}</span>
          {entry.source_author && <span>{entry.source_author}</span>}
          <span>{new Date(entry.created_at).toLocaleDateString('zh-CN')}</span>
          {entry.is_valid === 0 && <span style={{ color: 'var(--color-danger)' }}>已过滤: {entry.filter_reason}</span>}
        </div>
        {categories.length > 0 && (
          <div className="entry-categories" style={{ marginTop: 6 }}>
            {categories.map((cat) => (
              <span key={cat} className="entry-category-tag">{cat}</span>
            ))}
          </div>
        )}
      </div>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 18 }}>›</span>
    </div>
  );
}
