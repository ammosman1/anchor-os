// src/components/screens/OnboardingScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui';

const steps = [
  {
    id: 'name',
    question: "First, what should Anchor call you?",
    sub: "First name is fine.",
    type: 'text',
    placeholder: 'Andrew',
    field: 'firstName',
  },
  {
    id: 'priority',
    question: "What's your single biggest priority right now?",
    sub: "Not a list — just the one thing that matters most.",
    type: 'text',
    placeholder: 'e.g. Get my finances back on solid ground',
    field: 'topPriority',
  },
  {
    id: 'challenge',
    question: "What's the biggest thing working against you right now?",
    sub: "Be honest. Anchor works better when it knows the real situation.",
    type: 'text',
    placeholder: 'e.g. Carrying significant debt and rebuilding from a business failure',
    field: 'biggestChallenge',
  },
  {
    id: 'energy',
    question: "How would you describe your current energy baseline?",
    sub: "Not today specifically — your general state lately.",
    type: 'select',
    field: 'energyBaseline',
    options: [
      { value: 'high',   label: '⚡ High — I have fuel and drive' },
      { value: 'medium', label: '〰 Medium — steady but managing a lot' },
      { value: 'low',    label: '▽ Low — depleted, running on fumes' },
      { value: 'mixed',  label: '◈ Mixed — depends on the day' },
    ],
  },
  {
    id: 'goal',
    question: "One year from today — what does a win look like?",
    sub: "Specific is better than vague.",
    type: 'text',
    placeholder: 'e.g. Debt significantly reduced, one income stream outside my job',
    field: 'oneYearGoal',
  },
];

export default function OnboardingScreen() {
  const { updateProfile, user } = useAuth();
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving,  setSaving]  = useState(false);

  const current = steps[step];
  const value   = answers[current.field] || (current.type === 'select' ? current.options[0].value : '');

  const canAdvance = value.trim?.() !== '' || current.type === 'select';

  const handleNext = async () => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      setSaving(true);
      await updateProfile({
        ...answers,
        onboardingComplete: true,
        uid: user.uid,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && canAdvance) handleNext();
  };


  return (
    <div style={{
      minHeight: '100vh',
      background: tokens.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 50% 40% at 50% 0%, rgba(200,169,110,0.06) 0%, transparent 60%)',
      }} />

      <div className="fade-in" style={{ width: '100%', maxWidth: 520 }}>
        {/* Progress bar */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.08em' }}>SETUP — {step + 1} of {steps.length}</div>
            <div style={{ fontSize: '11px', color: tokens.accent }}>
              {Math.round(((step + 1) / steps.length) * 100)}%
            </div>
          </div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${((step + 1) / steps.length) * 100}%`, background: tokens.accent, borderRadius: 99, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Question */}
        <div key={step} className="fade-up">
          <h2 style={{
            fontFamily: fonts.display,
            fontSize: '26px',
            fontWeight: 700,
            color: tokens.textPrimary,
            letterSpacing: '-0.02em',
            lineHeight: 1.3,
            marginBottom: '8px',
          }}>
            {current.question}
          </h2>
          <p style={{ fontSize: '14px', color: tokens.textMuted, marginBottom: '28px', lineHeight: 1.6 }}>
            {current.sub}
          </p>

          {/* Input */}
          {current.type === 'text' && (
            <input
              autoFocus
              value={value}
              onChange={e => setAnswers(a => ({ ...a, [current.field]: e.target.value }))}
              onKeyDown={handleKey}
              placeholder={current.placeholder}
              style={{
                width: '100%',
                background: tokens.bgCard,
                border: `1px solid ${tokens.borderFocus}`,
                borderRadius: '10px',
                padding: '14px 18px',
                color: tokens.textPrimary,
                fontSize: '15px',
                outline: 'none',
                fontFamily: fonts.body,
                boxSizing: 'border-box',
              }}
            />
          )}

          {current.type === 'select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {current.options.map(opt => (
                <div
                  key={opt.value}
                  onClick={() => setAnswers(a => ({ ...a, [current.field]: opt.value }))}
                  style={{
                    padding: '13px 18px',
                    borderRadius: '10px',
                    border: `1px solid ${value === opt.value ? 'rgba(200,169,110,0.4)' : tokens.border}`,
                    background: value === opt.value ? tokens.accentDim : tokens.bgCard,
                    color: value === opt.value ? tokens.accent : tokens.textSecondary,
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    fontWeight: value === opt.value ? 600 : 400,
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          )}

          {/* Nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '28px' }}>
            {step > 0 ? (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '13px', cursor: 'pointer', padding: '8px 0' }}
              >
                ← Back
              </button>
            ) : <div />}

            <Button
              onClick={handleNext}
              disabled={!canAdvance}
              loading={saving}
              size="lg"
            >
              {step === steps.length - 1 ? 'Launch Anchor →' : 'Continue →'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
