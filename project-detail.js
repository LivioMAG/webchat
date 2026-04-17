const CONFIG_PATH = './supabase-config.json';
const NOTES_TABLE = 'notes';
const PROJECT_NOTE_TYPE = 'pro';
const NOTE_STORAGE_BUCKET = 'crm-note-attachments';
const GRID_SIZE = 24;
const DEFAULT_NOTE_CATEGORY = 'information';
const NOTE_CARD_WIDTH = 148;
const NOTE_CARD_HEIGHT = 136;
const NOTE_PREVIEW_LENGTH = 60;
const NOTE_FLOW_FALLBACK_NAME = 'Unbekannt';
const NOTE_CATEGORY_INFO = 'information';
const NOTE_CATEGORY_TASK = 'aufgabe';

const state = {
  supabase: null,
  user: null,
  projectId: '',
  profiles: [],
  notes: [],
  activeNote: null,
  pendingPosition: { x: GRID_SIZE, y: GRID_SIZE },
  drag: null,
  showOutgoingOnly: false,
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  hydrateMeta();
  await initializeSupabase();
  await loadData();
}

function cacheElements() {
  elements.projectMeta = document.getElementById('projectMeta');
  elements.backButton = document.getElementById('backIconButton');
  elements.toggleOutgoingButton = document.getElementById('toggleOutgoingButton');
  elements.canvas = document.getElementById('dashboardCanvas');
  elements.alert = document.getElementById('statusAlert');
  elements.modal = document.getElementById('noteModal');
  elements.closeNoteModalButton = document.getElementById('closeNoteModalButton');
  elements.noteForm = document.getElementById('noteForm');
  elements.recipientUidInput = document.getElementById('recipientUidInput');
  elements.noteCategoryInput = document.getElementById('noteCategoryInput');
  elements.noteTextInput = document.getElementById('noteTextInput');
  elements.visibleFromInput = document.getElementById('visibleFromInput');
  elements.requiresResponseInput = document.getElementById('requiresResponseInput');
  elements.noteAttachmentInput = document.getElementById('noteAttachmentInput');
  elements.deleteNoteButton = document.getElementById('deleteNoteButton');
  elements.existingAttachments = document.getElementById('existingAttachments');
  elements.noteFlowList = document.getElementById('noteFlowList');
}

function bindEvents() {
  elements.backButton?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = './index.html';
  });
  elements.toggleOutgoingButton?.addEventListener('click', toggleOutgoingView);

  elements.canvas?.addEventListener('dblclick', handleCanvasDoubleClick);
  elements.canvas?.addEventListener('pointerdown', handleCanvasPointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('resize', handleWindowResize);

  elements.noteForm?.addEventListener('submit', handleSaveNote);
  elements.closeNoteModalButton?.addEventListener('click', closeModal);
  elements.modal?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeNoteModal === 'true') {
      closeModal();
    }
  });
  elements.deleteNoteButton?.addEventListener('click', handleDeleteNote);
}

function hydrateMeta() {
  const params = new URLSearchParams(window.location.search);
  const commission = (params.get('commission') || '').trim();
  const name = (params.get('name') || '').trim();
  state.projectId = (params.get('projectId') || '').trim();
  const meta = [commission, name].filter(Boolean).join(' · ');

  if (elements.projectMeta) {
    elements.projectMeta.textContent = meta;
    elements.projectMeta.hidden = meta.length === 0;
  }

  if (!state.projectId) {
    showAlert('Projekt-ID fehlt. Notizen können nicht geladen werden.', true);
  }
}

async function initializeSupabase() {
  const config = await fetch(CONFIG_PATH, { cache: 'no-store' }).then((res) => res.json());
  state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data: sessionData } = await state.supabase.auth.getSession();
  state.user = sessionData?.session?.user || null;
}

