const STORAGE_BUCKET = 'weekly-attachments';
const CONFIG_PATH = './supabase-config.json';
const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const HOLIDAY_TYPE_LABELS = {
  ferien: 'Ferien',
  fehlen: 'Ferien',
  militaer: 'Militär',
  zivildienst: 'Zivildienst',
  unfall: 'Unfall',
  krankheit: 'Krankheit',
  feiertag: 'Feiertag',
};
const ABSENCE_CATEGORY_CONFIG = [
  { key: 'unfall', label: 'Unfall', terms: ['unfall'] },
  { key: 'militaer', label: 'Militär', terms: ['militaer', 'militär', 'zivildienst'] },
  { key: 'ferien', label: 'Ferien', terms: ['ferien', 'fehlen'] },
  { key: 'krankheit', label: 'Krankheit', terms: ['krankheit'] },
  { key: 'feiertag', label: 'Feiertag', terms: ['feiertag'] },
];
const ADMIN_SQL_SNIPPET = `-- Vollzugriff nur für Profile mit is_admin = true

alter table public.app_profiles enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.holiday_requests enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_profiles
    where id = auth.uid()
      and is_admin = true
  );
$$;

drop policy if exists "authenticated full access app_profiles" on public.app_profiles;
drop policy if exists "authenticated full access weekly_reports" on public.weekly_reports;
drop policy if exists "authenticated full access holiday_requests" on public.holiday_requests;
drop policy if exists "authenticated attachment read" on storage.objects;
drop policy if exists "authenticated attachment write" on storage.objects;
drop policy if exists "app_profiles own or admin" on public.app_profiles;
drop policy if exists "app_profiles insert own or admin" on public.app_profiles;
drop policy if exists "app_profiles update own or admin" on public.app_profiles;
drop policy if exists "app_profiles delete own or admin" on public.app_profiles;
drop policy if exists "weekly_reports own or admin" on public.weekly_reports;
drop policy if exists "holiday_requests own or admin" on public.holiday_requests;
drop policy if exists "weekly attachment read own or admin" on storage.objects;
drop policy if exists "weekly attachment write own or admin" on storage.objects;

create policy "app_profiles own or admin"
on public.app_profiles
for select
using (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles insert own or admin"
on public.app_profiles
for insert
with check (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles update own or admin"
on public.app_profiles
for update
using (public.is_admin_user() or auth.uid() = id)
with check (public.is_admin_user() or auth.uid() = id);

create policy "app_profiles delete own or admin"
on public.app_profiles
for delete
using (public.is_admin_user() or auth.uid() = id);

create policy "weekly_reports own or admin"
on public.weekly_reports
for all
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

create policy "holiday_requests own or admin"
on public.holiday_requests
for all
using (public.is_admin_user() or auth.uid() = profile_id)
with check (public.is_admin_user() or auth.uid() = profile_id);

create policy "weekly attachment read own or admin"
on storage.objects
for select
using (
  bucket_id = '${STORAGE_BUCKET}' and (
    public.is_admin_user() or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "weekly attachment write own or admin"
on storage.objects
for all
using (
  bucket_id = '${STORAGE_BUCKET}' and (
    public.is_admin_user() or auth.uid()::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = '${STORAGE_BUCKET}' and (
    public.is_admin_user() or auth.uid()::text = split_part(name, '/', 1)
  )
);`;

const demoProfiles = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'admin@maraschow.cn',
    full_name: 'Master Admin',
    role_label: 'Administration',
    is_admin: true,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'michael@example.com',
    full_name: 'Michael Gerber',
    role_label: 'Monteur',
    is_admin: false,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'sandra@example.com',
    full_name: 'Sandra Bühler',
    role_label: 'Monteurin',
    is_admin: false,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'pascal@example.com',
    full_name: 'Pascal Frei',
    role_label: 'Monteur',
    is_admin: false,
  },
];

const demoWeeklyReports = [
  {
    id: crypto.randomUUID(),
    profile_id: '22222222-2222-2222-2222-222222222222',
    work_date: getDateForWeekOffset(0, 0),
    commission_number: 'K-1024',
    start_time: '07:00',
    end_time: '17:00',
    lunch_break_minutes: 60,
    additional_break_minutes: 15,
    total_work_minutes: 525,
    expenses_amount: 24.5,
    other_costs_amount: 0,
    expense_note: 'Mittag auf Baustelle',
    notes: 'Leitungen montiert',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '22222222-2222-2222-2222-222222222222',
    work_date: getDateForWeekOffset(0, 1),
    commission_number: 'K-1024',
    start_time: '07:15',
    end_time: '16:45',
    lunch_break_minutes: 60,
    additional_break_minutes: 15,
    total_work_minutes: 495,
    expenses_amount: 18,
    other_costs_amount: 0,
    expense_note: 'Spesen',
    notes: 'Abschluss Elektroinstallationen',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '33333333-3333-3333-3333-333333333333',
    work_date: getDateForWeekOffset(0, 0),
    commission_number: 'K-2001',
    start_time: '08:00',
    end_time: '16:30',
    lunch_break_minutes: 45,
    additional_break_minutes: 15,
    total_work_minutes: 450,
    expenses_amount: 12,
    other_costs_amount: 8,
    expense_note: 'Parkhaus',
    notes: 'Serviceeinsatz und Messung',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '33333333-3333-3333-3333-333333333333',
    work_date: getDateForWeekOffset(0, 3),
    commission_number: 'ferien',
    start_time: '00:00',
    end_time: '00:00',
    lunch_break_minutes: 0,
    additional_break_minutes: 0,
    total_work_minutes: 0,
    expenses_amount: 0,
    other_costs_amount: 0,
    expense_note: '',
    notes: 'Ferientag',
    attachments: [],
  },
];

const demoHolidayRequests = [
  {
    id: crypto.randomUUID(),
    profile_id: '33333333-3333-3333-3333-333333333333',
    start_date: getDateForWeekOffset(0, 3),
    end_date: getDateForWeekOffset(0, 4),
    request_type: 'ferien',
    notes: 'Bereits mit Team abgestimmt.',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '22222222-2222-2222-2222-222222222222',
    start_date: getDateForWeekOffset(1, 0),
    end_date: getDateForWeekOffset(1, 2),
    request_type: 'militaer',
    notes: 'WK laut Aufgebot.',
    attachments: [],
  },
];

const state = {
  supabase: null,
  session: null,
  user: null,
  currentProfile: null,
  profiles: [],
  weeklyReports: [],
  holidayRequests: [],
  selectedWeek: getCurrentWeekValue(),
  currentPage: 'reports',
  employeeFilterQuery: '',
  selectedEmployeeIds: [],
  employeeSelectionInitialized: false,
  reportsPage: 1,
  reportsPerPage: 10,
  editingReportId: null,
  isSavingReport: false,
  isDemoMode: false,
  hasAdminAccess: false,
  configReady: false,
  authListenerBound: false,
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  elements.weekPicker.value = state.selectedWeek;
  elements.adminSqlPreview.textContent = ADMIN_SQL_SNIPPET;

  await initializeSupabase();
  await bootstrapSession();
  render();
}

