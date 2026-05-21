// src/components/SearchModal.js
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { tokens, fonts } from '../lib/tokens';

const ENTITY_TYPES = [
  {
    key: 'tasks',
    label: 'Tasks',
    icon: '✓',
    color: tokens.blue,
    getItems: d => d.tasks || [],
    getSearchText: t => [t.title, t.notes, typeof t.tags === 'string' ? t.tags : (t.tags || []).join(' ')].filter(Boolean).join(' '),
    getTitle: t => t.title || '(Untitled)',
    getSubtitle: t => [t.project, t.priority].filter(Boolean).join(' · '),
    getPath: () => '/tasks',
  },
  {
    key: 'goals',
    label: 'Goals',
    icon: '◆',
    color: tokens.accent,
    getItems: d => d.goals || [],
    getSearchText: g => [g.title, g.description, g.why].filter(Boolean).join(' '),
    getTitle: g => g.title || '(Untitled)',
    getSubtitle: g => g.status || '',
    getPath: g => `/goals/${g.id}`,
  },
  {
    key: 'projects',
    label: 'Projects',
    icon: '◈',
    color: tokens.purple,
    getItems: d => d.projects || [],
    getSearchText: p => [p.title, p.description, p.notes, p.blockers].filter(Boolean).join(' '),
    getTitle: p => p.title || '(Untitled)',
    getSubtitle: p => p.status || '',
    getPath: p => `/projects/${p.id}`,
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: '▤',
    color: tokens.green,
    getItems: d => d.notes || [],
    getSearchText: n => [n.title, n.body].filter(Boolean).join(' '),
    getTitle: n => n.title || '(Untitled)',
    getSubtitle: n => n.body ? n.body.replace(/\n/g, ' ').slice(0, 80) : '',
    getPath: () => '/notes',
    getNavState: n => ({ openNoteId: n.id }),
  },
  {
    key: 'ideas',
    label: 'Ideas',
    icon: '◇',
    color: tokens.amber,
    getItems: d => d.ideas || [],
    getSearchText: i => [i.title, i.notes].filter(Boolean).join(' '),
    getTitle: i => i.title || '(Untitled)',
    getSubtitle: i => i.status || '',
    getPath: () => '/ideas',
  },
  {
    key: 'habits',
    label: 'Habits',
    icon: '⊙',
    color: tokens.green,
    getItems: d => (d.habits || []).filter(h => h.active !== false),
    getSearchText: h => h.title || '',
    getTitle: h => h.title || '(Untitled)',
    getSubtitle: h => h.frequency === 'weekdays' ? 'Weekdays only' : h.frequency === 'weekly' ? 'Once a week' : 'Every day',
    getPath: () => '/habits',
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: '▣',
    color: tokens.blue,
    getItems: d => d.documents || [],
    getSearchText: doc => [doc.name, doc.fileName, doc.category].filter(Boolean).join(' '),
    getTitle: doc => doc.name || doc.fileName || '(Untitled)',
    getSubtitle: doc => doc.category ? doc.category.replace(/_/g, ' ') : '',
    getPath: () => '/documents',
  },
];

