// src/components/screens/AdvisorScreen.js
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI } from '../../lib/ai';
import { calculateMomentum } from '../../lib/momentum';
import { saveAdvisorChat, getAdvisorChat, addTask, addProject } from '../../lib/db';
import { Spinner } from '../ui';

const SESSION_KEY = new Date().toDateString().replace(/ /g, '-');

const SUGGESTED_PROMPTS = [
  "What's my highest leverage move today?",
  "Am I overcommitting right now?",
  "Where am I leaking energy?",
  "Which project needs attention most?",
  "What should I ignore this week?",
  "Talk me through my debt payoff strategy",
  "What patterns are hurting my progress?",
  "Create a project for my home gym build",
];

// Parse AI response for action commands
function parseActions(text) {
  const actions = [];

  // Detect CREATE_PROJECT: {"action":"create_project","title":"...","category":"...","nextAction":"..."}
  const projectMatches = text.matchAll(/CREATE_PROJECT:\s*({[^}]+})/g);
  for (const match of projectMatches) {
    try { actions.push({ type: 'create_project', ...JSON.parse(match[1]) }); } catch {}
  }

  // Detect CREATE_TASK: {"action":"create_task","title":"...","priority":"...","project":"..."}
  const taskMatches = text.matchAll(/CREATE_TASK:\s*({[^}]+})/g);
  for (const match of taskMatches) {
    try { actions.push({ type: 'create_task', ...JSON.parse(match[1]) }); } catch {}
  }

  // Clean the display text — remove the action JSON from what we show
  const cleanText = text
    .replace(/CREATE_PROJECT:\s*{[^}]+}/g, '')
    .replace(/CREATE_TASK:\s*{[^}]+}/g, '')
    .trim();

  return { cleanText, actions };
}