function cacheElements() {
  elements.loginView = document.getElementById('loginView');
  elements.appView = document.getElementById('appView');
  elements.accessDeniedView = document.getElementById('accessDeniedView');
  elements.accessDeniedLogoutButton = document.getElementById('accessDeniedLogoutButton');
  elements.loginForm = document.getElementById('loginForm');
  elements.emailInput = document.getElementById('emailInput');
  elements.passwordInput = document.getElementById('passwordInput');
  elements.loginAlert = document.getElementById('loginAlert');
  elements.userName = document.getElementById('userName');
  elements.userRole = document.getElementById('userRole');
  elements.userBadge = document.getElementById('userBadge');
  elements.connectionBadge = document.getElementById('connectionBadge');
  elements.dataTimestamp = document.getElementById('dataTimestamp');
  elements.pageTitle = document.getElementById('pageTitle');
  elements.weekPicker = document.getElementById('weekPicker');
  elements.weekLabel = document.getElementById('weekLabel');
  elements.weekDateRange = document.getElementById('weekDateRange');
  elements.previousWeekButton = document.getElementById('previousWeekButton');
  elements.nextWeekButton = document.getElementById('nextWeekButton');
  elements.exportPdfButton = document.getElementById('exportPdfButton');
  elements.reloadButton = document.getElementById('reloadButton');
  elements.connectionRefreshButton = document.getElementById('connectionRefreshButton');
  elements.logoutButton = document.getElementById('logoutButton');
  elements.reportsTableBody = document.getElementById('reportsTableBody');
  elements.absencesTableBody = document.getElementById('absencesTableBody');
  elements.reportCount = document.getElementById('reportCount');
  elements.totalHours = document.getElementById('totalHours');
  elements.totalExpenses = document.getElementById('totalExpenses');
  elements.missingReports = document.getElementById('missingReports');
  elements.submissionList = document.getElementById('submissionList');
  elements.missingList = document.getElementById('missingList');
  elements.selectedEmployeesSummary = document.getElementById('selectedEmployeesSummary');
  elements.employeeFilterInput = document.getElementById('employeeFilterInput');
  elements.employeeFilterList = document.getElementById('employeeFilterList');
  elements.selectAllEmployeesButton = document.getElementById('selectAllEmployeesButton');
  elements.clearEmployeeSelectionButton = document.getElementById('clearEmployeeSelectionButton');
  elements.reportsPrevPageButton = document.getElementById('reportsPrevPageButton');
  elements.reportsNextPageButton = document.getElementById('reportsNextPageButton');
  elements.reportsPaginationSummary = document.getElementById('reportsPaginationSummary');
  elements.reportEditModal = document.getElementById('reportEditModal');
  elements.reportEditForm = document.getElementById('reportEditForm');
  elements.closeReportEditModalButton = document.getElementById('closeReportEditModalButton');
  elements.cancelReportEditButton = document.getElementById('cancelReportEditButton');
  elements.editReportId = document.getElementById('editReportId');
  elements.editEmployeeName = document.getElementById('editEmployeeName');
  elements.editWorkDate = document.getElementById('editWorkDate');
  elements.editCommissionNumber = document.getElementById('editCommissionNumber');
  elements.editStartTime = document.getElementById('editStartTime');
  elements.editEndTime = document.getElementById('editEndTime');
  elements.editTotalMinutes = document.getElementById('editTotalMinutes');
  elements.editExpensesAmount = document.getElementById('editExpensesAmount');
  elements.editOtherCostsAmount = document.getElementById('editOtherCostsAmount');
  elements.editNotes = document.getElementById('editNotes');
  elements.editExpenseNote = document.getElementById('editExpenseNote');
  elements.pages = {
    reports: document.getElementById('reportsPage'),
    absences: document.getElementById('absencesPage'),
    security: document.getElementById('securityPage'),
  };
  elements.navTabs = Array.from(document.querySelectorAll('.nav-tab'));
  elements.adminSqlPreview = document.getElementById('adminSqlPreview');
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.accessDeniedLogoutButton.addEventListener('click', handleLogout);
  elements.reloadButton.addEventListener('click', refreshData);
  elements.connectionRefreshButton.addEventListener('click', refreshData);
  elements.weekPicker.addEventListener('change', async (event) => {
    state.selectedWeek = event.target.value;
    await loadData();
  });
  elements.previousWeekButton.addEventListener('click', async () => {
    state.selectedWeek = shiftWeekValue(state.selectedWeek, -1);
    elements.weekPicker.value = state.selectedWeek;
    await loadData();
  });
  elements.nextWeekButton.addEventListener('click', async () => {
    state.selectedWeek = shiftWeekValue(state.selectedWeek, 1);
    elements.weekPicker.value = state.selectedWeek;
    await loadData();
  });
  elements.exportPdfButton.addEventListener('click', exportWeekPdf);
  elements.employeeFilterInput.addEventListener('input', handleEmployeeFilterInput);
  elements.selectAllEmployeesButton.addEventListener('click', selectAllEmployees);
  elements.clearEmployeeSelectionButton.addEventListener('click', clearEmployeeSelection);
  elements.employeeFilterList.addEventListener('change', handleEmployeeSelectionChange);
  elements.employeeFilterList.addEventListener('click', handleEmployeeFilterListClick);
  elements.reportsTableBody.addEventListener('click', handleReportsTableClick);
  elements.reportsPrevPageButton.addEventListener('click', goToPreviousReportsPage);
  elements.reportsNextPageButton.addEventListener('click', goToNextReportsPage);
  elements.closeReportEditModalButton.addEventListener('click', closeReportEditModal);
  elements.cancelReportEditButton.addEventListener('click', closeReportEditModal);
  elements.reportEditForm.addEventListener('submit', handleReportEditSubmit);
  elements.reportEditModal.addEventListener('click', (event) => {
    if (event.target?.dataset?.closeModal === 'true') {
      closeReportEditModal();
    }
  });
  document.addEventListener('keydown', handleGlobalKeydown);
  elements.navTabs.forEach((tab) => {
    tab.addEventListener('click', () => setCurrentPage(tab.dataset.page));
  });
}

async function initializeSupabase() {
  if (!window.supabase?.createClient) {
    setConnectionBadge('Supabase SDK fehlt', true);
    return;
  }

  try {
    const response = await fetch(CONFIG_PATH, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Konfigurationsdatei nicht gefunden. Demo-Modus aktiv.');
    }

    const config = await response.json();
    if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
      throw new Error('supabase-config.json ist unvollständig. Demo-Modus aktiv.');
    }

    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    state.configReady = true;
    setConnectionBadge('Verbunden');
  } catch (error) {
    console.warn(error);
    state.isDemoMode = true;
    setConnectionBadge('Demo-Modus', true);
    showLoginMessage(`${error.message} Mit Demo-Daten kann das UI trotzdem geprüft werden.`, false);
  }
}

