const NAV_ITEMS = [
  { key: 'wiki', label: '📁 知识库', icon: '📁' },
  { key: 'qa', label: '💬 问答助手', icon: '💬' },
  { key: 'import', label: '📥 采集导入', icon: '📥' },
  { key: 'filtered', label: '🗑️ 已过滤', icon: '🗑️' },
  { key: 'rules', label: '⚙️ 规则管理', icon: '⚙️' },
];

export default function Sidebar({ activeNav, onNavChange }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>📚 Knowledge Vault</h1>
        <p>个人知识库整理系统</p>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">导航</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${activeNav === item.key ? 'active' : ''}`}
            onClick={() => onNavChange(item.key)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
