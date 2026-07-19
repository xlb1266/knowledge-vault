import { useState, useCallback, useEffect } from 'react';
import { wikiApi, knowledgeApi } from '../../api';
import FileTree from './FileTree';
import MarkdownEditor from './MarkdownEditor';

export default function FileExplorer({ pendingWikiPath, onConsumePending }) {
  const [tree, setTree] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newDir, setNewDir] = useState('raw/notes');
  const [newName, setNewName] = useState('');
  const [reextractingOne, setReextractingOne] = useState(false);

  const refreshTree = useCallback(async () => {
    try {
      const t = await wikiApi.getTree();
      setTree(t);
    } catch (err) {
      setError('加载目录失败: ' + err.message);
    }
  }, []);

  // 首次挂载加载目录树
  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  // 引用跳转：问答助手点击引用卡片时，打开对应 wiki 文件
  useEffect(() => {
    if (pendingWikiPath) {
      handleSelect(pendingWikiPath);
      if (onConsumePending) onConsumePending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWikiPath]);

  const handleSelect = useCallback(async (filePath) => {
    setError('');
    setLoading(true);
    try {
      const file = await wikiApi.getFile(filePath);
      setCurrentPath(filePath);
      setContent(file.content || '');
    } catch (err) {
      setError('读取文件失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSave = useCallback(
    async (newContent) => {
      setError('');
      try {
        await wikiApi.saveFile(currentPath, newContent);
        setContent(newContent);
        await refreshTree();
      } catch (err) {
        setError('保存失败: ' + err.message);
      }
    },
    [currentPath, refreshTree]
  );

  const handleDelete = useCallback(async () => {
    if (!currentPath) return;
    if (!confirm(`确定删除 ${currentPath}？此操作不可撤销。`)) return;
    setError('');
    try {
      await wikiApi.deleteFile(currentPath);
      setCurrentPath('');
      setContent('');
      await refreshTree();
    } catch (err) {
      setError('删除失败: ' + err.message);
    }
  }, [currentPath, refreshTree]);

  const handleCreate = useCallback(async () => {
    setError('');
    if (!newName.trim()) {
      setError('请输入文件名');
      return;
    }
    let name = newName.trim();
    if (!name.endsWith('.md')) name += '.md';
    // 清理非法字符
    name = name.replace(/[\/\\:*?"<>|]/g, '');
    const filePath = `${newDir.replace(/\/$/, '')}/${name}`;
    try {
      await wikiApi.createFile(filePath, `---\ntitle: ${name.replace(/\.md$/, '')}\n---\n\n# ${name.replace(/\.md$/, '')}\n\n`);
      setCreating(false);
      setNewName('');
      await refreshTree();
      await handleSelect(filePath);
    } catch (err) {
      setError('创建失败: ' + err.message);
    }
  }, [newDir, newName, refreshTree, handleSelect]);

  const handleRegenerate = useCallback(async () => {
    if (!confirm('从数据库重新生成所有有效条目的 .md？已存在的同名文件会生成带 hash 后缀的新文件。')) return;
    setError('');
    try {
      const r = await wikiApi.regenerate();
      alert(`已生成 ${r.generated} 个 .md，跳过 ${r.skipped} 个`);
      await refreshTree();
    } catch (err) {
      setError('重新生成失败: ' + err.message);
    }
  }, [refreshTree]);

  const [reextractingAll, setReextractingAll] = useState(false);

  const handleReextractAll = useCallback(async () => {
    if (!confirm('重新提取所有正文为空的条目？\n会重新抓取正文并调用 AI 生成 description/分类，覆盖对应 md 文件。\n每条约 10-30 秒，请耐心等待，期间勿关闭页面。')) return;
    setReextractingAll(true);
    setError('');
    try {
      const r = await wikiApi.reextractAll(true);
      alert(`完成：处理 ${r.processed} 条，成功 ${r.ok}，失败 ${r.failed}`);
      await refreshTree();
    } catch (err) {
      setError('重新提取失败: ' + err.message);
    } finally {
      setReextractingAll(false);
    }
  }, [refreshTree]);

  const [distilling, setDistilling] = useState(false);
  const [distillProgress, setDistillProgress] = useState('');

  const handleDistill = useCallback(async () => {
    if (!confirm('蒸馏知识库？\nAI 会把 raw 原文提炼成 wiki/ 下交叉链接的知识页（含 description）。\n会多次调用 AI，约 2-4 分钟，期间勿关闭页面。')) return;
    setDistilling(true);
    setDistillProgress('规划中...');
    setError('');
    try {
      const r = await wikiApi.distill((ev) => {
        if (ev.type === 'progress') {
          if (ev.stage === 'plan') setDistillProgress(`规划中（${ev.total} 条原始资料）...`);
          else if (ev.stage === 'synthesize') setDistillProgress(`合成「${ev.title}」（${ev.index}/${ev.total}）...`);
        }
      });
      if (!r) return;
      if (r.type === 'error') {
        setError('蒸馏失败: ' + r.message);
      } else {
        const broken = r.brokenLinks && r.brokenLinks.length
          ? `\n⚠️ ${r.brokenLinks.length} 处断链（已降级为纯文本）`
          : '';
        alert(`✅ 蒸馏完成：生成 ${r.pagesGenerated} 个 wiki 页，${r.links} 处交叉链接${broken}`);
        await refreshTree();
      }
    } catch (err) {
      setError('蒸馏失败: ' + err.message);
    } finally {
      setDistilling(false);
      setDistillProgress('');
    }
  }, [refreshTree]);

  // 从当前文件 frontmatter 解析 id，重新提取单条
  const handleReextractCurrent = useCallback(async () => {
    const idMatch = content.match(/^id:\s*(\d+)/m);
    if (!idMatch) {
      setError('当前文件无 id 字段（非采集条目），无法重新提取');
      return;
    }
    const id = Number(idMatch[1]);
    if (!confirm(`重新提取条目 #${id}？会重新抓取正文 + AI 生成 description，覆盖当前 md。约 10-30 秒。`)) return;
    setReextractingOne(true);
    setError('');
    try {
      const r = await knowledgeApi.reextract(id);
      await refreshTree();
      await handleSelect(currentPath); // 重新加载当前文件
      setError(`✅ 完成：正文 ${r.contentLen} 字`);
    } catch (err) {
      setError('重新提取失败: ' + err.message);
    } finally {
      setReextractingOne(false);
    }
  }, [content, currentPath, refreshTree, handleSelect]);

  return (
    <div className="file-explorer">
      <div className="fe-sidebar">
        <div className="fe-sidebar-header">
          <span>📁 文件系统</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" title="新建文件" onClick={() => setCreating((v) => !v)}>
              ➕
            </button>
            <button
              className="btn btn-secondary btn-sm"
              title="重新提取正文为空的条目（调 AI 生成 description）"
              onClick={handleReextractAll}
              disabled={reextractingAll}
            >
              {reextractingAll ? '⏳' : '🔍'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              title="蒸馏知识库：raw 原文提炼成 wiki 交叉链接知识页（调 AI，较慢）"
              onClick={handleDistill}
              disabled={distilling}
            >
              {distilling ? '⏳' : '🧪'}
            </button>
            <button className="btn btn-secondary btn-sm" title="从数据库重新生成" onClick={handleRegenerate}>
              🔄
            </button>
            <button className="btn btn-secondary btn-sm" title="刷新" onClick={refreshTree}>
              ↻
            </button>
          </div>
        </div>

        {distilling && distillProgress && (
          <div className="fe-progress">🧪 {distillProgress}</div>
        )}

        {creating && (
          <div className="fe-create-form">
            <select className="fe-create-dir" value={newDir} onChange={(e) => setNewDir(e.target.value)}>
              <option value="raw/notes">raw/notes</option>
              <option value="raw/articles">raw/articles</option>
              <option value="raw/clippings">raw/clippings</option>
              <option value="wiki/concepts">wiki/concepts</option>
              <option value="wiki/entities">wiki/entities</option>
              <option value="wiki/topics">wiki/topics</option>
            </select>
            <input
              className="fe-create-name"
              placeholder="文件名.md"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary btn-sm" onClick={handleCreate} style={{ flex: 1 }}>
                创建
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </div>
        )}

        <div className="fe-tree-scroll">
          <FileTree tree={tree} currentPath={currentPath} onSelect={handleSelect} />
        </div>
      </div>

      <div className="fe-main">
        {error && (
          <div className="fe-error">❌ {error}</div>
        )}
        {currentPath ? (
          loading ? (
            <div className="fe-loading">加载中...</div>
          ) : (
            <MarkdownEditor
              filePath={currentPath}
              content={content}
              onSave={handleSave}
              onDelete={handleDelete}
              onReextract={handleReextractCurrent}
              reextracting={reextractingOne}
            />
          )
        ) : (
          <div className="fe-empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <p>从左侧选择一个 .md 文件查看/编辑</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
              采集导入的内容会自动生成到 raw/articles/
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
