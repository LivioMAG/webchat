const CONFIG_PATH = './supabase-config.json';
const KANBAN_TABLE = 'project_kanban_notes';
const KANBAN_ATTACHMENT_BUCKET = 'project-kanban-attachments';
const PROJECT_SETTINGS_DOCUMENT_BUCKET = 'project-settings-documents';
const DISPO_TABLE = 'project_dispo';
const DISPO_LAYER_TABLE = 'project_dispo_layer';
const DISPO_ITEM_TABLE = 'project_dispo_items';
const JOURNAL_TABLE = 'project_journal';
const JOURNAL_ATTACHMENT_BUCKET = 'project-journal-attachments';
const DISPO_WEEKDAYS = [
  { key: 1, label: 'Montag' },
  { key: 2, label: 'Dienstag' },
  { key: 3, label: 'Mittwoch' },
  { key: 4, label: 'Donnerstag' },
  { key: 5, label: 'Freitag' },
  { key: 6, label: 'Samstag' },
  { key: 0, label: 'Sonntag' },
];
const MAX_TODOS_PER_NOTE = 6;
const NOTE_COLOR_OPTIONS = ['green', 'blue', 'yellow', 'red'];
const DRAG_DOCK_ICONS = ['⭐', '📌', '📁', '🏷️', '🧭', '🔔', '📅', '🗂️', '📤', '🧩'];
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
  currentPage: 'kanban',
  pendingNewNoteColumn: '',
  pendingTodoInputFocusNoteId: '',
  activeNoteId: '',
  noteEditorDraft: '',
  noteEditorOriginal: '',
  isDragDockVisible: false,
  contacts: [],
  profiles: [],
  showHiddenNotes: false,
  dispo: null,
  dispoLayers: [],
  dispoItems: [],
  journalEntries: [],
  dispoItemContext: null,
  journalPendingFiles: [],
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
  elements.attachmentInput = document.getElementById('attachmentInput');
  elements.detailNavTabs = document.getElementById('detailNavTabs');
  elements.noteDetailModal = document.getElementById('noteDetailModal');
  elements.noteDetailEditor = document.getElementById('noteDetailEditor');
  elements.noteDetailTimeline = document.getElementById('noteDetailTimeline');
  elements.projectSettingsForm = document.getElementById('projectSettingsForm');
  elements.settingsCommissionInput = document.getElementById('settingsCommissionInput');
  elements.settingsProjectNameInput = document.getElementById('settingsProjectNameInput');
  elements.settingsProjectLeadSelect = document.getElementById('settingsProjectLeadSelect');
  elements.settingsConstructionLeadSelect = document.getElementById('settingsConstructionLeadSelect');
  elements.settingsStreetInput = document.getElementById('settingsStreetInput');
  elements.settingsPostalCodeInput = document.getElementById('settingsPostalCodeInput');
  elements.settingsCityInput = document.getElementById('settingsCityInput');
  elements.settingsHasBarrackInput = document.getElementById('settingsHasBarrackInput');
  elements.settingsHasLunchBreakInput = document.getElementById('settingsHasLunchBreakInput');
  elements.settingsWorkdayStartInput = document.getElementById('settingsWorkdayStartInput');
  elements.settingsWorkdayEndInput = document.getElementById('settingsWorkdayEndInput');
  elements.settingsContactSelect = document.getElementById('settingsContactSelect');
  elements.settingsRoleSelect = document.getElementById('settingsRoleSelect');
  elements.settingsContactKeyValueInput = document.getElementById('settingsContactKeyValueInput');
  elements.addExistingContactButton = document.getElementById('addExistingContactButton');
  elements.settingsContactsTableBody = document.getElementById('settingsContactsTableBody');
  elements.createContactButton = document.getElementById('createContactButton');
  elements.newContactFirstNameInput = document.getElementById('newContactFirstNameInput');
  elements.newContactLastNameInput = document.getElementById('newContactLastNameInput');
  elements.newContactCompanyInput = document.getElementById('newContactCompanyInput');
  elements.newContactCategoryInput = document.getElementById('newContactCategoryInput');
  elements.newContactPhoneInput = document.getElementById('newContactPhoneInput');
  elements.newContactEmailInput = document.getElementById('newContactEmailInput');
  elements.newContactStreetInput = document.getElementById('newContactStreetInput');
  elements.newContactPostalCodeInput = document.getElementById('newContactPostalCodeInput');
  elements.newContactCityInput = document.getElementById('newContactCityInput');
  elements.newContactRoleInput = document.getElementById('newContactRoleInput');
  elements.newContactKeyValueInput = document.getElementById('newContactKeyValueInput');
  elements.uploadProjectDocumentButton = document.getElementById('uploadProjectDocumentButton');
  elements.projectDocumentInput = document.getElementById('projectDocumentInput');
  elements.settingsDocumentsTableBody = document.getElementById('settingsDocumentsTableBody');
  elements.dragDock = document.getElementById('dragDock');
  elements.dragDockInner = document.getElementById('dragDockInner');
  elements.toggleHiddenNotesButton = document.getElementById('toggleHiddenNotesButton');
  elements.dispoMatrixHead = document.getElementById('dispoMatrixHead');
  elements.dispoMatrixBody = document.getElementById('dispoMatrixBody');
  elements.addDispoLayerButton = document.getElementById('addDispoLayerButton');
  elements.dispoLayerModal = document.getElementById('dispoLayerModal');
  elements.dispoLayerForm = document.getElementById('dispoLayerForm');
  elements.dispoLayerTypeSelect = document.getElementById('dispoLayerTypeSelect');
  elements.dispoLayerNameInput = document.getElementById('dispoLayerNameInput');
  elements.dispoLayerProfileSelect = document.getElementById('dispoLayerProfileSelect');
  elements.dispoCustomLayerNameRow = document.getElementById('dispoCustomLayerNameRow');
  elements.dispoPersonLayerRow = document.getElementById('dispoPersonLayerRow');
  elements.closeDispoLayerModalButton = document.getElementById('closeDispoLayerModalButton');
  elements.cancelDispoLayerButton = document.getElementById('cancelDispoLayerButton');
  elements.dispoItemModal = document.getElementById('dispoItemModal');
  elements.dispoItemForm = document.getElementById('dispoItemForm');
  elements.dispoItemNoteSelect = document.getElementById('dispoItemNoteSelect');
  elements.closeDispoItemModalButton = document.getElementById('closeDispoItemModalButton');
  elements.cancelDispoItemButton = document.getElementById('cancelDispoItemButton');
  elements.newJournalEntryButton = document.getElementById('newJournalEntryButton');
  elements.journalList = document.getElementById('journalList');
  elements.journalEntryModal = document.getElementById('journalEntryModal');
  elements.journalEntryForm = document.getElementById('journalEntryForm');
  elements.journalEntryTextInput = document.getElementById('journalEntryTextInput');
  elements.journalAttachmentInput = document.getElementById('journalAttachmentInput');
  elements.journalPickAttachmentsButton = document.getElementById('journalPickAttachmentsButton');
  elements.journalAttachmentSummary = document.getElementById('journalAttachmentSummary');
  elements.closeJournalEntryModalButton = document.getElementById('closeJournalEntryModalButton');
  elements.cancelJournalEntryButton = document.getElementById('cancelJournalEntryButton');
}