async function loadData() {
  if (!state.projectId) return;

  try {
    const [notesResult, profilesResult] = await Promise.all([
      state.supabase.from(NOTES_TABLE).select('*').eq('note_type', PROJECT_NOTE_TYPE).eq('target_uid', state.projectId).order('created_at', { ascending: false }),
      state.supabase.from('app_profiles').select('id,full_name,email').order('full_name', { ascending: true }),
    ]);

    if (notesResult.error) throw notesResult.error;
    if (profilesResult.error) throw profilesResult.error;

    state.notes = notesResult.data || [];
    state.profiles = profilesResult.data || [];

    renderCanvas();
    renderRecipientOptions();
  } catch (error) {
    showAlert(`Notizen konnten nicht geladen werden: ${error.message}`, true);
  }
}

function renderRecipientOptions() {
  if (!elements.recipientUidInput) return;
  const options = state.profiles
    .map((profile) => `<option value="${escapeAttribute(profile.id)}">${escapeHtml(profile.full_name || profile.email || profile.id)}</option>`)
    .join('');
  elements.recipientUidInput.innerHTML = options;
}

function renderCanvas() {
  if (!elements.canvas) return;
  elements.canvas.querySelectorAll('.note-icon').forEach((node) => node.remove());

  for (const note of getVisibleNotes()) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'note-icon';
    node.dataset.noteId = String(note.id || '');

    const x = snapToGrid(Number(note.note_pos_x ?? GRID_SIZE));
    const y = snapToGrid(Number(note.note_pos_y ?? GRID_SIZE));
    const clamped = clampPosition({ x, y });
    node.style.left = `${clamped.x}px`;
    node.style.top = `${clamped.y}px`;

    const flow = getNoteFlow(note);
    const latestEntry = flow[flow.length - 1] || null;
    const previewText = String(latestEntry?.message || note.note_text || '');
    const previewAuthor = String(latestEntry?.author_name || resolveProfileName(latestEntry?.author_uid) || NOTE_FLOW_FALLBACK_NAME);
    node.title = `${previewAuthor}: ${previewText}`;
    const categoryIcon = getCategoryIcon(note.note_category);
    node.innerHTML = `
      <span class="note-category-badge" aria-hidden="true">${escapeHtml(categoryIcon)}</span>
      <div class="note-icon-title">${escapeHtml(buildTitleFromText(previewText))}</div>
    `;
    node.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      openModalForNote(note.id);
    });
    elements.canvas.appendChild(node);
  }
}

function handleCanvasDoubleClick(event) {
  if (!(event.target instanceof HTMLElement)) return;
  if (event.target.closest('.note-icon')) return;

  const rect = elements.canvas.getBoundingClientRect();
  const x = snapToGrid(event.clientX - rect.left - NOTE_CARD_WIDTH / 2);
  const y = snapToGrid(event.clientY - rect.top - NOTE_CARD_HEIGHT / 2);
  state.pendingPosition = clampPosition({ x, y });
  openModalForCreate();
}

function handleCanvasPointerDown(event) {
  const noteNode = event.target instanceof HTMLElement ? event.target.closest('.note-icon') : null;
  if (!noteNode || !(noteNode instanceof HTMLElement)) return;

  const noteId = String(noteNode.dataset.noteId || '');
  const rect = elements.canvas.getBoundingClientRect();
  const left = parseFloat(noteNode.style.left || '0');
  const top = parseFloat(noteNode.style.top || '0');

  state.drag = {
    noteId,
    offsetX: event.clientX - rect.left - left,
    offsetY: event.clientY - rect.top - top,
    node: noteNode,
    hasMoved: false,
  };
  noteNode.classList.add('dragging');
  noteNode.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (!state.drag || !elements.canvas) return;
  state.drag.hasMoved = true;

  const rect = elements.canvas.getBoundingClientRect();
  const x = snapToGrid(event.clientX - rect.left - state.drag.offsetX);
  const y = snapToGrid(event.clientY - rect.top - state.drag.offsetY);
  const clamped = clampPosition({ x, y });

  state.drag.node.style.left = `${clamped.x}px`;
  state.drag.node.style.top = `${clamped.y}px`;
}

