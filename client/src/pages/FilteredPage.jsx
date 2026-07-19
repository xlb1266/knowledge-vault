import { useState, useCallback } from 'react';
import { knowledgeApi } from '../api';
import EntryList from '../components/Knowledge/EntryList';
import { useEntries } from '../hooks/useEntries';

export default function FilteredPage() {
  const {
    items, total, page, pageSize, totalPages,
    loading, setPage, refresh,
  } = useEntries({ valid: 0, page: 1 });

  const [selectedIds, setSelectedIds] = useState(new Set());

  const handleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((selectAll) => {
    if (selectAll) {
      setSelectedIds(new Set(items.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [items]);

  const handleRestore = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定将选中的 ${selectedIds.size} 条恢复为有效知识？`)) return;
    try {
      await knowledgeApi.batchOperation([...selectedIds], 'mark_valid');
      setSelectedIds(new Set());
      refresh();
    } catch (err) {
      alert('操作失败: ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定永久删除选中的 ${selectedIds.size} 条？此操作不可撤销！`)) return;
    try {
      await knowledgeApi.batchOperation([...selectedIds], 'delete');
      setSelectedIds(new Set());
      refresh();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 8 }}>🗑️ 已过滤内容</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          以下内容已被规则引擎自动过滤。你可以手动恢复或永久删除它们。
        </p>
        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleRestore}>
              🔄 恢复为有效知识
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>
              🗑️ 永久删除
            </button>
          </div>
        )}
      </div>

      <EntryList
        items={items}
        loading={loading}
        selectedIds={selectedIds}
        onSelect={handleSelect}
        onSelectAll={handleSelectAll}
        onEntryClick={() => {}}
        total={total}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