function bindEvents() {
  elements.backButton?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = './index.html';
  });

  elements.detailNavTabs?.addEventListener('click', handlePageNavigation);
  elements.kanbanBoard?.addEventListener('click', handleBoardClick);
  elements.kanbanBoard?.addEventListener('change', handleBoardChange);
  elements.kanbanBoard?.addEventListener('keydown', handleBoardKeydown);
  elements.kanbanBoard?.addEventListener('dragstart', handleDragStart);
  elements.kanbanBoard?.addEventListener('dragover', handleDragOver);
  elements.kanbanBoard?.addEventListener('drop', handleDrop);
  elements.kanbanBoard?.addEventListener('dragend', handleDragEnd);
  elements.attachmentInput?.addEventListener('change', handleAttachmentSelection);
  elements.noteDetailModal?.addEventListener('click', handleNoteDetailModalClick);
  elements.noteDetailModal?.addEventListener('input', handleNoteDetailModalInput);
  elements.noteDetailModal?.addEventListener('change', handleBoardChange);
  elements.noteDetailModal?.addEventListener('keydown', handleBoardKeydown);
  elements.projectSettingsForm?.addEventListener('submit', handleProjectSettingsSubmit);
  elements.addExistingContactButton?.addEventListener('click', handleAddExistingContact);
  elements.createContactButton?.addEventListener('click', handleCreateContact);
  elements.settingsContactsTableBody?.addEventListener('click', handleProjectContactsTableClick);
  elements.uploadProjectDocumentButton?.addEventListener('click', () => elements.projectDocumentInput?.click());
  elements.projectDocumentInput?.addEventListener('change', handleProjectDocumentSelection);
  elements.settingsDocumentsTableBody?.addEventListener('click', handleProjectDocumentsTableClick);
  elements.dragDockInner?.addEventListener('dragover', handleDockDragOver);
  elements.dragDockInner?.addEventListener('drop', handleDockDrop);
  elements.toggleHiddenNotesButton?.addEventListener('click', handleToggleHiddenNotes);
  elements.addDispoLayerButton?.addEventListener('click', openDispoLayerModal);
  elements.dispoLayerTypeSelect?.addEventListener('change', handleDispoLayerTypeChange);
  elements.dispoLayerForm?.addEventListener('submit', handleDispoLayerSubmit);
  elements.closeDispoLayerModalButton?.addEventListener('click', closeDispoLayerModal);
  elements.cancelDispoLayerButton?.addEventListener('click', closeDispoLayerModal);
  elements.dispoLayerModal?.addEventListener('click', (event) => {
    if (event.target === elements.dispoLayerModal) closeDispoLayerModal();
  });
  elements.dispoMatrixBody?.addEventListener('click', handleDispoMatrixClick);
  elements.dispoItemForm?.addEventListener('submit', handleDispoItemSubmit);
  elements.closeDispoItemModalButton?.addEventListener('click', closeDispoItemModal);
  elements.cancelDispoItemButton?.addEventListener('click', closeDispoItemModal);
  elements.dispoItemModal?.addEventListener('click', (event) => {
    if (event.target === elements.dispoItemModal) closeDispoItemModal();
  });
  elements.newJournalEntryButton?.addEventListener('click', openJournalEntryModal);
  elements.journalPickAttachmentsButton?.addEventListener('click', () => elements.journalAttachmentInput?.click());
  elements.journalAttachmentInput?.addEventListener('change', handleJournalAttachmentSelection);
  elements.journalEntryForm?.addEventListener('submit', handleJournalEntrySubmit);
  elements.closeJournalEntryModalButton?.addEventListener('click', closeJournalEntryModal);
  elements.cancelJournalEntryButton?.addEventListener('click', closeJournalEntryModal);
  elements.journalEntryModal?.addEventListener('click', (event) => {
    if (event.target === elements.journalEntryModal) closeJournalEntryModal();
  });
  elements.journalList?.addEventListener('click', handleJournalListClick);
}

function handleToggleHiddenNotes() {
  state.showHiddenNotes = !state.showHiddenNotes;
  renderBoard();
}


function handlePageNavigation(event) {
  const button = event.target.closest('[data-page]');
  if (!button) return;

  const page = String(button.dataset.page || 'kanban');
  setActivePage(page);
}

function setActivePage(page) {
  const allowedPages = ['kanban', 'dispo', 'settings', 'docs', 'journal'];
  const nextPage = allowedPages.includes(page) ? page : 'kanban';
  state.currentPage = nextPage;

  document.querySelectorAll('.detail-nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.page === nextPage);
  });

  document.querySelectorAll('.detail-page').forEach((section) => {
    const isActive = section.id === `${nextPage}Page`;
    section.classList.toggle('hidden', !isActive);
    section.classList.toggle('active', isActive);
  });

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
  const [projectResult, notesResult, contactsResult, profilesResult, userResult, dispoResult, dispoLayersResult, dispoItemsResult, journalResult] = await Promise.all([
    state.supabase
      .from('projects')
      .select('id, commission_number, name, project_lead_profile_id, construction_lead_profile_id, street, postal_code, city, has_barrack, has_lunch_break, workday_start_time, workday_end_time, project_contacts, project_documents')
      .eq('id', state.projectId)
      .single(),
    state.supabase
      .from(KANBAN_TABLE)
      .select('*')
      .eq('project_id', state.projectId)
      .order('position', { ascending: true }),
    state.supabase
      .from('crm_contacts')
      .select('id, category, company_name, first_name, last_name, email')
      .order('last_name', { ascending: true }),
    state.supabase
      .from('app_profiles')
      .select('id, full_name, email')
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    state.supabase.auth.getUser(),
    state.supabase
      .from(DISPO_TABLE)
      .select('*')
      .eq('project_id', state.projectId)
      .maybeSingle(),
    state.supabase
      .from(DISPO_LAYER_TABLE)
      .select('*')
      .eq('project_id', state.projectId)
      .order('position', { ascending: true }),
    state.supabase
      .from(DISPO_ITEM_TABLE)
      .select('*')
      .eq('project_id', state.projectId),
    state.supabase
      .from(JOURNAL_TABLE)
      .select('*')
      .eq('project_id', state.projectId)
      .order('created_at', { ascending: false }),
  ]);

  if (projectResult.error) throw projectResult.error;
  if (notesResult.error) throw notesResult.error;
  if (contactsResult.error) throw contactsResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (dispoResult.error) throw dispoResult.error;
  if (dispoLayersResult.error) throw dispoLayersResult.error;
  if (dispoItemsResult.error) throw dispoItemsResult.error;
  if (journalResult.error) throw journalResult.error;

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
  state.contacts = contactsResult.data || [];
  state.profiles = profilesResult.data || [];
  state.dispo = dispoResult.data || null;
  state.dispoLayers = dispoLayersResult.data || [];
  state.dispoItems = dispoItemsResult.data || [];
  state.journalEntries = journalResult.data || [];
  state.currentUser = {
    uid: currentUid || null,
    name: profileName || String(userResult.data?.user?.email || '').trim(),
  };
  render();
}

