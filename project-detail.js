const CONFIG_PATH = './supabase-config.json';
const KANBAN_TABLE = 'project_kanban_notes';
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
  elements.kanbanBoard?.addEventListener('dragstart', handleDragStart);
  elements.kanbanBoard?.addEventListener('dragover', handleDragOver);
  elements.kanbanBoard?.addEventListener('drop', handleDrop);
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
  const [projectResult, notesResult] = await Promise.all([
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
  ]);

  if (projectResult.error) throw projectResult.error;
  if (notesResult.error) throw notesResult.error;

  state.project = projectResult.data;
  state.notes = notesResult.data || [];
  render();
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
          <h2 class="column-title">${escapeHtml(column.label)} (${notes.length})</h2>
          <button class="button" type="button" data-action="add-note" data-column="${escapeHtml(column.key)}">＋</button>
        </header>
        <div class="column-body" data-drop-column="${escapeHtml(column.key)}">
          ${notes.length ? notes.map((note) => renderCard(note)).join('') : '<div class="empty-column">Keine Notizen</div>'}
        </div>
      </article>
    `;
  }).join('');
}

function renderCard(note) {
  return `
    <section class="task-card" draggable="true" data-note-id="${escapeHtml(note.id)}">
      <textarea class="task-description" data-field="content" data-note-id="${escapeHtml(note.id)}" rows="4" placeholder="Notiztext">${escapeHtml(note.content || '')}</textarea>
      <div class="task-actions">
        <button class="task-action" type="button" data-action="delete-note" data-note-id="${escapeHtml(note.id)}">Löschen</button>
      </div>
    </section>
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

  const deleteButton = event.target.closest('[data-action="delete-note"]');
  if (deleteButton) {
    await deleteNote(String(deleteButton.dataset.noteId || ''));
  }
}

async function handleBoardChange(event) {
  const field = event.target.dataset.field;
  const noteId = event.target.dataset.noteId;
  if (field !== 'content' || !noteId) return;
  const value = event.target.value || '';
  const { error } = await state.supabase
    .from(KANBAN_TABLE)
    .update({ content: value })
    .eq('id', noteId);

  if (error) {
    showAlert(`Speichern fehlgeschlagen: ${error.message}`, true);
    return;
  }

  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  if (note) note.content = value;
  showAlert('Notiz gespeichert.');
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
  state.draggedNoteId = '';
}

async function createNote(status) {
  const position = getNotesByColumn(status).length;
  const payload = {
    project_id: state.projectId,
    status,
    position,
    content: '',
    note_type: 'text',
    todo_items: [],
    todo_description: '',
    counter_value: 0,
    counter_start_value: 1,
    counter_log: [],
    counter_description: '',
    attachments: [],
    created_by_uid: null,
    created_by_name: '',
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

  state.notes.push(data);
  renderBoard();
}

async function deleteNote(noteId) {
  if (!noteId) return;
  if (!window.confirm('Notiz wirklich löschen?')) return;

  const { error } = await state.supabase
    .from(KANBAN_TABLE)
    .delete()
    .eq('id', noteId);

  if (error) {
    showAlert(`Löschen fehlgeschlagen: ${error.message}`, true);
    return;
  }

  state.notes = state.notes.filter((note) => String(note.id) !== String(noteId));
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
