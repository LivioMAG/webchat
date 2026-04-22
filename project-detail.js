const CONFIG_PATH = './supabase-config.json';
const KANBAN_TABLE = 'project_kanban_notes';
const KANBAN_ATTACHMENT_BUCKET = 'project-kanban-attachments';
const KANBAN_COLUMNS = [
  { key: 'todo', label: 'Neue Aufträge' },
  { key: 'planned', label: 'AVOR' },
  { key: 'in_progress', label: 'In Bearbeitung' },
  { key: 'review', label: 'Backoffice' },
  { key: 'done', label: 'Erledigt' },
];

const state = {
  supabase: null,
  projectId: '',
  project: null,
  notes: [],
  draggedNoteId: '',
  currentUser: null,
  pendingAttachmentNoteId: '',
  todoOpenMap: {},
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  state.projectId = getProjectId();
  if (!state.projectId) {
    showAlert('Projekt-ID fehlt.', true);
    return;
  }

  try {
    await initializeSupabase();
    await loadData();
  } catch (error) {
    showAlert(error.message || 'Projekt konnte nicht geladen werden.', true);
  }
}

function cacheElements() {
  elements.projectTitle = document.getElementById('projectTitle');
  elements.projectMeta = document.getElementById('projectMeta');
  elements.kanbanBoard = document.getElementById('kanbanBoard');
  elements.backButton = document.getElementById('backButton');
  elements.alert = document.getElementById('alert');
  elements.addTaskButton = document.getElementById('addTaskButton');
  elements.attachmentInput = document.getElementById('attachmentInput');
}

function bindEvents() {
  elements.backButton?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = './index.html';
  });

  elements.addTaskButton?.addEventListener('click', () => createNote('todo'));
  elements.kanbanBoard?.addEventListener('click', handleBoardClick);
  elements.kanbanBoard?.addEventListener('change', handleBoardChange);
  elements.kanbanBoard?.addEventListener('keydown', handleBoardKeydown);
  elements.kanbanBoard?.addEventListener('dragstart', handleDragStart);
  elements.kanbanBoard?.addEventListener('dragover', handleDragOver);
  elements.kanbanBoard?.addEventListener('drop', handleDrop);
  elements.kanbanBoard?.addEventListener('dragend', handleDragEnd);
  elements.attachmentInput?.addEventListener('change', handleAttachmentSelection);
}

function getProjectId() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get('projectId') || '').trim();
}