function normalizeNote(rawNote) {
  const note = { ...rawNote };
  note.note_type = 'text';
  note.todo_items = Array.isArray(note.todo_items) ? note.todo_items.map(normalizeTodoItem) : [];
  note.attachments = Array.isArray(note.attachments) ? note.attachments : [];
  note.content = normalizeConversation(note.content);
  note.todo_description = String(note.todo_description || '');
  note.color = normalizeNoteColor(note.color);
  note.visible_from_date = normalizeIsoDateOnly(note.visible_from_date);
  return note;
}

function normalizeIsoDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function normalizeNoteColor(color) {
  const normalized = String(color || '').trim().toLowerCase();
  return NOTE_COLOR_OPTIONS.includes(normalized) ? normalized : '';
}

function normalizeConversation(rawContent) {
  if (Array.isArray(rawContent)) {
    return rawContent.map(normalizeConversationEntry).filter((entry) => entry.text);
  }
  if (typeof rawContent === 'string') {
    const trimmed = rawContent.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeConversationEntry).filter((entry) => entry.text);
      }
    } catch (_error) {
      return [buildConversationEntry(trimmed)];
    }
    return [buildConversationEntry(trimmed)];
  }
  return [];
}

function normalizeConversationEntry(entry) {
  const firstName = String(entry?.first_name || '').trim();
  const lastName = String(entry?.last_name || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return {
    id: String(entry?.id || crypto.randomUUID()),
    author_type: String(entry?.author_type || 'user'),
    user_id: entry?.user_id ? String(entry.user_id) : null,
    uid: entry?.uid ? String(entry.uid) : null,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName || String(entry?.full_name || entry?.created_by_name || '').trim(),
    text: String(entry?.text || '').trim(),
    created_at: String(entry?.created_at || new Date().toISOString()),
  };
}

function buildConversationEntry(text = '') {
  const authorName = String(state.currentUser?.name || '').trim();
  const [firstName = '', ...rest] = authorName.split(' ');
  return normalizeConversationEntry({
    author_type: 'user',
    user_id: state.currentUser?.uid || null,
    uid: state.currentUser?.uid || null,
    first_name: firstName,
    last_name: rest.join(' ').trim(),
    full_name: authorName,
    text,
    created_at: new Date().toISOString(),
  });
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
  renderSettings();
  renderDispo();
  renderJournal();
  setActivePage(state.currentPage);
}

function renderBoard() {
  if (!elements.kanbanBoard) return;
  updateHiddenNotesToggleButtonLabel();
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
  const lastEntry = getLastConversationEntry(note);
  const preview = truncateText(lastEntry?.text || '', 100);
  const isLastByCurrentUser = isEntryByCurrentUser(lastEntry);
  const effectiveColor = getEffectiveNoteColor(note);
  const descriptionField = isLastByCurrentUser
    ? `
      <textarea
        class="task-description"
        data-field="latest_text"
        data-note-id="${escapeHtml(note.id)}"
        rows="3"
        placeholder="Notiz hier eingeben ..."
      >${escapeHtml(preview)}</textarea>
    `
    : `<p class="task-description readonly">${escapeHtml(preview || 'Letzter Eintrag von jemand anderem')}</p>`;
  const todoSection = `<div class="todo-section" data-todo-section="${escapeHtml(note.id)}">${renderTodoList(note, { showCompleted: false })}</div>`;
  const attachments = Array.isArray(note.attachments) ? note.attachments : [];
  const hiddenHint = state.showHiddenNotes && !isNoteVisibleToday(note)
    ? `<p class="task-visibility-hint">Ausgeblendet bis ${escapeHtml(formatDateLabel(note.visible_from_date))}</p>`
    : '';

  return `
    <section class="task-card task-card-${escapeHtml(effectiveColor)}" draggable="true" data-note-id="${escapeHtml(note.id)}" data-note-color="${escapeHtml(effectiveColor)}">
      <div class="task-header-row">
        <div class="task-type-wrap">
          <span class="task-type-icon">📝</span>
          <p class="task-preview-hint">${lastEntry ? `Letzter Eintrag: ${escapeHtml(getEntryAuthorLabel(lastEntry))}` : 'Noch kein Eintrag'}</p>
        </div>
        <div class="task-actions">
          <button class="task-icon" type="button" title="Anhang hinzufügen" data-action="open-attachments" data-note-id="${escapeHtml(note.id)}">📎</button>
          <button class="task-icon" type="button" title="Löschen" data-action="delete-note" data-note-id="${escapeHtml(note.id)}">🗑</button>
        </div>
      </div>

      ${descriptionField}
      ${hiddenHint}
      ${todoSection}

      <button class="attachment-summary" type="button" data-action="open-note-detail" data-note-id="${escapeHtml(note.id)}">
        ${attachments.length ? `${attachments.length} Anhang${attachments.length === 1 ? '' : 'e'} anzeigen` : 'Keine Anhänge'}
      </button>

    </section>
  `;
}

function renderTodoList(note, { showCompleted = true } = {}) {
  const items = sortTodoItems(Array.isArray(note.todo_items) ? note.todo_items : []);
  const visibleItems = showCompleted ? items : items.filter((item) => !item.done);
  const isLimitReached = items.length >= MAX_TODOS_PER_NOTE;
  const emptyMessage = showCompleted ? 'Noch keine To-dos' : '';
  return `
    <div class="todo-list" data-todo-list="${escapeHtml(note.id)}">
      ${visibleItems.map((item) => `
        <label class="todo-item">
          <input type="checkbox" data-action="toggle-todo" data-note-id="${escapeHtml(note.id)}" data-item-id="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''} />
          <input class="todo-text ${item.done ? 'done' : ''}" type="text" value="${escapeHtml(item.text)}" data-action="edit-todo" data-note-id="${escapeHtml(note.id)}" data-item-id="${escapeHtml(item.id)}" />
          <button class="todo-remove" type="button" data-action="remove-todo" data-note-id="${escapeHtml(note.id)}" data-item-id="${escapeHtml(item.id)}">✕</button>
        </label>
      `).join('')}
      ${visibleItems.length || !emptyMessage ? '' : `<p class="attachment-empty">${emptyMessage}</p>`}
      <input class="todo-add-input" type="text" data-action="add-todo" data-note-id="${escapeHtml(note.id)}" placeholder="${isLimitReached ? `Maximal ${MAX_TODOS_PER_NOTE} To-dos erreicht` : 'To-do hinzufügen und Enter drücken'}" ${isLimitReached ? 'disabled' : ''} />
    </div>
  `;
}

function sortTodoItems(items) {
  return [...items].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)));
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

function renderSettings() {
  if (!state.project) return;
  renderLeadSelectOptions();
  renderContactOptions();
  renderProjectContactsTable();
  renderProjectDocumentsTable();
  elements.settingsCommissionInput && (elements.settingsCommissionInput.value = state.project.commission_number || '');
  elements.settingsProjectNameInput && (elements.settingsProjectNameInput.value = state.project.name || '');
  elements.settingsStreetInput && (elements.settingsStreetInput.value = state.project.street || '');
  elements.settingsPostalCodeInput && (elements.settingsPostalCodeInput.value = state.project.postal_code || '');
  elements.settingsCityInput && (elements.settingsCityInput.value = state.project.city || '');
  elements.settingsHasBarrackInput && (elements.settingsHasBarrackInput.checked = Boolean(state.project.has_barrack));
  elements.settingsHasLunchBreakInput && (elements.settingsHasLunchBreakInput.checked = Boolean(state.project.has_lunch_break));
  elements.settingsWorkdayStartInput && (elements.settingsWorkdayStartInput.value = normalizeTimeInput(state.project.workday_start_time, '07:00'));
  elements.settingsWorkdayEndInput && (elements.settingsWorkdayEndInput.value = normalizeTimeInput(state.project.workday_end_time, '16:30'));
}