export default function AdvisorScreen() {
  const { user, profile }                      = useAuth();
  const { projects, tasks, totalDebt, goals } = useData();
  const [messages,       setMessages]          = useState([]);
  const [input,          setInput]             = useState('');
  const [loading,        setLoading]           = useState(false);
  const [loadingSession, setLoadingSession]    = useState(true);
  const [pendingActions, setPendingActions]    = useState([]);
  const [executedActions, setExecutedActions] = useState([]);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Pattern-based proactive insights
  const proactiveInsights = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const insights = [];

    const overdue = tasks.filter(t => !t.done && t.scheduledDate && t.scheduledDate < today);
    if (overdue.length >= 3) {
      insights.push({
        label: `${overdue.length} tasks overdue`,
        prompt: `I have ${overdue.length} overdue tasks including "${overdue[0].title}". Am I overcommitting or avoiding?`,
      });
    }

    const stalled = projects.filter(p => p.status === 'stalled');
    if (stalled.length > 0) {
      insights.push({
        label: `${stalled.length > 1 ? `${stalled.length} projects` : stalled[0].title} stalled`,
        prompt: `My "${stalled[0].title}" project is stalled. What's the right move — push, pause, or kill it?`,
      });
    }

    const critical = tasks.filter(t => !t.done && t.priority === 'critical');
    if (critical.length > 0) {
      insights.push({
        label: `${critical.length} critical task${critical.length > 1 ? 's' : ''} pending`,
        prompt: `I have ${critical.length} critical task${critical.length > 1 ? 's' : ''} pending: "${critical[0].title}". Help me unblock this.`,
      });
    }

    const inbox = tasks.filter(t => !t.done && (!t.projectId || t.project === 'Inbox'));
    if (inbox.length >= 10) {
      insights.push({
        label: `${inbox.length} tasks in inbox`,
        prompt: `My inbox has ${inbox.length} unorganized tasks. How should I process this backlog?`,
      });
    }

    if ((goals || []).filter(g => g.status === 'active').length === 0 && projects.length > 2) {
      insights.push({
        label: 'No active goals set',
        prompt: "I have projects but no goals defined. Help me identify what I'm actually working toward.",
      });
    }

    return insights.slice(0, 3);
  }, [tasks, projects, goals]);

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
    const activeProjects  = projects.filter(p => p.status === 'active').map(p => {
      const pts = tasks.filter(t => t.projectId === p.id);
      const { score } = calculateMomentum(p, pts);
      return `${p.title} (${score}% momentum)`;
    });
    const stalledProjects = projects.filter(p => p.status === 'stalled').map(p => p.title);
    const pendingTasks    = tasks.filter(t => !t.done).slice(0, 8).map(t => `${t.title} [${t.priority}]`);

    return `
CURRENT SNAPSHOT (${new Date().toLocaleDateString()}):
- Energy today: ${profile?.energyToday || '?'}/10
- Active projects: ${activeProjects.join(', ') || 'none'}
- Stalled projects: ${stalledProjects.join(', ') || 'none'}
- Pending tasks: ${pendingTasks.join(', ') || 'none'}
- Total debt: $${totalDebt.toLocaleString()}
- One-year goal: ${profile?.oneYearGoal || 'not set'}
- Biggest challenge: ${profile?.biggestChallenge || 'not set'}

CAPABILITIES: You can create projects and tasks directly. When Andrew asks you to create something, include these markers in your response (they will be processed automatically and NOT shown to the user):
CREATE_PROJECT: {"title":"Project Name","category":"work|home|finance|health|creative|personal|business","nextAction":"first step","notes":"brief context"}
CREATE_TASK: {"title":"Task name","priority":"critical|high|medium|low","project":"Project name or Inbox"}

You can include multiple CREATE_TASK markers. Always confirm what you created in plain language.
    `.trim();
  };

  const executeActions = async (actions) => {
    const results = [];
    for (const action of actions) {
      try {
        if (action.type === 'create_project') {
          const exists = projects.some(p => p.title.toLowerCase() === action.title?.toLowerCase());
          if (!exists && action.title) {
            await addProject(user.uid, {
              title:      action.title,
              category:   action.category || 'personal',
              status:     'active',
              momentum:   30,
              nextAction: action.nextAction || '',
              notes:      action.notes || 'Created by Anchor advisor',
              blockers:   '',
              sentiment:  'new',
            });
            results.push(`✓ Project created: "${action.title}"`);
          }
        }
        if (action.type === 'create_task') {
          const linkedProject = projects.find(p => p.title.toLowerCase() === action.project?.toLowerCase());
          await addTask(user.uid, {
            title:     action.title,
            priority:  action.priority || 'medium',
            project:   linkedProject?.title || action.project || 'Inbox',
            projectId: linkedProject?.id || null,
            source:    'advisor',
          });
          results.push(`✓ Task created: "${action.title}"`);
        }
      } catch (err) {
        console.error('Action execution error:', err);
      }
    }
    return results;
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    setPendingActions([]);

    const userMsg = { role: 'user', content: msg };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);

    const context = buildContext();
    const apiMsgs = updated.map(m => ({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.content,
    }));

    const rawReply = await callAI({
      messages:    apiMsgs,
      systemExtra: context,
      maxTokens:   500,
    });

    const { cleanText, actions } = parseActions(rawReply || "Let me think on that.");

    // Execute any actions
    let actionResults = [];
    if (actions.length > 0) {
      actionResults = await executeActions(actions);
      setExecutedActions(prev => [...prev, ...actionResults]);
    }

    const aiMsg = { role: 'ai', content: cleanText, actionResults };
    const final = [...updated, aiMsg];
    setMessages(final);
    setLoading(false);

    await saveAdvisorChat(user.uid, SESSION_KEY, final);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 72px)' }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '16px', flexShrink: 0 }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>AI Strategic Advisor</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Thinking Partner</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '12px', marginTop: '4px' }}>
          Context-aware · Can create projects and tasks · Session saved automatically
        </p>
      </div>

      {/* Proactive pattern insights */}
      {proactiveInsights.length > 0 && messages.length === 0 && !loadingSession && (
        <div className="fade-up stagger-1" style={{ marginBottom: '14px', flexShrink: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
            ✦ Pattern Detected
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {proactiveInsights.map((insight, i) => (
              <button key={i} onClick={() => send(insight.prompt)}
                style={{
                  fontSize: '11px', color: tokens.accent,
                  background: tokens.accentDim,
                  border: `1px solid rgba(200,169,110,0.25)`,
                  borderRadius: '99px', padding: '5px 14px',
                  cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(200,169,110,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = tokens.accentDim; }}
              >
                ⚑ {insight.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested prompts */}
      {messages.length === 0 && !loadingSession && (
        <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px', flexShrink: 0 }}>
          {SUGGESTED_PROMPTS.map(p => (
            <button key={p} onClick={() => send(p)}
              style={{ fontSize: '11px', color: tokens.textSecondary, background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '5px 12px', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: fonts.body }}
              onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
              onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Chat */}
      <div className="fade-in" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '16px' }}>
        {loadingSession ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '40px' }}><Spinner /></div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>✦</div>
            <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '6px' }}>Ready when you are.</div>
            <div style={{ fontSize: '13px', color: tokens.textMuted, lineHeight: 1.6 }}>Ask anything. I can also create projects and tasks directly from this chat.</div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: '10px' }}>
                {m.role === 'ai' && (
                  <div style={{ width: 28, height: 28, borderRadius: '8px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0, marginTop: '2px' }}>✦</div>
                )}
                <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '3px 12px 12px 12px', background: m.role === 'user' ? tokens.accentDim : tokens.bgCard, border: `1px solid ${m.role === 'user' ? 'rgba(200,169,110,0.18)' : tokens.border}`, fontSize: '14px', color: tokens.textPrimary, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {m.content}
                </div>
                {m.role === 'user' && (
                  <div style={{ width: 28, height: 28, borderRadius: '8px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>A</div>
                )}
              </div>

              {/* Show created items */}
              {m.role === 'ai' && m.actionResults?.length > 0 && (
                <div style={{ marginLeft: '38px', marginTop: '6px', padding: '10px 14px', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.2)`, borderRadius: '8px' }}>
                  {m.actionResults.map((r, j) => (
                    <div key={j} style={{ fontSize: '12px', color: tokens.green, marginBottom: j < m.actionResults.length - 1 ? '4px' : 0 }}>{r}</div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 28, height: 28, borderRadius: '8px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>✦</div>
            <div style={{ padding: '12px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '3px 12px 12px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Spinner size={14} />
              <span style={{ fontSize: '13px', color: tokens.textMuted }}>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Prompt chips when mid-conversation */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px', flexShrink: 0 }}>
          {SUGGESTED_PROMPTS.slice(0, 3).map(p => (
            <button key={p} onClick={() => send(p)}
              style={{ fontSize: '10px', color: tokens.textMuted, background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: fonts.body }}
              onMouseEnter={e => { e.target.style.color = tokens.accent; e.target.style.borderColor = tokens.accent; }}
              onMouseLeave={e => { e.target.style.color = tokens.textMuted; e.target.style.borderColor = tokens.border; }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ paddingTop: '10px', borderTop: `1px solid ${tokens.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder="Ask anything, or say 'create a project for...' or 'add a task to...'"
            rows={1}
            style={{ flex: 1, background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px', padding: '12px 16px', color: tokens.textPrimary, fontSize: '13px', resize: 'none', outline: 'none', fontFamily: fonts.body, lineHeight: 1.6, minHeight: '46px', maxHeight: '120px', overflow: 'auto', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading}
            style={{ background: input.trim() && !loading ? tokens.accent : 'rgba(255,255,255,0.05)', color: input.trim() && !loading ? '#0C0E12' : tokens.textMuted, border: 'none', borderRadius: '10px', padding: '0 18px', fontSize: '18px', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', transition: 'all 0.15s', flexShrink: 0, minWidth: '48px' }}>
            →
          </button>
        </div>
      </div>
    </div>
  );
}