async function initializeSupabase() {
  if (!window.supabase?.createClient) {
    throw new Error('Supabase SDK fehlt.');
  }
  const response = await fetch(CONFIG_PATH, { cache: 'no-store' });
  if (!response.ok) throw new Error('supabase-config.json fehlt.');
  const config = await response.json();
  state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

async function loadData() {
  const [projectResult, notesResult, userResult] = await Promise.all([
    state.supabase
      .from('projects')
      .select('id, commission_number, name')
      .eq('id', state.projectId)
      .single(),
    state.supabase
      .from(KANBAN_TABLE)
      .select('*')
      .eq('project_id', state.projectId)
      .order('position', { ascending: true }),
    state.supabase.auth.getUser(),
  ]);

  if (projectResult.error) throw projectResult.error;
  if (notesResult.error) throw notesResult.error;

  const currentUid = String(userResult.data?.user?.id || '').trim();
  let profileName = '';
  if (currentUid) {
    const profileResult = await state.supabase
      .from('app_profiles')
      .select('full_name')
      .eq('id', currentUid)
      .maybeSingle();
    profileName = String(profileResult.data?.full_name || '').trim();
  }

  state.project = projectResult.data;
  state.notes = (notesResult.data || []).map(normalizeNote);
  state.currentUser = {
    uid: currentUid || null,
    name: profileName || String(userResult.data?.user?.email || '').trim(),
  };
  loadTodoOpenState();
  render();
}


function loadTodoOpenState() {
  try {
    const raw = window.localStorage.getItem('project-kanban-todo-open-state');
    const parsed = raw ? JSON.parse(raw) : {};
    state.todoOpenMap = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    state.todoOpenMap = {};
  }
}

function saveTodoOpenState() {
  try {
    window.localStorage.setItem('project-kanban-todo-open-state', JSON.stringify(state.todoOpenMap || {}));
  } catch (_error) {
    // ignore localStorage failures
  }
}

function isTodoOpen(noteId) {
  return Boolean(state.todoOpenMap?.[String(noteId)]);
}

function normalizeNote(rawNote) {
  const note = { ...rawNote };
  note.note_type = ['text', 'todo'].includes(note.note_type) ? note.note_type : 'text';
  note.todo_items = Array.isArray(note.todo_items) ? note.todo_items.map(normalizeTodoItem) : [];
  note.attachments = Array.isArray(note.attachments) ? note.attachments : [];
  note.content = String(note.content || '');
  note.todo_description = String(note.todo_description || '');
  return note;
}

function normalizeTodoItem(item) {
  return {
    id: String(item?.id || crypto.randomUUID()),
    text: String(item?.text || ''),
    done: Boolean(item?.done),
  };
}

function render() {
  if (!state.project) return;
  elements.projectTitle.textContent = state.project.name || 'Projekt';
  elements.projectMeta.textContent = `Kommissionsnummer: ${state.project.commission_number || '–'}`;
  renderBoard();
}

function renderBoard() {
  if (!elements.kanbanBoard) return;
  elements.kanbanBoard.innerHTML = KANBAN_COLUMNS.map((column) => {
    const notes = getNotesByColumn(column.key);
    return `
      <article class="kanban-column" data-column-id="${escapeHtml(column.key)}">
        <header class="column-header">
          <h2 class="column-title">${escapeHtml(column.label)}</h2>
          <button class="column-add" type="button" data-action="add-note" data-column="${escapeHtml(column.key)}">＋</button>
        </header>
        <div class="column-body" data-drop-column="${escapeHtml(column.key)}">
          ${notes.length ? notes.map((note) => renderCard(note)).join('') : '<div class="empty-column">Keine Notizen</div>'}
        </div>
      </article>
    `;
  }).join('');
}

function renderCard(note) {
  const noteType = note.note_type || 'text';
  const descriptionField = noteType === 'todo'
    ? `<textarea class="task-description" data-field="todo_description" data-note-id="${escapeHtml(note.id)}" rows="2" placeholder="Beschreibung">${escapeHtml(note.todo_description || '')}</textarea>`
    : `<textarea class="task-description" data-field="content" data-note-id="${escapeHtml(note.id)}" rows="3" placeholder="Notiz hier eingeben ...">${escapeHtml(note.content || '')}</textarea>`;
  const todoExpanded = noteType === 'todo' ? isTodoOpen(note.id) : false;
  const todoSection = noteType === 'todo' ? renderTodoList(note, todoExpanded) : '';
  const attachments = Array.isArray(note.attachments) ? note.attachments : [];

  return `
    <section class="task-card" draggable="true" data-note-id="${escapeHtml(note.id)}">
      <div class="task-header-row">
        <div class="task-type-wrap">
          <span class="task-type-icon">${noteType === 'todo' ? '☑' : '📝'}</span>
          <select class="task-type-select" data-field="note_type" data-note-id="${escapeHtml(note.id)}">
            <option value="text" ${noteType === 'text' ? 'selected' : ''}>Notiz</option>
            <option value="todo" ${noteType === 'todo' ? 'selected' : ''}>To-do</option>
          </select>
        </div>
        <div class="task-actions">
          ${noteType === 'todo' ? `<button class="task-toggle" type="button" data-action="toggle-todo-list" data-note-id="${escapeHtml(note.id)}">${todoExpanded ? 'To-do schließen' : 'To-do öffnen'}</button>` : ''}
          <button class="task-icon" type="button" title="Anhang hinzufügen" data-action="open-attachments" data-note-id="${escapeHtml(note.id)}">📎</button>
          <button class="task-icon" type="button" title="Löschen" data-action="delete-note" data-note-id="${escapeHtml(note.id)}">🗑</button>
        </div>
      </div>

      ${descriptionField}
      ${todoSection}

      <div class="attachments-wrap">
        ${renderAttachmentList(attachments, note.id)}
      </div>

    </section>
  `;
}

function renderTodoList(note, isExpanded) {
  const items = Array.isArray(note.todo_items) ? note.todo_items : [];
  return `
    <div class="todo-list ${isExpanded ? "" : "hidden"}" data-todo-list="${escapeHtml(note.id)}">
      ${items.map((item) => `
        <label class="todo-item">
          <input type="checkbox" data-action="toggle-todo" data-note-id="${escapeHtml(note.id)}" data-item-id="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''} />
          <input class="todo-text ${item.done ? 'done' : ''}" type="text" value="${escapeHtml(item.text)}" data-action="edit-todo" data-note-id="${escapeHtml(note.id)}" data-item-id="${escapeHtml(item.id)}" />
          <button class="todo-remove" type="button" data-action="remove-todo" data-note-id="${escapeHtml(note.id)}" data-item-id="${escapeHtml(item.id)}">✕</button>
        </label>
      `).join('')}
      <input class="todo-add-input" type="text" data-action="add-todo" data-note-id="${escapeHtml(note.id)}" placeholder="To-do hinzufügen und Enter drücken" />
    </div>
  `;
}

function renderAttachmentList(attachments, noteId) {
  if (!attachments.length) {
    return '<p class="attachment-empty">Keine Anhänge</p>';
  }

  return `
    <ul class="attachment-list">
      ${attachments.map((attachment, index) => {
        const name = escapeHtml(String(attachment?.name || `Datei ${index + 1}`));
        const sizeLabel = formatFileSize(attachment?.size || 0);
        return `
          <li class="attachment-item">
            <span class="attachment-name">${name} <small>${sizeLabel}</small></span>
            <span class="attachment-actions">
              <button class="task-action" type="button" data-action="download-attachment" data-note-id="${escapeHtml(noteId)}" data-attachment-index="${index}">Download</button>
              <button class="task-action danger" type="button" data-action="delete-attachment" data-note-id="${escapeHtml(noteId)}" data-attachment-index="${index}">Löschen</button>
            </span>
          </li>
        `;
      }).join('')}
    </ul>
  `;
}

function getNotesByColumn(columnKey) {
  return state.notes
    .filter((note) => String(note.status || 'todo') === columnKey)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

async function handleBoardClick(event) {
  const addButton = event.target.closest('[data-action="add-note"]');
  if (addButton) {
    await createNote(String(addButton.dataset.column || 'todo'));
    return;
  }


  const toggleTodoListButton = event.target.closest('[data-action="toggle-todo-list"]');
  if (toggleTodoListButton) {
    const noteId = String(toggleTodoListButton.dataset.noteId || '');
    if (!noteId) return;
    state.todoOpenMap[noteId] = !isTodoOpen(noteId);
    saveTodoOpenState();
    renderBoard();
    return;
  }

  const deleteButton = event.target.closest('[data-action="delete-note"]');
  if (deleteButton) {
    await deleteNote(String(deleteButton.dataset.noteId || ''));
    return;
  }

  const addAttachmentButton = event.target.closest('[data-action="open-attachments"]');
  if (addAttachmentButton) {
    state.pendingAttachmentNoteId = String(addAttachmentButton.dataset.noteId || '');
    elements.attachmentInput?.click();
    return;
  }

  const deleteAttachmentButton = event.target.closest('[data-action="delete-attachment"]');
  if (deleteAttachmentButton) {
    const noteId = String(deleteAttachmentButton.dataset.noteId || '');
    const attachmentIndex = Number(deleteAttachmentButton.dataset.attachmentIndex || -1);
    await removeAttachment(noteId, attachmentIndex);
    return;
  }

  const downloadAttachmentButton = event.target.closest('[data-action="download-attachment"]');
  if (downloadAttachmentButton) {
    const noteId = String(downloadAttachmentButton.dataset.noteId || '');
    const attachmentIndex = Number(downloadAttachmentButton.dataset.attachmentIndex || -1);
    await downloadAttachment(noteId, attachmentIndex);
    return;
  }

  const removeTodoButton = event.target.closest('[data-action="remove-todo"]');
  if (removeTodoButton) {
    const noteId = String(removeTodoButton.dataset.noteId || '');
    const itemId = String(removeTodoButton.dataset.itemId || '');
    await removeTodoItem(noteId, itemId);
  }
}

async function handleBoardChange(event) {
  const field = String(event.target.dataset.field || '');
  const noteId = String(event.target.dataset.noteId || '');
  if (!field || !noteId) return;

  const note = state.notes.find((entry) => String(entry.id) === noteId);
  if (!note) return;

  if (field === 'content' || field === 'todo_description') {
    const value = event.target.value || '';
    note[field] = value;
    await saveNote(note);
    return;
  }

  if (field === 'note_type') {
    const nextType = event.target.value === 'todo' ? 'todo' : 'text';
    note.note_type = nextType;
    if (nextType === 'todo' && !Array.isArray(note.todo_items)) {
      note.todo_items = [];
    }
    await saveNote(note);
    renderBoard();
    return;
  }

  const action = String(event.target.dataset.action || '');
  if (action === 'toggle-todo') {
    const itemId = String(event.target.dataset.itemId || '');
    updateTodoItem(note, itemId, (item) => ({ ...item, done: event.target.checked }));
    await saveTodoItems(note);
    return;
  }

  if (action === 'edit-todo') {
    const itemId = String(event.target.dataset.itemId || '');
    updateTodoItem(note, itemId, (item) => ({ ...item, text: String(event.target.value || '').trim() }));
    note.todo_items = note.todo_items.filter((item) => item.text);
    await saveTodoItems(note);
  }
}

async function handleBoardKeydown(event) {
  const action = String(event.target.dataset.action || '');
  const noteId = String(event.target.dataset.noteId || '');
  if (!noteId) return;

  const note = state.notes.find((entry) => String(entry.id) === noteId);
  if (!note) return;

  if (action === 'add-todo' && event.key === 'Enter') {
    event.preventDefault();
    const text = String(event.target.value || '').trim();
    if (!text) return;
    note.todo_items = [...(note.todo_items || []), { id: crypto.randomUUID(), text, done: false }];
    event.target.value = '';
    await saveTodoItems(note);
    renderBoard();
    return;
  }

  if (action === 'edit-todo' && event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  }
}

async function handleAttachmentSelection(event) {
  const noteId = state.pendingAttachmentNoteId;
  state.pendingAttachmentNoteId = '';
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!noteId || !files.length) return;

  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  if (!note) return;

  try {
    for (const file of files) {
      const attachment = await uploadAttachment(note, file);
      note.attachments = [...(note.attachments || []), attachment];
    }
    await saveNote(note);
    renderBoard();
    showAlert('Anhang gespeichert.');
  } catch (error) {
    showAlert(`Upload fehlgeschlagen: ${error.message}`, true);
  }
}

function handleDragStart(event) {
  const card = event.target.closest('[data-note-id]');
  if (!card) return;
  state.draggedNoteId = String(card.dataset.noteId || '');
  card.classList.add('dragging');
}

function handleDragOver(event) {
  const columnBody = event.target.closest('[data-drop-column]');
  if (!columnBody) return;
  event.preventDefault();
  columnBody.classList.add('drag-over');
}

function handleDragEnd() {
  state.draggedNoteId = '';
  document.querySelectorAll('.column-body.drag-over').forEach((node) => node.classList.remove('drag-over'));
  document.querySelectorAll('.task-card.dragging').forEach((node) => node.classList.remove('dragging'));
}

async function handleDrop(event) {
  const columnBody = event.target.closest('[data-drop-column]');
  if (!columnBody || !state.draggedNoteId) return;
  event.preventDefault();

  const targetStatus = String(columnBody.dataset.dropColumn || 'todo');
  const movingNote = state.notes.find((note) => String(note.id) === state.draggedNoteId);
  if (!movingNote) return;

  movingNote.status = targetStatus;
  await resequenceAndPersist();
  handleDragEnd();
}

async function createNote(status) {
  const position = getNotesByColumn(status).length;
  const payload = {
    project_id: state.projectId,
    status,
    position,
    note_type: 'text',
    content: '',
    todo_items: [],
    todo_description: '',
    counter_value: 0,
    counter_start_value: 1,
    counter_log: [],
    counter_description: '',
    attachments: [],
    created_by_uid: state.currentUser?.uid,
    created_by_name: state.currentUser?.name || '',
  };

  const { data, error } = await state.supabase
    .from(KANBAN_TABLE)
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    showAlert(`Notiz konnte nicht erstellt werden: ${error.message}`, true);
    return;
  }

  state.notes.push(normalizeNote(data));
  renderBoard();
}