async function handlePointerUp() {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  drag.node.classList.remove('dragging');

  if (!drag.hasMoved) return;
  const x = snapToGrid(parseFloat(drag.node.style.left || '0'));
  const y = snapToGrid(parseFloat(drag.node.style.top || '0'));

  const existing = state.notes.find((note) => String(note.id) === String(drag.noteId));
  if (!existing) return;

  try {
    const { error } = await state.supabase.from(NOTES_TABLE).update({ note_pos_x: x, note_pos_y: y }).eq('id', drag.noteId);
    if (error) throw error;

    existing.note_pos_x = x;
    existing.note_pos_y = y;
  } catch (error) {
    showAlert(`Position konnte nicht gespeichert werden: ${error.message}`, true);
  }
}

function openModalForCreate() {
  state.activeNote = null;
  elements.deleteNoteButton?.classList.add('hidden');
  elements.noteForm?.reset();
  elements.noteCategoryInput.value = DEFAULT_NOTE_CATEGORY;
  const me = state.user?.id || '';
  if (me) elements.recipientUidInput.value = me;
  if (elements.visibleFromInput) elements.visibleFromInput.value = '';
  if (elements.requiresResponseInput) elements.requiresResponseInput.checked = false;
  if (elements.existingAttachments) {
    elements.existingAttachments.innerHTML = '<span class="subtle-text">Noch keine Anhänge vorhanden.</span>';
  }
  renderFlowList([]);
  elements.modal?.classList.remove('hidden');
}

function openModalForNote(noteId) {
  const note = state.notes.find((item) => String(item.id) === String(noteId));
  if (!note) return;
  state.activeNote = note;

  elements.noteTextInput.value = '';
  elements.noteCategoryInput.value = normalizeCategory(note.note_category);
  elements.recipientUidInput.value = note.recipient_uid || state.user?.id || '';
  elements.visibleFromInput.value = toDateInputValue(note.visible_from_date);
  elements.requiresResponseInput.checked = Boolean(note.requires_response);
  elements.noteAttachmentInput.value = '';
  elements.deleteNoteButton?.classList.remove('hidden');

  const attachments = Array.isArray(note.attachments) ? note.attachments : [];
  elements.existingAttachments.innerHTML = attachments.length
    ? `<strong>Vorhandene Anhänge:</strong> ${attachments
      .map((attachment) => `<a href="${escapeAttribute(attachment.publicUrl || '#')}" target="_blank" rel="noopener">${escapeHtml(attachment.name || 'Anhang')}</a>`)
      .join(' · ')}`
    : '<span class="subtle-text">Keine Anhänge vorhanden.</span>';
  renderFlowList(getNoteFlow(note));

  elements.modal?.classList.remove('hidden');
}

function closeModal() {
  elements.modal?.classList.add('hidden');
  state.activeNote = null;
}

async function handleSaveNote(event) {
  event.preventDefault();
  if (!state.projectId) return;

  const senderUid = String(state.user?.id || '').trim();
  const recipientUid = String(elements.recipientUidInput.value || '').trim();
  const noteText = String(elements.noteTextInput.value || '').trim();
  const noteCategory = normalizeCategory(elements.noteCategoryInput.value);
  const visibleFromDate = String(elements.visibleFromInput.value || '').trim() || null;
  const requiresResponse = Boolean(elements.requiresResponseInput.checked);

  if (!senderUid || !recipientUid || !noteText) {
    showAlert('Aktiver Benutzer, Empfänger oder Notiztext fehlt.', true);
    return;
  }

  try {
    const newAttachments = await uploadAttachments(senderUid, state.projectId, elements.noteAttachmentInput.files);
    const flowEntry = buildFlowEntry({
      authorUid: senderUid,
      message: noteText,
      attachments: newAttachments,
    });

    if (!state.activeNote) {
      const payload = {
        target_uid: state.projectId,
        note_type: PROJECT_NOTE_TYPE,
        note_text: flowEntry.message,
        sender_uid: senderUid,
        recipient_uid: recipientUid,
        note_category: noteCategory,
        visible_from_date: visibleFromDate,
        requires_response: requiresResponse,
        note_ranking: 2,
        attachments: newAttachments,
        note_flow: [flowEntry],
        note_pos_x: state.pendingPosition.x,
        note_pos_y: state.pendingPosition.y,
      };
      const { error } = await state.supabase.from(NOTES_TABLE).insert(payload);
      if (error) throw error;
      showAlert('Projekt-Notiz gespeichert.', false);
    } else {
      const existingFlow = getNoteFlow(state.activeNote);
      const mergedFlow = [...existingFlow, flowEntry];
      const mergedAttachments = mergedFlow.flatMap((entry) => (Array.isArray(entry.attachments) ? entry.attachments : []));
      const { error } = await state.supabase
        .from(NOTES_TABLE)
        .update({
          note_text: flowEntry.message,
          recipient_uid: recipientUid,
          note_category: noteCategory,
          visible_from_date: visibleFromDate,
          requires_response: requiresResponse,
          attachments: mergedAttachments,
          note_flow: mergedFlow,
        })
        .eq('id', state.activeNote.id);
      if (error) throw error;
      showAlert('Projekt-Notiz aktualisiert.', false);
    }

    closeModal();
    await loadData();
  } catch (error) {
    showAlert(`Notiz konnte nicht gespeichert werden: ${error.message}`, true);
  }
}