async function bootstrapSession() {
  if (state.isDemoMode) {
    return;
  }

  const { data, error } = await state.supabase.auth.getSession();
  if (error) {
    showLoginMessage(error.message);
    return;
  }

  state.session = data.session;
  if (state.session?.user) {
    state.user = state.session.user;
    state.hasAdminAccess = false;
    await loadData();
  }

  if (!state.authListenerBound) {
    state.authListenerBound = true;
    state.supabase.auth.onAuthStateChange(async (event, session) => {
      state.session = session;

      if (event === 'SIGNED_OUT') {
        resetAppState();
        render();
        return;
      }

      if (!session?.user) {
        return;
      }

      const nextUserId = session.user.id;
      const currentUserId = state.user?.id ?? null;
      const shouldRefreshUserData = ['SIGNED_IN', 'USER_UPDATED'].includes(event);
      const isSessionRecoveryEvent = ['INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event);

      state.user = session.user;

      if (shouldRefreshUserData || (isSessionRecoveryEvent && currentUserId !== nextUserId)) {
        await loadData();
      }
    });
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.emailInput.value.trim().toLowerCase();
  const password = elements.passwordInput.value;

  if (state.isDemoMode) {
    const demoProfile = demoProfiles.find((profile) => profile.email === email) ?? demoProfiles[0];
    state.user = { id: demoProfile.id, email: demoProfile.email };
    state.currentProfile = demoProfile;
    state.hasAdminAccess = isAdminProfile(demoProfile);
    await loadDemoData();
    showLoginMessage('Demo-Login erfolgreich.', false);
    render();
    return;
  }

  const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showLoginMessage(error.message);
    return;
  }

  state.session = data.session;
  state.user = data.user;
  state.hasAdminAccess = false;
  await loadData();
  showLoginMessage('Login erfolgreich.', false);
  render();
}

async function handleLogout() {
  if (state.isDemoMode) {
    resetAppState();
    showLoginMessage('Demo-Sitzung beendet.', false);
    render();
    return;
  }

  const { error } = await state.supabase.auth.signOut();
  if (error) {
    alert(error.message);
    return;
  }

  resetAppState();
  render();
}

async function refreshData() {
  await loadData();
}

function resetAppState() {
  state.session = null;
  state.user = null;
  state.currentProfile = null;
  state.profiles = [];
  state.weeklyReports = [];
  state.holidayRequests = [];
  state.employeeFilterQuery = '';
  state.selectedEmployeeIds = [];
  state.employeeSelectionInitialized = false;
  state.reportsPage = 1;
  state.editingReportId = null;
  state.isSavingReport = false;
  state.hasAdminAccess = false;
  closeReportEditModal();
  elements.dataTimestamp.textContent = 'Noch keine Daten geladen';
}

async function loadData() {
  if (!state.user) {
    render();
    return;
  }

  if (state.isDemoMode) {
    await loadDemoData();
    render();
    return;
  }

  try {
    const currentProfile = await fetchCurrentProfile();
    state.currentProfile = currentProfile ?? buildFallbackProfileFromUser(state.user);
    state.hasAdminAccess = isAdminProfile(state.currentProfile);

    if (!state.hasAdminAccess) {
      state.profiles = [];
      state.weeklyReports = [];
      state.holidayRequests = [];
      elements.dataTimestamp.textContent = 'Kein Zugriff – is_admin ist für dieses Profil nicht aktiviert';
      render();
      return;
    }

    const weekRange = getWeekRange(state.selectedWeek);
    const reportsQuery = state.supabase
      .from('weekly_reports')
      .select('*')
      .gte('work_date', weekRange.start)
      .lte('work_date', weekRange.end)
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true });

    const profilesQuery = state.supabase.from('app_profiles').select('*').order('full_name', { ascending: true });
    const absencesQuery = state.supabase
      .from('holiday_requests')
      .select('*')
      .order('start_date', { ascending: false })
      .limit(200);

    const [{ data: reports, error: reportsError }, { data: profiles, error: profilesError }, { data: absences, error: absencesError }] = await Promise.all([
      reportsQuery,
      profilesQuery,
      absencesQuery,
    ]);

    if (reportsError) throw reportsError;
    if (profilesError) throw profilesError;
    if (absencesError) throw absencesError;

    state.weeklyReports = reports ?? [];
    state.profiles = profiles ?? [];
    state.holidayRequests = absences ?? [];
    syncEmployeeSelection();
    elements.dataTimestamp.textContent = `Letzte Aktualisierung: ${new Date().toLocaleString('de-CH')}`;
    render();
  } catch (error) {
    console.error(error);
    const hint = getAccessConfigurationHint(error);
    elements.dataTimestamp.textContent = hint || 'Daten konnten nicht geladen werden';
    alert(`Daten konnten nicht geladen werden: ${error.message}${hint ? `\n\nHinweis: ${hint}` : ''}`);
  }
}

async function fetchCurrentProfile() {
  const { data, error } = await state.supabase
    .from('app_profiles')
    .select('*')
    .eq('id', state.user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function loadDemoData() {
  state.currentProfile = demoProfiles.find((profile) => profile.id === state.user.id) ?? demoProfiles[0];

  if (!state.hasAdminAccess) {
    state.profiles = [];
    state.weeklyReports = [];
    state.holidayRequests = [];
    elements.dataTimestamp.textContent = 'Kein Zugriff – Demo-Profil hat is_admin = false';
    return;
  }

  state.profiles = demoProfiles;

  const weekRange = getWeekRange(state.selectedWeek);
  const reports = demoWeeklyReports.filter((report) => report.work_date >= weekRange.start && report.work_date <= weekRange.end);
  state.weeklyReports = reports;
  state.holidayRequests = [...demoHolidayRequests];
  syncEmployeeSelection();
  elements.dataTimestamp.textContent = `Demo-Daten geladen: ${new Date().toLocaleString('de-CH')}`;
}

function render() {
  const loggedIn = Boolean(state.user);
  const hasAdminAccess = loggedIn && state.hasAdminAccess;
  const showAccessDenied = loggedIn && !state.hasAdminAccess;

  elements.loginView.classList.toggle('hidden', loggedIn);
  elements.appView.classList.toggle('hidden', !hasAdminAccess);
  elements.accessDeniedView.classList.toggle('hidden', !showAccessDenied);

  if (!hasAdminAccess) {
    closeReportEditModal();
    return;
  }

  renderSidebar();
  renderPages();
  renderWeekSummary();
  renderReportStats();
  renderEmployeeFilters();
  renderReportsTable();
  renderSubmissionLists();
  renderAbsenceTable();
}

function renderSidebar() {
  const profile = state.currentProfile;
  elements.userName.textContent = profile?.full_name ?? state.user.email;
  elements.userRole.textContent = profile?.role_label ?? 'Benutzer';
  elements.userBadge.textContent = state.hasAdminAccess ? 'Admin' : 'Kein Zugriff';
}

function renderPages() {
  const pageTitles = {
    reports: 'Wochenrapporte',
    absences: 'Ferien & Absenzen',
    security: 'Admin-Zugriff',
  };

  elements.pageTitle.textContent = pageTitles[state.currentPage];

  for (const [key, page] of Object.entries(elements.pages)) {
    page.classList.toggle('hidden', key !== state.currentPage);
  }

  elements.navTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.page === state.currentPage);
  });
}