export default function SearchModal({ open, onClose }) {
  const data                         = useData();
  const navigate                     = useNavigate();
  const [query,       setQuery]       = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef                     = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const groups = [];
    for (const type of ENTITY_TYPES) {
      const matched = type.getItems(data).filter(item =>
        type.getSearchText(item).toLowerCase().includes(q)
      );
      if (matched.length > 0) {
        groups.push({ ...type, items: matched.slice(0, 4), total: matched.length });
      }
    }
    return groups;
  }, [query, data]);

  const flatItems = useMemo(() =>
    results.flatMap(g => g.items.map(item => ({ item, type: g }))),
    [results]
  );

  const handleSelect = (item, type) => {
    const navState = type.getNavState ? type.getNavState(item) : undefined;
    navigate(type.getPath(item), navState ? { state: navState } : undefined);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, flatItems.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && flatItems[selectedIdx]) {
      const { item, type } = flatItems[selectedIdx];
      handleSelect(item, type);
    }
  };

  if (!open) return null;

  let flatIdx = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', zIndex: 500 }}
      />

      {/* Panel */}
      <div className="fade-up" style={{
        position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(640px, calc(100vw - 32px))',
        background: tokens.bgCard,
        border: `1px solid ${tokens.border}`,
        borderRadius: '16px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.24)',
        zIndex: 501,
        overflow: 'hidden',
      }}>

        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px',
          borderBottom: query.trim().length >= 2 ? `1px solid ${tokens.border}` : '1px solid transparent',
        }}>
          <span style={{ fontSize: '18px', color: tokens.textMuted, flexShrink: 0, lineHeight: 1 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, notes, goals, projects..."
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: tokens.textPrimary, fontSize: '16px', fontFamily: fonts.body,
              caretColor: tokens.accent,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.textMuted, fontSize: '13px', padding: '3px 6px', borderRadius: '4px', lineHeight: 1, fontFamily: fonts.body }}
            >✕</button>
          )}
          <kbd style={{ fontSize: '10px', color: tokens.textMuted, border: `1px solid ${tokens.border}`, borderRadius: '4px', padding: '2px 6px', fontFamily: fonts.body, flexShrink: 0, background: tokens.bgInput }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '16px' }}>
                Type 2+ characters to search across all your data
              </div>
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                {ENTITY_TYPES.map(t => (
                  <span key={t.key} style={{
                    fontSize: '10px', color: tokens.textMuted,
                    background: tokens.bgInput, border: `1px solid ${tokens.border}`,
                    borderRadius: '6px', padding: '3px 8px',
                  }}>
                    {t.icon} {t.label}
                  </span>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: '13px', color: tokens.textMuted }}>
              No results for <strong style={{ color: tokens.textSecondary }}>"{query}"</strong>
            </div>
          ) : (
            <div style={{ paddingBottom: '8px' }}>
              {results.map(group => (
                <div key={group.key}>
                  {/* Group header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 20px 4px' }}>
                    <span style={{ fontSize: '11px', color: group.color }}>{group.icon}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {group.label}
                    </span>
                    {group.total > group.items.length && (
                      <span style={{ fontSize: '10px', color: tokens.textMuted, marginLeft: 'auto' }}>
                        +{group.total - group.items.length} more
                      </span>
                    )}
                  </div>

                  {/* Items */}
                  {group.items.map(item => {
                    const idx = flatIdx++;
                    const isSelected = idx === selectedIdx;
                    const subtitle = group.getSubtitle(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item, group)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '9px 20px', border: 'none', textAlign: 'left',
                          background: isSelected ? tokens.accentDim : 'transparent',
                          cursor: 'pointer', fontFamily: fonts.body, transition: 'background 0.08s',
                        }}
                      >
                        <span style={{ fontSize: '13px', color: group.color, flexShrink: 0, opacity: 0.7, width: 16, textAlign: 'center' }}>
                          {group.icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '14px', lineHeight: 1.3,
                            color: isSelected ? tokens.textPrimary : tokens.textSecondary,
                            fontWeight: isSelected ? 600 : 400,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {group.getTitle(item)}
                          </div>
                          {subtitle && (
                            <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {subtitle}
                            </div>
                          )}
                        </div>
                        {isSelected && <span style={{ fontSize: '11px', color: tokens.textMuted, flexShrink: 0 }}>↵</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer keyboard hints */}
        {flatItems.length > 0 && (
          <div style={{ padding: '8px 20px', borderTop: `1px solid ${tokens.border}`, display: 'flex', gap: '16px', fontSize: '10px', color: tokens.textMuted }}>
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>Esc close</span>
          </div>
        )}
      </div>
    </>
  );
}