async function deleteNote(noteId) {
  if (!noteId) return;
  if (!window.confirm('Notiz wirklich löschen?')) return;

  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  if (note?.attachments?.length) {
    await removeStorageObjects(note.attachments);
  }

  const { error } = await state.supabase
    .from(KANBAN_TABLE)
    .delete()
    .eq('id', noteId);

  if (error) {
    showAlert(`Löschen fehlgeschlagen: ${error.message}`, true);
    return;
  }

  state.notes = state.notes.filter((entry) => String(entry.id) !== String(noteId));
  await resequenceAndPersist();
}

async function resequenceAndPersist() {
  const updates = [];
  for (const column of KANBAN_COLUMNS) {
    const columnNotes = getNotesByColumn(column.key);
    columnNotes.forEach((note, index) => {
      note.position = index;
      updates.push({ id: note.id, status: column.key, position: index });
    });
  }

  for (const update of updates) {
    const { error } = await state.supabase
      .from(KANBAN_TABLE)
      .update({ status: update.status, position: update.position })
      .eq('id', update.id);
    if (error) {
      showAlert(`Verschieben fehlgeschlagen: ${error.message}`, true);
      return;
    }
  }

  renderBoard();
  showAlert('Kanban gespeichert.');
}

async function saveNote(note) {
  const payload = {
    note_type: note.note_type || 'text',
    content: note.content || '',
    todo_description: note.todo_description || '',
    todo_items: Array.isArray(note.todo_items) ? note.todo_items : [],
    attachments: Array.isArray(note.attachments) ? note.attachments : [],
  };

  const { error } = await state.supabase
    .from(KANBAN_TABLE)
    .update(payload)
    .eq('id', note.id);

  if (error) {
    showAlert(`Speichern fehlgeschlagen: ${error.message}`, true);
    return false;
  }

  showAlert('Gespeichert.');
  return true;
}