function renderWeekSummary() {
  const weekRange = getWeekRange(state.selectedWeek);
  elements.weekPicker.value = state.selectedWeek;
  elements.weekLabel.textContent = getWeekLabel(state.selectedWeek);
  elements.weekDateRange.textContent = `${formatDate(weekRange.start)} – ${formatDate(weekRange.end)}`;
}

function renderReportStats() {
  const totalMinutes = state.weeklyReports.reduce((sum, report) => sum + Number(report.total_work_minutes || 0), 0);
  const totalExpenses = state.weeklyReports.reduce(
    (sum, report) => sum + Number(report.expenses_amount || 0) + Number(report.other_costs_amount || 0),
    0,
  );
  const missingProfiles = getMissingProfiles();

  elements.reportCount.textContent = String(state.weeklyReports.length);
  elements.totalHours.textContent = `${(totalMinutes / 60).toFixed(1)} h`;
  elements.totalExpenses.textContent = formatCurrency(totalExpenses);
  elements.missingReports.textContent = String(missingProfiles.length);
}

function renderEmployeeFilters() {
  elements.employeeFilterInput.value = state.employeeFilterQuery;
  const profiles = getReportableProfiles();
  const query = state.employeeFilterQuery.trim().toLowerCase();
  const visibleProfiles = profiles.filter((profile) =>
    `${profile.full_name} ${profile.email}`.toLowerCase().includes(query),
  );

  elements.selectedEmployeesSummary.textContent = `${state.selectedEmployeeIds.length} von ${profiles.length} Mitarbeitenden ausgewählt`;

  if (!profiles.length) {
    elements.employeeFilterList.innerHTML = '<div class="empty-state">Keine Mitarbeitenden vorhanden.</div>';
    return;
  }

  elements.employeeFilterList.innerHTML = visibleProfiles.length
    ? visibleProfiles
        .map((profile) => `
          <div class="employee-filter-card ${state.selectedEmployeeIds.includes(profile.id) ? 'selected' : ''}">
            <label class="employee-filter-chip">
              <input type="checkbox" value="${escapeAttribute(profile.id)}" ${state.selectedEmployeeIds.includes(profile.id) ? 'checked' : ''} />
              <span>${escapeHtml(profile.full_name)}</span>
            </label>
            <button class="employee-email-button" type="button" data-action="filter-single-employee" data-profile-id="${escapeAttribute(profile.id)}">
              ${escapeHtml(profile.email || 'Keine E-Mail')}
            </button>
          </div>
        `)
        .join('')
    : '<div class="empty-state">Keine Mitarbeitenden für diesen Suchbegriff gefunden.</div>';
}

