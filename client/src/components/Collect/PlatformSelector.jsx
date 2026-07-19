import { useState } from 'react';
import { collectApi } from '../../api';

const PLATFORMS = [
  { key: 'bilibili', label: 'B站', icon: '📺' },
  { key: 'douyin', label: '抖音', icon: '🎵' },
  { key: 'xiaohongshu', label: '小红书', icon: '📕' },
  { key: 'wechat', label: '微信公众号', icon: '💬' },
];

export default function PlatformSelector({ onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {PLATFORMS.map((p) => (
        <button
          key={p.key}
          className="btn btn-secondary"
          onClick={() => onSelect(p.key)}
        >
          {p.icon} {p.label}
        </button>
      ))}
    </div>
  );
}