async function handleDeleteNote() {
  if (!state.activeNote) return;
  if (!window.confirm('Diese Notiz wirklich löschen?')) return;

  try {
    const { error } = await state.supabase.from(NOTES_TABLE).delete().eq('id', state.activeNote.id);
    if (error) throw error;

    showAlert('Notiz gelöscht.', false);
    closeModal();
    await loadData();
  } catch (error) {
    showAlert(`Notiz konnte nicht gelöscht werden: ${error.message}`, true);
  }
}

async function uploadAttachments(senderUid, projectId, fileList) {
  const files = Array.from(fileList || []).filter((file) => String(file.type || '').toLowerCase() === 'application/pdf' || String(file.name || '').toLowerCase().endsWith('.pdf'));
  if (!files.length) return [];

  const entries = [];
  for (const file of files) {
    const path = `${senderUid}/${projectId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const { error } = await state.supabase.storage.from(NOTE_STORAGE_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/pdf' });
    if (error) throw error;
    const { data } = state.supabase.storage.from(NOTE_STORAGE_BUCKET).getPublicUrl(path);
    entries.push({ name: file.name, mimeType: file.type || 'application/pdf', size: file.size, path, bucket: NOTE_STORAGE_BUCKET, publicUrl: data?.publicUrl || '' });
  }
  return entries;
}

function showAlert(message, isError) {
  if (!elements.alert) return;
  elements.alert.textContent = message;
  elements.alert.classList.remove('hidden', 'error', 'success');
  elements.alert.classList.add(isError ? 'error' : 'success');
}

function buildTitleFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Notiz';
  if (normalized.length <= NOTE_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, NOTE_PREVIEW_LENGTH)}…`;
}

function getCategoryIcon(category) {
  const normalized = normalizeCategory(category);
  if (normalized === NOTE_CATEGORY_TASK) return '🔨';
  return 'i';
}

function normalizeCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  return normalized === NOTE_CATEGORY_TASK ? NOTE_CATEGORY_TASK : NOTE_CATEGORY_INFO;
}

function toggleOutgoingView() {
  state.showOutgoingOnly = !state.showOutgoingOnly;
  if (elements.toggleOutgoingButton) {
    elements.toggleOutgoingButton.textContent = state.showOutgoingOnly ? 'Eingehende Notizen' : 'Ausgehende Notizen';
  }
  renderCanvas();
}

function getVisibleNotes() {
  const me = String(state.user?.id || '');
  if (!me) return [];
  if (state.showOutgoingOnly) {
    return state.notes.filter((note) => String(note.sender_uid || '') === me);
  }

  return state.notes.filter((note) => {
    const recipientUid = String(note.recipient_uid || '');
    const senderUid = String(note.sender_uid || '');
    const needsResponse = Boolean(note.requires_response);
    const isRecipient = recipientUid === me;
    const isSenderWithResponse = senderUid === me && needsResponse;
    if (!isRecipient && !isSenderWithResponse) return false;
    if (!isRecipient) return true;
    return isVisibleByDate(note.visible_from_date);
  });
}