function renderLeadSelectOptions() {
  const options = ['<option value="">Bitte wählen</option>']
    .concat(state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.full_name || profile.email || 'Unbekannt')}</option>`))
    .join('');
  if (elements.settingsProjectLeadSelect) {
    elements.settingsProjectLeadSelect.innerHTML = options;
    elements.settingsProjectLeadSelect.value = String(state.project?.project_lead_profile_id || '');
  }
  if (elements.settingsConstructionLeadSelect) {
    elements.settingsConstructionLeadSelect.innerHTML = options;
    elements.settingsConstructionLeadSelect.value = String(state.project?.construction_lead_profile_id || '');
  }
}

function renderContactOptions() {
  if (!elements.settingsContactSelect) return;
  if (!state.contacts.length) {
    elements.settingsContactSelect.innerHTML = '<option value="">Keine CRM-Kontakte vorhanden</option>';
    return;
  }
  elements.settingsContactSelect.innerHTML = state.contacts
    .map((contact) => `<option value="${escapeHtml(contact.id)}">${escapeHtml(getContactLabel(contact))}</option>`)
    .join('');
}

function getContactLabel(contact) {
  const person = `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim();
  return [person, contact?.company_name, contact?.email].filter(Boolean).join(' · ');
}

function getProjectContacts() {
  return Array.isArray(state.project?.project_contacts) ? state.project.project_contacts : [];
}

function renderProjectContactsTable() {
  if (!elements.settingsContactsTableBody) return;
  const rows = getProjectContacts();
  if (!rows.length) {
    elements.settingsContactsTableBody.innerHTML = '<tr><td colspan="5">Noch keine Kontakte zugewiesen.</td></tr>';
    return;
  }
  elements.settingsContactsTableBody.innerHTML = rows.map((entry, index) => {
    const contact = state.contacts.find((item) => String(item.id) === String(entry.crm_contact_id));
    return `<tr>
      <td>${escapeHtml(entry.role || '—')}</td>
      <td>${escapeHtml(contact ? getContactLabel(contact) : 'Kontakt nicht gefunden')}</td>
      <td>${escapeHtml(contact?.category || '—')}</td>
      <td>${entry.include_in_reports ? 'Ja' : 'Nein'}</td>
      <td><button class="button task-action danger" type="button" data-action="remove-project-contact" data-index="${index}">Entfernen</button></td>
    </tr>`;
  }).join('');
}

function getProjectDocuments() {
  return Array.isArray(state.project?.project_documents) ? state.project.project_documents : [];
}

function renderProjectDocumentsTable() {
  if (!elements.settingsDocumentsTableBody) return;
  const docs = getProjectDocuments();
  if (!docs.length) {
    elements.settingsDocumentsTableBody.innerHTML = '<tr><td colspan="3">Keine Dokumente vorhanden.</td></tr>';
    return;
  }
  elements.settingsDocumentsTableBody.innerHTML = docs.map((doc, index) => `
    <tr>
      <td>${escapeHtml(doc.name || `Dokument ${index + 1}`)}</td>
      <td>${escapeHtml(formatDateTime(doc.created_at))}</td>
      <td>
        <button class="button task-action" type="button" data-action="view-project-document" data-index="${index}">Ansehen</button>
        <button class="button task-action" type="button" data-action="download-project-document" data-index="${index}">Download</button>
        <button class="button task-action danger" type="button" data-action="delete-project-document" data-index="${index}">Löschen</button>
      </td>
    </tr>
  `).join('');
}

function renderDispo() {
  renderDispoLayerProfileOptions();
  if (!elements.dispoMatrixHead || !elements.dispoMatrixBody) return;
  elements.dispoMatrixHead.innerHTML = `<tr><th>Layer</th>${DISPO_WEEKDAYS.map((day) => `<th>${escapeHtml(day.label)}</th>`).join('')}</tr>`;
  if (!state.dispoLayers.length) {
    elements.dispoMatrixBody.innerHTML = `<tr><td colspan="${DISPO_WEEKDAYS.length + 1}"><p class="journal-empty">Noch keine Layer vorhanden.</p></td></tr>`;
    return;
  }
  elements.dispoMatrixBody.innerHTML = state.dispoLayers.map((layer) => {
    const profile = layer.profile_id ? state.profiles.find((item) => String(item.id) === String(layer.profile_id)) : null;
    return `<tr>
      <td class="dispo-layer-cell">
        <p class="dispo-layer-name">${profile ? `<a class="layer-person-link" href="./index.html#profile-${escapeHtml(profile.id)}">${escapeHtml(profile.full_name || profile.email || 'Person')}</a>` : escapeHtml(layer.name || 'Layer')}</p>
        <p class="dispo-layer-meta">${profile ? 'Personen-Layer' : 'Freier Layer'}</p>
      </td>
      ${DISPO_WEEKDAYS.map((day) => renderDispoCell(layer, day.key)).join('')}
    </tr>`;
  }).join('');
}

function renderDispoCell(layer, weekday) {
  const items = state.dispoItems
    .filter((item) => String(item.layer_id) === String(layer.id) && Number(item.weekday) === Number(weekday))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  return `<td>
    <div class="dispo-cell-actions">
      <button class="column-add" type="button" data-action="open-dispo-item-modal" data-layer-id="${escapeHtml(layer.id)}" data-weekday="${weekday}" title="Karte hinzufügen">＋</button>
    </div>
    <div class="dispo-cell-cards">
      ${items.length ? items.map((item) => renderDispoNoteCard(item)).join('') : '<p class="journal-empty">Keine Einträge</p>'}
    </div>
  </td>`;
}

function renderDispoNoteCard(dispoItem) {
  const note = state.notes.find((entry) => String(entry.id) === String(dispoItem.note_id));
  if (!note) return '';
  return `<div class="dispo-card-wrap" data-dispo-item-id="${escapeHtml(dispoItem.id)}">
    ${renderCard(note).replace('task-card ', 'task-card dispo-card ')}
    <button class="task-action danger" type="button" data-action="remove-dispo-item" data-dispo-item-id="${escapeHtml(dispoItem.id)}">Zuordnung entfernen</button>
  </div>`;
}

