import { useState } from 'react';

// 初始展开的目录
const DEFAULT_EXPANDED = ['raw', 'raw/articles', 'wiki'];

export default function FileTree({ tree, currentPath, onSelect }) {
  return (
    <div className="file-tree">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          currentPath={currentPath}
          onSelect={onSelect}
          defaultExpanded={DEFAULT_EXPANDED}
        />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, currentPath, onSelect, defaultExpanded }) {
  const [expanded, setExpanded] = useState(
    defaultExpanded ? defaultExpanded.includes(node.path) : depth === 0
  );

  const isSelected = currentPath === node.path;
  const padding = 8 + depth * 14;

  if (node.type === 'dir') {
    const childCount = node.children ? node.children.length : 0;
    return (
      <div>
        <button
          className="tree-node tree-dir"
          style={{ paddingLeft: padding }}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="tree-arrow">{expanded ? '▼' : '▶'}</span>
          <span>{expanded ? '📂' : '📁'}</span>
          <span className="tree-label">{node.name}</span>
          {childCount > 0 && <span className="tree-count">{childCount}</span>}
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                currentPath={currentPath}
                onSelect={onSelect}
                defaultExpanded={defaultExpanded}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // 文件
  return (
    <button
      className={`tree-node tree-file ${isSelected ? 'selected' : ''}`}
      style={{ paddingLeft: padding + 22 }}
      onClick={() => onSelect && onSelect(node.path)}
    >
      <span>📄</span>
      <span className="tree-label">{node.name}</span>
    </button>
  );
}
