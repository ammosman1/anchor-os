// src/components/screens/BrainDumpScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI } from '../../lib/ai';
import { saveBrainDump, addTask, addProject } from '../../lib/db';
import { Card, Button, SectionLabel, Tag, AICard } from '../ui';

export default function BrainDumpScreen() {
  const { user } = useAuth();
  const { projects } = useData();
  const [text,        setText]        = useState('');
  const [processing,  setProcessing]  = useState(false);
  const [result,      setResult]      = useState(null);
  const [recording,   setRecording]   = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [tasksSent,   setTasksSent]   = useState([]);
  const [created,     setCreated]     = useState({ projects: [], tasks: [] });
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition          = new SpeechRecognition();
      recognition.continuous     = true;
      recognition.interimResults = true;
      recognition.lang           = 'en-US';
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
        setText(transcript);
      };
      recognition.onend = () => setRecording(false);
      recognitionRef.current = recognition;
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
      messages: [{
        role: 'user',
        content: `Process this brain dump. Existing projects: ${existingProjectNames || 'none'}.

Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence sharp summary",
  "mostUrgent": "single most important item or null",
  "categories": {
    "Work": [], "Money": [], "Family": [], "Health": [],
    "Home": [], "Ideas": [], "Emotional": [], "Later": []
  },
  "actionItems": ["item1", "item2"],
  "emotionalThemes": ["theme1"],
  "urgentFlags": ["item1"],
  "newProjects": [
    {
      "title": "Project name if user mentioned creating one",
      "category": "work|home|finance|health|creative|personal|business",
      "nextAction": "first action",
      "notes": "brief context"
    }
  ],
  "tasksToCreate": [
    {
      "title": "task title",
      "priority": "critical|high|medium|low",
      "projectName": "name of project this belongs to or null for Inbox"
    }
  ]
}

Only include newProjects if user explicitly mentioned starting/creating a project.
Only include tasksToCreate for clear actionable items.
BRAIN DUMP:
${text}`,
      }],
      maxTokens: 1000,
      systemExtra: 'Return ONLY valid JSON. No markdown fences.',
    });

    let parsed = null;
    try {
      const clean = (raw || '{}').replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        summary: 'Your thoughts have been captured and organized.',
        mostUrgent: null,
        categories: {},
        actionItems: [],
        emotionalThemes: [],
        urgentFlags: [],
        newProjects: [],
        tasksToCreate: [],
      };
    }

    // Auto-create projects from brain dump
    const createdProjects = [];
    if (parsed.newProjects?.length > 0) {
      for (const proj of parsed.newProjects) {
        if (!proj.title) continue;
        // Don't duplicate if project already exists
        const exists = projects.some(p => p.title.toLowerCase() === proj.title.toLowerCase());
        if (!exists) {
          const ref = await addProject(user.uid, {
            title:      proj.title,
            category:   proj.category || 'personal',
            status:     'active',
            momentum:   30,
            nextAction: proj.nextAction || '',
            notes:      proj.notes || 'Created from brain dump',
            blockers:   '',
            sentiment:  'new',
          });
          createdProjects.push({ ...proj, id: ref?.id });
        }
      }
    }

    // Auto-create tasks from brain dump
    const createdTasks = [];
    if (parsed.tasksToCreate?.length > 0) {
      // Combine existing + newly created projects for linking
      const allProjects = [...projects, ...createdProjects];
      for (const task of parsed.tasksToCreate) {
        if (!task.title) continue;
        const matchedProject = task.projectName
          ? allProjects.find(p => p.title.toLowerCase().includes(task.projectName.toLowerCase()))
          : null;
        await addTask(user.uid, {
          title:     task.title,
          priority:  task.priority || 'medium',
          project:   matchedProject?.title || 'Inbox',
          projectId: matchedProject?.id || null,
          source:    'brain-dump',
          energy:    'medium',
        });
        createdTasks.push(task.title);
      }
    }

    setCreated({ projects: createdProjects.map(p => p.title), tasks: createdTasks });
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

  const tips = ['What\'s stressing me', 'What I\'m avoiding', 'Tasks I need to do', 'New project ideas', 'Money worries', 'What\'s unresolved'];

  const categoryColors = {
    Work:      { bg: tokens.blueDim,   text: tokens.blue   },
    Money:     { bg: tokens.redDim,    text: tokens.red    },
    Family:    { bg: tokens.purpleDim, text: tokens.purple },
    Health:    { bg: tokens.greenDim,  text: tokens.green  },
    Home:      { bg: tokens.amberDim,  text: tokens.amber  },
    Ideas:     { bg: tokens.accentDim, text: tokens.accent },
    Emotional: { bg: tokens.purpleDim, text: tokens.purple },
    Later:     { bg: 'rgba(255,255,255,0.05)', text: tokens.textMuted },
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Brain Dump → AI Organization</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Dump it all here.</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Raw thoughts, worries, ideas, tasks, new projects — everything. AI will organize it.</p>
      </div>

      {!result ? (
        <div className="fade-up stagger-1">
          {/* Voice button */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <button onClick={toggleRecording}
              style={{ width: 68, height: 68, borderRadius: '50%', background: recording ? 'rgba(212,122,107,0.2)' : tokens.accentDim, border: `2px solid ${recording ? tokens.red : tokens.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: recording ? `0 0 24px rgba(212,122,107,0.3)` : `0 0 16px rgba(200,169,110,0.15)` }}
              className={recording ? 'pulsing' : ''}
            >
              {recording ? '⏹' : '🎤'}
            </button>
          </div>
          {recording && <p style={{ textAlign: 'center', fontSize: '12px', color: tokens.red, marginBottom: '12px' }} className="pulsing">Recording... speak freely</p>}

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Start typing anything — don't filter yourself.&#10;&#10;Mention creating a project? AI will create it automatically.&#10;Mention tasks? AI will create and link them.&#10;Worries, ideas, anything — dump it all."
            style={{ width: '100%', minHeight: '220px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '16px 18px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.75, resize: 'vertical', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', marginBottom: '14px' }}>
            {tips.map(tip => (
              <button key={tip} onClick={() => setText(t => t + (t.trim() ? '\n\n' : '') + tip + ': ')}
                style={{ fontSize: '11px', color: tokens.textSecondary, background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '4px 12px', cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
              >
                {tip}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={handleProcess} loading={processing} disabled={!text.trim() || processing} size="lg">
              ✦ Organize with AI
            </Button>
            {text.length > 0 && <span style={{ fontSize: '12px', color: tokens.textMuted }}>{text.length} chars</span>}
          </div>
        </div>
      ) : (
        <div className="fade-in">
          {/* AI Summary */}
          <div style={{ marginBottom: '14px' }}>
            <AICard text={result.summary} label="ANCHOR SUMMARY" />
          </div>

          {/* Auto-created items callout */}
          {(created.projects.length > 0 || created.tasks.length > 0) && (
            <div style={{ marginBottom: '14px', padding: '14px 16px', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.2)`, borderRadius: '12px' }}>
              <div style={{ fontSize: '11px', color: tokens.green, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>✓ AUTOMATICALLY CREATED</div>
              {created.projects.length > 0 && (
                <div style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '4px' }}>
                  <span style={{ color: tokens.green }}>Projects: </span>{created.projects.join(', ')}
                </div>
              )}
              {created.tasks.length > 0 && (
                <div style={{ fontSize: '13px', color: tokens.textPrimary }}>
                  <span style={{ color: tokens.green }}>Tasks: </span>{created.tasks.join(', ')}
                </div>
              )}
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>These are now live in Projects and Tasks.</div>
            </div>
          )}

          {/* Most Urgent */}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {result.actionItems.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
                        <span style={{ color: tokens.accent, flexShrink: 0 }}>→</span>
                        <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{item}</span>
                      </div>
                      {!tasksSent.includes(item) ? (
                        <button onClick={() => sendTaskToInbox(item)} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body }}>+ Task</button>
                      ) : (
                        <span style={{ fontSize: '10px', color: tokens.green }}>✓</span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {result.emotionalThemes?.length > 0 && (
              <Card>
                <SectionLabel>Emotional Themes</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {result.emotionalThemes.map((t, i) => <Tag key={i} label={t} color={tokens.purpleDim} textColor={tokens.purple} />)}
                </div>
                {result.urgentFlags?.length > 0 && (
                  <>
                    <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>URGENT</div>
                    {result.urgentFlags.map((f, i) => <div key={i} style={{ fontSize: '12px', color: tokens.red, marginBottom: '4px' }}>⚑ {f}</div>)}
                  </>
                )}
              </Card>
            )}
          </div>

          {/* Categories */}
          {Object.entries(result.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).length > 0 && (
            <Card style={{ marginBottom: '14px' }}>
              <SectionLabel>Categorized Thoughts</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                {Object.entries(result.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([cat, items]) => {
                  const colors = categoryColors[cat] || { bg: tokens.bgGlass, text: tokens.textSecondary };
                  return (
                    <div key={cat} style={{ padding: '12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: colors.text, letterSpacing: '0.08em', marginBottom: '8px' }}>{cat.toUpperCase()}</div>
                      {items.map((item, i) => <div key={i} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '4px' }}>· {item}</div>)}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={reset} variant="ghost">← New Dump</Button>
            {saved && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved to history</span>}
          </div>
        </div>
      )}
    </div>
  );
}