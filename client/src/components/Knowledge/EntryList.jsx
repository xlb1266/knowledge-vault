import { EmptyState, LoadingSpinner } from '../common';
import EntryCard from './EntryCard';

export default function EntryList({
  items,
  loading,
  selectedIds,
  onSelect,
  onSelectAll,
  onEntryClick,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
}) {
  if (loading) return <LoadingSpinner />;
  if (!items || items.length === 0) {
    return <EmptyState icon="📭" title="暂无知识条目" message="点击「采集导入」开始添加内容" />;
  }

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onSelectAll && onSelectAll(!allSelected)}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          已选 {selectedIds.size} / {total} 条
        </span>
        {selectedIds.size > 0 && (
          <span style={{ fontSize: 13, color: 'var(--color-primary)', marginLeft: 'auto' }}>
            {selectedIds.size} 条已选中 — 可使用批量操作
          </span>
        )}
      </div>

      <div className="entry-list">
        {items.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            selected={selectedIds.has(entry.id)}
            onSelect={onSelect}
            onClick={onEntryClick}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ‹ 上一页
          </button>
          <span className="pagination-info">
            {page} / {totalPages}（共 {total} 条）
          </span>
          <button
            className="pagination-btn"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页 ›
          </button>
        </div>
      )}
    </div>
  );
}
