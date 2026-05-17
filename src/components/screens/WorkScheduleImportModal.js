// src/components/screens/WorkScheduleImportModal.js
// Import a work calendar photo → parse with AI → push gray blocks to Google Calendar.

import React, { useState, useRef, useCallback } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { getValidAccessToken, createEvent, deleteEvent } from '../../lib/calendar';
import { addWorkScheduleBlock, getWorkScheduleBlocksInRange, deleteWorkScheduleBlock } from '../../lib/db';
import { Button, Modal, Spinner } from '../ui';

const STEPS = { SELECT: 'select', PARSING: 'parsing', REVIEW: 'review', IMPORTING: 'importing', DONE: 'done', ERROR: 'error' };

// Resize image to max 1600px wide (reduces payload, still plenty for AI vision)
function resizeImage(file, maxPx = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
      resolve({ base64, mediaType: 'image/jpeg' });
    };
    img.src = url;
  });
}

function fmtDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hr = ((h - 1 + 12) % 12) + 1;
  return m === 0 ? `${hr}${suffix}` : `${hr}:${String(m).padStart(2,'0')}${suffix}`;
}

export default function WorkScheduleImportModal({ open, onClose, calendarIntegration, onImported }) {
  const { user } = useAuth();

  const [step,        setStep]        = useState(STEPS.SELECT);
  const [preview,     setPreview]     = useState(null);   // data URL for display
  const [imageData,   setImageData]   = useState(null);   // { base64, mediaType }
  const [parsed,      setParsed]      = useState(null);   // { rangeStart, rangeEnd, events }
  const [selected,    setSelected]    = useState({});     // eventIdx → boolean
  const [errorMsg,    setErrorMsg]    = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const [existing,    setExisting]    = useState([]);     // existing WF blocks in range

  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const reset = () => {
    setStep(STEPS.SELECT);
    setPreview(null);
    setImageData(null);
    setParsed(null);
    setSelected({});
    setErrorMsg('');
    setImportedCount(0);
    setExisting([]);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFileSelected = useCallback(async (file) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setStep(STEPS.PARSING);

    try {
      const imgData = await resizeImage(file);
      setImageData(imgData);

      const res  = await fetch('/api/schedule/parse-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imgData.base64, mediaType: imgData.mediaType }),
      });

      if (!res.ok) throw new Error('Parse failed');
      const data = await res.json();

      if (!data.events?.length) {
        setErrorMsg('No events were detected in this image. Try a clearer photo showing a day or week view.');
        setStep(STEPS.ERROR);
        return;
      }

      // Pre-check existing WF blocks in this date range
      let existingBlocks = [];
      if (data.rangeStart && data.rangeEnd) {
        existingBlocks = await getWorkScheduleBlocksInRange(user.uid, data.rangeStart, data.rangeEnd);
      }
      setExisting(existingBlocks);

      // Default all events selected
      const sel = {};
      data.events.forEach((_, i) => { sel[i] = true; });
      setSelected(sel);
      setParsed(data);
      setStep(STEPS.REVIEW);
    } catch (err) {
      console.error('Photo parse error:', err);
      setErrorMsg('Something went wrong parsing the image. Please try again with a clearer photo.');
      setStep(STEPS.ERROR);
    }
  }, [user.uid]);

  const handleConfirmImport = async () => {
    if (!parsed) return;
    setStep(STEPS.IMPORTING);

    const eventsToImport = parsed.events.filter((_, i) => selected[i] !== false);
    if (!eventsToImport.length) {
      setStep(STEPS.REVIEW);
      return;
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let token = null;
    const gcalConnected = calendarIntegration?.connected;

    if (gcalConnected) {
      token = await getValidAccessToken(user.uid, calendarIntegration).catch(() => null);
    }

    try {
      // 1. Delete existing WF blocks in this date range (GCal + Firestore)
      await Promise.all(existing.map(async block => {
        if (token && block.gcalEventId) {
          await deleteEvent(token, block.gcalEventId).catch(() => {});
        }
        await deleteWorkScheduleBlock(user.uid, block.id);
      }));

      // 2. Create new events
      let count = 0;
      for (const ev of eventsToImport) {
        const [y, m, d] = ev.date.split('-').map(Number);
        const [sh, sm]  = (ev.startTime || '09:00').split(':').map(Number);
        const [eh, em]  = (ev.endTime   || '10:00').split(':').map(Number);
        const start = new Date(y, m - 1, d, sh, sm, 0);
        const end   = new Date(y, m - 1, d, eh, em, 0);
        // If end <= start (e.g. parsing error), add 30 min
        if (end <= start) end.setMinutes(end.getMinutes() + 30);

        let gcalEventId = null;
        if (token) {
          try {
            const created = await createEvent(token, {
              summary:     `[WF] ${ev.title}`,
              description: ev.location ? `Location: ${ev.location}` : 'Imported from work schedule',
              start: ev.allDay
                ? { date: ev.date }
                : { dateTime: start.toISOString(), timeZone: tz },
              end: ev.allDay
                ? { date: ev.date }
                : { dateTime: end.toISOString(), timeZone: tz },
              colorId: '8',  // graphite — visually distinct from Anchor tasks
            });
            gcalEventId = created.id;
          } catch (err) {
            console.warn('GCal create failed for event:', ev.title, err.message);
          }
        }

        await addWorkScheduleBlock(user.uid, {
          gcalEventId,
          date:       ev.date,
          title:      ev.title,
          startTime:  ev.startTime || null,
          endTime:    ev.endTime   || null,
          location:   ev.location  || null,
          allDay:     ev.allDay    || false,
        });

        count++;
      }

      setImportedCount(count);
      setStep(STEPS.DONE);
      if (onImported) onImported();
    } catch (err) {
      console.error('Import error:', err);
      setErrorMsg('Import failed partway through. Some events may have been created. Please check your calendar.');
      setStep(STEPS.ERROR);
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <Modal open={open} onClose={handleClose} title="Import Work Schedule">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '200px' }}>

        {/* ── Step: SELECT ── */}
        {step === STEPS.SELECT && (
          <>
            <p style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6, margin: 0 }}>
              Take a photo of your Outlook or Teams calendar, or upload one you already have. AI will extract the events and block that time in Google Calendar.
            </p>

            {/* Photo preview if already selected (re-select state) */}
            {preview && (
              <div style={{ borderRadius: '8px', overflow: 'hidden', maxHeight: '220px', textAlign: 'center', background: tokens.bgGlass, border: `1px solid ${tokens.border}` }}>
                <img src={preview} alt="Schedule preview" style={{ maxWidth: '100%', maxHeight: '220px', objectFit: 'contain' }} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {/* Camera capture */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '20px 16px', background: tokens.bgGlass, border: `1.5px dashed ${tokens.border}`, borderRadius: '12px', cursor: 'pointer', transition: 'border-color 0.15s', fontFamily: fonts.body }}
                onMouseEnter={e => e.currentTarget.style.borderColor = tokens.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}>
                <span style={{ fontSize: '28px' }}>📷</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>Take Photo</span>
                <span style={{ fontSize: '11px', color: tokens.textMuted, textAlign: 'center' }}>Point camera at your work screen</span>
              </button>

              {/* File upload */}
              <button
                onClick={() => uploadInputRef.current?.click()}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '20px 16px', background: tokens.bgGlass, border: `1.5px dashed ${tokens.border}`, borderRadius: '12px', cursor: 'pointer', transition: 'border-color 0.15s', fontFamily: fonts.body }}
                onMouseEnter={e => e.currentTarget.style.borderColor = tokens.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}>
                <span style={{ fontSize: '28px' }}>🖼</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>Upload Photo</span>
                <span style={{ fontSize: '11px', color: tokens.textMuted, textAlign: 'center' }}>Choose a saved screenshot</span>
              </button>
            </div>

            <div style={{ padding: '10px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Tips for best results</div>
              <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.6 }}>
                • Use a day view or 5-day week view — not month view<br/>
                • Make sure event titles and times are visible<br/>
                • Good lighting if photographing a screen
              </div>
            </div>

            {/* Hidden inputs */}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
              style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFileSelected(e.target.files[0])} />
            <input ref={uploadInputRef} type="file" accept="image/*"
              style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFileSelected(e.target.files[0])} />
          </>
        )}

        {/* ── Step: PARSING ── */}
        {step === STEPS.PARSING && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px 0' }}>
            {preview && (
              <div style={{ borderRadius: '8px', overflow: 'hidden', maxHeight: '180px', textAlign: 'center', opacity: 0.6, border: `1px solid ${tokens.border}` }}>
                <img src={preview} alt="Processing" style={{ maxWidth: '100%', maxHeight: '180px', objectFit: 'contain' }} />
              </div>
            )}
            <Spinner size={24} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '4px' }}>Analyzing your schedule...</div>
              <div style={{ fontSize: '12px', color: tokens.textMuted }}>AI is reading the events from your photo</div>
            </div>
          </div>
        )}

        {/* ── Step: REVIEW ── */}
        {step === STEPS.REVIEW && parsed && (
          <>
            {/* Date range header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.textPrimary }}>
                  {parsed.events.length} event{parsed.events.length !== 1 ? 's' : ''} detected
                </div>
                {parsed.rangeStart && (
                  <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                    {fmtDate(parsed.rangeStart)}{parsed.rangeEnd !== parsed.rangeStart ? ` – ${fmtDate(parsed.rangeEnd)}` : ''}
                  </div>
                )}
              </div>
              <button onClick={() => { reset(); }}
                style={{ fontSize: '11px', color: tokens.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
                ← New photo
              </button>
            </div>

            {/* Existing WF events warning */}
            {existing.length > 0 && (
              <div style={{ padding: '10px 14px', background: tokens.amberDim, borderRadius: '8px', border: `1px solid ${tokens.amber}30`, fontSize: '12px', color: tokens.amber, fontWeight: 600 }}>
                ⚑ {existing.length} existing work schedule block{existing.length > 1 ? 's' : ''} in this date range will be replaced.
              </div>
            )}

            {/* Event list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto' }}>
              {parsed.events.map((ev, i) => (
                <div key={i}
                  onClick={() => setSelected(s => ({ ...s, [i]: s[i] === false ? true : false }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: selected[i] === false ? 'transparent' : tokens.bgGlass, border: `1px solid ${selected[i] === false ? tokens.border : tokens.borderHover}`, borderRadius: '8px', cursor: 'pointer', opacity: selected[i] === false ? 0.45 : 1, transition: 'all 0.12s' }}>
                  {/* Checkbox */}
                  <div style={{ width: 16, height: 16, borderRadius: '3px', flexShrink: 0, border: `1.5px solid ${selected[i] === false ? tokens.border : tokens.accent}`, background: selected[i] === false ? 'transparent' : tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: tokens.accent }}>
                    {selected[i] !== false ? '✓' : ''}
                  </div>
                  {/* Event details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.title}
                    </div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                      {fmtDate(ev.date)}
                      {!ev.allDay && ev.startTime && ` · ${fmtTime(ev.startTime)}${ev.endTime ? ` – ${fmtTime(ev.endTime)}` : ''}`}
                      {ev.allDay && ' · All day'}
                      {ev.location && ` · ${ev.location}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Select/deselect all */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={() => { const s = {}; parsed.events.forEach((_, i) => { s[i] = true; }); setSelected(s); }}
                style={{ fontSize: '11px', color: tokens.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
                Select all
              </button>
              <span style={{ fontSize: '11px', color: tokens.textMuted }}>·</span>
              <button onClick={() => { const s = {}; parsed.events.forEach((_, i) => { s[i] = false; }); setSelected(s); }}
                style={{ fontSize: '11px', color: tokens.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
                Deselect all
              </button>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: tokens.textMuted }}>
                {selectedCount} of {parsed.events.length} selected
              </span>
            </div>

            {!calendarIntegration?.connected && (
              <div style={{ padding: '10px 14px', background: tokens.amberDim, border: `1px solid ${tokens.amber}30`, borderRadius: '8px', fontSize: '12px', color: tokens.amber }}>
                ⚠ Google Calendar not connected — events will be saved to Anchor only and won't appear on your GCal.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleConfirmImport} disabled={selectedCount === 0}>
                Import {selectedCount} event{selectedCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}

        {/* ── Step: IMPORTING ── */}
        {step === STEPS.IMPORTING && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px 0' }}>
            <Spinner size={24} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '4px' }}>Creating calendar blocks...</div>
              <div style={{ fontSize: '12px', color: tokens.textMuted }}>Adding events to Google Calendar</div>
            </div>
          </div>
        )}

        {/* ── Step: DONE ── */}
        {step === STEPS.DONE && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px 0', textAlign: 'center' }}>
            <div style={{ fontSize: '40px' }}>✓</div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: tokens.green, marginBottom: '6px' }}>
                {importedCount} work block{importedCount !== 1 ? 's' : ''} imported
              </div>
              <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
                They appear as graphite blocks on your Google Calendar labeled <strong>[WF]</strong>.
                Re-import any time to update — existing blocks for that date range are replaced automatically.
              </div>
            </div>
            <Button onClick={handleClose}>Done</Button>
          </div>
        )}

        {/* ── Step: ERROR ── */}
        {step === STEPS.ERROR && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ padding: '14px 16px', background: tokens.redDim, borderRadius: '8px', border: `1px solid ${tokens.red}30`, fontSize: '13px', color: tokens.red, lineHeight: 1.6 }}>
              {errorMsg}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={reset}>Try Again</Button>
            </div>
          </div>
        )}

      </div>
    </Modal>
  );
}
