const API_BASE = '/api';

async function request(url, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  const res = await fetch(`${API_BASE}${url}`, config);
  const text = await res.text();

  // 空响应：后端未启动 / 进程崩溃 / 代理被截断
  if (!text) {
    throw new Error(`后端无响应（HTTP ${res.status}）- 请确认后端服务已启动（端口 3001）`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`后端返回非 JSON 数据（HTTP ${res.status}），可能正在重启或已崩溃`);
  }

  if (!data.success) {
    throw new Error(data.error || '请求失败');
  }

  return data.data;
}

/**
 * 通用 SSE 流式请求：POST url + body，逐事件回调 onEvent，返回最后一条事件
 * 供蒸馏进度 / 问答助手流式输出复用
 */
async function streamSSE(url, body, onEvent) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留半行等下次拼接
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const ev = JSON.parse(line.slice(6));
          last = ev;
          if (onEvent) onEvent(ev);
        } catch { /* 忽略解析失败的行 */ }
      }
    }
  }
  return last;
}

// ========== 采集 API ==========
export const collectApi = {
  importItems: (platform, items) =>
    request('/collect/import', {
      method: 'POST',
      body: JSON.stringify({ platform, items }),
    }),

  importFile: (platform, file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('platform', platform);
    return fetch(`${API_BASE}/collect/import/file`, {
      method: 'POST',
      body: formData,
    }).then((r) => r.json()).then((d) => {
      if (!d.success) throw new Error(d.error);
      return d.data;
    });
  },

  pullBilibili: (cookie, media_id) =>
    request('/collect/bilibili', {
      method: 'POST',
      body: JSON.stringify({ cookie, media_id }),
    }),
};

// ========== 知识库 API ==========
export const knowledgeApi = {
  getEntries: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/knowledge/entries?${qs}`);
  },

  getEntry: (id) => request(`/knowledge/entries/${id}`),

  getRelated: (id) => request(`/knowledge/entries/${id}/related`),

  updateEntry: (id, data) =>
    request(`/knowledge/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteEntry: (id) =>
    request(`/knowledge/entries/${id}`, { method: 'DELETE' }),

  reextract: (id) =>
    request(`/knowledge/entries/${id}/reextract`, { method: 'POST' }),

  batchOperation: (ids, action) =>
    request('/knowledge/entries/batch', {
      method: 'POST',
      body: JSON.stringify({ ids, action }),
    }),

  getStats: () => request('/knowledge/stats'),

  getFiltered: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/knowledge/filtered?${qs}`);
  },
};

// ========== 分类 API ==========
export const categoryApi = {
  getTree: () => request('/categories/tree'),

  getRules: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/categories/rules?${qs}`);
  },

  addRule: (data) =>
    request('/categories/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateRule: (id, data) =>
    request(`/categories/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteRule: (id) =>
    request(`/categories/rules/${id}`, { method: 'DELETE' }),
};

// ========== 知识库文件系统 API ==========
export const wikiApi = {
  getTree: () => request('/wiki/tree'),

  getFile: (filePath) => request(`/wiki/file?path=${encodeURIComponent(filePath)}`),

  createFile: (filePath, content) =>
    request('/wiki/file', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content }),
    }),

  saveFile: (filePath, content) =>
    request(`/wiki/file?path=${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  deleteFile: (filePath) =>
    request(`/wiki/file?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    }),

  regenerate: () => request('/wiki/regenerate', { method: 'POST' }),

  reextractAll: (onlyEmpty = true) =>
    request(`/wiki/reextract-all?onlyEmpty=${onlyEmpty ? 'true' : 'false'}`, { method: 'POST' }),

  // 蒸馏：SSE 流式进度，onEvent 收 {type:'progress'|'done'|'error', ...}
  distill: (onEvent) => streamSSE('/wiki/distill', {}, onEvent),
};

// ========== 问答助手 API ==========
export const qaApi = {
  // SSE 流式问答，onEvent 收 {type:'status'|'citations'|'delta'|'done'|'error', ...}
  ask: (question, history, onEvent) => streamSSE('/qa/ask', { question, history }, onEvent),
};
