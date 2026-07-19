import { useState, useEffect } from 'react';
import { categoryApi } from '../api';
import { Modal } from '../components/common';

export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const data = await categoryApi.getRules();
      setRules(data);
    } catch (err) {
      console.error('获取规则失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确定删除该规则？')) return;
    try {
      await categoryApi.deleteRule(id);
      fetchRules();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleToggleEnabled = async (rule) => {
    try {
      await categoryApi.updateRule(rule.id, { enabled: rule.enabled === 1 ? 0 : 1 });
      fetchRules();
    } catch (err) {
      alert('操作失败: ' + err.message);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>;
  }

  const excludeRules = rules.filter((r) => r.rule_type === 'exclude');
  const includeRules = rules.filter((r) => r.rule_type === 'include');
  const classifyRules = rules.filter((r) => r.rule_type === 'classify');

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8 }}>⚙️ 规则管理</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          管理内容过滤和自动分类规则。规则按优先级从高到低执行。
        </p>
      </div>

      <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ marginBottom: 24 }}>
        ➕ 添加新规则
      </button>

      <RuleSection title="🚫 排除规则" rules={excludeRules} onDelete={handleDelete} onToggle={handleToggleEnabled} onEdit={setEditingRule} />
      <RuleSection title="✅ 包含规则" rules={includeRules} onDelete={handleDelete} onToggle={handleToggleEnabled} onEdit={setEditingRule} />
      <RuleSection title="📂 分类规则" rules={classifyRules} onDelete={handleDelete} onToggle={handleToggleEnabled} onEdit={setEditingRule} />

      {(showAddModal || editingRule) && (
        <RuleModal
          rule={editingRule}
          onClose={() => {
            setShowAddModal(false);
            setEditingRule(null);
          }}
          onSave={() => {
            setShowAddModal(false);
            setEditingRule(null);
            fetchRules();
          }}
        />
      )}
    </div>
  );
}

function RuleSection({ title, rules, onDelete, onToggle, onEdit }) {
  if (rules.length === 0) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      <h4 style={{ marginBottom: 12, fontSize: 16 }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rules.map((rule) => (
          <div
            key={rule.id}
            style={{
              background: 'var(--color-surface)',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              opacity: rule.enabled === 0 ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 60 }}>#{rule.priority}</span>
            <span style={{ flex: 1, fontSize: 14 }}>{rule.pattern}</span>
            {rule.category_l1 && (
              <span style={{ fontSize: 12, color: 'var(--color-primary)' }}>
                → {rule.category_l1}
                {rule.category_l2 && ` / ${rule.category_l2}`}
              </span>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onToggle(rule)}
              title={rule.enabled === 1 ? '禁用' : '启用'}
            >
              {rule.enabled === 1 ? '✅' : '⏸️'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => onEdit(rule)}>
              ✏️
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(rule.id)}>
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleModal({ rule, onClose, onSave }) {
  const [form, setForm] = useState({
    rule_type: rule?.rule_type || 'include',
    pattern: rule?.pattern || '',
    target_field: rule?.target_field || 'title',
    priority: rule?.priority || 0,
    category_l1: rule?.category_l1 || '',
    category_l2: rule?.category_l2 || '',
    category_l3: rule?.category_l3 || '',
    enabled: rule?.enabled ?? 1,
  });

  const handleSubmit = async () => {
    if (!form.pattern.trim()) {
      alert('请输入规则匹配模式');
      return;
    }

    try {
      if (rule) {
        await categoryApi.updateRule(rule.id, form);
      } else {
        await categoryApi.addRule(form);
      }
      onSave();
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  };

  return (
    <Modal title={rule ? '编辑规则' : '添加规则'} onClose={onClose}>
      <div className="form-group">
        <div className="form-label">规则类型</div>
        <select
          className="form-select"
          value={form.rule_type}
          onChange={(e) => setForm({ ...form, rule_type: e.target.value })}
        >
          <option value="exclude">排除 (命中即过滤)</option>
          <option value="include">包含 (命中即保留)</option>
          <option value="classify">分类 (自动归类)</option>
        </select>
      </div>

      <div className="form-group">
        <div className="form-label">匹配模式（关键词）</div>
        <input
          className="form-input"
          value={form.pattern}
          onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          placeholder="例如：编程、Python、搞笑"
        />
      </div>

      <div className="form-group">
        <div className="form-label">优先级（数字越大越优先）</div>
        <input
          className="form-input"
          type="number"
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
        />
      </div>

      {(form.rule_type === 'include' || form.rule_type === 'classify') && (
        <>
          <div className="form-group">
            <div className="form-label">一级分类</div>
            <input
              className="form-input"
              value={form.category_l1}
              onChange={(e) => setForm({ ...form, category_l1: e.target.value })}
            />
          </div>
          <div className="form-group">
            <div className="form-label">二级分类</div>
            <input
              className="form-input"
              value={form.category_l2}
              onChange={(e) => setForm({ ...form, category_l2: e.target.value })}
            />
          </div>
          <div className="form-group">
            <div className="form-label">三级分类</div>
            <input
              className="form-input"
              value={form.category_l3}
              onChange={(e) => setForm({ ...form, category_l3: e.target.value })}
            />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={handleSubmit}>
          💾 保存
        </button>
        <button className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}