async function saveTodoItems(note) {
  const todoItems = (note.todo_items || []).map(normalizeTodoItem);
  note.todo_items = todoItems;
  const { error } = await state.supabase
    .from(KANBAN_TABLE)
    .update({ todo_items: todoItems })
    .eq('id', note.id);

  if (error) {
    showAlert(`To-do Speichern fehlgeschlagen: ${error.message}`, true);
    return;
  }

  renderBoard();
}

function updateTodoItem(note, itemId, updater) {
  note.todo_items = (note.todo_items || []).map((item) => {
    if (String(item.id) !== String(itemId)) return item;
    return normalizeTodoItem(updater(item));
  });
}

async function removeTodoItem(noteId, itemId) {
  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  if (!note) return;
  note.todo_items = (note.todo_items || []).filter((item) => String(item.id) !== String(itemId));
  await saveTodoItems(note);
}

async function uploadAttachment(note, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${state.projectId}/${note.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { error } = await state.supabase.storage
    .from(KANBAN_ATTACHMENT_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });

  if (error) throw error;

  const { data } = state.supabase.storage.from(KANBAN_ATTACHMENT_BUCKET).getPublicUrl(path);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    bucket: KANBAN_ATTACHMENT_BUCKET,
    path,
    publicUrl: String(data?.publicUrl || '').trim(),
    uploaded_at: new Date().toISOString(),
  };
}

