import { useEffect } from 'react';
import FileExplorer from '../components/Wiki/FileExplorer';

export default function WikiPage({ pendingWikiPath, onConsumePending }) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ marginBottom: 4 }}>📁 知识库</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          采集内容自动生成 Markdown 文件，可浏览 / 编辑 / 新建 / 删除。文件位于 server/data/kb-wiki/，外部 AI 与 Obsidian 可直接访问。
        </p>
      </div>
      <FileExplorer pendingWikiPath={pendingWikiPath} onConsumePending={onConsumePending} />
    </div>
  );
}