function renderReportsTable() {
  const allReports = getSortedFilteredReports();
  const pagination = getReportsPaginationMeta(allReports);

  if (!state.weeklyReports.length) {
    elements.reportsTableBody.innerHTML = `<tr><td colspan="10">Keine Rapporte in dieser Woche gefunden.</td></tr>`;
    renderReportsPagination(pagination);
    return;
  }

  if (!allReports.length) {
    elements.reportsTableBody.innerHTML = `<tr><td colspan="10">Für die aktuelle Auswahl wurden keine Rapporte gefunden.</td></tr>`;
    renderReportsPagination(pagination);
    return;
  }

  elements.reportsTableBody.innerHTML = pagination.pageItems
    .map((report) => {
      const profile = getProfileById(report.profile_id);
      return `
        <tr class="report-row" data-action="edit-report" data-report-id="${escapeAttribute(report.id)}">
          <td>${escapeHtml(profile?.full_name ?? 'Unbekannt')}</td>
          <td>${formatDate(report.work_date)}</td>
          <td>${escapeHtml(report.commission_number || '–')}</td>
          <td>${escapeHtml(report.start_time || '–')} – ${escapeHtml(report.end_time || '–')}</td>
          <td>${formatMinutes(report.total_work_minutes)}</td>
          <td>${formatCurrency(Number(report.expenses_amount || 0) + Number(report.other_costs_amount || 0))}</td>
          <td>${escapeHtml(report.notes || report.expense_note || '–')}</td>
          <td>${renderAttachmentLinks(report.attachments)}</td>
          <td><button class="button button-small button-success" type="button" data-action="confirm-report" data-report-id="${escapeAttribute(report.id)}">Bestätigen</button></td>
          <td>
            <div class="table-row-actions">
              <button class="button button-small button-secondary" type="button" data-action="edit-report" data-report-id="${escapeAttribute(report.id)}">Bearbeiten</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
  renderReportsPagination(pagination);
}

function renderAbsenceTable() {
  if (!state.holidayRequests.length) {
    elements.absencesTableBody.innerHTML = `<tr><td colspan="6">Keine Ferien- oder Absenzanträge gefunden.</td></tr>`;
    return;
  }

  const sorted = [...state.holidayRequests].sort((a, b) => `${b.start_date}`.localeCompare(`${a.start_date}`));
  elements.absencesTableBody.innerHTML = sorted
    .map((request) => {
      const profile = getProfileById(request.profile_id);
      return `
        <tr>
          <td>${escapeHtml(profile?.full_name ?? 'Unbekannt')}</td>
          <td>${escapeHtml(HOLIDAY_TYPE_LABELS[request.request_type] ?? request.request_type)}</td>
          <td>${formatDate(request.start_date)}</td>
          <td>${formatDate(request.end_date)}</td>
          <td>${escapeHtml(request.notes || '–')}</td>
          <td>${renderAttachmentLinks(request.attachments)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderSubmissionLists() {
  const summaries = getProfileSubmissionSummary();
  const submittedItems = summaries
    .filter((summary) => summary.hasSubmission)
    .map((summary) => `
      <li class="align-start">
        <div class="status-stack">
          <strong>${escapeHtml(summary.profile.full_name)}</strong>
          <div class="subtle-text">${escapeHtml(summary.profile.email || 'Keine E-Mail')}</div>
          <div class="subtle-text">${summary.entryCount} Einträge in dieser Woche</div>
        </div>
        <div class="status-meta">
          <span class="pill success">Rapport erfasst</span>
          <strong>${formatMinutes(summary.totalMinutes)}</strong>
        </div>
      </li>
    `);

  const missingItems = summaries
    .filter((summary) => !summary.hasSubmission)
    .map(
      (summary) => `
      <li class="align-start">
        <div class="status-stack">
          <strong>${escapeHtml(summary.profile.full_name)}</strong>
          <div class="subtle-text">${escapeHtml(summary.profile.email)}</div>
          <div class="subtle-text">${escapeHtml(summary.profile.role_label || 'Profil')}</div>
        </div>
        <div class="status-meta">
          <span class="pill warning">Fehlt</span>
          <strong>0.00 h</strong>
        </div>
      </li>
    `,
    );

  elements.submissionList.innerHTML = submittedItems.join('') || '<li>In dieser Woche wurde noch kein Rapport erfasst.</li>';
  elements.missingList.innerHTML = missingItems.join('') || '<li>Alle Profile haben abgegeben.</li>';
}

function handleEmployeeFilterInput(event) {
  state.employeeFilterQuery = event.target.value;
  state.reportsPage = 1;
  renderEmployeeFilters();
}

function handleEmployeeSelectionChange(event) {
  if (event.target?.type !== 'checkbox') {
    return;
  }

  const profileId = event.target.value;
  if (event.target.checked) {
    if (!state.selectedEmployeeIds.includes(profileId)) {
      state.selectedEmployeeIds = [...state.selectedEmployeeIds, profileId];
    }
  } else {
    state.selectedEmployeeIds = state.selectedEmployeeIds.filter((id) => id !== profileId);
  }

  state.employeeSelectionInitialized = true;
  state.reportsPage = 1;
  render();
}

function selectAllEmployees() {
  state.selectedEmployeeIds = getReportableProfiles().map((profile) => profile.id);
  state.employeeSelectionInitialized = true;
  state.reportsPage = 1;
  render();
}

function clearEmployeeSelection() {
  state.selectedEmployeeIds = [];
  state.employeeSelectionInitialized = true;
  state.reportsPage = 1;
  render();
}

function handleEmployeeFilterListClick(event) {
  const button = event.target.closest('[data-action="filter-single-employee"]');
  if (!button) {
    return;
  }

  const profileId = button.dataset.profileId;
  if (!profileId) {
    return;
  }

  state.selectedEmployeeIds = [profileId];
  state.employeeSelectionInitialized = true;
  state.reportsPage = 1;
  render();
}

function syncEmployeeSelection() {
  const validIds = getReportableProfiles().map((profile) => profile.id);
  const validIdSet = new Set(validIds);
  const selected = state.selectedEmployeeIds.filter((id) => validIdSet.has(id));

  if (!state.employeeSelectionInitialized) {
    state.selectedEmployeeIds = [...validIds];
    state.employeeSelectionInitialized = true;
    state.reportsPage = 1;
    return;
  }

  state.selectedEmployeeIds = selected;
  const pageCount = Math.max(1, Math.ceil(getSortedFilteredReports().length / state.reportsPerPage));
  state.reportsPage = Math.min(state.reportsPage, pageCount);
}

function getFilteredReports() {
  const selectedIds = new Set(state.selectedEmployeeIds);
  return state.weeklyReports.filter((report) => selectedIds.has(report.profile_id));
}

function getSortedFilteredReports() {
  return [...getFilteredReports()].sort((a, b) => {
    const profileCompare = (getProfileById(a.profile_id)?.full_name ?? '').localeCompare(getProfileById(b.profile_id)?.full_name ?? '');
    if (profileCompare !== 0) return profileCompare;
    return `${a.work_date}${a.start_time}`.localeCompare(`${b.work_date}${b.start_time}`);
  });
}

function getReportsPaginationMeta(reports = getSortedFilteredReports()) {
  const totalItems = reports.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / state.reportsPerPage));
  const currentPage = Math.min(Math.max(1, state.reportsPage), totalPages);
  const startIndex = (currentPage - 1) * state.reportsPerPage;
  const endIndex = Math.min(startIndex + state.reportsPerPage, totalItems);

  state.reportsPage = currentPage;

  return {
    totalItems,
    totalPages,
    currentPage,
    startIndex,
    endIndex,
    pageItems: reports.slice(startIndex, endIndex),
  };
}

function renderReportsPagination({ totalItems, totalPages, currentPage, startIndex, endIndex }) {
  if (!elements.reportsPaginationSummary) {
    return;
  }

  elements.reportsPaginationSummary.textContent = totalItems
    ? `Seite ${currentPage} von ${totalPages} · ${startIndex + 1}-${endIndex} von ${totalItems} Rapporten`
    : 'Seite 1 von 1 · 0 Rapporte';
  elements.reportsPrevPageButton.disabled = currentPage <= 1;
  elements.reportsNextPageButton.disabled = currentPage >= totalPages || totalItems === 0;
}

function goToPreviousReportsPage() {
  if (state.reportsPage <= 1) {
    return;
  }

  state.reportsPage -= 1;
  renderReportsTable();
}

function goToNextReportsPage() {
  const totalPages = Math.max(1, Math.ceil(getSortedFilteredReports().length / state.reportsPerPage));
  if (state.reportsPage >= totalPages) {
    return;
  }

  state.reportsPage += 1;
  renderReportsTable();
}

function getProfileSubmissionSummary() {
  const groups = groupReportsByProfile(state.weeklyReports);
  return getReportableProfiles().map((profile) => {
    const reports = groups.get(profile.id) ?? [];
    const totalMinutes = reports.reduce((sum, report) => sum + Number(report.total_work_minutes || 0), 0);
    return {
      profile,
      reports,
      entryCount: reports.length,
      totalMinutes,
      hasSubmission: reports.length > 0,
    };
  });
}

function handleReportsTableClick(event) {
  if (event.target.closest('a')) {
    return;
  }

  const trigger = event.target.closest('[data-action]');
  if (!trigger) {
    return;
  }

  const reportId = trigger.dataset.reportId;
  if (!reportId) {
    return;
  }

  if (trigger.dataset.action === 'edit-report') {
    openReportEditModal(reportId);
    return;
  }

  if (trigger.dataset.action === 'confirm-report') {
    alert('Der Bestätigen-Button ist vorbereitet. Die eigentliche Kontroll-Logik folgt im nächsten Schritt.');
  }
}

function openReportEditModal(reportId) {
  const report = state.weeklyReports.find((item) => item.id === reportId);
  if (!report) {
    return;
  }

  const profile = getProfileById(report.profile_id);
  state.editingReportId = report.id;
  elements.editReportId.value = report.id;
  elements.editEmployeeName.value = profile?.full_name ?? 'Unbekannt';
  elements.editWorkDate.value = report.work_date || '';
  elements.editCommissionNumber.value = report.commission_number || '';
  elements.editStartTime.value = report.start_time || '';
  elements.editEndTime.value = report.end_time || '';
  elements.editTotalMinutes.value = Number(report.total_work_minutes || 0);
  elements.editExpensesAmount.value = Number(report.expenses_amount || 0);
  elements.editOtherCostsAmount.value = Number(report.other_costs_amount || 0);
  elements.editNotes.value = report.notes || '';
  elements.editExpenseNote.value = report.expense_note || '';
  elements.reportEditModal.classList.remove('hidden');
}

function closeReportEditModal() {
  state.editingReportId = null;
  if (!elements.reportEditModal || !elements.reportEditForm) {
    return;
  }

  elements.reportEditModal.classList.add('hidden');
  elements.reportEditForm.reset();
}

async function handleReportEditSubmit(event) {
  event.preventDefault();
  if (!state.editingReportId || state.isSavingReport) {
    return;
  }

  const reportId = state.editingReportId;
  const updates = {
    work_date: elements.editWorkDate.value,
    commission_number: elements.editCommissionNumber.value.trim(),
    start_time: elements.editStartTime.value,
    end_time: elements.editEndTime.value,
    total_work_minutes: Number(elements.editTotalMinutes.value || 0),
    expenses_amount: Number(elements.editExpensesAmount.value || 0),
    other_costs_amount: Number(elements.editOtherCostsAmount.value || 0),
    notes: elements.editNotes.value.trim(),
    expense_note: elements.editExpenseNote.value.trim(),
  };

  state.isSavingReport = true;
  try {
    if (state.isDemoMode) {
      updateDemoReport(reportId, updates);
    } else {
      const { error } = await state.supabase.from('weekly_reports').update(updates).eq('id', reportId);
      if (error) throw error;
    }

    await loadData();
    closeReportEditModal();
  } catch (error) {
    console.error(error);
    alert(`Rapport konnte nicht aktualisiert werden: ${error.message}`);
  } finally {
    state.isSavingReport = false;
  }
}

function updateDemoReport(reportId, updates) {
  const report = demoWeeklyReports.find((item) => item.id === reportId);
  if (!report) {
    throw new Error('Demo-Rapport nicht gefunden');
  }

  Object.assign(report, updates);
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && !elements.reportEditModal.classList.contains('hidden')) {
    closeReportEditModal();
  }
}

function setCurrentPage(page) {
  state.currentPage = page;
  renderPages();
}

async function exportWeekPdf() {
  const filteredReports = getSortedFilteredReports();
  if (!filteredReports.length) {
    alert('Für die gewählte Woche sind keine Rapporte vorhanden.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const grouped = groupReportsByProfile(filteredReports);
  const weekRange = getWeekRange(state.selectedWeek);
  let firstSection = true;

  for (const profile of getReportableProfiles().filter((item) => grouped.has(item.id))) {
    const reports = grouped.get(profile.id) ?? [];
    if (!firstSection) pdf.addPage();
    firstSection = false;

    const reportLayout = buildWeeklyReportLayout(reports);
    drawWeeklyReportPage(pdf, {
      profile,
      weekRange,
      calendarWeek: getWeekLabel(state.selectedWeek),
      layout: reportLayout,
    });

    const imageAttachments = reports
      .flatMap((report) => Array.isArray(report.attachments) ? report.attachments : [])
      .filter((attachment) => isImageAttachment(attachment) && (attachment.publicUrl || attachment.path));
    for (let index = 0; index < imageAttachments.length; index += 2) {
      pdf.addPage();
      await drawAttachmentGalleryPage(pdf, imageAttachments.slice(index, index + 2));
    }
  }

  pdf.addPage();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('Fehlende Wochenrapporte', 14, 18);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(getWeekLabel(state.selectedWeek), 14, 24);
  const missingRows = getMissingProfiles({ selectedOnly: true }).map((profile) => [profile.full_name, profile.email, profile.role_label || 'Profil']);
  pdf.autoTable({
    startY: 30,
    head: [['Mitarbeiter', 'E-Mail', 'Rolle']],
    body: missingRows.length ? missingRows : [['Alle Mitarbeiter haben abgegeben.', '', '']],
    styles: { fontSize: 9, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: [22, 163, 74], textColor: [255, 255, 255] },
  });

  pdf.save(`wochenrapport-${state.selectedWeek}.pdf`);
}

function buildWeeklyReportLayout(reports) {
  const regularRows = buildWeeklyMatrixRows(
    reports.filter((report) => !getAbsenceCategory(report.commission_number)),
  );
  const absenceRows = buildAbsenceMatrixRows(reports);
  const notes = buildWeeklyRemarkLines(reports);
  const totals = regularRows.reduce(
    (summary, row) => {
      row.dailyMinutes.forEach((minutes, index) => {
        summary.dailyMinutes[index] += minutes;
      });
      summary.totalMinutes += row.totalMinutes;
      summary.expenses += row.expenses;
      return summary;
    },
    {
      dailyMinutes: Array(6).fill(0),
      totalMinutes: 0,
      expenses: 0,
    },
  );

  return {
    regularRows,
    absenceRows,
    notes,
    totals,
  };
}

function drawWeeklyReportPage(pdf, { profile, weekRange, calendarWeek, layout }) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const marginLeft = 14;
  const marginRight = 8;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const nameBoxY = 24;
  const nameBoxHeight = 10;
  const mainTableY = 40;

  drawReportHeader(pdf, {
    profile,
    weekRange,
    calendarWeek,
    marginLeft,
    contentWidth,
    nameBoxY,
    nameBoxHeight,
  });

  const regularBody = layout.regularRows.length
    ? layout.regularRows.map((row) => [
        row.commission,
        ...row.days,
        formatHours(row.totalMinutes),
        formatCurrency(row.expenses),
        row.notes.join(' | '),
      ])
    : [];
  while (regularBody.length < 10) {
    regularBody.push(['', '', '', '', '', '', '', '', '', '']);
  }

  pdf.autoTable({
    startY: mainTableY,
    margin: { left: marginLeft, right: marginRight },
    tableWidth: contentWidth,
    head: [['Kom. Nr.', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'Total', 'Spesen', 'Bemerkungen']],
    body: regularBody,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      minCellHeight: 5.3,
      overflow: 'linebreak',
      valign: 'middle',
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 11, halign: 'center' },
      2: { cellWidth: 11, halign: 'center' },
      3: { cellWidth: 11, halign: 'center' },
      4: { cellWidth: 11, halign: 'center' },
      5: { cellWidth: 11, halign: 'center' },
      6: { cellWidth: 11, halign: 'center' },
      7: { cellWidth: 13, halign: 'center' },
      8: { cellWidth: 16, halign: 'center' },
      9: { cellWidth: 69 },
    },
  });

  const totalsY = (pdf.lastAutoTable?.finalY || mainTableY) + 3;
  const absencesY = totalsY + 10;
  const remarksY = absencesY + layout.absenceRows.length * 6 + 4;

  drawWeeklyTotalRow(pdf, { margin: marginLeft, totalsY, contentWidth, totals: layout.totals });
  drawAbsenceTable(pdf, { margin: marginLeft, y: absencesY, width: contentWidth, rows: layout.absenceRows });
  drawRemarksBox(pdf, { margin: marginLeft, y: remarksY, width: contentWidth, height: 16, notes: layout.notes });
}

