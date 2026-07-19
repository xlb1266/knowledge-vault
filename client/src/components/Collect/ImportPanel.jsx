import { useState } from 'react';
import { collectApi } from '../../api';
import PlatformSelector from './PlatformSelector';
import FileUploader from './FileUploader';

// 各平台手动输入的提示文案与示例（区分图文/视频）
function getInputHint(platform) {
  switch (platform) {
    case 'wechat':
      return {
        label: '文章链接列表（每行一个，格式：URL|标题|公众号名|摘要，标题等可留空，系统会自动抓取正文）',
        placeholder:
          'https://mp.weixin.qq.com/s/xxxxxxxx\nhttps://mp.weixin.qq.com/s/yyyyyyyy | 可选填标题 | 公众号名',
        help:
          '图文内容：系统会抓取公众号文章正文（标题、公众号名、正文），用 AI 做内容级分类。单篇约需 10-20 秒。',
      };
    case 'douyin':
      return {
        label: '视频链接 / 分享口令（每行一个，可直接粘贴抖音「分享-复制链接」的整段口令文本）',
        placeholder:
          'https://www.douyin.com/video/721xxxxxxx\n7.99 复制打开抖音，看看【xx的内容】 https://v.douyin.com/iABC123/ ...',
        help:
          '支持短链（v.douyin.com）和分享口令文本，系统会自动展开为真实链接再提取。无字幕时用标题+简介降级分类。',
      };
    case 'xiaohongshu':
      return {
        label: '链接列表（每行一个，格式：URL|标题|作者|摘要，标题等可留空，系统会自动提取）',
        placeholder: 'https://www.xiaohongshu.com/explore/xxxxxxxx\nhttps://www.xiaohongshu.com/... | 可选填标题 | 作者',
        help: '视频/图文内容：系统会自动解析内容，并用 AI 做内容级分类。',
      };
    default: // bilibili
      return {
        label: '链接列表（每行一个，格式：URL|标题|作者|摘要，标题等可留空，系统会自动提取）',
        placeholder:
          'https://www.bilibili.com/video/BV1xxxxxx\nhttps://www.bilibili.com/video/BV2xxxxxx | 可选填标题 | 作者',
        help:
          '系统会自动解析视频内容（标题、简介、字幕），并用 AI 做内容级分类。单条视频处理约需 10-30 秒，请耐心等待。',
      };
  }
}

export default function ImportPanel({ onImportComplete }) {
  const [platform, setPlatform] = useState(null);
  const [mode, setMode] = useState('manual'); // 'manual' | 'file'
  const [links, setLinks] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleImport = async () => {
    setError('');
    setResult(null);

    if (!platform) {
      setError('请先选择平台');
      return;
    }

    // 手动输入链接模式
    if (mode === 'manual') {
      const linkLines = links.trim().split('\n').filter(Boolean);
      if (linkLines.length === 0) {
        setError('请输入至少一个链接');
        return;
      }
      const items = linkLines.map((line) => {
        const parts = line.split('|');
        return {
          title: (parts[1] || '').trim(),
          url: (parts[0] || line).trim(),
          author: (parts[2] || '').trim(),
          description: (parts[3] || '').trim(),
        };
      });

      setLoading(true);
      try {
        const data = await collectApi.importItems(platform, items);
        setResult(data);
        setLinks('');
        onImportComplete && onImportComplete();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleFileUpload = async (file) => {
    if (!platform) {
      setError('请先选择平台');
      return;
    }
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const data = await collectApi.importFile(platform, file);
      setResult(data);
      onImportComplete && onImportComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPlatform(null);
    setMode('manual');
    setLinks('');
    setResult(null);
    setError('');
  };

  return (
    <div className="import-panel">
      <h3 style={{ marginBottom: 16 }}>📥 采集导入</h3>

      {/* 平台选择 */}
      <div className="detail-field">
        <div className="detail-label">选择平台</div>
        <PlatformSelector onSelect={(p) => { setPlatform(p); setResult(null); setError(''); }} />
        {platform && (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-primary)' }}>
            已选择: {platform === 'bilibili' ? 'B站' : platform === 'douyin' ? '抖音' : platform === 'xiaohongshu' ? '小红书' : '微信公众号'}
          </div>
        )}
      </div>

      {/* 导入模式 */}
      {platform && (
        <div className="import-tabs">
          <button className={`import-tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>
            📝 手动输入
          </button>
          <button className={`import-tab ${mode === 'file' ? 'active' : ''}`} onClick={() => setMode('file')}>
            📁 文件上传
          </button>
        </div>
      )}

      {/* 手动输入 */}
      {mode === 'manual' && platform && (
        <div className="form-group">
          <div className="form-label">{getInputHint(platform).label}</div>
          <textarea
            className="form-textarea"
            rows={6}
            placeholder={getInputHint(platform).placeholder}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
          />
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {getInputHint(platform).help}
          </p>
        </div>
      )}

      {/* 文件上传 */}
      {mode === 'file' && platform && (
        <FileUploader platform={platform} onUpload={handleFileUpload} />
      )}

      {/* 操作按钮 */}
      {platform && mode !== 'file' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
            {loading ? '⏳ 正在解析内容并分类...' : '🚀 开始导入'}
          </button>
          <button className="btn btn-secondary" onClick={reset}>重置</button>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="import-result" style={{ background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 14 }}>❌ {error}</p>
        </div>
      )}

      {/* 导入结果 */}
      {result && (
        <div className="import-result">
          <h4>✅ 导入完成</h4>
          <div className="stat-row">
            <span>总数: <strong>{result.total}</strong></span>
            <span>有效: <strong style={{ color: 'var(--color-success)' }}>{result.valid}</strong></span>
            <span>已过滤: <strong style={{ color: 'var(--color-warning)' }}>{result.filtered}</strong></span>
            <span>新增: <strong style={{ color: 'var(--color-primary)' }}>{result.inserted}</strong></span>
            <span>跳过(重复): <strong>{result.skipped}</strong></span>
          </div>
          {result.aiEnabled !== undefined && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {result.aiEnabled ? '✅ 已启用 AI 内容级分类' : '⚠️ 未配置 AI，使用关键词分类（请在 server/.env 填入 SILICONFLOW_API_KEY）'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
