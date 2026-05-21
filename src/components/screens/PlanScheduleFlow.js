// src/components/screens/PlanScheduleFlow.js
// Multi-step scheduling wizard: scope → triage → building → review → commit → done
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import {
  getValidAccessToken, getEvents, createEvent, deleteEvent, getFreeSlots,
} from '../../lib/calendar';
import { buildScheduleForDays } from '../../lib/ai';
import { updateTask } from '../../lib/db';
import { Button, Spinner, priorityColors } from '../ui';
import { calculateUrgency } from '../../lib/tasks';
import { isOutdoorTask } from '../../lib/weather';
const STEPS = ['scope', 'triage', 'building', 'review', 'commit', 'done'];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateRange(scope) {
  const today = new Date();
  if (scope === 'today') return [ymd(today)];
  if (scope === 'tomorrow') {
    const tom = new Date(today); tom.setDate(today.getDate() + 1);
    return [ymd(tom)];
  }
  // week: next 5 business days starting today
  const days = [];
  const d = new Date(today);
  while (days.length < 5) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(ymd(new Date(d)));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function yesterdayYMD() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return ymd(d);
}

export default function PlanScheduleFlow({ open, onClose, calendarIntegration, weatherForecast }) {
  const { user } = useAuth();
  const { tasks, userProfile } = useData();

  const [step, setStep]                   = useState('scope');
  const [scope, setScope]                 = useState('today');
  const [selectedIds, setSelectedIds]     = useState(new Set());
  const [schedule, setSchedule]           = useState([]);
  const [scheduleSummary, setScheduleSummary] = useState('');
  const [unschedulable, setUnschedulable] = useState([]);
  const [commitMode, setCommitMode]       = useState('anchor');
  const [committing, setCommitting]       = useState(false);
  const [gcalCount, setGcalCount]         = useState(0);
  const [buildStatus, setBuildStatus]     = useState('');
  const [error, setError]                 = useState('');

  const yesterdayStr = useMemo(() => yesterdayYMD(), []);

  const candidateTasks = useMemo(() => tasks
    .filter(t => {
      if (t.done) return false;
      if (!t.scheduledDate) return true;
      if (t.scheduledDate <= yesterdayStr) return true;
      return false;
    })
    .sort((a, b) => calculateUrgency(b) - calculateUrgency(a)),
  [tasks, yesterdayStr]);

  const reset = useCallback(() => {
    setStep('scope');
    setScope('today');
    setSelectedIds(new Set(candidateTasks.map(t => t.id)));
    setSchedule([]);
    setScheduleSummary('');
    setUnschedulable([]);
    setCommitMode('anchor');
    setError('');
    setGcalCount(0);
  }, [candidateTasks]);

  useEffect(() => {
    if (open) reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset is defined without useCallback; including it would cause the effect to re-run on every render

  const toggleTask = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleScopeNext = () => {
    setSelectedIds(new Set(candidateTasks.map(t => t.id)));
    setStep('triage');
  };

  const buildPlan = async () => {
    setStep('building');
    setError('');

    const days = getDateRange(scope);
    const selected = candidateTasks
      .filter(t => selectedIds.has(t.id))
      .map(t => ({
        id:               t.id,
        title:            t.title,
        priority:         t.priority,
        estimatedMinutes: t.estimatedMinutes || 45,
        project:          t.project || 'Inbox',
        dueDate:          t.dueDate || null,
        pushCount:        t.pushCount || 0,
        outdoor:          isOutdoorTask(t),
        tags:             t.tags || [],
      }));

    try {
      setBuildStatus('Fetching your calendar...');
      const slotsMap = {};

      if (calendarIntegration?.connected) {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (token) {
          setBuildStatus('Finding free time slots...');
          try {
            const startDate = new Date(days[0] + 'T00:00:00');
            const endDate   = new Date(days[days.length - 1] + 'T23:59:59');
            const { events } = await getEvents(token, startDate.toISOString(), endDate.toISOString());
            const wh = userProfile?.workHours || null;
            for (const day of days) {
              const dayEvs = (events || []).filter(e => e.start?.dateTime?.startsWith(day));
              slotsMap[day] = getFreeSlots(dayEvs, day + 'T12:00:00', wh);
            }
          } catch {
            const wh = userProfile?.workHours || null;
            for (const day of days) slotsMap[day] = getFreeSlots([], day + 'T12:00:00', wh);
          }
        } else {
          const wh = userProfile?.workHours || null;
          for (const day of days) slotsMap[day] = getFreeSlots([], day + 'T12:00:00', wh);
        }
      } else {
        const wh = userProfile?.workHours || null;
        for (const day of days) slotsMap[day] = getFreeSlots([], day + 'T12:00:00', wh);
      }

      // Clip today's slots — remove anything ending before now+15min, trim slots that start in the past
      const now = new Date();
      const minStart = new Date(now.getTime() + 15 * 60 * 1000);
      const todayStr = now.toISOString().split('T')[0];
      if (slotsMap[todayStr]) {
        slotsMap[todayStr] = slotsMap[todayStr]
          .map(slot => {
            const slotEnd = new Date(slot.end);
            if (slotEnd <= minStart) return null;
            const slotStart = new Date(slot.start);
            if (slotStart < minStart) {
              const newDuration = Math.round((slotEnd - minStart) / 60000);
              if (newDuration < 30) return null;
              return { start: minStart.toISOString(), end: slot.end, durationMins: newDuration };
            }
            return slot;
          })
          .filter(Boolean);
      }

      setBuildStatus('AI is building your plan...');
      const result = await buildScheduleForDays({
        tasks: selected,
        slotsMap,
        days,
        currentTime: now.toISOString(),
        focusProfile: { recentEnergy: userProfile?.energyToday ? userProfile.energyToday * 10 : 70 },
        weatherForecast: weatherForecast?.forecast || null,
      });

      const scheduledIds = new Set((result?.schedule || []).map(s => s.taskId).filter(Boolean));
      setSchedule(result?.schedule || []);
      setScheduleSummary(result?.summary || '');
      setUnschedulable(selected.filter(t => !scheduledIds.has(t.id)));
      setStep('review');
    } catch (err) {
      console.error('Plan build error:', err);
      setError('Failed to build schedule. Try again.');
      setStep('triage');
    }
  };

  const commitPlan = async () => {
    setCommitting(true);
    setError('');
    let gcalCreated = 0;

    try {
      let token = null;
      if (commitMode === 'gcal' && calendarIntegration?.connected) {
        token = await getValidAccessToken(user.uid, calendarIntegration);
      }

      // Delete previously Anchor-created events for these dates to prevent duplicates
      if (token) {
        try {
          const scheduleDates = [...new Set(schedule.map(b => b.date).filter(Boolean))];
          await Promise.all(scheduleDates.map(async date => {
            const timeMin = `${date}T00:00:00`;
            const timeMax = `${date}T23:59:59`;
            const { events } = await getEvents(token, timeMin, timeMax);
            const anchorEvents = (events || []).filter(e => e.extendedProperties?.private?.anchorScheduled === 'true');
            await Promise.all(anchorEvents.map(e => deleteEvent(token, e.id).catch(() => {})));
          }));
        } catch (err) {
          console.warn('Failed to clean up prior Anchor events:', err);
        }
      }

      for (const block of schedule) {
        if (!block.taskId) continue;
        const updates = {
          status: 'scheduled',
          scheduledDate:  block.date,
          scheduledStart: block.start,
          scheduledEnd:   block.end,
        };

        if (token) {
          try {
            const orig = tasks.find(t => t.id === block.taskId);
            const created = await createEvent(token, {
              summary:     block.taskTitle,
              description: orig?.notes || '',
              start: { dateTime: block.start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
              end:   { dateTime: block.end,   timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
              colorId: '5',
              extendedProperties: { private: { anchorScheduled: 'true' } },
            });
            updates.calendarEventId = created.id;
            updates._anchor = true;
            gcalCreated++;
          } catch (err) {
            console.error('GCal create failed for', block.taskTitle, err);
          }
        }

        await updateTask(user.uid, block.taskId, updates);
      }

      setGcalCount(gcalCreated);
      setStep('done');
    } catch (err) {
      console.error('Commit error:', err);
      setError('Some tasks could not be committed. Check your connection.');
    } finally {
      setCommitting(false);
    }
  };

  if (!open) return null;

  const stepIdx = STEPS.indexOf(step);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
      animation: 'fadeIn 0.18s ease both',
    }}>
      <div style={{
        background: tokens.bgCard, borderRadius: '18px',
        width: '100%', maxWidth: '560px',
        maxHeight: '88vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 28px 90px rgba(0,0,0,0.55)',
        border: `1px solid ${tokens.border}`,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${tokens.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.textPrimary, margin: 0 }}>
              {step === 'scope'    && 'Plan My Schedule'}
              {step === 'triage'   && 'Select Tasks'}
              {step === 'building' && 'Building Plan...'}
              {step === 'review'   && 'Draft Schedule'}
              {step === 'commit'   && 'Commit Plan'}
              {step === 'done'     && 'Schedule Set'}
            </h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '22px', padding: '2px 6px', lineHeight: 1 }}>×</button>
          </div>
          {/* Progress bar */}
          <div style={{ display: 'flex', gap: '5px', marginTop: '14px' }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{
                height: 3, flex: 1, borderRadius: 99,
                background: stepIdx >= i ? tokens.accent : tokens.border,
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── SCOPE ── */}
          {step === 'scope' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ color: tokens.textSecondary, fontSize: '13px', marginBottom: '8px' }}>
                Choose how far out to plan. Anchor will find free slots and build a draft schedule.
              </p>
              {[
                { value: 'today',    label: 'Today',     sub: 'Fill free time left in today\'s calendar' },
                { value: 'tomorrow', label: 'Tomorrow',  sub: 'Plan out all of tomorrow' },
                { value: 'week',     label: 'This Week', sub: 'Spread tasks across the next 5 business days' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setScope(opt.value)} style={{
                  background: scope === opt.value ? tokens.accentDim : tokens.bgGlass,
                  border: `1.5px solid ${scope === opt.value ? tokens.accent : tokens.border}`,
                  borderRadius: '10px', padding: '14px 16px',
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary }}>{opt.label}</div>
                  <div style={{ fontSize: '12px', color: tokens.textSecondary, marginTop: '3px' }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          )}

          {/* ── TRIAGE ── */}
          {step === 'triage' && (
            <div>
              <p style={{ color: tokens.textSecondary, fontSize: '13px', marginBottom: '14px' }}>
                {candidateTasks.length} unscheduled task{candidateTasks.length !== 1 ? 's' : ''} found. Deselect any to exclude.
              </p>
              {candidateTasks.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: tokens.textMuted }}>
                  No unscheduled tasks. Add tasks first.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {candidateTasks.map(task => {
                  const selected  = selectedIds.has(task.id);
                  const overdue   = task.scheduledDate && task.scheduledDate < yesterdayStr;
                  const yesterday = task.scheduledDate === yesterdayStr;
                  const pc        = priorityColors[task.priority] || {};

                  return (
                    <div key={task.id} onClick={() => toggleTask(task.id)} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                      border: `1.5px solid ${selected ? tokens.accent : tokens.border}`,
                      background: selected ? tokens.accentDim : tokens.bgGlass,
                      opacity: selected ? 1 : 0.55,
                      transition: 'all 0.12s',
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '4px', flexShrink: 0,
                        border: `1.5px solid ${selected ? tokens.accent : tokens.border}`,
                        background: selected ? tokens.accent : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', color: tokens.bgCard, fontWeight: 800,
                      }}>{selected ? '✓' : ''}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.title}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: pc.bg || tokens.accentDim, color: pc.text || tokens.accent, fontWeight: 700, textTransform: 'uppercase' }}>
                            {task.priority}
                          </span>
                          {task.project && <span style={{ fontSize: '10px', color: tokens.textMuted }}>{task.project}</span>}
                          {yesterday && <span style={{ fontSize: '10px', color: tokens.amber, fontWeight: 600 }}>⚡ Not done yesterday</span>}
                          {overdue && <span style={{ fontSize: '10px', color: tokens.red, fontWeight: 600 }}>⚑ Overdue</span>}
                          {task.estimatedMinutes && <span style={{ fontSize: '10px', color: tokens.textMuted }}>{task.estimatedMinutes}m</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {error && <div style={{ color: tokens.red, fontSize: '12px', marginTop: '12px' }}>{error}</div>}
            </div>
          )}

          {/* ── BUILDING ── */}
          {step === 'building' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <Spinner size={28} />
              <div style={{ color: tokens.textSecondary, fontSize: '14px', marginTop: '18px' }}>{buildStatus}</div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {step === 'review' && (
            <div>
              {scheduleSummary && (
                <div style={{ padding: '12px 16px', background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.25)`, borderRadius: '10px', marginBottom: '18px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.accent, marginBottom: '6px' }}>Why this schedule</div>
                  <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>{scheduleSummary}</div>
                </div>
              )}
              {schedule.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: tokens.textMuted }}>
                  No tasks could be scheduled. Expand scope or reduce tasks.
                </div>
              )}
              {Array.from(new Set(schedule.map(s => s.date))).sort().map(date => (
                <div key={date} style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '8px' }}>
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {schedule.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start)).map((block, i) => (
                      <div key={i} style={{
                        padding: '10px 14px', borderRadius: '8px',
                        background: tokens.bgGlass,
                        border: `1px solid ${tokens.border}`,
                        borderLeft: `3px solid ${tokens.accent}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary, flex: 1 }}>{block.taskTitle}</div>
                          <div style={{ fontSize: '11px', color: tokens.accent, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {new Date(block.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
                            {' – '}
                            {new Date(block.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
                          </div>
                        </div>
                        {block.reason && (
                          <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '3px' }}>{block.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {unschedulable.length > 0 && (
                <div style={{ padding: '12px 14px', background: tokens.redDim, borderRadius: '8px', border: `1px solid ${tokens.redDim}` }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: tokens.red, marginBottom: '4px' }}>
                    {unschedulable.length} task{unschedulable.length > 1 ? 's' : ''} couldn't fit
                  </div>
                  <div style={{ fontSize: '11px', color: tokens.textSecondary }}>
                    {unschedulable.map(t => t.title).join(' · ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── COMMIT ── */}
          {step === 'commit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ color: tokens.textSecondary, fontSize: '13px', marginBottom: '8px' }}>
                {schedule.length} task{schedule.length !== 1 ? 's' : ''} ready to commit. How should we save this?
              </p>
              {[
                { value: 'anchor', label: 'Anchor only',               sub: 'Update task dates in Anchor. Calendar stays unchanged.' },
                { value: 'gcal',   label: 'Anchor + Google Calendar',  sub: 'Create calendar events for each block. They appear on your Google Calendar.' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setCommitMode(opt.value)} style={{
                  background: commitMode === opt.value ? tokens.accentDim : tokens.bgGlass,
                  border: `1.5px solid ${commitMode === opt.value ? tokens.accent : tokens.border}`,
                  borderRadius: '10px', padding: '14px 16px',
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary }}>{opt.label}</div>
                  <div style={{ fontSize: '12px', color: tokens.textSecondary, marginTop: '3px' }}>{opt.sub}</div>
                </button>
              ))}
              {!calendarIntegration?.connected && commitMode === 'gcal' && (
                <div style={{ fontSize: '12px', color: tokens.amber, padding: '8px 0' }}>
                  ⚠ Google Calendar not connected — will save to Anchor only.
                </div>
              )}
              {error && <div style={{ color: tokens.red, fontSize: '12px', marginTop: '8px' }}>{error}</div>}
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', color: tokens.green }}>✓</div>
              <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '8px' }}>
                Schedule committed
              </div>
              <div style={{ fontSize: '14px', color: tokens.textSecondary }}>
                {schedule.length} task{schedule.length !== 1 ? 's' : ''} scheduled
                {gcalCount > 0 ? ` · ${gcalCount} calendar event${gcalCount > 1 ? 's' : ''} created` : ''}
              </div>
              {unschedulable.length > 0 && (
                <div style={{ fontSize: '12px', color: tokens.amber, marginTop: '12px' }}>
                  {unschedulable.length} task{unschedulable.length > 1 ? 's' : ''} couldn't be scheduled — add them manually.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${tokens.border}`,
          flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            {step === 'triage' && <Button onClick={() => setStep('scope')} variant="ghost" size="sm">← Back</Button>}
            {step === 'review'  && <Button onClick={() => setStep('triage')} variant="ghost" size="sm">← Back</Button>}
            {step === 'commit'  && <Button onClick={() => setStep('review')} variant="ghost" size="sm">← Back</Button>}
          </div>
          <div>
            {step === 'scope'   && <Button onClick={handleScopeNext}>Choose Tasks →</Button>}
            {step === 'triage'  && <Button onClick={buildPlan} disabled={selectedIds.size === 0}>Build Plan →</Button>}
            {step === 'review'  && schedule.length > 0 && <Button onClick={() => setStep('commit')}>Commit →</Button>}
            {step === 'review'  && schedule.length === 0 && <Button onClick={() => setStep('triage')} variant="ghost">← Try Again</Button>}
            {step === 'commit'  && <Button onClick={commitPlan} loading={committing}>Commit ✓</Button>}
            {step === 'done'    && <Button onClick={onClose}>Done</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
