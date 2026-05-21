// src/components/screens/ProfileScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { tokens, fonts, THEME_LIST, setTheme } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveProfile } from '../../lib/db';
import { auth, storage } from '../../lib/firebase';
import { requestNotificationPermission, disableNotifications } from '../../lib/notifications';
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
  const { userProfile, brainDumpDigests = [] } = useData();
  const fileInputRef      = useRef(null);

  const [displayName,    setDisplayName]    = useState('');
  const [photoURL,       setPhotoURL]       = useState('');
  const [zip,            setZip]            = useState('');
  const [persona,        setPersona]        = useState('');
  const [workHours,      setWorkHours]      = useState(DEFAULT_WORK_HOURS);
  const [currentTheme]                      = useState(() => { try { return localStorage.getItem('anchorTheme') || 'warmCream'; } catch { return 'warmCream'; } });

  const [notifStatus,    setNotifStatus]    = useState(() => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  });
  const [notifLoading,   setNotifLoading]   = useState(false);

  const [testEmailState, setTestEmailState] = useState('idle'); // idle | sending | sent | error
  const [testEmailMsg,   setTestEmailMsg]   = useState('');

  const [calGridStart,   setCalGridStart]   = useState(6);
  const [calGridEnd,     setCalGridEnd]     = useState(22);
  const [savingCalGrid,  setSavingCalGrid]  = useState(false);

  const [savingProfile,  setSavingProfile]  = useState(false);
  const [savingHours,    setSavingHours]    = useState(false);
  const [savingPersona,  setSavingPersona]  = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [resetSent,      setResetSent]      = useState(false);
  const [savedSection,   setSavedSection]   = useState('');
  const [inboundToken,   setInboundToken]   = useState('');
  const [tokenCopied,    setTokenCopied]    = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setPhotoURL(user.photoURL || '');
    }
  }, [user]);

  useEffect(() => {
    if (userProfile) {
      setPersona(userProfile.persona || '');
      setZip(userProfile.zip || '');
      if (userProfile.workHours) setWorkHours(userProfile.workHours);
      if (userProfile.calGridStart != null) setCalGridStart(userProfile.calGridStart);
      if (userProfile.calGridEnd   != null) setCalGridEnd(userProfile.calGridEnd);

      // Generate inbound token if missing
      if (userProfile.inboundEmailToken) {
        setInboundToken(userProfile.inboundEmailToken);
      } else if (user) {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(9)))
          .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
        saveProfile(user.uid, { inboundEmailToken: token });
        setInboundToken(token);
      }
    }
  }, [userProfile, user]); // eslint-disable-line react-hooks/exhaustive-deps -- saveProfile is a stable import

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
      await saveProfile(user.uid, { displayName: displayName.trim(), zip: zip.trim() || null });
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

  const handleSaveCalGrid = async () => {
    if (calGridEnd <= calGridStart) return;
    setSavingCalGrid(true);
    await saveProfile(user.uid, { calGridStart, calGridEnd });
    setSavingCalGrid(false);
    showSaved('calGrid');
  };

  const handleSavePersona = async () => {
    setSavingPersona(true);
    await saveProfile(user.uid, { persona });
    setSavingPersona(false);
    showSaved('persona');
  };

  const handleEnableNotifications = async () => {
    setNotifLoading(true);
    const result = await requestNotificationPermission(user.uid);
    setNotifStatus(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'default');
    setNotifLoading(false);
  };

  const handleDisableNotifications = async () => {
    setNotifLoading(true);
    await disableNotifications(user.uid);
    setNotifLoading(false);
    setNotifStatus('default');
  };

  const handlePasswordReset = async () => {
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
    } catch (err) {
      console.error('Password reset error:', err);
    }
  };

  const handleTestEmail = async () => {
    setTestEmailState('sending');
    setTestEmailMsg('');
    try {
      const token = await user.getIdToken();
      const res   = await fetch('/api/email/test', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 120) }; }
      if (res.ok) {
        setTestEmailState('sent');
        setTestEmailMsg(`Sent to ${data.sentTo}`);
      } else {
        setTestEmailState('error');
        setTestEmailMsg(data.error || 'Unknown error');
      }
    } catch (err) {
      setTestEmailState('error');
      setTestEmailMsg(err.message || 'Request failed');
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
    fontSize: '12px', outline: 'none', fontFamily: fonts.body, colorScheme: 'light',
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
              <div style={{ fontSize: '11px', fontWeight: 600, color: tokens.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '12px 0 6px' }}>Location (Zip Code)</div>
              <input
                value={zip}
                onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="e.g. 50063"
                maxLength={5}
                style={{ ...inputStyle, width: '120px' }}
                onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                onBlur={e => e.target.style.borderColor = tokens.border}
              />
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>Used for local weather forecasts</div>
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

      {/* ── Calendar View Hours ── */}
      <div className="fade-up stagger-3" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Calendar View Hours</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
            Set the visible hour range in your calendar grid. Default is 6am – 10pm.
          </p>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted }}>Start Hour</label>
              <select value={calGridStart} onChange={e => setCalGridStart(Number(e.target.value))}
                style={{ background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {Array.from({ length: 13 }, (_, i) => i).map(h => (
                  <option key={h} value={h}>{h === 0 ? '12am' : h < 12 ? `${h}am` : '12pm'}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: '14px', color: tokens.textMuted, alignSelf: 'flex-end', paddingBottom: '10px' }}>→</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted }}>End Hour</label>
              <select value={calGridEnd} onChange={e => setCalGridEnd(Number(e.target.value))}
                style={{ background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {Array.from({ length: 11 }, (_, i) => i + 14).map(h => (
                  <option key={h} value={h}>{h === 24 ? '12am' : h > 12 ? `${h - 12}pm` : h === 12 ? '12pm' : `${h}am`}</option>
                ))}
              </select>
            </div>
          </div>
          {calGridEnd <= calGridStart && (
            <div style={{ fontSize: '11px', color: tokens.red, marginTop: '8px' }}>End must be after start.</div>
          )}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '14px' }}>
            <Button onClick={handleSaveCalGrid} loading={savingCalGrid} size="sm" disabled={calGridEnd <= calGridStart}>Save Hours</Button>
            {savedSection === 'calGrid' && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved</span>}
          </div>
        </Card>
      </div>

      {/* ── Appearance ── */}
      <div className="fade-up stagger-4" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Appearance</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
            Choose your color theme. The page will reload to apply the change.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
            {THEME_LIST.map(theme => {
              const isActive = currentTheme === theme.id;
              return (
                <button key={theme.id} onClick={() => setTheme(theme.id)}
                  style={{ padding: '12px', borderRadius: '10px', border: `2px solid ${isActive ? tokens.accent : tokens.border}`, background: isActive ? tokens.accentDim : tokens.bgInput, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', fontFamily: fonts.body }}>
                  <div style={{ fontSize: '13px', fontWeight: isActive ? 700 : 500, color: isActive ? tokens.accent : tokens.textPrimary, marginBottom: '2px' }}>{theme.name}</div>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, lineHeight: 1.4 }}>{theme.description}</div>
                  {isActive && <div style={{ fontSize: '10px', color: tokens.accent, marginTop: '6px', fontWeight: 700 }}>✓ Active</div>}
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── Notifications ── */}
      <div className="fade-up stagger-5" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Notifications</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
            Morning briefings, EOD check-ins, and weekly reviews sent as push notifications.
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {notifStatus === 'granted' && (
                <div style={{ fontSize: '13px', color: tokens.green, fontWeight: 600 }}>✓ Notifications enabled</div>
              )}
              {notifStatus === 'denied' && (
                <div style={{ fontSize: '13px', color: tokens.red }}>Blocked — enable in browser settings</div>
              )}
              {notifStatus === 'unsupported' && (
                <div style={{ fontSize: '13px', color: tokens.textMuted }}>Not supported on this browser</div>
              )}
              {notifStatus === 'default' && (
                <div style={{ fontSize: '13px', color: tokens.textSecondary }}>Not yet enabled</div>
              )}
            </div>
            {notifStatus === 'granted'
              ? <Button onClick={handleDisableNotifications} loading={notifLoading} variant="ghost" size="sm">Turn Off</Button>
              : notifStatus !== 'unsupported' && notifStatus !== 'denied'
                ? <Button onClick={handleEnableNotifications} loading={notifLoading} size="sm">Enable Notifications</Button>
                : null
            }
          </div>
        </Card>
      </div>

      {/* ── Email Briefings ── */}
      <div className="fade-up stagger-6" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>Email Briefings</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
            Morning briefings (6:30am CST) and weekly digests (Sunday evening) are sent to your account email.
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '13px', color: tokens.textSecondary }}>
              Sending to: <span style={{ color: tokens.textPrimary, fontWeight: 500 }}>{user?.email}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {testEmailState === 'sent' && (
                <span style={{ fontSize: '12px', color: tokens.green }}>✓ {testEmailMsg}</span>
              )}
              {testEmailState === 'error' && (
                <span style={{ fontSize: '12px', color: tokens.red }}>{testEmailMsg}</span>
              )}
              <Button
                onClick={handleTestEmail}
                loading={testEmailState === 'sending'}
                size="sm"
                variant="ghost"
                disabled={testEmailState === 'sending'}
              >
                Send test email
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* ── My Persona ── */}
      <div className="fade-up stagger-6" style={{ marginBottom: '12px' }}>
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

      {/* ── AI Memory ── */}
      <div className="fade-up stagger-7" style={{ marginBottom: '12px' }}>
        <Card>
          <SectionLabel>AI Memory — Brain Dump Digests</SectionLabel>
          <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
            Brain dumps older than 2 weeks are automatically compressed into weekly summaries. The AI uses these as long-term memory when giving advice.
          </p>
          {brainDumpDigests.length === 0 ? (
            <div style={{ fontSize: '12px', color: tokens.textMuted, fontStyle: 'italic' }}>
              No digests yet — brain dumps from completed weeks will be auto-summarized in the background.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12px', color: tokens.accent, fontWeight: 600 }}>
                {brainDumpDigests.length} week{brainDumpDigests.length !== 1 ? 's' : ''} of history in AI memory
              </div>
              {brainDumpDigests.map(d => (
                <div key={d.id} style={{ borderLeft: `2px solid ${tokens.accentDim}`, paddingLeft: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.04em' }}>
                      Week of {new Date(d.weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span style={{ fontSize: '10px', color: tokens.textMuted }}>
                      {d.entryCount} entr{d.entryCount !== 1 ? 'ies' : 'y'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.65 }}>
                    {d.digest}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Security ── */}
      <div className="fade-up stagger-7" style={{ marginBottom: '12px' }}>
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

      {/* ── Email to Task ── */}
      {inboundToken && (
        <div className="fade-up stagger-8" style={{ marginBottom: '12px' }}>
          <Card>
            <SectionLabel>Email to Task</SectionLabel>
            <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '14px' }}>
              Forward any email to your unique Anchor address and it will automatically become a task — title, priority, and notes extracted by AI.
            </p>

            {/* Inbound address */}
            <div style={{ background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <code style={{ flex: 1, fontSize: '12px', color: tokens.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                tasks+{inboundToken}@inbound.anchor-os.app
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`tasks+${inboundToken}@inbound.anchor-os.app`);
                  setTokenCopied(true);
                  setTimeout(() => setTokenCopied(false), 2000);
                }}
                style={{ background: tokenCopied ? tokens.greenDim : tokens.accentDim, border: `1px solid ${tokenCopied ? tokens.green : 'rgba(200,169,110,0.3)'}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: tokenCopied ? tokens.green : tokens.accent, cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body, transition: 'all 0.15s' }}>
                {tokenCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            {/* Setup steps */}
            <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600, color: tokens.textPrimary, marginBottom: '6px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Setup (one-time)</div>
              <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>Set up <strong style={{ color: tokens.textPrimary }}>Postmark</strong> (free) → Servers → Inbound Email</li>
                <li>Point your inbound domain MX records to Postmark's servers</li>
                <li>Set the webhook URL to: <code style={{ fontSize: '11px', color: tokens.accent }}>https://your-app.vercel.app/api/email/inbound</code></li>
                <li>In Gmail, create a filter → "Forward to" → paste your Anchor address above</li>
              </ol>
              <div style={{ marginTop: '8px', padding: '8px 12px', background: tokens.bgGlass, borderRadius: '6px', fontSize: '11px', color: tokens.textMuted }}>
                <strong style={{ color: tokens.textPrimary }}>Shortcut:</strong> You can also include <code style={{ color: tokens.accent }}>[anchor:{inboundToken}]</code> in any email subject and forward it to a generic address — Anchor will pick it up.
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Account ── */}
      <div className="fade-up stagger-8">
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