async function removeAttachment(noteId, attachmentIndex) {
  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  if (!note || attachmentIndex < 0) return;

  const attachments = Array.isArray(note.attachments) ? [...note.attachments] : [];
  const [removedAttachment] = attachments.splice(attachmentIndex, 1);
  if (!removedAttachment) return;

  await removeStorageObjects([removedAttachment]);
  note.attachments = attachments;
  await saveNote(note);
  renderBoard();
}

async function downloadAttachment(noteId, attachmentIndex) {
  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  const attachment = note?.attachments?.[attachmentIndex];
  if (!attachment) return;

  const bucket = String(attachment.bucket || KANBAN_ATTACHMENT_BUCKET);
  const path = String(attachment.path || '');
  if (!path) return;

  const { data, error } = await state.supabase.storage.from(bucket).download(path);
  if (error || !data) {
    showAlert(`Download fehlgeschlagen: ${error?.message || 'Unbekannter Fehler'}`, true);
    return;
  }

  const blobUrl = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = attachment.name || 'anhang';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

async function removeStorageObjects(attachments = []) {
  const groupedByBucket = new Map();
  for (const attachment of attachments) {
    const bucket = String(attachment?.bucket || KANBAN_ATTACHMENT_BUCKET);
    const path = String(attachment?.path || '').trim();
    if (!path) continue;
    if (!groupedByBucket.has(bucket)) {
      groupedByBucket.set(bucket, []);
    }
    groupedByBucket.get(bucket).push(path);
  }

  for (const [bucket, paths] of groupedByBucket.entries()) {
    if (!paths.length) continue;
    const { error } = await state.supabase.storage.from(bucket).remove(paths);
    if (error) {
      showAlert(`Datei konnte nicht entfernt werden: ${error.message}`, true);
    }
  }
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function showAlert(message, isError = false) {
  if (!elements.alert) return;
  elements.alert.textContent = message;
  elements.alert.classList.remove('hidden');
  elements.alert.classList.toggle('error', isError);
  window.clearTimeout(showAlert.timeoutId);
  showAlert.timeoutId = window.setTimeout(() => elements.alert?.classList.add('hidden'), 2200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