function renderDispoLayerProfileOptions() {
  if (!elements.dispoLayerProfileSelect) return;
  const profiles = state.profiles || [];
  if (!profiles.length) {
    elements.dispoLayerProfileSelect.innerHTML = '<option value="">Keine Personen verfügbar</option>';
    return;
  }
  elements.dispoLayerProfileSelect.innerHTML = profiles
    .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.full_name || profile.email || 'Unbekannt')}</option>`)
    .join('');
}

function openDispoLayerModal() {
  handleDispoLayerTypeChange();
  elements.dispoLayerNameInput && (elements.dispoLayerNameInput.value = '');
  elements.dispoLayerModal?.classList.remove('hidden');
}

function closeDispoLayerModal() {
  elements.dispoLayerModal?.classList.add('hidden');
}

function handleDispoLayerTypeChange() {
  const type = String(elements.dispoLayerTypeSelect?.value || 'custom');
  elements.dispoCustomLayerNameRow?.classList.toggle('hidden', type !== 'custom');
  elements.dispoPersonLayerRow?.classList.toggle('hidden', type !== 'person');
}

async function ensureDispoContext() {
  if (state.dispo?.id) return state.dispo;
  const { data, error } = await state.supabase.from(DISPO_TABLE).insert({ project_id: state.projectId }).select('*').single();
  if (error) throw error;
  state.dispo = data;
  return data;
}

async function handleDispoLayerSubmit(event) {
  event.preventDefault();
  try {
    const dispo = await ensureDispoContext();
    const type = String(elements.dispoLayerTypeSelect?.value || 'custom');
    const profileId = type === 'person' ? String(elements.dispoLayerProfileSelect?.value || '') : '';
    const profile = profileId ? state.profiles.find((item) => String(item.id) === profileId) : null;
    const customName = String(elements.dispoLayerNameInput?.value || '').trim();
    const name = profile ? String(profile.full_name || profile.email || '').trim() : customName;
    if (!name) {
      showAlert('Bitte Layer-Namen oder Person wählen.', true);
      return;
    }
    const payload = {
      project_id: state.projectId,
      project_dispo_id: dispo.id,
      position: state.dispoLayers.length,
      name,
      profile_id: profile ? profile.id : null,
    };
    const { data, error } = await state.supabase.from(DISPO_LAYER_TABLE).insert(payload).select('*').single();
    if (error) throw error;
    state.dispoLayers.push(data);
    closeDispoLayerModal();
    renderDispo();
  } catch (error) {
    showAlert(error.message || 'Layer konnte nicht erstellt werden.', true);
  }
}

function handleDispoMatrixClick(event) {
  const addButton = event.target.closest('[data-action="open-dispo-item-modal"]');
  if (addButton) {
    const layerId = String(addButton.dataset.layerId || '');
    const weekday = Number(addButton.dataset.weekday || 1);
    openDispoItemModal({ layerId, weekday });
    return;
  }

  const removeButton = event.target.closest('[data-action="remove-dispo-item"]');
  if (removeButton) {
    void deleteDispoItem(String(removeButton.dataset.dispoItemId || ''));
    return;
  }

  void handleBoardClick(event);
}

function openDispoItemModal({ layerId, weekday }) {
  state.dispoItemContext = { layerId, weekday };
  const noteOptions = state.notes
    .map((note) => ({ note, entry: getLastConversationEntry(note) }))
    .map(({ note, entry }) => ({
      id: note.id,
      label: truncateText((entry?.text || 'Ohne Inhalt'), 50),
      status: note.status,
    }));
  elements.dispoItemNoteSelect.innerHTML = noteOptions.length
    ? noteOptions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(`[${item.status}] ${item.label}`)}</option>`).join('')
    : '<option value="">Keine Karten verfügbar</option>';
  elements.dispoItemModal?.classList.remove('hidden');
}

function closeDispoItemModal() {
  state.dispoItemContext = null;
  elements.dispoItemModal?.classList.add('hidden');
}

async function handleDispoItemSubmit(event) {
  event.preventDefault();
  const noteId = String(elements.dispoItemNoteSelect?.value || '');
  if (!noteId || !state.dispoItemContext?.layerId) return;
  const payload = {
    project_id: state.projectId,
    layer_id: state.dispoItemContext.layerId,
    note_id: noteId,
    weekday: state.dispoItemContext.weekday,
    position: state.dispoItems.filter((item) => String(item.layer_id) === String(state.dispoItemContext.layerId) && Number(item.weekday) === Number(state.dispoItemContext.weekday)).length,
  };
  const { data, error } = await state.supabase.from(DISPO_ITEM_TABLE).insert(payload).select('*').single();
  if (error) {
    showAlert(error.message || 'Dispo-Eintrag konnte nicht erstellt werden.', true);
    return;
  }
  state.dispoItems.push(data);
  closeDispoItemModal();
  renderDispo();
}

async function deleteDispoItem(dispoItemId) {
  if (!dispoItemId) return;
  const { error } = await state.supabase.from(DISPO_ITEM_TABLE).delete().eq('id', dispoItemId);
  if (error) {
    showAlert(error.message || 'Dispo-Eintrag konnte nicht gelöscht werden.', true);
    return;
  }
  state.dispoItems = state.dispoItems.filter((item) => String(item.id) !== String(dispoItemId));
  renderDispo();
}

function renderJournal() {
  if (!elements.journalList) return;
  if (!state.journalEntries.length) {
    elements.journalList.innerHTML = '<p class="journal-empty">Noch keine Journal-Einträge vorhanden.</p>';
    return;
  }
  elements.journalList.innerHTML = state.journalEntries.map((entry) => `
    <article class="journal-entry">
      <p class="journal-entry-meta">${escapeHtml(formatDateTime(entry.created_at))} · ${escapeHtml(entry.created_by_name || 'Unbekannt')}</p>
      <p class="journal-entry-text">${escapeHtml(entry.content || '')}</p>
      ${(entry.attachments || []).length ? `<div class="journal-attachments"><h4>Dateien</h4>${renderJournalAttachmentList(entry.attachments || [], entry.id)}</div>` : ''}
    </article>
  `).join('');
}

function renderJournalAttachmentList(attachments, entryId) {
  return `<ul class="attachment-list">
    ${attachments.map((attachment, index) => {
      const name = escapeHtml(String(attachment?.name || `Datei ${index + 1}`));
      const sizeLabel = formatFileSize(attachment?.size || 0);
      return `<li class="attachment-item">
        <span class="attachment-name">${name} <small>${sizeLabel}</small></span>
        <span class="attachment-actions">
          <button class="task-action" type="button" data-action="download-attachment" data-note-id="${escapeHtml(entryId)}" data-attachment-index="${index}">Download</button>
        </span>
      </li>`;
    }).join('')}
  </ul>`;
}

function openJournalEntryModal() {
  state.journalPendingFiles = [];
  if (elements.journalEntryTextInput) elements.journalEntryTextInput.value = '';
  if (elements.journalAttachmentSummary) elements.journalAttachmentSummary.textContent = 'Keine Dateien ausgewählt.';
  elements.journalEntryModal?.classList.remove('hidden');
}

function closeJournalEntryModal() {
  state.journalPendingFiles = [];
  elements.journalEntryModal?.classList.add('hidden');
}

function handleJournalAttachmentSelection(event) {
  state.journalPendingFiles = Array.from(event.target.files || []);
  if (elements.journalAttachmentSummary) {
    elements.journalAttachmentSummary.textContent = state.journalPendingFiles.length
      ? `${state.journalPendingFiles.length} Datei(en) ausgewählt`
      : 'Keine Dateien ausgewählt.';
  }
}

