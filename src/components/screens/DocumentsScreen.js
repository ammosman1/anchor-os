// src/components/screens/DocumentsScreen.js
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addDocument, deleteDocument, addTask } from '../../lib/db';
import { Button, Modal, Spinner } from '../ui';

const isDev = process.env.NODE_ENV !== 'production';

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3 MB

const CATEGORY_LABELS = {
  bank_statement: 'Bank Statement',
  credit_card:    'Credit Card',
  invoice:        'Invoice',
  receipt:        'Receipt',
  tax:            'Tax',
  insurance:      'Insurance',
  medical:        'Medical',
  contract:       'Contract',
  utility:        'Utility',
  paycheck:       'Paycheck',
  other:          'Other',
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Strip data URI prefix, keep only base64 part
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CURRENT_YEAR  = new Date().getFullYear();
const CURRENT_MONTH_NAME = new Date().toLocaleString('en-US', { month: 'long' });

export default function DocumentsScreen() {
  const { user }       = useAuth();
  const { documents, tasks } = useData();
  const fileInputRef   = useRef(null);

  const [uploading,    setUploading]    = useState(false);
  const [progress,     setProgress]     = useState(0);
  const [extracting,   setExtracting]   = useState(false);
  const [uploadError,  setUploadError]  = useState('');
  const [selected,     setSelected]     = useState(null);
  const [deleteConf,   setDeleteConf]   = useState(null);
  const [deleting,     setDeleting]     = useState(false);
  const [filterCat,    setFilterCat]    = useState('');
  const [filterYear,   setFilterYear]   = useState('');
  const [monthTaskCreated, setMonthTaskCreated] = useState(false);

  // Auto-create monthly "Upload statements" task if not already present
  useEffect(() => {
    if (!user || !tasks || monthTaskCreated) return;
    const taskTitle = `Upload ${CURRENT_MONTH_NAME} ${CURRENT_YEAR} statements`;
    const alreadyExists = tasks.some(t => !t.done && t.title === taskTitle);
    if (!alreadyExists) {
      addTask(user.uid, {
        title:    taskTitle,
        priority: 'medium',
        project:  'Inbox',
        context:  'financial',
        notes:    'Monthly document upload reminder',
        status:   'pending',
        tags:     ['documents', 'financial'],
        source:   'auto',
      }).catch(() => {});
    }
    setMonthTaskCreated(true);
  }, [user, tasks, monthTaskCreated]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setUploadError(`File too large (${fmtBytes(file.size)}). Maximum 3 MB.`);
      return;
    }

    const isPdf   = file.type === 'application/pdf';
    const isImage = file.type.startsWith('image/');
    if (!isPdf && !isImage) {
      setUploadError('Only PDF and image files are supported.');
      return;
    }

    setUploadError('');
    setUploading(true);
    setProgress(0);

    try {
      // 1. Upload to Firebase Storage
      const storagePath = `users/${user.uid}/documents/${Date.now()}_${file.name}`;
      const storageRef  = ref(storage, storagePath);
      const uploadTask  = uploadBytesResumable(storageRef, file);

      const downloadUrl = await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 80)),
          reject,
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          }
        );
      });

      setProgress(85);
      setExtracting(true);

      // 2. Extract metadata via AI
      let extracted = {};
      try {
        const base64 = await fileToBase64(file);
        const res    = await fetch('/api/documents/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: base64, mimeType: file.type }),
        });
        if (res.ok) extracted = await res.json();
      } catch (err) {
        if (isDev) console.warn('Extraction failed, saving without metadata:', err);
      }

      setProgress(95);
      setExtracting(false);

      // 3. Save to Firestore
      const now = new Date();
      await addDocument(user.uid, {
        name:        extracted.suggestedTitle || file.name,
        fileName:    file.name,
        fileSize:    file.size,
        fileType:    file.type,
        storageUrl:  downloadUrl,
        storagePath,
        category:    extracted.category || 'other',
        year:        extracted.year  || now.getFullYear(),
        month:       extracted.month || (now.getMonth() + 1),
        vendor:      extracted.vendor      || null,
        amount:      extracted.amount      ?? null,
        docDate:     extracted.date        || null,
        description: extracted.description || null,
      });

      setProgress(100);
    } catch (err) {
      if (isDev) console.error('Upload error:', err);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setExtracting(false);
      setTimeout(() => setProgress(0), 1500);
    }
  };

  const handleDelete = async () => {
    if (!deleteConf || deleting) return;
    setDeleting(true);
    try {
      // Delete from Storage
      if (deleteConf.storagePath) {
        try {
          await deleteObject(ref(storage, deleteConf.storagePath));
        } catch (err) { if (isDev) console.warn('Storage delete failed:', err); }
      }
      // Delete from Firestore
      await deleteDocument(user.uid, deleteConf.id);
      setDeleteConf(null);
      if (selected?.id === deleteConf.id) setSelected(null);
    } finally {
      setDeleting(false);
    }
  };

  const allYears = useMemo(() =>
    [...new Set((documents || []).map(d => d.year).filter(Boolean))].sort((a, b) => b - a),
    [documents]
  );

  const allCategories = useMemo(() =>
    [...new Set((documents || []).map(d => d.category).filter(Boolean))],
    [documents]
  );

  const filtered = useMemo(() => {
    return (documents || []).filter(d => {
      if (filterCat  && d.category !== filterCat)  return false;
      if (filterYear && d.year     !== parseInt(filterYear)) return false;
      return true;
    });
  }, [documents, filterCat, filterYear]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>Documents</h1>
          {documents.length > 0 && <div style={{ fontSize: '13px', color: tokens.textMuted, marginTop: '4px' }}>{documents.length} document{documents.length !== 1 ? 's' : ''}</div>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(uploading || extracting) && <Spinner size={14} />}
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            variant="accent"
          >
            {uploading ? (extracting ? '✦ Extracting…' : `Uploading ${progress}%`) : '↑ Upload Document'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Upload error */}
      {uploadError && (
        <div style={{ padding: '10px 14px', background: tokens.redDim, border: `1px solid ${tokens.red}`, borderRadius: '8px', marginBottom: '12px', fontSize: '13px', color: tokens.red, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{uploadError}</span>
          <button onClick={() => setUploadError('')} style={{ background: 'none', border: 'none', color: tokens.red, cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
      )}

      {/* Upload progress bar */}
      {uploading && progress > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ height: 4, background: tokens.border, borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: tokens.accent, borderRadius: 99, transition: 'width 0.3s ease' }} />
          </div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>
            {extracting ? '✦ Analyzing document with AI…' : `Uploading… ${progress}%`}
          </div>
        </div>
      )}

      {/* Filters */}
      {documents.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            style={{ padding: '6px 10px', background: tokens.bgCard, border: `1px solid ${filterCat ? tokens.accent : tokens.border}`, borderRadius: '7px', color: filterCat ? tokens.accent : tokens.textMuted, fontSize: '12px', fontFamily: fonts.body, outline: 'none', cursor: 'pointer' }}>
            <option value="">All categories</option>
            {allCategories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </select>
          {allYears.length > 1 && (
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
              style={{ padding: '6px 10px', background: tokens.bgCard, border: `1px solid ${filterYear ? tokens.accent : tokens.border}`, borderRadius: '7px', color: filterYear ? tokens.accent : tokens.textMuted, fontSize: '12px', fontFamily: fonts.body, outline: 'none', cursor: 'pointer' }}>
              <option value="">All years</option>
              {allYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {(filterCat || filterYear) && (
            <button onClick={() => { setFilterCat(''); setFilterYear(''); }}
              style={{ padding: '6px 10px', background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '7px', color: tokens.textMuted, fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {documents.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: tokens.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>▣</div>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: tokens.textSecondary }}>No documents yet</div>
          <div style={{ fontSize: '13px', marginBottom: '20px', lineHeight: 1.6 }}>
            Upload bank statements, invoices, receipts, and contracts. AI extracts key details automatically.
          </div>
          <Button onClick={() => fileInputRef.current?.click()} variant="accent">↑ Upload First Document</Button>
        </div>
      )}

      {/* Document list */}
      {filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(doc => (
            <div key={doc.id}
              onClick={() => setSelected(doc)}
              style={{
                background: tokens.bgCard, border: `1px solid ${selected?.id === doc.id ? tokens.accent : tokens.border}`,
                borderRadius: '10px', padding: '12px 16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '12px',
                transition: 'border-color 0.12s',
              }}
              onMouseEnter={e => { if (selected?.id !== doc.id) e.currentTarget.style.borderColor = tokens.borderHover; }}
              onMouseLeave={e => { if (selected?.id !== doc.id) e.currentTarget.style.borderColor = tokens.border; }}
            >
              {/* Icon */}
              <div style={{ width: 36, height: 36, borderRadius: '8px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                {doc.fileType === 'application/pdf' ? '📄' : '🖼'}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.name}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {doc.category && (
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: tokens.accentDim, color: tokens.accent, fontWeight: 600 }}>
                      {CATEGORY_LABELS[doc.category] || doc.category}
                    </span>
                  )}
                  {doc.vendor && <span style={{ fontSize: '10px', color: tokens.textSecondary }}>{doc.vendor}</span>}
                  {doc.amount != null && (
                    <span style={{ fontSize: '10px', color: tokens.green, fontWeight: 600 }}>
                      ${typeof doc.amount === 'number' ? doc.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : doc.amount}
                    </span>
                  )}
                  {doc.month && doc.year && (
                    <span style={{ fontSize: '10px', color: tokens.textMuted }}>{MONTH_NAMES[(doc.month || 1) - 1]} {doc.year}</span>
                  )}
                </div>
              </div>

              {/* Date + size */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '11px', color: tokens.textMuted }}>{fmtDate(doc.createdAt)}</div>
                {doc.fileSize && <div style={{ fontSize: '10px', color: tokens.textDisabled, marginTop: '2px' }}>{fmtBytes(doc.fileSize)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {documents.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: tokens.textMuted, fontSize: '13px' }}>No documents match the selected filters.</div>
      )}

      {/* Detail panel */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || 'Document'}>
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Category + date row */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selected.category && (
                <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', background: tokens.accentDim, color: tokens.accent, fontWeight: 600 }}>
                  {CATEGORY_LABELS[selected.category] || selected.category}
                </span>
              )}
              {selected.month && selected.year && (
                <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', background: tokens.bgGlass, color: tokens.textSecondary, border: `1px solid ${tokens.border}` }}>
                  {MONTH_NAMES[(selected.month || 1) - 1]} {selected.year}
                </span>
              )}
            </div>

            {/* Extracted info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {selected.vendor && (
                <div style={{ padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Vendor</div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{selected.vendor}</div>
                </div>
              )}
              {selected.amount != null && (
                <div style={{ padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Amount</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: tokens.green, fontFamily: fonts.display }}>
                    ${typeof selected.amount === 'number' ? selected.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }) : selected.amount}
                  </div>
                </div>
              )}
              {selected.docDate && (
                <div style={{ padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Document Date</div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{selected.docDate}</div>
                </div>
              )}
              {selected.fileSize && (
                <div style={{ padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>File Size</div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{fmtBytes(selected.fileSize)}</div>
                </div>
              )}
            </div>

            {/* AI description */}
            {selected.description && (
              <div style={{ padding: '12px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>✦ AI Summary</div>
                <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>{selected.description}</div>
              </div>
            )}

            {/* Original file name */}
            {selected.fileName && selected.fileName !== selected.name && (
              <div style={{ fontSize: '11px', color: tokens.textMuted }}>Original file: {selected.fileName}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: `1px solid ${tokens.border}` }}>
              <Button onClick={() => setDeleteConf(selected)} variant="ghost" style={{ color: tokens.red, borderColor: tokens.red }}>Delete</Button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button onClick={() => setSelected(null)} variant="ghost">Close</Button>
                <a href={selected.storageUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <Button variant="accent">↓ Download</Button>
                </a>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteConf} onClose={() => setDeleteConf(null)} title="Delete Document">
        {deleteConf && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: tokens.textSecondary, lineHeight: 1.6 }}>
              Permanently delete <strong style={{ color: tokens.textPrimary }}>{deleteConf.name}</strong>? The file will be removed from storage and cannot be recovered.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setDeleteConf(null)} variant="ghost">Cancel</Button>
              <Button onClick={handleDelete} loading={deleting} variant="danger">Delete Permanently</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
