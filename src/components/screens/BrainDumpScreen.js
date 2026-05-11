// src/components/screens/BrainDumpScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { processBrainDump } from '../../lib/ai';
import { saveBrainDump, addTask } from '../../lib/db';
import { Card, Button, SectionLabel, Tag, AICard, EmptyState } from '../ui';

export default function BrainDumpScreen() {
  const { user } = useAuth();
  const [text,         setText]         = useState('');
  const [processing,   setProcessing]   = useState(false);
  const [result,       setResult]       = useState(null);
  const [recording,    setRecording]    = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [tasksSent,    setTasksSent]    = useState([]);
  const recognitionRef = useRef(null);
  const textareaRef    = useRef(null);

  // Voice setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous    = true;
      recognition.interimResults = true;
      recognition.lang          = 'en-US';

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setText(transcript);
      };

      recognition.onend = () => setRecording(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('Voice input not supported in this browser. Try Chrome.');
      return;
    }
    if (recording) {
      recognitionRef.current.stop();
      setRecording(false);
    } else {
      setText('');
      recognitionRef.current.start();
      setRecording(true);
    }
  };

  const handleProcess = async () => {
    if (!text.trim()) return;
    setProcessing(true);
    setResult(null);

    const parsed = await processBrainDump(text);

    if (parsed) {
      setResult(parsed);
      // Save to Firebase
      await saveBrainDump(user.uid, {
        rawText: text,
        result: parsed,
      });
      setSaved(true);
    }
    setProcessing(false);
  };

  const sendTaskToInbox = async (taskText) => {
    await addTask(user.uid, {
      title: taskText,
      priority: 'medium',
      project: 'Inbox',
      energy: 'medium',
      source: 'brain-dump',
    });
    setTasksSent(prev => [...prev, taskText]);
  };

  const reset = () => {
    setText('');
    setResult(null);
    setSaved(false);
    setTasksSent([]);
  };

  const tips = ['What\'s stressing me', 'What I\'m avoiding', 'Tasks I need to do', 'New ideas', 'Money worries', 'What\'s unresolved'];

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
      <div className="fade-up" style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Brain Dump → AI Organization</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
          Dump it all here.
        </h1>
        <p style={{ color: tokens.textSecondary, fontSize: '14px', marginTop: '6px' }}>
          Raw thoughts, worries, ideas, tasks — everything. AI will organize it.
        </p>
      </div>

      {!result ? (
        <div className="fade-up stagger-1">
          {/* Voice button */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <button
              onClick={toggleRecording}
              style={{
                width: 72, height: 72, borderRadius: '50%',
                background: recording ? 'rgba(212,122,107,0.2)' : tokens.accentDim,
                border: `2px solid ${recording ? tokens.red : tokens.accent}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '28px', cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: recording ? `0 0 24px rgba(212,122,107,0.3)` : `0 0 16px rgba(200,169,110,0.15)`,
              }}
              className={recording ? 'pulsing' : ''}
              title={recording ? 'Tap to stop recording' : 'Hold to speak'}
            >
              {recording ? '⏹' : '🎤'}
            </button>
          </div>
          {recording && (
            <p style={{ textAlign: 'center', fontSize: '12px', color: tokens.red, marginBottom: '12px' }} className="pulsing">
              Recording... speak freely
            </p>
          )}

          {/* Text area */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Start typing anything — don't filter yourself.&#10;&#10;What's on your mind? What's stressing you? What are you avoiding? What needs to happen? What ideas keep coming back?..."
            style={{
              width: '100%',
              minHeight: '240px',
              background: tokens.bgCard,
              border: `1px solid ${tokens.border}`,
              borderRadius: '12px',
              padding: '18px 20px',
              color: tokens.textPrimary,
              fontSize: '14px',
              lineHeight: 1.75,
              resize: 'vertical',
              outline: 'none',
              fontFamily: fonts.body,
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />

          {/* Tip chips */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', marginBottom: '16px' }}>
            {tips.map(tip => (
              <button
                key={tip}
                onClick={() => setText(t => t + (t.trim() ? '\n\n' : '') + tip + ': ')}
                style={{
                  fontSize: '11px', color: tokens.textSecondary,
                  background: tokens.bgCard, border: `1px solid ${tokens.border}`,
                  borderRadius: '99px', padding: '4px 12px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
              >
                {tip}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button
              onClick={handleProcess}
              loading={processing}
              disabled={!text.trim() || processing}
              size="lg"
            >
              ✦ Organize with AI
            </Button>
            {text.length > 0 && (
              <span style={{ fontSize: '12px', color: tokens.textMuted }}>{text.length} chars</span>
            )}
          </div>
        </div>
      ) : (
        <div className="fade-in">
          {/* AI Summary */}
          <div style={{ marginBottom: '16px' }}>
            <AICard
              text={result.summary}
              label="ANCHOR SUMMARY"
            />
          </div>

          {/* Most Urgent */}
          {result.mostUrgent && (
            <Card accent style={{ marginBottom: '16px' }}>
              <SectionLabel>Most Urgent</SectionLabel>
              <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary }}>{result.mostUrgent}</div>
            </Card>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            {/* Action Items */}
            {result.actionItems?.length > 0 && (
              <Card>
                <SectionLabel>Action Items</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {result.actionItems.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1 }}>
                        <span style={{ color: tokens.accent, flexShrink: 0, marginTop: '1px' }}>→</span>
                        <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{item}</span>
                      </div>
                      {!tasksSent.includes(item) ? (
                        <button
                          onClick={() => sendTaskToInbox(item)}
                          style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          + Task
                        </button>
                      ) : (
                        <span style={{ fontSize: '10px', color: tokens.green }}>✓ Added</span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Emotional */}
            {result.emotionalThemes?.length > 0 && (
              <Card>
                <SectionLabel>Emotional Themes</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {result.emotionalThemes.map((t, i) => (
                    <Tag key={i} label={t} color={tokens.purpleDim} textColor={tokens.purple} />
                  ))}
                </div>
                {result.urgentFlags?.length > 0 && (
                  <>
                    <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>URGENT FLAGS</div>
                    {result.urgentFlags.map((f, i) => (
                      <div key={i} style={{ fontSize: '12px', color: tokens.red, marginBottom: '4px' }}>⚑ {f}</div>
                    ))}
                  </>
                )}
              </Card>
            )}
          </div>

          {/* Categories */}
          <Card style={{ marginBottom: '16px' }}>
            <SectionLabel>Categorized Thoughts</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {Object.entries(result.categories || {})
                .filter(([, v]) => Array.isArray(v) && v.length > 0)
                .map(([cat, items]) => {
                  const colors = categoryColors[cat] || { bg: tokens.bgGlass, text: tokens.textSecondary };
                  return (
                    <div key={cat} style={{ padding: '12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: colors.text, letterSpacing: '0.08em', marginBottom: '8px' }}>{cat.toUpperCase()}</div>
                      {items.map((item, i) => (
                        <div key={i} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '4px', display: 'flex', gap: '6px' }}>
                          <span style={{ color: tokens.textMuted }}>·</span> {item}
                        </div>
                      ))}
                    </div>
                  );
                })}
            </div>
          </Card>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={reset} variant="ghost">← New Dump</Button>
            {saved && <span style={{ fontSize: '12px', color: tokens.green, alignSelf: 'center' }}>✓ Saved to history</span>}
          </div>
        </div>
      )}
    </div>
  );
}