function drawReportHeader(pdf, { profile, weekRange, calendarWeek, marginLeft, contentWidth, nameBoxY, nameBoxHeight }) {
  pdf.setDrawColor(0, 0, 0);
  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  pdf.setTextColor(215, 0, 21);
  pdf.text('MARÉCHAUX', marginLeft, 14);
  pdf.setFontSize(10);
  pdf.setTextColor(0, 0, 0);
  pdf.text('elektrisch gut.', marginLeft + 20, 18);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(0, 0, 0);
  pdf.text('Wochenrapport', marginLeft + contentWidth / 2, 14, { align: 'center' });

  pdf.rect(marginLeft, nameBoxY, contentWidth, nameBoxHeight);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'italic');
  pdf.text(profile.full_name || '–', marginLeft + 1, nameBoxY + 7);

  pdf.setFont('helvetica', 'normal');
  pdf.text(`${formatDate(weekRange.start)} - ${formatDate(weekRange.end)}`, marginLeft + contentWidth / 2, nameBoxY + 6.8, { align: 'center' });
  pdf.setFont('helvetica', 'bold');
  pdf.text(String(calendarWeek), marginLeft + contentWidth - 2, nameBoxY + 6.8, { align: 'right' });
}

function drawWeeklyTotalRow(pdf, { margin, totalsY, contentWidth, totals }) {
  const columns = [24, 11, 11, 11, 11, 11, 11, 13, 16, 62];
  let x = margin;

  pdf.setLineWidth(0.2);
  pdf.rect(margin, totalsY, contentWidth, 8);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text('Wochentotal', x + 1, totalsY + 5.3);
  x += columns[0];

  totals.dailyMinutes.forEach((minutes, index) => {
    pdf.line(x, totalsY, x, totalsY + 8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(formatHours(minutes), x + columns[index + 1] / 2, totalsY + 5.3, { align: 'center' });
    x += columns[index + 1];
  });

  pdf.line(x, totalsY, x, totalsY + 8);
  pdf.text(formatHours(totals.totalMinutes), x + columns[7] / 2, totalsY + 5.3, { align: 'center' });
  x += columns[7];

  pdf.line(x, totalsY, x, totalsY + 8);
  pdf.text(formatCurrency(totals.expenses), x + columns[8] / 2, totalsY + 5.3, { align: 'center' });
  x += columns[8];

  pdf.line(x, totalsY, x, totalsY + 8);
}

function drawAbsenceTable(pdf, { margin, y, width, rows }) {
  const labelWidth = 24;
  const dayWidth = 11;
  const totalWidth = 13;
  const notesWidth = width - labelWidth - dayWidth * 6 - totalWidth;
  const rowHeight = 6;
  const absenceRows = rows.length ? rows : buildEmptyAbsenceRows();
  const height = rowHeight * absenceRows.length;

  pdf.rect(margin, y, width, height);
  let currentY = y;
  absenceRows.forEach((row, index) => {
    if (index > 0) {
      pdf.line(margin, currentY, margin + width, currentY);
    }
    pdf.line(margin + labelWidth, currentY, margin + labelWidth, currentY + rowHeight);

    let x = margin + labelWidth;
    row.days.forEach(() => {
      pdf.line(x + dayWidth, currentY, x + dayWidth, currentY + rowHeight);
      x += dayWidth;
    });
    pdf.line(x + totalWidth, currentY, x + totalWidth, currentY + rowHeight);

    pdf.setFont('helvetica', index === absenceRows.length - 1 ? 'bold' : 'normal');
    pdf.setFontSize(8.5);
    pdf.text(row.label, margin + 1, currentY + 4.2);
    row.days.forEach((value, dayIndex) => {
      pdf.text(value, margin + labelWidth + dayWidth * dayIndex + dayWidth / 2, currentY + 4.2, { align: 'center' });
    });
    pdf.text(row.total, margin + labelWidth + dayWidth * 6 + totalWidth / 2, currentY + 4.2, { align: 'center' });
    if (row.notes) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.2);
      pdf.text(row.notes, margin + width - notesWidth + 1, currentY + 4.2, { maxWidth: notesWidth - 2 });
    }
    currentY += rowHeight;
  });
}

