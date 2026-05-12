// src/components/screens/BrainDumpScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI } from '../../lib/ai';
import { saveBrainDump, addTask, addProject } from '../../lib/db';
import { Card, Button, SectionLabel, Tag, AICard } from '../ui';

function HistoryTab({ brainDumps }) {
  const [expanded, setExpanded] = useState(null);

  if (brainDumps.length === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>◎</div>
      <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '6px' }}>No brain dumps yet</div>
      <div style={{ fontSize: '13px', color: tokens.textMuted }}>Do your first brain dump and it will appear here.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {brainDumps.map(dump => {
        const isExpanded = expanded === dump.id;
        const date       = dump.createdAt?.toDate?.() || new Date();
        const dateStr    = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const summary    = dump.result?.summary || dump.result?.mostUrgent || 'Brain dump captured';
        const actionCount = dump.result?.actionItems?.length || 0;
        const categories  = Object.entries(dump.result?.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([k]) => k);

        return (
          <div key={dump.id}
            onClick={() => setExpanded(isExpanded ? null : dump.id)}
            style={{ background: isExpanded ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExpanded ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, paddingRight: '10px' }}>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '4px' }}>{dateStr}</div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.5 }}>{summary}</div>
                {categories.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {categories.slice(0, 4).map(cat => (
                      <span key={cat} style={{ fontSize: '10px', color: tokens.textMuted, background: 'rgba(255,255,255,0.06)', padding: '1px 7px', borderRadius: '4px' }}>{cat}</span>
                    ))}
                    {actionCount > 0 && <span style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, padding: '1px 7px', borderRadius: '4px' }}>{actionCount} actions</span>}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '12px', color: tokens.textMuted, flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}` }}>
                {/* Raw text */}
                {dump.rawText && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>RAW DUMP</div>
                    <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: tokens.bgGlass, padding: '10px 12px', borderRadius: '8px' }}>{dump.rawText}</div>
                  </div>
                )}

                {/* Action items */}
                {dump.result?.actionItems?.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>ACTION ITEMS</div>
                    {dump.result.actionItems.map((item, i) => (
                      <div key={i} style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '4px', display: 'flex', gap: '6px' }}>
                        <span style={{ color: tokens.accent }}>→</span>{item}
                      </div>
                    ))}
                  </div>
                )}

                {/* Categories */}
                {Object.entries(dump.result?.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>CATEGORIZED</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                      {Object.entries(dump.result.categories).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([cat, items]) => (
                        <div key={cat} style={{ padding: '10px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, marginBottom: '6px' }}>{cat.toUpperCase()}</div>
                          {items.map((item, i) => <div key={i} style={{ fontSize: '11px', color: tokens.textSecondary, marginBottom: '3px' }}>· {item}</div>)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function BrainDumpScreen() {
  const { user }     = useAuth();
  const { projects, brainDumps } = useData();
  const [activeTab,   setActiveTab]   = useState('dump');
  const [text,        setText]        = useState('');
  const [processing,  setProcessing]  = useState(false);
  const [result,      setResult]      = useState(null);
  const [recording,   setRecording]   = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [tasksSent,   setTasksSent]   = useState([]);
  const [created,     setCreated]     = useState({ projects: [], tasks: [] });
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r          = new SR();
      r.continuous     = true;
      r.interimResults = true;
      r.lang           = 'en-US';
      r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setText(t); };
      r.onend = () => setRecording(false);
      recognitionRef.current = r;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) { alert('Voice input not supported. Try Chrome.'); return; }
    if (recording) { recognitionRef.current.stop(); setRecording(false); }
    else           { setText(''); recognitionRef.current.start(); setRecording(true); }
  };

  const handleProcess = async () => {
    if (!text.trim()) return;
    setProcessing(true);
    setResult(null);

    const existingProjectNames = projects.map(p => p.title).join(', ');
    const raw = await callAI({
      messages: [{ role: 'user', content: `Process this brain dump. Existing projects: ${existingProjectNames || 'none'}.
Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence sharp summary",
  "mostUrgent": "single most important item or null",
  "categories": { "Work": [], "Money": [], "Family": [], "Health": [], "Home": [], "Ideas": [], "Emotional": [], "Later": [] },
  "actionItems": ["item1"],
  "emotionalThemes": ["theme1"],
  "urgentFlags": ["item1"],
  "newProjects": [{"title":"name","category":"work|home|finance|health|creative|personal|business","nextAction":"first action","notes":"brief context"}],
  "tasksToCreate": [{"title":"task","priority":"critical|high|medium|low","projectName":"project name or null"}]
}
Only include newProjects if user explicitly mentioned creating one. Only tasksToCreate for clear actionable items.
BRAIN DUMP:\n${text}` }],
      maxTokens: 1000,
      systemExtra: 'Return ONLY valid JSON. No markdown fences.',
    });

    let parsed = null;
    try { const clean = (raw || '{}').replace(/```json|```/g, '').trim(); parsed = JSON.parse(clean); }
    catch { parsed = { summary: 'Your thoughts have been captured.', mostUrgent: null, categories: {}, actionItems: [], emotionalThemes: [], urgentFlags: [], newProjects: [], tasksToCreate: [] }; }

    // Auto-create projects
    const createdProjects = [];
    if (parsed.newProjects?.length > 0) {
      for (const proj of parsed.newProjects) {
        if (!proj.title) continue;
        const exists = projects.some(p => p.title.toLowerCase() === proj.title.toLowerCase());
        if (!exists) {
          const ref = await addProject(user.uid, { title: proj.title, category: proj.category || 'personal', status: 'active', momentum: 30, nextAction: proj.nextAction || '', notes: proj.notes || 'Created from brain dump', blockers: '', sentiment: 'new' });
          createdProjects.push({ ...proj, id: ref?.id });
        }
      }
    }

    // Auto-create tasks
    const createdTaskTitles = [];
    if (parsed.tasksToCreate?.length > 0) {
      const allProjects = [...projects, ...createdProjects];
      for (const task of parsed.tasksToCreate) {
        if (!task.title) continue;
        const matched = task.projectName ? allProjects.find(p => p.title.toLowerCase().includes(task.projectName.toLowerCase())) : null;
        await addTask(user.uid, { title: task.title, priority: task.priority || 'medium', project: matched?.title || 'Inbox', projectId: matched?.id || null, source: 'brain-dump', energy: 'medium' });
        createdTaskTitles.push(task.title);
      }
    }

    setCreated({ projects: createdProjects.map(p => p.title), tasks: createdTaskTitles });
    setResult(parsed);
    await saveBrainDump(user.uid, { rawText: text, result: parsed });
    setSaved(true);
    setProcessing(false);
  };

  const sendTaskToInbox = async (taskText) => {
    await addTask(user.uid, { title: taskText, priority: 'medium', project: 'Inbox', energy: 'medium', source: 'brain-dump' });
    setTasksSent(prev => [...prev, taskText]);
  };

  const reset = () => { setText(''); setResult(null); setSaved(false); setTasksSent([]); setCreated({ projects: [], tasks: [] }); };

  const tips  = ['What\'s stressing me', 'What I\'m avoiding', 'Tasks I need to do', 'New project ideas', 'Money worries', 'What\'s unresolved'];
  const catColors = { Work: { bg: tokens.blueDim, text: tokens.blue }, Money: { bg: tokens.redDim, text: tokens.red }, Family: { bg: tokens.purpleDim, text: tokens.purple }, Health: { bg: tokens.greenDim, text: tokens.green }, Home: { bg: tokens.amberDim, text: tokens.amber }, Ideas: { bg: tokens.accentDim, text: tokens.accent }, Emotional: { bg: tokens.purpleDim, text: tokens.purple }, Later: { bg: 'rgba(255,255,255,0.05)', text: tokens.textMuted } };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Brain Dump → AI Organization</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Brain Dump</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>Raw thoughts, worries, ideas, tasks — everything. AI will organize it.</p>
      </div>

      {/* Tabs */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', marginBottom: '20px', background: tokens.bgCard, padding: '6px', borderRadius: '10px', border: `1px solid ${tokens.border}` }}>
        {[{ id: 'dump', label: '◎ New Dump' }, { id: 'history', label: `📋 History (${brainDumps.length})` }].map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === 'dump') reset(); }}
            style={{ flex: 1, padding: '9px', borderRadius: '7px', border: 'none', background: activeTab === tab.id ? tokens.accentDim : 'transparent', color: activeTab === tab.id ? tokens.accent : tokens.textSecondary, fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'history' ? (
        <HistoryTab brainDumps={brainDumps} />
      ) : !result ? (
        <div className="fade-up stagger-2">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
            <button onClick={toggleRecording}
              style={{ width: 64, height: 64, borderRadius: '50%', background: recording ? 'rgba(212,122,107,0.2)' : tokens.accentDim, border: `2px solid ${recording ? tokens.red : tokens.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: recording ? `0 0 24px rgba(212,122,107,0.3)` : `0 0 16px rgba(200,169,110,0.15)` }}
              className={recording ? 'pulsing' : ''}
            >{recording ? '⏹' : '🎤'}</button>
          </div>
          {recording && <p style={{ textAlign: 'center', fontSize: '12px', color: tokens.red, marginBottom: '12px' }} className="pulsing">Recording... speak freely</p>}

          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Start typing anything — don't filter yourself.&#10;&#10;Mention creating a project? AI creates it automatically.&#10;Mention tasks? AI creates and links them.&#10;Worries, ideas, anything — dump it all."
            style={{ width: '100%', minHeight: '200px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '16px 18px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.75, resize: 'vertical', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', marginBottom: '14px' }}>
            {tips.map(tip => (
              <button key={tip} onClick={() => setText(t => t + (t.trim() ? '\n\n' : '') + tip + ': ')}
                style={{ fontSize: '11px', color: tokens.textSecondary, background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '4px 12px', cursor: 'pointer', fontFamily: fonts.body }}
                onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
              >{tip}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={handleProcess} loading={processing} disabled={!text.trim() || processing} size="lg">✦ Organize with AI</Button>
            {text.length > 0 && <span style={{ fontSize: '12px', color: tokens.textMuted }}>{text.length} chars</span>}
          </div>
        </div>
      ) : (
        <div className="fade-in">
          <div style={{ marginBottom: '14px' }}><AICard text={result.summary} label="ANCHOR SUMMARY" /></div>

          {(created.projects.length > 0 || created.tasks.length > 0) && (
            <div style={{ marginBottom: '14px', padding: '14px 16px', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.2)`, borderRadius: '12px' }}>
              <div style={{ fontSize: '11px', color: tokens.green, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>✓ AUTOMATICALLY CREATED</div>
              {created.projects.length > 0 && <div style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '4px' }}><span style={{ color: tokens.green }}>Projects: </span>{created.projects.join(', ')}</div>}
              {created.tasks.length > 0 && <div style={{ fontSize: '13px', color: tokens.textPrimary }}><span style={{ color: tokens.green }}>Tasks: </span>{created.tasks.join(', ')}</div>}
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>Now live in Projects and Tasks screens.</div>
            </div>
          )}

          {result.mostUrgent && (
            <Card accent style={{ marginBottom: '14px' }}>
              <SectionLabel>Most Urgent</SectionLabel>
              <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary }}>{result.mostUrgent}</div>
            </Card>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            {result.actionItems?.length > 0 && (
              <Card>
                <SectionLabel>Action Items</SectionLabel>
                {result.actionItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', flex: 1 }}><span style={{ color: tokens.accent, flexShrink: 0 }}>→</span><span style={{ fontSize: '13px', color: tokens.textPrimary }}>{item}</span></div>
                    {!tasksSent.includes(item)
                      ? <button onClick={() => sendTaskToInbox(item)} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body }}>+ Task</button>
                      : <span style={{ fontSize: '10px', color: tokens.green }}>✓</span>
                    }
                  </div>
                ))}
              </Card>
            )}
            {result.emotionalThemes?.length > 0 && (
              <Card>
                <SectionLabel>Emotional Themes</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {result.emotionalThemes.map((t, i) => <Tag key={i} label={t} color={tokens.purpleDim} textColor={tokens.purple} />)}
                </div>
                {result.urgentFlags?.length > 0 && (<>
                  <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>URGENT</div>
                  {result.urgentFlags.map((f, i) => <div key={i} style={{ fontSize: '12px', color: tokens.red, marginBottom: '4px' }}>⚑ {f}</div>)}
                </>)}
              </Card>
            )}
          </div>

          {Object.entries(result.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).length > 0 && (
            <Card style={{ marginBottom: '14px' }}>
              <SectionLabel>Categorized Thoughts</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                {Object.entries(result.categories).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([cat, items]) => {
                  const c = catColors[cat] || { bg: tokens.bgGlass, text: tokens.textSecondary };
                  return (
                    <div key={cat} style={{ padding: '12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: c.text, letterSpacing: '0.08em', marginBottom: '8px' }}>{cat.toUpperCase()}</div>
                      {items.map((item, i) => <div key={i} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '4px' }}>· {item}</div>)}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={reset} variant="ghost">← New Dump</Button>
            <Button onClick={() => setActiveTab('history')} variant="accent" size="sm">View History →</Button>
            {saved && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}