function isVisibleByDate(value) {
  if (!value) return true;
  const visibleFrom = new Date(value);
  if (Number.isNaN(visibleFrom.getTime())) return true;
  const now = new Date();
  return visibleFrom.getTime() <= now.getTime();
}

function toDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNoteFlow(note) {
  const flow = Array.isArray(note?.note_flow) ? note.note_flow : [];
  if (flow.length) {
    return flow
      .map((entry) => normalizeFlowEntry(entry))
      .filter((entry) => entry.message || entry.attachments.length);
  }

  const legacyMessage = String(note?.note_text || '').trim();
  const legacyAttachments = Array.isArray(note?.attachments) ? note.attachments : [];
  if (!legacyMessage && !legacyAttachments.length) return [];
  return [
    buildFlowEntry({
      authorUid: note?.sender_uid || '',
      authorName: resolveProfileName(note?.sender_uid),
      message: legacyMessage,
      attachments: legacyAttachments,
      createdAt: note?.created_at || new Date().toISOString(),
      id: note?.id ? `${note.id}-legacy` : crypto.randomUUID(),
    }),
  ];
}

function buildFlowEntry({ authorUid, authorName, message, attachments, createdAt, id }) {
  return {
    id: id || crypto.randomUUID(),
    author_uid: String(authorUid || ''),
    author_name: String(authorName || resolveProfileName(authorUid) || NOTE_FLOW_FALLBACK_NAME),
    message: String(message || '').trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    created_at: String(createdAt || new Date().toISOString()),
  };
}

function normalizeFlowEntry(entry) {
  return buildFlowEntry({
    id: entry?.id,
    authorUid: entry?.author_uid,
    authorName: entry?.author_name,
    message: entry?.message,
    attachments: entry?.attachments,
    createdAt: entry?.created_at,
  });
}

function resolveProfileName(profileId) {
  if (!profileId) return '';
  const profile = state.profiles.find((item) => String(item.id) === String(profileId));
  return String(profile?.full_name || profile?.email || '');
}

function renderFlowList(flowEntries) {
  if (!elements.noteFlowList) return;
  if (!flowEntries.length) {
    elements.noteFlowList.innerHTML = '<p class="subtle-text">Noch keine Kommentare vorhanden.</p>';
    return;
  }

  elements.noteFlowList.innerHTML = flowEntries
    .map((entry) => {
      const createdLabel = formatFlowTimestamp(entry.created_at);
      const links = Array.isArray(entry.attachments) && entry.attachments.length
        ? `<div class="flow-entry-attachments"><strong>Anhänge:</strong> ${entry.attachments
          .map((attachment) => `<a href="${escapeAttribute(attachment.publicUrl || '#')}" target="_blank" rel="noopener">${escapeHtml(attachment.name || 'Anhang')}</a>`)
          .join(' · ')}</div>`
        : '';
      return `
        <article class="flow-entry">
          <div class="flow-entry-header">
            <span class="flow-entry-author">${escapeHtml(entry.author_name || NOTE_FLOW_FALLBACK_NAME)}</span>
            <span>${escapeHtml(createdLabel)}</span>
          </div>
          <p class="flow-entry-message">${escapeHtml(entry.message || '–')}</p>
          ${links}
        </article>
      `;
    })
    .join('');
}

function formatFlowTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Zeit unbekannt';
  return new Intl.DateTimeFormat('de-CH', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function snapToGrid(value) {
  return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function clampPosition(position) {
  const canvas = elements.canvas;
  if (!canvas) return { x: position.x, y: position.y };
  const maxX = Math.max(0, canvas.clientWidth - NOTE_CARD_WIDTH);
  const maxY = Math.max(0, canvas.clientHeight - NOTE_CARD_HEIGHT);
  return {
    x: Math.max(0, Math.min(maxX, position.x)),
    y: Math.max(0, Math.min(maxY, position.y)),
  };
}

function handleWindowResize() {
  renderCanvas();
}

function sanitizeFileName(name) {
  return String(name || 'attachment.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
