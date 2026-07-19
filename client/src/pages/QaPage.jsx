import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { qaApi } from '../api';

const HISTORY_TURNS = 4; // 与后端一致：传最近 4 轮

export default function QaPage({ onOpenWikiPage }) {
  const [messages, setMessages] = useState([]); // {role, content, citations?, status?, error?}
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg = { role: 'user', content: question };
    const assistantMsg = { role: 'assistant', content: '', status: '正在检索知识库...', citations: [] };
    // 用函数式更新避免闭包旧值
    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // 构造 history（最近 4 轮 = 8 条，不含本次提问）
    const history = messages
      .filter((m) => !m.error)
      .slice(-HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content }));

    const assistantIdx = newMessages.length - 1;
    const updateAssistant = (patch) => {
      setMessages((prev) => {
        const next = [...prev];
        next[assistantIdx] = { ...next[assistantIdx], ...patch };
        return next;
      });
    };

    try {
      await qaApi.ask(question, history, (ev) => {
        if (ev.type === 'status') {
          updateAssistant({ status: ev.message });
        } else if (ev.type === 'citations') {
          updateAssistant({ citations: ev.items || [] });
        } else if (ev.type === 'delta') {
          // delta 到达：清空 status，追加正文
          setMessages((prev) => {
            const next = [...prev];
            next[assistantIdx] = {
              ...next[assistantIdx],
              status: '',
              content: next[assistantIdx].content + ev.text,
            };
            return next;
          });
        } else if (ev.type === 'error') {
          updateAssistant({ status: '', error: ev.message, content: '' });
        }
      });
    } catch (err) {
      updateAssistant({ status: '', error: err.message });
    } finally {
      setLoading(false);
      updateAssistant({ status: '' });
      inputRef.current?.focus();
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleOpenCitation = (cite) => {
    if (cite.path && onOpenWikiPage) {
      onOpenWikiPage(cite.path);
    }
  };

  return (
    <div className="qa-page">
      <div className="qa-header">
        <h3>💬 问答助手</h3>
        <p>基于知识库 wiki 蒸馏层回答你的问题。答案标注引用来源，可点击查看原文。</p>
      </div>

      <div className="qa-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="qa-empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
            <p>问我任何关于知识库内容的问题</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
              例如：LangChain 能做什么？RAG 和多智能体工作流有什么关系？
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`qa-msg qa-msg-${msg.role}`}>
            <div className="qa-msg-avatar">{msg.role === 'user' ? '🧑' : '🤖'}</div>
            <div className="qa-msg-body">
              {msg.role === 'assistant' && msg.status && !msg.content && (
                <div className="qa-status">
                  <span className="qa-spinner" /> {msg.status}
                </div>
              )}
              {msg.error ? (
                <div className="qa-error">⚠️ {msg.error}</div>
              ) : (
                msg.content && (
                  <div className="qa-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )
              )}
              {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                <div className="qa-citations">
                  <div className="qa-citations-title">📚 引用来源</div>
                  {msg.citations.map((c) => (
                    <div key={c.index} className="qa-citation">
                      <span className="qa-cite-index">[{c.index}]</span>
                      <span
                        className="qa-cite-title"
                        title={c.path ? `打开 ${c.path}` : '无对应文件'}
                        onClick={() => handleOpenCitation(c)}
                        style={{ cursor: c.path ? 'pointer' : 'default' }}
                      >
                        {c.title}
                      </span>
                      <span className="qa-cite-type">{c.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="qa-input-area">
        <textarea
          ref={inputRef}
          className="qa-input"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button className="btn btn-primary qa-send" onClick={send} disabled={loading || !input.trim()}>
          {loading ? '回答中...' : '发送'}
        </button>
      </div>
    </div>
  );
}
