// src/components/screens/ProfileScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveProfile } from '../../lib/db';
import { auth, storage } from '../../lib/firebase';
import { Card, Button, SectionLabel } from '../ui';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABELS = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };

const DEFAULT_WORK_HOURS = {
  monday:    { enabled: true,  start: '08:00', end: '18:00' },
  tuesday:   { enabled: true,  start: '08:00', end: '18:00' },
  wednesday: { enabled: true,  start: '08:00', end: '18:00' },
  thursday:  { enabled: true,  start: '08:00', end: '18:00' },
  friday:    { enabled: true,  start: '08:00', end: '18:00' },
  saturday:  { enabled: false, start: '09:00', end: '14:00' },
  sunday:    { enabled: false, start: '09:00', end: '14:00' },
};

function Toggle({ enabled, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 38, height: 22, borderRadius: '11px', background: enabled ? tokens.accent : tokens.bgInput, border: `1px solid ${enabled ? 'transparent' : tokens.border}`, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: '3px', left: enabled ? '19px' : '3px', width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </div>
  );
}

export default function ProfileScreen() {
  const { user, logout }  = useAuth();
  const { userProfile }   = useData();
  const fileInputRef      = useRef(null);

  const [displayName,    setDisplayName]    = useState('');
  const [photoURL,       setPhotoURL]       = useState('');
  const [persona,        setPersona]        = useState('');
  const [workHours,      setWorkHours]      = useState(DEFAULT_WORK_HOURS);

  const [savingProfile,  setSavingProfile]  = useState(false);
  const [savingHours,    setSavingHours]    = useState(false);
  const [savingPersona,  setSavingPersona]  = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [resetSent,      setResetSent]      = useState(false);
  const [savedSection,   setSavedSection]   = useState('');

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setPhotoURL(user.photoURL || '');
    }
  }, [user]);

  useEffect(() => {
    if (userProfile) {
      setPersona(userProfile.persona || '');
      if (userProfile.workHours) setWorkHours(userProfile.workHours);
    }
  }, [userProfile]);

  const showSaved = (section) => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(''), 2500);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const storageRef = ref(storage, `users/${user.uid}/profile.jpg`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateProfile(auth.currentUser, { photoURL: url });
      await saveProfile(user.uid, { photoURL: url });
      setPhotoURL(url);
      showSaved('photo');
    } catch (err) {
      console.error('Photo upload error:', err);
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSaveProfile = async () => {
    if (!displayName.trim()) return;
    setSavingProfile(true);
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      await saveProfile(user.uid, { displayName: displayName.trim() });
      showSaved('profile');
    } catch (err) {
      console.error('Save profile error:', err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveHours = async () => {
    setSavingHours(true);
    await saveProfile(user.uid, { workHours });
    setSavingHours(false);
    showSaved('hours');
  };

  const handleSavePersona = async () => {
    setSavingPersona(true);
    await saveProfile(user.uid, { persona });
    setSavingPersona(false);
    showSaved('persona');
  };

  const handlePasswordReset = async () => {
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
    } catch (err) {
      console.error('Password reset error:', err);
    }
  };

  const updateDayHours = (day, field, value) =>
    setWorkHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));

  const inputStyle = {
    width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`,
    borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary,
    fontSize: '14px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const timeInputStyle = {
    flex: 1, background: tokens.bgInput, border: `1px solid ${tokens.border}`,
    borderRadius: '6px', padding: '5px 8px', color: tokens.textPrimary,
    fontSize: '12px', outline: 'none', fontFamily: fonts.body, colorScheme: 'dark',
  };

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Account</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Profile & Settings</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>Your preferences shape how Anchor works for you.</p>
      </div>

      {/* ── Profile ── */}
      <div className="fade-up stagger-1" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Profile</SectionLabel>
          <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start', marginBottom: '16px' }}>
            {/* Avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{ width: 76, height: 76, borderRadius: '50%', background: photoURL ? 'transparent' : `linear-gradient(135deg, ${tokens.blue}, ${tokens.purple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 700, color: '#fff', overflow: 'hidden', cursor: 'pointer', border: `2px solid ${tokens.border}` }}
              >
                {photoURL
                  ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (displayName?.[0] || user?.email?.[0] || 'A').toUpperCase()}
              </div>
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', background: tokens.accent, border: `2px solid ${tokens.bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
                {uploadingPhoto ? '…' : '✎'}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
            </div>

            {/* Name + email */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: tokens.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}>Display Name</div>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                onBlur={e => e.target.style.borderColor = tokens.border}
              />
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>{user?.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={handleSaveProfile} loading={savingProfile} size="sm" disabled={!displayName.trim()}>Save Profile</Button>
            {savedSection === 'profile' && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved</span>}
            {savedSection === 'photo'   && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Photo updated</span>}
          </div>
        </Card>
      </div>

      {/* ── Work Hours ── */}
      <div className="fade-up stagger-2" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Work Hours</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
            The schedule builder uses these to find free slots. Toggle a day off to block it entirely.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {DAYS.map(day => {
              const cfg = workHours[day] || DEFAULT_WORK_HOURS[day];
              return (
                <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Toggle enabled={cfg.enabled} onChange={() => updateDayHours(day, 'enabled', !cfg.enabled)} />
                  <span style={{ width: '36px', fontSize: '13px', fontWeight: 600, color: cfg.enabled ? tokens.textPrimary : tokens.textMuted, flexShrink: 0 }}>{DAY_LABELS[day]}</span>
                  {cfg.enabled ? (
                    <>
                      <input type="time" value={cfg.start} onChange={e => updateDayHours(day, 'start', e.target.value)} style={timeInputStyle} />
                      <span style={{ fontSize: '11px', color: tokens.textMuted, flexShrink: 0 }}>to</span>
                      <input type="time" value={cfg.end}   onChange={e => updateDayHours(day, 'end',   e.target.value)} style={timeInputStyle} />
                    </>
                  ) : (
                    <span style={{ fontSize: '12px', color: tokens.textMuted, fontStyle: 'italic' }}>Off</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '16px' }}>
            <Button onClick={handleSaveHours} loading={savingHours} size="sm">Save Work Hours</Button>
            {savedSection === 'hours' && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved</span>}
          </div>
        </Card>
      </div>

      {/* ── My Persona ── */}
      <div className="fade-up stagger-3" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>My Persona</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '12px' }}>
            Tell Anchor how you think and work. This is injected into every AI conversation as added context.
          </p>
          <textarea
            value={persona}
            onChange={e => setPersona(e.target.value)}
            placeholder={`Examples:\n• I work best in 90-min deep focus blocks, not meetings before 10am\n• I prefer direct advice — no sugarcoating, no preamble\n• I'm a systems thinker — show me frameworks, not just answers\n• Cash flow is tight right now — factor that into every recommendation\n• Biggest lever right now is debt reduction, not new revenue`}
            rows={7}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '12px 14px', color: tokens.textPrimary, fontSize: '13px', lineHeight: 1.75, resize: 'vertical', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
            <Button onClick={handleSavePersona} loading={savingPersona} size="sm">Save Persona</Button>
            {savedSection === 'persona' && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved</span>}
            <span style={{ fontSize: '11px', color: tokens.textMuted, marginLeft: 'auto' }}>{persona.length} chars</span>
          </div>
        </Card>
      </div>

      {/* ── Security ── */}
      <div className="fade-up stagger-4" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Security</SectionLabel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>Password Reset</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>Send a reset link to {user?.email}</div>
            </div>
            {resetSent
              ? <span style={{ fontSize: '12px', color: tokens.green }}>✓ Email sent</span>
              : <Button onClick={handlePasswordReset} variant="ghost" size="sm">Send Reset Email</Button>
            }
          </div>
        </Card>
      </div>

      {/* ── Account ── */}
      <div className="fade-up stagger-5">
        <Card>
          <SectionLabel>Account</SectionLabel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', color: tokens.textSecondary }}>Signed in as {user?.email}</div>
            <Button onClick={logout} variant="ghost" size="sm" style={{ color: tokens.red }}>Sign Out</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
