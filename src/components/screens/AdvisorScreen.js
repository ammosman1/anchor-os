// src/components/screens/AdvisorScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI } from '../../lib/ai';
import { saveAdvisorChat, getAdvisorChat } from '../../lib/db';
import { Card, Button, Spinner } from '../ui';

const SESSION_KEY = new Date().toDateString().replace(/ /g, '-');

const SUGGESTED_PROMPTS = [
  "What's my highest leverage move today?",
  "Am I overcommitting right now?",
  "Where am I leaking energy?",
  "Which project needs attention most?",
  "What should I ignore this week?",
  "Talk me through my debt payoff strategy",
  "What patterns are hurting my progress?",
  "What would you cut from my plate right now?",
];

export default function AdvisorScreen() {
  const { user, profile } = useAuth();
  const { projects, tasks, debtAccounts, totalDebt } = useData();
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Load today's session
  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const session = await getAdvisorChat(user.uid, SESSION_KEY);
      if (session?.messages) setMessages(session.messages);
      setLoadingSession(false);
    };
    load();
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const buildContext = () => {
    const activeProjects  = projects.filter(p => p.status === 'active').map(p => `${p.title} (${p.momentum}% momentum)`);
    const stalledProjects = projects.filter(p => p.status === 'stalled').map(p => p.title);
    const pendingTasks    = tasks.filter(t => !t.done).slice(0, 6).map(t => `${t.title} [${t.priority}]`);

    return `
CURRENT SNAPSHOT (${new Date().toLocaleDateString()}):
- Energy today: ${profile?.energyToday || '?'}/10
- Active projects: ${activeProjects.join(', ') || 'none'}
- Stalled projects: ${stalledProjects.join(', ') || 'none'}
- Pending tasks: ${pendingTasks.join(', ') || 'none'}
- Total debt load: $${totalDebt.toLocaleString()}
- One-year goal: ${profile?.oneYearGoal || 'not set'}
- Biggest challenge: ${profile?.biggestChallenge || 'not set'}
    `.trim();
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg  = { role: 'user',      content: msg };
    const updated  = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);

    const context  = buildContext();
    const apiMsgs  = updated.map(m => ({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.content,
    }));

    const reply = await callAI({
      messages: apiMsgs,
      systemExtra: context,
      maxTokens: 400,
    });

    const aiMsg   = { role: 'ai', content: reply || "Let me think on that. Give me more context." };
    const final   = [...updated, aiMsg];
    setMessages(final);
    setLoading(false);

    // Persist session
    await saveAdvisorChat(user.uid, SESSION_KEY, final);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 72px)' }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '20px', flexShrink: 0 }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>AI Strategic Advisor</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
          Your Thinking Partner
        </h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>
          Brief, bright, gone. Context-aware. Pulls your full situation every message.
        </p>
      </div>

      {/* Suggested prompts */}
      {messages.length === 0 && !loadingSession && (
        <div className="fade-up stagger-1" style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '16px', flexShrink: 0 }}>
          {SUGGESTED_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => send(p)}
              style={{
                fontSize: '11px', color: tokens.textSecondary,
                background: tokens.bgCard, border: `1px solid ${tokens.border}`,
                borderRadius: '99px', padding: '5px 13px', cursor: 'pointer',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
              onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Chat window */}
      <div className="fade-in" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', paddingBottom: '16px' }}>
        {loadingSession ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '40px' }}>
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>✦</div>
            <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '8px' }}>
              Ready when you are.
            </div>
            <div style={{ fontSize: '13px', color: tokens.textMuted, lineHeight: 1.6 }}>
              Ask anything about your priorities, projects, or patterns.<br />
              Anchor knows your full situation.
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: '10px' }}>
              {m.role === 'ai' && (
                <div style={{ width: 30, height: 30, borderRadius: '8px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0, marginTop: '2px' }}>
                  ✦
                </div>
              )}
              <div style={{
                maxWidth: '80%',
                padding: '12px 16px',
                borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '3px 12px 12px 12px',
                background: m.role === 'user' ? tokens.accentDim : tokens.bgCard,
                border: `1px solid ${m.role === 'user' ? 'rgba(200,169,110,0.18)' : tokens.border}`,
                fontSize: '14px',
                color: tokens.textPrimary,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
              }}>
                {m.content}
              </div>
              {m.role === 'user' && (
                <div style={{ width: 30, height: 30, borderRadius: '8px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>
                  A
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 30, height: 30, borderRadius: '8px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>✦</div>
            <div style={{ padding: '12px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '3px 12px 12px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Spinner size={14} />
              <span style={{ fontSize: '13px', color: tokens.textMuted }}>Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ paddingTop: '12px', borderTop: `1px solid ${tokens.border}`, flexShrink: 0 }}>
        {messages.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {SUGGESTED_PROMPTS.slice(0, 4).map(p => (
              <button key={p} onClick={() => send(p)}
                style={{ fontSize: '10px', color: tokens.textMuted, background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.target.style.color = tokens.accent; e.target.style.borderColor = tokens.accent; }}
                onMouseLeave={e => { e.target.style.color = tokens.textMuted; e.target.style.borderColor = tokens.border; }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything about your priorities, projects, or patterns..."
            rows={1}
            style={{
              flex: 1,
              background: tokens.bgCard,
              border: `1px solid ${tokens.border}`,
              borderRadius: '10px',
              padding: '12px 16px',
              color: tokens.textPrimary,
              fontSize: '13px',
              resize: 'none',
              outline: 'none',
              fontFamily: fonts.body,
              lineHeight: 1.6,
              minHeight: '46px',
              maxHeight: '120px',
              overflow: 'auto',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              background: input.trim() && !loading ? tokens.accent : 'rgba(255,255,255,0.05)',
              color: input.trim() && !loading ? '#0C0E12' : tokens.textMuted,
              border: 'none', borderRadius: '10px',
              padding: '0 18px', fontSize: '18px',
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s', flexShrink: 0, minWidth: '48px',
            }}
          >
            →
          </button>
        </div>
        <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '6px', textAlign: 'center' }}>
          Enter to send · Shift+Enter for new line · Session saved automatically
        </div>
      </div>
    </div>
  );
}