function drawRemarksBox(pdf, { margin, y, width, height, notes }) {
  pdf.rect(margin, y, width, height);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('Bemerkung', margin + 1, y + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  const content = notes.length ? notes.join(' | ') : '–';
  pdf.text(content, margin + 24, y + 5, { maxWidth: width - 26 });
}

async function drawAttachmentGalleryPage(pdf, attachments) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  const slotGap = 8;
  const titleY = 18;
  const availableHeight = pageHeight - 34 - margin;
  const slotHeight = (availableHeight - slotGap) / 2;
  const slotWidth = pageWidth - margin * 2;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Liebe Männecken', margin, titleY);

  for (const [index, attachment] of attachments.entries()) {
    const slotY = 24 + index * (slotHeight + slotGap);
    try {
      const dataUrl = await fileToDataUrl(attachment.publicUrl || attachment.path);
      const imageProps = pdf.getImageProperties(dataUrl);
      const scale = Math.min(slotWidth / imageProps.width, slotHeight / imageProps.height);
      const renderWidth = imageProps.width * scale;
      const renderHeight = imageProps.height * scale;
      const renderX = margin + (slotWidth - renderWidth) / 2;
      const renderY = slotY + (slotHeight - renderHeight) / 2;
      pdf.addImage(dataUrl, imageProps.fileType || 'JPEG', renderX, renderY, renderWidth, renderHeight);
    } catch (error) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text('Bild konnte nicht geladen werden.', margin, slotY + 10);
    }
  }
}

function buildWeeklyMatrixRows(reports) {
  const groups = new Map();

  reports.forEach((report) => {
    const key = report.commission_number || 'Ohne Kommission';
    if (!groups.has(key)) {
      groups.set(key, {
        commission: key,
        days: Array(6).fill(''),
        dailyMinutes: Array(6).fill(0),
        totalMinutes: 0,
        expenses: 0,
        notes: [],
      });
    }

    const dayIndex = getWeekdayIndex(report.work_date);
    if (dayIndex < 0 || dayIndex > 5) {
      return;
    }

    const current = groups.get(key);
    const workedHours = report.total_work_minutes > 0 ? formatHours(report.total_work_minutes) : '–';
    current.days[dayIndex] = current.days[dayIndex]
      ? `${current.days[dayIndex]} / ${workedHours}`
      : workedHours;
    current.dailyMinutes[dayIndex] += Number(report.total_work_minutes || 0);
    current.totalMinutes += Number(report.total_work_minutes || 0);
    current.expenses += Number(report.expenses_amount || 0) + Number(report.other_costs_amount || 0);
    if (report.notes) current.notes.push(report.notes);
  });

  return [...groups.values()];
}