async function handleJournalEntrySubmit(event) {
  event.preventDefault();
  const text = String(elements.journalEntryTextInput?.value || '').trim();
  if (!text) {
    showAlert('Journal-Text ist erforderlich.', true);
    return;
  }
  try {
    const attachments = [];
    for (const file of state.journalPendingFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${state.projectId}/journal/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const { error } = await state.supabase.storage.from(JOURNAL_ATTACHMENT_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw error;
      attachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        bucket: JOURNAL_ATTACHMENT_BUCKET,
        path,
        uploaded_at: new Date().toISOString(),
      });
    }
    const payload = {
      project_id: state.projectId,
      content: text,
      attachments,
      created_by_uid: state.currentUser?.uid || null,
      created_by_name: state.currentUser?.name || '',
    };
    const { data, error } = await state.supabase.from(JOURNAL_TABLE).insert(payload).select('*').single();
    if (error) throw error;
    state.journalEntries = [data, ...state.journalEntries];
    closeJournalEntryModal();
    renderJournal();
  } catch (error) {
    showAlert(error.message || 'Journal-Eintrag konnte nicht gespeichert werden.', true);
  } finally {
    if (elements.journalAttachmentInput) elements.journalAttachmentInput.value = '';
  }
}

async function handleJournalListClick(event) {
  const downloadAttachmentButton = event.target.closest('[data-action="download-attachment"]');
  if (!downloadAttachmentButton) return;
  const noteId = String(downloadAttachmentButton.dataset.noteId || '');
  const attachmentIndex = Number(downloadAttachmentButton.dataset.attachmentIndex || -1);
  const entry = state.journalEntries.find((item) => String(item.id) === noteId);
  const attachment = entry?.attachments?.[attachmentIndex];
  if (!attachment) return;
  const { data, error } = await state.supabase.storage.from(String(attachment.bucket || JOURNAL_ATTACHMENT_BUCKET)).download(String(attachment.path || ''));
  if (error || !data) {
    showAlert(error?.message || 'Download fehlgeschlagen.', true);
    return;
  }
  const blobUrl = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = attachment.name || 'datei';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

function getNotesByColumn(columnKey) {
  return state.notes
    .filter((note) => state.showHiddenNotes || isNoteVisibleToday(note))
    .filter((note) => String(note.status || 'todo') === columnKey)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function isNoteVisibleToday(note) {
  const visibleFrom = normalizeIsoDateOnly(note?.visible_from_date);
  if (!visibleFrom) return true;
  return visibleFrom <= getTodayIsoDate();
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function updateHiddenNotesToggleButtonLabel() {
  if (!elements.toggleHiddenNotesButton) return;
  if (state.showHiddenNotes) {
    elements.toggleHiddenNotesButton.textContent = 'Versteckte ausblenden';
    return;
  }
  elements.toggleHiddenNotesButton.textContent = 'Alle inkl. versteckte';
}

async function handleProjectSettingsSubmit(event) {
  event.preventDefault();
  if (!state.projectId) return;
  const payload = {
    project_lead_profile_id: elements.settingsProjectLeadSelect?.value || null,
    construction_lead_profile_id: elements.settingsConstructionLeadSelect?.value || null,
    street: elements.settingsStreetInput?.value.trim() || null,
    postal_code: elements.settingsPostalCodeInput?.value.trim() || null,
    city: elements.settingsCityInput?.value.trim() || null,
    has_barrack: elements.settingsHasBarrackInput?.checked === true,
    has_lunch_break: elements.settingsHasLunchBreakInput?.checked === true,
    workday_start_time: elements.settingsWorkdayStartInput?.value || null,
    workday_end_time: elements.settingsWorkdayEndInput?.value || null,
    project_contacts: getProjectContacts(),
    project_documents: getProjectDocuments(),
  };
  const { error } = await state.supabase.from('projects').update(payload).eq('id', state.projectId);
  if (error) {
    showAlert(error.message || 'Einstellungen konnten nicht gespeichert werden.', true);
    return;
  }
  state.project = { ...state.project, ...payload };
  renderSettings();
  showAlert('Einstellungen gespeichert.');
}

function handleAddExistingContact() {
  const contactId = String(elements.settingsContactSelect?.value || '');
  const role = String(elements.settingsRoleSelect?.value || '').trim();
  if (!contactId || !role) return;
  const next = [...getProjectContacts(), {
    crm_contact_id: contactId,
    role,
    include_in_reports: elements.settingsContactKeyValueInput?.checked === true,
  }];
  state.project.project_contacts = next;
  renderProjectContactsTable();
}

async function handleCreateContact() {
  const firstName = elements.newContactFirstNameInput?.value.trim();
  const lastName = elements.newContactLastNameInput?.value.trim();
  const category = elements.newContactCategoryInput?.value;
  if (!firstName || !lastName || !category) {
    showAlert('Vorname, Nachname und CRM-Kategorie sind Pflicht.', true);
    return;
  }
  const payload = {
    first_name: firstName,
    last_name: lastName,
    category,
    company_name: elements.newContactCompanyInput?.value.trim() || null,
    phone: elements.newContactPhoneInput?.value.trim() || null,
    email: elements.newContactEmailInput?.value.trim() || null,
    street: elements.newContactStreetInput?.value.trim() || null,
    postal_code: elements.newContactPostalCodeInput?.value.trim() || null,
    city: elements.newContactCityInput?.value.trim() || null,
  };
  const { data, error } = await state.supabase.from('crm_contacts').insert(payload).select('*').single();
  if (error) {
    showAlert(error.message || 'CRM-Kontakt konnte nicht erstellt werden.', true);
    return;
  }
  state.contacts = [data, ...state.contacts];
  renderContactOptions();
  const next = [...getProjectContacts(), {
    crm_contact_id: data.id,
    role: String(elements.newContactRoleInput?.value || 'kunde'),
    include_in_reports: elements.newContactKeyValueInput?.checked === true,
  }];
  state.project.project_contacts = next;
  renderProjectContactsTable();
  showAlert('Kontakt erstellt und zum Projekt hinzugefügt.');
}

function handleProjectContactsTableClick(event) {
  const button = event.target.closest('[data-action="remove-project-contact"]');
  if (!button) return;
  const index = Number(button.dataset.index || -1);
  if (index < 0) return;
  state.project.project_contacts = getProjectContacts().filter((_, itemIndex) => itemIndex !== index);
  renderProjectContactsTable();
}

async function handleProjectDocumentSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length || !state.projectId) return;
  try {
    const uploaded = [];
    for (const file of files) {
      const path = `${state.projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
      const { error } = await state.supabase.storage.from(PROJECT_SETTINGS_DOCUMENT_BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      uploaded.push({
        name: file.name,
        size: file.size,
        path,
        created_at: new Date().toISOString(),
      });
    }
    state.project.project_documents = [...getProjectDocuments(), ...uploaded];
    renderProjectDocumentsTable();
    showAlert('Dokument(e) hochgeladen. Zum endgültigen Speichern bitte "Einstellungen speichern" klicken.');
  } catch (error) {
    showAlert(error.message || 'Dokumente konnten nicht hochgeladen werden.', true);
  } finally {
    event.target.value = '';
  }
}

async function handleProjectDocumentsTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index || -1);
  const docs = getProjectDocuments();
  const doc = docs[index];
  if (!doc) return;
  if (button.dataset.action === 'delete-project-document') {
    const { error } = await state.supabase.storage.from(PROJECT_SETTINGS_DOCUMENT_BUCKET).remove([doc.path]);
    if (error) {
      showAlert(error.message || 'Dokument konnte nicht gelöscht werden.', true);
      return;
    }
    state.project.project_documents = docs.filter((_, docIndex) => docIndex !== index);
    renderProjectDocumentsTable();
    return;
  }
  const { data, error } = await state.supabase.storage.from(PROJECT_SETTINGS_DOCUMENT_BUCKET).createSignedUrl(doc.path, 60);
  if (error || !data?.signedUrl) {
    showAlert(error?.message || 'Dokument konnte nicht geöffnet werden.', true);
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function handleBoardClick(event) {
  const addButton = event.target.closest('[data-action="add-note"]');
  if (addButton) {
    await createNote({ columnStatus: String(addButton.dataset.column || 'todo') });
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
    return;
  }

  const openDetailButton = event.target.closest('[data-action="open-note-detail"]');
  if (openDetailButton) {
    openNoteDetailModal(String(openDetailButton.dataset.noteId || ''));
    return;
  }

  const card = event.target.closest('.task-card[data-note-id]');
  if (!card) return;
  if (event.target.closest('button, input, textarea, select, a, label')) return;
  openNoteDetailModal(String(card.dataset.noteId || ''));
}

async function handleBoardChange(event) {
  const noteId = String(event.target.dataset.noteId || '');
  if (!noteId) return;

  const note = state.notes.find((entry) => String(entry.id) === noteId);
  if (!note) return;
  const field = String(event.target.dataset.field || '');
  const action = String(event.target.dataset.action || '');

  if (field === 'todo_description') {
    const value = event.target.value || '';
    note[field] = value;
    await saveNote(note);
    return;
  }

  if (field === 'latest_text') {
    const latestEntry = getLastConversationEntry(note);
    if (!latestEntry || !isEntryByCurrentUser(latestEntry)) return;
    latestEntry.text = String(event.target.value || '');
    await saveNote(note);
    return;
  }

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
    if ((note.todo_items || []).length >= MAX_TODOS_PER_NOTE) {
      showAlert(`Maximal ${MAX_TODOS_PER_NOTE} To-dos pro Karte.`, true);
      return;
    }
    note.todo_items = [...(note.todo_items || []), { id: crypto.randomUUID(), text, done: false }];
    event.target.value = '';
    state.pendingTodoInputFocusNoteId = noteId;
    await saveTodoItems(note);
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
  } catch (error) {
    showAlert(`Upload fehlgeschlagen: ${error.message}`, true);
  }
}

function handleDragStart(event) {
  const card = event.target.closest('[data-note-id]');
  if (!card) return;
  state.draggedNoteId = String(card.dataset.noteId || '');
  card.classList.add('dragging');
  showDragDock();
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
  hideDragDock();
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

async function createNote({ columnStatus = 'todo' } = {}) {
  const position = getNotesByColumn(columnStatus).length;
  const payload = {
    project_id: state.projectId,
    status: columnStatus,
    position,
    note_type: 'text',
    content: [],
    todo_items: [],
    todo_description: '',
    counter_value: 0,
    counter_start_value: 1,
    counter_log: [],
    counter_description: '',
    attachments: [],
    color: null,
    visible_from_date: null,
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
  setActivePage(state.currentPage);
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
}

async function saveNote(note, { notify = true } = {}) {
  const payload = {
    note_type: 'text',
    content: Array.isArray(note.content) ? note.content : [],
    todo_description: note.todo_description || '',
    todo_items: Array.isArray(note.todo_items) ? note.todo_items : [],
    attachments: Array.isArray(note.attachments) ? note.attachments : [],
    color: normalizeNoteColor(note.color) || null,
    visible_from_date: normalizeIsoDateOnly(note.visible_from_date) || null,
  };

  const { error } = await state.supabase
    .from(KANBAN_TABLE)
    .update(payload)
    .eq('id', note.id);

  if (error) {
    if (notify) showAlert(`Speichern fehlgeschlagen: ${error.message}`, true);
    return false;
  }

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
  if (state.activeNoteId && String(state.activeNoteId) === String(note.id)) {
    renderNoteDetailModal();
  }
  focusTodoAddInputIfNeeded();
  setActivePage(state.currentPage);
}

function openNoteDetailModal(noteId) {
  const note = state.notes.find((entry) => String(entry.id) === String(noteId));
  if (!note) return;
  state.activeNoteId = String(noteId);
  const latestEntry = getLastConversationEntry(note);
  state.noteEditorDraft = latestEntry && isEntryByCurrentUser(latestEntry) ? latestEntry.text : '';
  state.noteEditorOriginal = state.noteEditorDraft;
  renderNoteDetailModal();
  elements.noteDetailModal?.classList.remove('hidden');
}

async function closeNoteDetailModal() {
  await saveActiveNoteDraftIfNeeded();
  state.activeNoteId = '';
  state.noteEditorDraft = '';
  state.noteEditorOriginal = '';
  elements.noteDetailModal?.classList.add('hidden');
}

function renderNoteDetailModal() {
  const note = state.notes.find((entry) => String(entry.id) === String(state.activeNoteId));
  if (!note || !elements.noteDetailEditor || !elements.noteDetailTimeline) return;
  const latestEntry = getLastConversationEntry(note);
  const latestIsMine = isEntryByCurrentUser(latestEntry);

  elements.noteDetailEditor.innerHTML = `
    <textarea class="note-primary-input" data-action="note-editor-input" placeholder="${latestIsMine ? 'Dein letzter Eintrag' : 'Neuen Eintrag schreiben ...'}">${escapeHtml(state.noteEditorDraft)}</textarea>
    <div class="todo-modal-wrap" data-modal-todos="${escapeHtml(note.id)}">${renderTodoList(note, { showCompleted: true })}</div>
    <div class="attachments-wrap modal-attachments">
      <div class="modal-attachments-header">
        <h4>Anhänge</h4>
        <button class="task-icon" type="button" title="Anhang hochladen" aria-label="Anhang hochladen" data-action="open-attachments" data-note-id="${escapeHtml(note.id)}">⤴︎</button>
      </div>
      ${renderAttachmentList(Array.isArray(note.attachments) ? note.attachments : [], note.id)}
    </div>
    <div class="note-card-controls-row">
      <div class="note-color-picker" role="radiogroup" aria-label="Kartenfarbe auswählen">
        ${NOTE_COLOR_OPTIONS.map((color) => `
          <label class="note-color-option note-color-option-${color}">
            <input type="radio" name="noteColor" value="${color}" data-action="change-note-color" ${note.color === color ? 'checked' : ''} />
            <span class="note-color-swatch" aria-hidden="true"></span>
          </label>
        `).join('')}
      </div>
      <label class="note-visibility-label">
        <span>Unsichtbar bis</span>
        <input type="date" data-action="change-visible-from-date" data-note-id="${escapeHtml(note.id)}" value="${escapeHtml(note.visible_from_date || '')}" />
      </label>
    </div>
  `;

  elements.noteDetailTimeline.innerHTML = `
    <h4>Gesprächsverlauf</h4>
    <div class="note-conversation-list">
      ${(note.content || []).map((entry) => `
        <article class="note-conversation-item ${isEntryByCurrentUser(entry) ? '' : 'external'}">
          <span class="note-conversation-meta">${escapeHtml(getEntryAuthorLabel(entry))} · ${escapeHtml(formatDateTime(entry.created_at))}</span>
          <p>${escapeHtml(entry.text || '')}</p>
        </article>
      `).join('') || '<p class="subtle-text">Noch kein Verlauf vorhanden.</p>'}
    </div>
  `;
}

async function handleNoteDetailModalClick(event) {
  if (event.target === elements.noteDetailModal || event.target.closest('[data-action="close-note-detail"]')) {
    await closeNoteDetailModal();
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
    renderNoteDetailModal();
    return;
  }

  const downloadAttachmentButton = event.target.closest('[data-action="download-attachment"]');
  if (downloadAttachmentButton) {
    const noteId = String(downloadAttachmentButton.dataset.noteId || '');
    const attachmentIndex = Number(downloadAttachmentButton.dataset.attachmentIndex || -1);
    await downloadAttachment(noteId, attachmentIndex);
    return;
  }

  const note = state.notes.find((entry) => String(entry.id) === String(state.activeNoteId));
  if (!note) return;

  const removeTodoButton = event.target.closest('[data-action="remove-todo"]');
  if (removeTodoButton) {
    const noteId = String(removeTodoButton.dataset.noteId || '');
    const itemId = String(removeTodoButton.dataset.itemId || '');
    await removeTodoItem(noteId, itemId);
    renderNoteDetailModal();
  }
}

function focusTodoAddInputIfNeeded() {
  if (!state.pendingTodoInputFocusNoteId) return;
  const noteId = state.pendingTodoInputFocusNoteId;
  state.pendingTodoInputFocusNoteId = '';
  const targetInput = document.querySelector(`[data-action="add-todo"][data-note-id="${CSS.escape(noteId)}"]`);
  targetInput?.focus();
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

function handleNoteDetailModalInput(event) {
  if (event.target.matches('[data-action="note-editor-input"]')) {
    state.noteEditorDraft = String(event.target.value || '');
    return;
  }

  if (event.target.matches('[data-action="change-note-color"]')) {
    const note = state.notes.find((entry) => String(entry.id) === String(state.activeNoteId));
    if (!note) return;
    note.color = normalizeNoteColor(event.target.value);
    void saveNote(note, { notify: false });
    renderBoard();
    return;
  }

  if (event.target.matches('[data-action="change-visible-from-date"]')) {
    const note = state.notes.find((entry) => String(entry.id) === String(state.activeNoteId));
    if (!note) return;
    note.visible_from_date = normalizeIsoDateOnly(event.target.value);
    void saveNote(note, { notify: false });
    renderBoard();
  }
}

async function saveNoteDetailEditor(note) {
  const text = String(state.noteEditorDraft || '').trim();
  if (!text) return;
  const latestEntry = getLastConversationEntry(note);
  if (latestEntry && isEntryByCurrentUser(latestEntry)) {
    latestEntry.text = text;
    latestEntry.created_at = new Date().toISOString();
  } else {
    note.content = [...(note.content || []), buildConversationEntry(text)];
  }
  await saveNote(note);
  state.noteEditorOriginal = text;
  renderBoard();
  renderNoteDetailModal();
}

async function saveActiveNoteDraftIfNeeded() {
  const noteId = String(state.activeNoteId || '');
  if (!noteId) return;
  if (String(state.noteEditorDraft || '') === String(state.noteEditorOriginal || '')) return;
  const note = state.notes.find((entry) => String(entry.id) === noteId);
  if (!note) return;
  await saveNoteDetailEditor(note);
}

function getLastConversationEntry(note) {
  const history = Array.isArray(note?.content) ? note.content : [];
  if (!history.length) return null;
  return history[history.length - 1];
}

function getEntryAuthorLabel(entry) {
  if (!entry) return 'Unbekannt';
  if (entry.author_type === 'ai') return 'AI';
  return entry.full_name || [entry.first_name, entry.last_name].filter(Boolean).join(' ') || 'User';
}

function isEntryByCurrentUser(entry) {
  if (!entry) return false;
  const currentUid = String(state.currentUser?.uid || '');
  const entryUid = String(entry.uid || entry.user_id || '');
  return Boolean(currentUid) && currentUid === entryUid;
}

function truncateText(text, maxLength = 100) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}...`;
}

function getEffectiveNoteColor(note) {
  const selected = normalizeNoteColor(note?.color);
  if (selected) return selected;
  return isEntryByCurrentUser(getLastConversationEntry(note)) ? 'blue' : 'yellow';
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
  setActivePage(state.currentPage);
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

function normalizeTimeInput(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

function formatDateTime(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDateLabel(value) {
  const isoDate = normalizeIsoDateOnly(value);
  if (!isoDate) return '–';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('de-CH', { dateStyle: 'short' });
}

function showAlert(message, isError = false) {
  if (!elements.alert) return;
  if (!isError) {
    elements.alert.classList.add('hidden');
    return;
  }
  elements.alert.textContent = message;
  elements.alert.classList.remove('hidden');
  elements.alert.classList.toggle('error', isError);
  window.clearTimeout(showAlert.timeoutId);
  showAlert.timeoutId = window.setTimeout(() => elements.alert?.classList.add('hidden'), 2200);
}

function showDragDock() {
  if (!elements.dragDock || !elements.dragDockInner) return;
  if (!elements.dragDockInner.childElementCount) {
    elements.dragDockInner.innerHTML = DRAG_DOCK_ICONS.map((icon, index) => `
      <button class="drag-dock-icon" type="button" data-dock-slot="${index}" aria-label="Dock Platzhalter ${index + 1}">
        <span>${icon}</span>
      </button>
    `).join('');
  }
  state.isDragDockVisible = true;
  elements.dragDock.classList.add('visible');
  elements.dragDock.setAttribute('aria-hidden', 'false');
}

function hideDragDock() {
  if (!elements.dragDock) return;
  state.isDragDockVisible = false;
  elements.dragDock.classList.remove('visible');
  elements.dragDock.setAttribute('aria-hidden', 'true');
  elements.dragDock.querySelectorAll('.drag-dock-icon.active').forEach((node) => node.classList.remove('active'));
}

function handleDockDragOver(event) {
  if (!state.draggedNoteId || !state.isDragDockVisible) return;
  event.preventDefault();
  const icon = event.target.closest('.drag-dock-icon');
  elements.dragDock?.querySelectorAll('.drag-dock-icon.active').forEach((node) => node.classList.remove('active'));
  if (icon) icon.classList.add('active');
}

function handleDockDrop(event) {
  if (!state.draggedNoteId || !state.isDragDockVisible) return;
  event.preventDefault();
  const icon = event.target.closest('.drag-dock-icon');
  if (!icon) return;
  const dockSlot = Number(icon.dataset.dockSlot || -1);
  const noteId = state.draggedNoteId;
  console.info('Dock placeholder drop:', { dockSlot, noteId });
  handleDragEnd();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