function buildAbsenceMatrixRows(reports) {
  const rows = ABSENCE_CATEGORY_CONFIG.map((category) => ({
    label: category.label,
    days: Array(6).fill(0),
    totalMinutes: 0,
    notes: [],
  }));

  reports.forEach((report) => {
    const absenceCategory = getAbsenceCategory(report.commission_number);
    if (!absenceCategory) {
      return;
    }

    const row = rows.find((item) => item.label === absenceCategory.label);
    const dayIndex = getWeekdayIndex(report.work_date);
    if (!row || dayIndex < 0 || dayIndex > 5) {
      return;
    }

    const absenceMinutes = getAbsenceMinutes(report);
    row.days[dayIndex] += absenceMinutes;
    row.totalMinutes += absenceMinutes;
    const commissionNumber = String(report.commission_number || '').trim();
    if (commissionNumber) row.notes.push(commissionNumber);
    if (report.notes) row.notes.push(report.notes);
  });

  const normalizedRows = rows.map((row) => ({
    label: row.label,
    days: row.days.map((minutes) => (minutes ? formatHours(minutes) : '')),
    total: row.totalMinutes ? formatHours(row.totalMinutes) : '',
    notes: dedupeStrings(row.notes).join(' | '),
  }));

  const totalAbsenceMinutes = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  normalizedRows.push({
    label: 'Total Absenzen',
    days: Array(6).fill(''),
    total: totalAbsenceMinutes ? formatHours(totalAbsenceMinutes) : '',
    notes: '',
  });

  return normalizedRows;
}

function getAbsenceMinutes(report) {
  const recordedMinutes = Number(report.total_work_minutes || 0);
  if (recordedMinutes > 0) {
    return recordedMinutes;
  }

  return 8 * 60;
}

function buildWeeklyRemarkLines(reports) {
  const notes = [];
  reports.forEach((report) => {
    if (report.notes) {
      notes.push(`${formatDate(report.work_date)}: ${report.notes}`);
    }
    if (hasOutOfHoursWork(report.start_time, report.end_time)) {
      notes.push(`${formatDate(report.work_date)}: Arbeitszeit von ${report.start_time} bis ${report.end_time}.`);
    }
  });
  return dedupeStrings(notes);
}

function buildEmptyAbsenceRows() {
  return [
    { label: 'Unfall', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Militär', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Ferien', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Krankheit', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Feiertag', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Total Absenzen', days: Array(6).fill(''), total: '', notes: '' },
  ];
}

function getAbsenceCategory(commissionNumber) {
  const normalizedCommission = normalizeSearchValue(commissionNumber);
  if (!normalizedCommission) {
    return null;
  }

  return ABSENCE_CATEGORY_CONFIG.find((category) =>
    category.terms.some((term) => normalizedCommission.includes(normalizeSearchValue(term)))
  ) ?? null;
}

function normalizeSearchValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasOutOfHoursWork(startTime, endTime) {
  if (!startTime || !endTime) {
    return false;
  }
  return startTime < '07:00' || endTime > '22:00';
}

function formatHours(totalMinutes) {
  const numericMinutes = Number(totalMinutes || 0);
  if (!numericMinutes) {
    return '';
  }
  return (numericMinutes / 60).toFixed(2);
}

function getMissingProfiles({ selectedOnly = false } = {}) {
  const groups = groupReportsByProfile(state.weeklyReports);
  const selectedIds = new Set(state.selectedEmployeeIds);
  return getReportableProfiles().filter((profile) => {
    if (selectedOnly && !selectedIds.has(profile.id)) {
      return false;
    }

    return !groups.has(profile.id);
  });
}

function getReportableProfiles() {
  return state.profiles.filter((profile) => !isAdminProfile(profile));
}

function groupReportsByProfile(reports) {
  const groups = new Map();
  reports.forEach((report) => {
    if (!groups.has(report.profile_id)) {
      groups.set(report.profile_id, []);
    }
    groups.get(report.profile_id).push(report);
  });
  return groups;
}

function getProfileById(profileId) {
  return state.profiles.find((profile) => profile.id === profileId);
}

function renderAttachmentLinks(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) {
    return '–';
  }

  return `<div class="attachment-list">${attachments
    .map((attachment) => {
      const url = attachment.publicUrl || '#';
      return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name || 'Anhang')}</a>`;
    })
    .join('')}</div>`;
}

function setConnectionBadge(text, warning = false) {
  elements.connectionBadge.textContent = text;
  elements.connectionBadge.classList.toggle('badge-soft', !warning);
  elements.connectionBadge.classList.toggle('badge-warning', warning);
}

function showLoginMessage(message, isError = true) {
  elements.loginAlert.classList.remove('hidden');
  elements.loginAlert.textContent = message;
  elements.loginAlert.style.background = isError ? 'rgba(248, 113, 113, 0.12)' : 'rgba(34, 197, 94, 0.12)';
  elements.loginAlert.style.borderColor = isError ? 'rgba(248, 113, 113, 0.28)' : 'rgba(34, 197, 94, 0.28)';
  elements.loginAlert.style.color = isError ? '#fee2e2' : '#dcfce7';
}

function getCurrentWeekValue() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getWeekRange(weekValue) {
  const [yearPart, weekPart] = weekValue.split('-W');
  const year = Number(yearPart);
  const week = Number(weekPart);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dayOfWeek = simple.getUTCDay();
  const monday = new Date(simple);
  if (dayOfWeek <= 4) {
    monday.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    monday.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function getWeekLabel(weekValue) {
  const [, weekPart] = weekValue.split('-W');
  return `KW ${weekPart}`;
}

function shiftWeekValue(weekValue, weekDelta) {
  const weekRange = getWeekRange(weekValue);
  const monday = new Date(`${weekRange.start}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + weekDelta * 7);
  return getIsoWeekValueFromDate(monday);
}

function getIsoWeekValueFromDate(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getWeekdayIndex(dateString) {
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(Number(value || 0));
}

function formatMinutes(minutes) {
  return `${(Number(minutes || 0) / 60).toFixed(2)} h`;
}

function formatDate(dateString) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('de-CH');
}

function buildFallbackProfileFromUser(user) {
  if (!user) {
    return null;
  }

  const email = String(user.email || '').trim().toLowerCase();
  return {
    id: user.id,
    email,
    full_name: email || 'Benutzer',
    role_label: 'Benutzer',
    is_admin: false,
  };
}

function getAccessConfigurationHint(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) {
    return '';
  }

  if (message.includes('row-level security') || message.includes('permission denied') || message.includes('not allowed')) {
    return 'Bitte das aktualisierte SQL aus supabase-schema.sql im Supabase-Projekt ausführen, damit Profile mit is_admin = true Vollzugriff erhalten.';
  }

  return '';
}

function isAdminProfile(profile) {
  return profile?.is_admin === true || profile?.is_admin === 'true' || profile?.is_admin === 1;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function getDateForWeekOffset(weekOffset, dayOffset) {
  const currentRange = getWeekRange(getCurrentWeekValue());
  const monday = new Date(`${currentRange.start}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + weekOffset * 7 + dayOffset);
  return monday.toISOString().slice(0, 10);
}

function isImageAttachment(attachment) {
  return String(attachment.mimeType || '').startsWith('image/');
}

async function fileToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Datei konnte nicht geladen werden');
  }
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
