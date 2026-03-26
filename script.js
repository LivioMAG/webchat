const STORAGE_BUCKET = 'weekly-attachments';
const CONFIG_PATH = './supabase-config.json';
const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const HOLIDAY_TYPE_LABELS = {
  ferien: 'Ferien',
  fehlen: 'Ferien',
  militaer: 'Militär',
  zivildienst: 'Zivildienst',
  berufsschule: 'Berufsschule',
  uk: 'Berufsschule',
  'ük': 'Berufsschule',
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
  { key: 'berufsschule', label: 'Berufsschule', terms: ['berufsschule', 'uk', 'ük'] },
];
const MAX_VISIBLE_FILTER_OPTIONS = 5;
const ADMIN_SQL_SNIPPET = `-- Vollzugriff nur für Profile mit is_admin = true

alter table public.holiday_requests
add column if not exists controll_pl text;

alter table public.holiday_requests
add column if not exists controll_gl text;

alter table public.app_profiles
add column if not exists vacation_allowance_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists booked_vacation_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists carryover_overtime_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists reported_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists credited_hours numeric(10,2) not null default 0;

alter table public.app_profiles
add column if not exists weekly_hours numeric(10,2) not null default 40;

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

create or replace function public.build_holiday_request_history_text(request_row public.holiday_requests)
returns text
language sql
stable
set search_path = public
as $$
  select trim(
    both ' | ' from concat_ws(
      ' | ',
      case
        when request_row.request_type is not null and request_row.request_type <> '' then
          initcap(replace(request_row.request_type, '_', ' '))
        else null
      end,
      case
        when request_row.start_date is not null and request_row.end_date is not null then
          request_row.start_date::text || ' bis ' || request_row.end_date::text
        else null
      end,
      nullif(trim(coalesce(request_row.notes, '')), '')
    )
  );
$$;

create or replace function public.approve_holiday_request(
  p_request_id uuid,
  p_field_name text,
  p_approval_name text
)
returns public.holiday_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_request public.holiday_requests%rowtype;
  updated_request public.holiday_requests%rowtype;
  archive_context text;
begin
  if p_field_name not in ('controll_pl', 'controll_gl') then
    raise exception 'Ungültiges Freigabefeld: %', p_field_name;
  end if;

  select *
  into current_request
  from public.holiday_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Absenzgesuch % wurde nicht gefunden.', p_request_id;
  end if;

  if p_field_name = 'controll_pl' then
    update public.holiday_requests
    set controll_pl = p_approval_name
    where id = p_request_id
    returning * into updated_request;
  else
    update public.holiday_requests
    set controll_gl = p_approval_name
    where id = p_request_id
    returning * into updated_request;
  end if;

  if nullif(trim(coalesce(updated_request.controll_pl, '')), '') is not null
    and nullif(trim(coalesce(updated_request.controll_gl, '')), '') is not null then
    archive_context := format(
      'Bestätigt durch PL: %s | GL: %s',
      updated_request.controll_pl,
      updated_request.controll_gl
    );

    insert into public.request_history (profile_id, request, context)
    values (
      updated_request.profile_id,
      public.build_holiday_request_history_text(updated_request),
      archive_context
    );

    delete from public.holiday_requests
    where id = updated_request.id;
  end if;

  return updated_request;
end;
$$;

create or replace function public.reject_holiday_request(
  p_request_id uuid,
  p_context text default 'Abgelehnt'
)
returns public.holiday_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_request public.holiday_requests%rowtype;
begin
  with removed_request as (
    delete from public.holiday_requests
    where id = p_request_id
    returning *
  )
  select *
  into deleted_request
  from removed_request;

  if not found then
    raise exception 'Absenzgesuch % wurde nicht gefunden.', p_request_id;
  end if;

  insert into public.request_history (profile_id, request, context)
  values (
    deleted_request.profile_id,
    public.build_holiday_request_history_text(deleted_request),
    coalesce(nullif(trim(p_context), ''), 'Abgelehnt')
  );

  return deleted_request;
end;
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
    vacation_allowance_hours: 200,
    booked_vacation_hours: 0,
    carryover_overtime_hours: 0,
    reported_hours: 0,
    credited_hours: 0,
    weekly_hours: 40,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'michael@example.com',
    full_name: 'Michael Gerber',
    role_label: 'Monteur',
    is_admin: false,
    vacation_allowance_hours: 200,
    booked_vacation_hours: 0,
    carryover_overtime_hours: 0,
    reported_hours: 0,
    credited_hours: 0,
    weekly_hours: 40,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'sandra@example.com',
    full_name: 'Sandra Bühler',
    role_label: 'Monteurin',
    is_admin: false,
    vacation_allowance_hours: 200,
    booked_vacation_hours: 0,
    carryover_overtime_hours: 0,
    reported_hours: 0,
    credited_hours: 0,
    weekly_hours: 40,
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
    project_name: 'Neubau Bahnhof Bern',
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
    controll: '',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '22222222-2222-2222-2222-222222222222',
    work_date: getDateForWeekOffset(0, 1),
    project_name: 'Neubau Bahnhof Bern',
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
    controll: 'Master',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '33333333-3333-3333-3333-333333333333',
    work_date: getDateForWeekOffset(0, 0),
    project_name: 'Sanierung Schulhaus Süd',
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
    controll: '',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '33333333-3333-3333-3333-333333333333',
    work_date: getDateForWeekOffset(0, 3),
    project_name: 'Berufsschule',
    commission_number: '',
    start_time: '00:00',
    end_time: '00:00',
    lunch_break_minutes: 0,
    additional_break_minutes: 0,
    total_work_minutes: 0,
    expenses_amount: 0,
    other_costs_amount: 0,
    expense_note: '',
    notes: 'Ferientag',
    controll: '',
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
    controll_pl: '',
    controll_gl: '',
    attachments: [],
  },
  {
    id: crypto.randomUUID(),
    profile_id: '22222222-2222-2222-2222-222222222222',
    start_date: getDateForWeekOffset(1, 0),
    end_date: getDateForWeekOffset(1, 2),
    request_type: 'militaer',
    notes: 'WK laut Aufgebot.',
    controll_pl: '',
    controll_gl: '',
    attachments: [],
  },
];

const demoRequestHistory = [];

const state = {
  supabase: null,
  session: null,
  user: null,
  currentProfile: null,
  profiles: [],
  weeklyReports: [],
  holidayRequests: [],
  requestHistory: [],
  selectedWeek: getCurrentWeekValue(),
  currentPage: 'reports',
  employeeFilterQuery: '',
  selectedEmployeeIds: [],
  employeeSelectionInitialized: false,
  employeeSelectionTouched: false,
  absenceFilterQuery: '',
  selectedAbsenceEmployeeIds: [],
  absenceSelectionInitialized: false,
  absenceSelectionTouched: false,
  confirmationDateFrom: '',
  confirmationDateTo: '',
  reportsPage: 1,
  reportsPerPage: 10,
  editingReportId: null,
  isSavingReport: false,
  isDemoMode: false,
  hasAdminAccess: false,
  isAdminStatusResolved: false,
  configReady: false,
  authListenerBound: false,
  isLoadingData: false,
  isSavingAbsence: false,
  isSavingConfirmation: false,
  isSavingSaldo: false,
  loadRequestId: 0,
  loadStartedAt: 0,
  tabHiddenAt: 0,
  loadRecoveryTimer: null,
};

const elements = {};
const STALE_LOADING_TIMEOUT_MS = 4000;
const LOAD_WATCHDOG_TIMEOUT_MS = 10000;

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
  elements.reportStatusButton = document.getElementById('reportStatusButton');
  elements.reportStatusIcon = document.getElementById('reportStatusIcon');
  elements.reportStatusText = document.getElementById('reportStatusText');
  elements.connectionRefreshButton = document.getElementById('connectionRefreshButton');
  elements.logoutButton = document.getElementById('logoutButton');
  elements.reportsTableBody = document.getElementById('reportsTableBody');
  elements.absencesTableBody = document.getElementById('absencesTableBody');
  elements.confirmationsTableBody = document.getElementById('confirmationsTableBody');
  elements.saldoTableBody = document.getElementById('saldoTableBody');
  elements.missingReports = document.getElementById('missingReports');
  elements.submissionList = document.getElementById('submissionList');
  elements.missingList = document.getElementById('missingList');
  elements.selectedEmployeesSummary = document.getElementById('selectedEmployeesSummary');
  elements.employeeFilterInput = document.getElementById('employeeFilterInput');
  elements.employeeFilterList = document.getElementById('employeeFilterList');
  elements.selectAllEmployeesButton = document.getElementById('selectAllEmployeesButton');
  elements.clearEmployeeSelectionButton = document.getElementById('clearEmployeeSelectionButton');
  elements.selectedAbsenceEmployeesSummary = document.getElementById('selectedAbsenceEmployeesSummary');
  elements.absenceFilterInput = document.getElementById('absenceFilterInput');
  elements.absenceFilterList = document.getElementById('absenceFilterList');
  elements.selectAllAbsenceEmployeesButton = document.getElementById('selectAllAbsenceEmployeesButton');
  elements.clearAbsenceSelectionButton = document.getElementById('clearAbsenceSelectionButton');
  elements.confirmationDateFromInput = document.getElementById('confirmationDateFromInput');
  elements.confirmationDateToInput = document.getElementById('confirmationDateToInput');
  elements.clearConfirmationDateFilterButton = document.getElementById('clearConfirmationDateFilterButton');
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
    confirmations: document.getElementById('confirmationsPage'),
    saldo: document.getElementById('saldoPage'),
    security: document.getElementById('securityPage'),
  };
  elements.navTabs = Array.from(document.querySelectorAll('.nav-tab'));
  elements.adminSqlPreview = document.getElementById('adminSqlPreview');
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.accessDeniedLogoutButton.addEventListener('click', handleLogout);
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
  elements.absenceFilterInput.addEventListener('input', handleAbsenceFilterInput);
  elements.selectAllAbsenceEmployeesButton.addEventListener('click', selectAllAbsenceEmployees);
  elements.clearAbsenceSelectionButton.addEventListener('click', clearAbsenceSelection);
  elements.absenceFilterList.addEventListener('change', handleAbsenceSelectionChange);
  elements.confirmationDateFromInput.addEventListener('change', handleConfirmationDateFilterChange);
  elements.confirmationDateToInput.addEventListener('change', handleConfirmationDateFilterChange);
  elements.clearConfirmationDateFilterButton.addEventListener('click', clearConfirmationDateFilter);
  elements.reportsTableBody.addEventListener('click', handleReportsTableClick);
  elements.absencesTableBody.addEventListener('click', handleAbsencesTableClick);
  elements.confirmationsTableBody.addEventListener('click', handleConfirmationsTableClick);
  elements.saldoTableBody.addEventListener('click', handleSaldoTableClick);
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
  window.addEventListener('focus', handleWindowFocus);
  window.addEventListener('pageshow', handleWindowFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
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
    state.isAdminStatusResolved = false;
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
      state.isAdminStatusResolved = false;

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
    state.isAdminStatusResolved = true;
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
  state.isAdminStatusResolved = false;
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

function clearLoadRecoveryTimer() {
  if (state.loadRecoveryTimer) {
    window.clearTimeout(state.loadRecoveryTimer);
    state.loadRecoveryTimer = null;
  }
}

function clearLoadingState() {
  state.loadRequestId += 1;
  state.isLoadingData = false;
  state.loadStartedAt = 0;
  clearLoadRecoveryTimer();
}

function recoverInteractionState({ forceReload = false } = {}) {
  if (!state.isLoadingData) {
    return;
  }

  const loadingDuration = state.loadStartedAt ? Date.now() - state.loadStartedAt : 0;
  if (!forceReload && loadingDuration < STALE_LOADING_TIMEOUT_MS) {
    return;
  }

  clearLoadingState();
  render();

  if (state.user) {
    loadData().catch((error) => {
      console.error(error);
    });
  }
}

function handleWindowFocus() {
  const tabWasHidden = state.tabHiddenAt > 0;
  state.tabHiddenAt = 0;
  recoverInteractionState({ forceReload: tabWasHidden });
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    state.tabHiddenAt = Date.now();
    return;
  }

  if (document.visibilityState === 'visible') {
    recoverInteractionState({ forceReload: true });
  }
}

function beginDataLoad() {
  clearLoadRecoveryTimer();
  state.isLoadingData = true;
  state.loadStartedAt = Date.now();
  const requestId = ++state.loadRequestId;
  state.loadRecoveryTimer = window.setTimeout(() => {
    if (!isActiveDataLoad(requestId) || !state.isLoadingData) {
      return;
    }

    recoverInteractionState({ forceReload: true });
  }, LOAD_WATCHDOG_TIMEOUT_MS);
  render();
  return requestId;
}

function isActiveDataLoad(requestId) {
  return requestId === state.loadRequestId;
}

function finishDataLoad(requestId) {
  if (!isActiveDataLoad(requestId)) {
    return false;
  }

  state.isLoadingData = false;
  state.loadStartedAt = 0;
  clearLoadRecoveryTimer();
  return true;
}

function resetAppState() {
  state.session = null;
  state.user = null;
  state.currentProfile = null;
  state.profiles = [];
  state.weeklyReports = [];
  state.holidayRequests = [];
  state.requestHistory = [];
  state.employeeFilterQuery = '';
  state.selectedEmployeeIds = [];
  state.employeeSelectionInitialized = false;
  state.employeeSelectionTouched = false;
  state.reportsPage = 1;
  state.confirmationDateFrom = '';
  state.confirmationDateTo = '';
  state.editingReportId = null;
  state.isSavingReport = false;
  state.hasAdminAccess = false;
  state.isAdminStatusResolved = false;
  state.isLoadingData = false;
  state.loadRequestId = 0;
  state.loadStartedAt = 0;
  state.tabHiddenAt = 0;
  clearLoadRecoveryTimer();
  closeReportEditModal();
  elements.dataTimestamp.textContent = 'Noch keine Daten geladen';
}

async function loadData() {
  if (!state.user) {
    render();
    return;
  }

  const shouldResolveAdminStatus = !state.currentProfile || state.currentProfile.id !== state.user.id;
  if (shouldResolveAdminStatus) {
    state.isAdminStatusResolved = false;
  }

  const requestId = beginDataLoad();

  if (state.isDemoMode) {
    await loadDemoData();
    if (!finishDataLoad(requestId)) {
      return;
    }
    render();
    return;
  }

  try {
    const currentProfile = await fetchCurrentProfile();
    if (!isActiveDataLoad(requestId)) {
      return;
    }
    state.currentProfile = currentProfile ?? buildFallbackProfileFromUser(state.user);
    state.hasAdminAccess = isAdminProfile(state.currentProfile);
    state.isAdminStatusResolved = true;

    if (!state.hasAdminAccess) {
      state.profiles = [];
      state.weeklyReports = [];
      state.holidayRequests = [];
      state.requestHistory = [];
      elements.dataTimestamp.textContent = 'Kein Zugriff – is_admin ist für dieses Profil nicht aktiviert';
      finishDataLoad(requestId);
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
    const requestHistoryQuery = state.supabase
      .from('request_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    const [
      { data: reports, error: reportsError },
      { data: profiles, error: profilesError },
      { data: absences, error: absencesError },
      { data: requestHistory, error: requestHistoryError },
    ] = await Promise.all([
      reportsQuery,
      profilesQuery,
      absencesQuery,
      requestHistoryQuery,
    ]);

    if (reportsError) throw reportsError;
    if (profilesError) throw profilesError;
    if (absencesError) throw absencesError;
    if (requestHistoryError) throw requestHistoryError;
    if (!isActiveDataLoad(requestId)) {
      return;
    }

    state.weeklyReports = reports ?? [];
    state.profiles = profiles ?? [];
    state.holidayRequests = absences ?? [];
    state.requestHistory = requestHistory ?? [];
    syncEmployeeSelection();
    syncAbsenceSelection();
    elements.dataTimestamp.textContent = `Letzte Aktualisierung: ${new Date().toLocaleString('de-CH')}`;
    finishDataLoad(requestId);
    render();
  } catch (error) {
    if (!finishDataLoad(requestId)) {
      return;
    }
    console.error(error);
    const hint = getAccessConfigurationHint(error);
    elements.dataTimestamp.textContent = hint || 'Daten konnten nicht geladen werden';
    render();
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
  state.isAdminStatusResolved = true;

  if (!state.hasAdminAccess) {
    state.profiles = [];
    state.weeklyReports = [];
    state.holidayRequests = [];
    state.requestHistory = [];
    elements.dataTimestamp.textContent = 'Kein Zugriff – Demo-Profil hat is_admin = false';
    return;
  }

  state.profiles = demoProfiles;

  const weekRange = getWeekRange(state.selectedWeek);
  const reports = demoWeeklyReports.filter((report) => report.work_date >= weekRange.start && report.work_date <= weekRange.end);
  state.weeklyReports = reports;
  state.holidayRequests = [...demoHolidayRequests];
  state.requestHistory = [...demoRequestHistory];
  syncEmployeeSelection();
  syncAbsenceSelection();
  elements.dataTimestamp.textContent = `Demo-Daten geladen: ${new Date().toLocaleString('de-CH')}`;
}

function render() {
  const loggedIn = Boolean(state.user);
  const hasAdminAccess = loggedIn && state.hasAdminAccess;
  const isCheckingAdminAccess = loggedIn && !state.isAdminStatusResolved && !state.currentProfile;
  const showAccessDenied = loggedIn && state.isAdminStatusResolved && !state.hasAdminAccess;

  elements.loginView.classList.toggle('hidden', loggedIn || isCheckingAdminAccess);
  elements.appView.classList.toggle('hidden', !hasAdminAccess);
  elements.accessDeniedView.classList.toggle('hidden', !showAccessDenied);

  if (isCheckingAdminAccess) {
    closeReportEditModal();
    elements.accessDeniedView.classList.add('hidden');
    elements.loginView.classList.remove('hidden');
    if (elements.loginAlert) {
      showLoginMessage('Admin-Zugriff wird geprüft …', false);
    }
    return;
  }

  if (!hasAdminAccess) {
    closeReportEditModal();
    return;
  }

  renderSidebar();
  renderPages();
  renderWeekSummary();
  renderReportStats();
  renderEmployeeFilters();
  renderAbsenceFilters();
  renderReportsTable();
  renderSubmissionLists();
  renderAbsenceTable();
  renderConfirmationFilters();
  renderConfirmationsTable();
  renderSaldoTable();
}

function renderSidebar() {
  const profile = state.currentProfile;
  if (elements.userName) {
    elements.userName.textContent = profile?.full_name ?? state.user.email;
  }
  if (elements.userRole) {
    elements.userRole.textContent = profile?.role_label ?? 'Benutzer';
  }
  if (elements.userBadge) {
    elements.userBadge.textContent = state.hasAdminAccess ? 'Admin' : 'Kein Zugriff';
  }
}

function renderPages() {
  const pageTitles = {
    reports: 'Wochenrapporte',
    absences: 'Ferien & Absenzen',
    confirmations: 'Bestätigungen',
    saldo: 'Saldo',
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
  const disableWeekNavigation = state.isLoadingData || state.isSavingReport;
  elements.previousWeekButton.disabled = disableWeekNavigation;
  elements.nextWeekButton.disabled = disableWeekNavigation;
}

function renderReportStats() {
  const missingProfiles = getMissingProfiles();
  const hasMissingReports = missingProfiles.length > 0;

  elements.reportStatusButton.classList.toggle('is-missing', hasMissingReports);
  elements.reportStatusButton.classList.toggle('is-complete', !hasMissingReports);
  elements.reportStatusIcon.textContent = hasMissingReports ? String(missingProfiles.length) : '✔';
  elements.reportStatusText.textContent = hasMissingReports ? 'fehlende Wochenrapporte' : 'Alle Wochenrapporte vorhanden';
}

function renderEmployeeFilters() {
  elements.employeeFilterInput.value = state.employeeFilterQuery;
  const profiles = getReportableProfiles();
  const visibleProfiles = getMatchingProfiles(profiles, state.employeeFilterQuery).slice(0, MAX_VISIBLE_FILTER_OPTIONS);

  elements.selectedEmployeesSummary.textContent = `${state.selectedEmployeeIds.length} von ${profiles.length} Mitarbeitenden ausgewählt`;

  if (!profiles.length) {
    elements.employeeFilterList.innerHTML = '<div class="empty-state">Keine Mitarbeitenden vorhanden.</div>';
    return;
  }

  elements.employeeFilterList.innerHTML = visibleProfiles.length
    ? visibleProfiles
        .map((profile) => `
          <label class="employee-filter-option">
            <input type="checkbox" value="${escapeAttribute(profile.id)}" ${state.selectedEmployeeIds.includes(profile.id) ? 'checked' : ''} />
            <span>${escapeHtml(profile.full_name)}</span>
          </label>
        `)
        .join('')
    : '<div class="empty-state">Keine Mitarbeitenden für diesen Suchbegriff gefunden.</div>';
}

function renderAbsenceFilters() {
  elements.absenceFilterInput.value = state.absenceFilterQuery;
  const profiles = getAbsenceFilterProfiles();
  const visibleProfiles = getMatchingProfiles(profiles, state.absenceFilterQuery).slice(0, MAX_VISIBLE_FILTER_OPTIONS);

  elements.selectedAbsenceEmployeesSummary.textContent = `${state.selectedAbsenceEmployeeIds.length} von ${profiles.length} Mitarbeitenden ausgewählt`;

  if (!profiles.length) {
    elements.absenceFilterList.innerHTML = '<div class="empty-state">Keine Mitarbeitenden vorhanden.</div>';
    return;
  }

  elements.absenceFilterList.innerHTML = visibleProfiles.length
    ? visibleProfiles
        .map((profile) => `
          <label class="employee-filter-option">
            <input type="checkbox" value="${escapeAttribute(profile.id)}" ${state.selectedAbsenceEmployeeIds.includes(profile.id) ? 'checked' : ''} />
            <span>${escapeHtml(profile.full_name)}</span>
          </label>
        `)
        .join('')
    : '<div class="empty-state">Keine Mitarbeitenden für diesen Suchbegriff gefunden.</div>';
}

function renderReportsTable() {
  if (state.isLoadingData) {
    elements.reportsTableBody.innerHTML = `<tr><td colspan="10">Rapporte für ${escapeHtml(getWeekLabel(state.selectedWeek))} werden geladen …</td></tr>`;
    renderReportsPagination({ totalItems: 0, totalPages: 1, currentPage: 1, startIndex: 0, endIndex: 0 });
    return;
  }

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
        <tr class="report-row">
          <td>${escapeHtml(profile?.full_name ?? 'Unbekannt')}</td>
          <td>${formatDate(report.work_date)}</td>
          <td>${escapeHtml(report.commission_number || '–')}</td>
          <td>${escapeHtml(report.start_time || '–')} – ${escapeHtml(report.end_time || '–')}</td>
          <td>${formatMinutes(report.total_work_minutes)}</td>
          <td>${formatCurrency(Number(report.expenses_amount || 0) + Number(report.other_costs_amount || 0))}</td>
          <td>${escapeHtml(report.notes || report.expense_note || '–')}</td>
          <td>${renderAttachmentLinks(report.attachments)}</td>
          <td>${renderControllCell(report)}</td>
          <td>
            <div class="table-row-actions">
              <button class="button button-small button-secondary" type="button" data-action="edit-report" data-report-id="${escapeAttribute(report.id)}">Bearbeiten</button>
              <button class="button button-small button-danger" type="button" data-action="delete-report" data-report-id="${escapeAttribute(report.id)}" ${state.isSavingReport ? 'disabled' : ''}>Löschen</button>
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
    elements.absencesTableBody.innerHTML = `<tr><td colspan="8">Keine Ferien- oder Absenzanträge gefunden.</td></tr>`;
    return;
  }

  const sorted = getFilteredHolidayRequests();
  if (!sorted.length) {
    elements.absencesTableBody.innerHTML = `<tr><td colspan="8">Für die aktuelle Auswahl wurden keine Ferien- oder Absenzanträge gefunden.</td></tr>`;
    return;
  }

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
          <td>${renderHolidayApprovalCell(request, 'controll_pl', 'PL')}</td>
          <td>${renderHolidayApprovalCell(request, 'controll_gl', 'GL')}</td>
        </tr>
      `;
    })
    .join('');
}


function renderConfirmationFilters() {
  if (!elements.confirmationDateFromInput || !elements.confirmationDateToInput) {
    return;
  }

  elements.confirmationDateFromInput.value = state.confirmationDateFrom;
  elements.confirmationDateToInput.value = state.confirmationDateTo;
}

function renderConfirmationsTable() {
  if (!elements.confirmationsTableBody) {
    return;
  }

  const filteredHistory = getFilteredRequestHistory();

  if (!state.requestHistory.length) {
    elements.confirmationsTableBody.innerHTML = '<tr><td colspan="6">Keine Bestätigungen in request_history gefunden.</td></tr>';
    return;
  }

  if (!filteredHistory.length) {
    elements.confirmationsTableBody.innerHTML = '<tr><td colspan="6">Für den gewählten Zeitraum wurden keine Bestätigungen gefunden.</td></tr>';
    return;
  }

  elements.confirmationsTableBody.innerHTML = filteredHistory
    .map((entry) => {
      const details = parseRequestHistoryEntry(entry);
      const profile = getProfileById(entry.profile_id);
      const personLabel = profile?.full_name || profile?.email || 'Unbekannt';
      const personSubLabel = profile?.email && profile?.email !== personLabel ? `<div class="subtle-text">${escapeHtml(profile.email)}</div>` : '';
      return `
        <tr>
          <td>
            <div class="status-stack compact">
              <strong>${escapeHtml(personLabel)}</strong>
              ${personSubLabel}
            </div>
          </td>
          <td>${escapeHtml(details.typeLabel)}</td>
          <td>${escapeHtml(details.periodLabel)}</td>
          <td>${escapeHtml(details.approvedByLabel)}</td>
          <td>${escapeHtml(formatDateTime(entry.created_at))}</td>
          <td>${renderHistoryActionsCell(entry)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderSaldoTable() {
  if (!elements.saldoTableBody) {
    return;
  }

  if (!state.profiles.length) {
    elements.saldoTableBody.innerHTML = '<tr><td colspan="11">Keine Profile gefunden.</td></tr>';
    return;
  }

  const currentIsoWeek = getCurrentIsoWeekNumber();
  elements.saldoTableBody.innerHTML = state.profiles
    .map((profile) => {
      const metrics = getProfileSaldoMetrics(profile, currentIsoWeek);
      return `
        <tr>
          <td>${escapeHtml(profile.full_name || '–')}</td>
          <td>${escapeHtml(profile.email || '–')}</td>
          <td>${renderSaldoInput(profile.id, 'vacation_allowance_hours', metrics.vacationAllowanceHours)}</td>
          <td>${metrics.bookedVacationHours.toFixed(2)}</td>
          <td>${renderSaldoInput(profile.id, 'carryover_overtime_hours', metrics.carryoverOvertimeHours)}</td>
          <td>${metrics.reportedHours.toFixed(2)}</td>
          <td>${renderSaldoInput(profile.id, 'credited_hours', metrics.creditedHours)}</td>
          <td>${renderSaldoInput(profile.id, 'weekly_hours', metrics.weeklyHours, 0.25)}</td>
          <td>${metrics.overtimeBalanceHours.toFixed(2)}</td>
          <td>${metrics.vacationBalanceHours.toFixed(2)}</td>
          <td>
            <button class="button button-small button-primary" type="button" data-action="save-saldo-profile" data-profile-id="${escapeAttribute(profile.id)}" ${state.isSavingSaldo ? 'disabled' : ''}>
              Speichern
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderSubmissionLists() {
  const summaries = getProfileSubmissionSummary();
  const submittedItems = summaries
    .filter((summary) => summary.hasSubmission)
    .map((summary) => {
      const statusLabel = summary.hasPendingControll ? 'Kontrolle ausstehend' : 'Rapporte erfasst';
      const statusClass = summary.hasPendingControll ? 'warning' : 'success';
      return `
      <li class="align-start">
        <div class="status-stack">
          <strong>${escapeHtml(summary.profile.full_name)}</strong>
          <div class="subtle-text">${summary.entryCount} Rapporteinträge in dieser Woche</div>
        </div>
        <div class="status-meta">
          <span class="pill ${statusClass}">${escapeHtml(statusLabel)}</span>
          <strong>${formatMinutes(summary.totalMinutes)}</strong>
        </div>
      </li>
    `;
    });

  const missingItems = summaries
    .filter((summary) => !summary.hasSubmission)
    .map(
      (summary) => `
      <li class="align-start">
        <div class="status-stack">
          <strong>${escapeHtml(summary.profile.full_name)}</strong>
          <div class="subtle-text">Für diese Woche wurde noch kein Rapport eingereicht.</div>
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

function handleAbsenceFilterInput(event) {
  state.absenceFilterQuery = event.target.value;
  renderAbsenceFilters();
}

function handleConfirmationDateFilterChange() {
  state.confirmationDateFrom = elements.confirmationDateFromInput.value || '';
  state.confirmationDateTo = elements.confirmationDateToInput.value || '';
  renderConfirmationsTable();
}

function clearConfirmationDateFilter() {
  state.confirmationDateFrom = '';
  state.confirmationDateTo = '';
  renderConfirmationFilters();
  renderConfirmationsTable();
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
  state.employeeSelectionTouched = true;
  state.reportsPage = 1;
  render();
}

function handleAbsenceSelectionChange(event) {
  if (event.target?.type !== 'checkbox') {
    return;
  }

  const profileId = event.target.value;
  if (event.target.checked) {
    if (!state.selectedAbsenceEmployeeIds.includes(profileId)) {
      state.selectedAbsenceEmployeeIds = [...state.selectedAbsenceEmployeeIds, profileId];
    }
  } else {
    state.selectedAbsenceEmployeeIds = state.selectedAbsenceEmployeeIds.filter((id) => id !== profileId);
  }

  state.absenceSelectionInitialized = true;
  state.absenceSelectionTouched = true;
  render();
}

function selectAllEmployees() {
  state.selectedEmployeeIds = getAvailableReportProfileIds();
  state.employeeSelectionInitialized = true;
  state.employeeSelectionTouched = true;
  state.reportsPage = 1;
  render();
}

function clearEmployeeSelection() {
  state.selectedEmployeeIds = [];
  state.employeeSelectionInitialized = true;
  state.employeeSelectionTouched = true;
  state.reportsPage = 1;
  render();
}

function selectAllAbsenceEmployees() {
  state.selectedAbsenceEmployeeIds = getAvailableAbsenceProfileIds();
  state.absenceSelectionInitialized = true;
  state.absenceSelectionTouched = true;
  render();
}

function clearAbsenceSelection() {
  state.selectedAbsenceEmployeeIds = [];
  state.absenceSelectionInitialized = true;
  state.absenceSelectionTouched = true;
  render();
}

function syncEmployeeSelection() {
  const validIds = getAvailableReportProfileIds();
  const validIdSet = new Set(validIds);
  const selected = state.selectedEmployeeIds.filter((id) => validIdSet.has(id));

  if (!state.employeeSelectionInitialized) {
    state.selectedEmployeeIds = [...validIds];
    state.employeeSelectionInitialized = true;
    state.reportsPage = 1;
    return;
  }

  if (!state.employeeSelectionTouched) {
    state.selectedEmployeeIds = [...validIds];
    state.reportsPage = 1;
    return;
  }

  state.selectedEmployeeIds = validIds.length ? selected : [];
  const pageCount = Math.max(1, Math.ceil(getSortedFilteredReports().length / state.reportsPerPage));
  state.reportsPage = Math.min(state.reportsPage, pageCount);
}

function syncAbsenceSelection() {
  const validIds = getAvailableAbsenceProfileIds();
  const validIdSet = new Set(validIds);
  const selected = state.selectedAbsenceEmployeeIds.filter((id) => validIdSet.has(id));

  if (!state.absenceSelectionInitialized) {
    state.selectedAbsenceEmployeeIds = [...validIds];
    state.absenceSelectionInitialized = true;
    return;
  }

  if (!state.absenceSelectionTouched) {
    state.selectedAbsenceEmployeeIds = [...validIds];
    return;
  }

  state.selectedAbsenceEmployeeIds = validIds.length ? selected : [];
}

function getFilteredReports() {
  if (!state.selectedEmployeeIds.length && !state.employeeSelectionTouched) {
    return [...state.weeklyReports];
  }

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


function getFilteredRequestHistory() {
  const fromDate = state.confirmationDateFrom || null;
  const toDate = state.confirmationDateTo || null;

  return [...state.requestHistory]
    .filter((entry) => {
      const createdAt = String(entry?.created_at || '');
      if (!createdAt) {
        return false;
      }

      const createdDate = createdAt.slice(0, 10);
      if (fromDate && createdDate < fromDate) {
        return false;
      }
      if (toDate && createdDate > toDate) {
        return false;
      }
      return true;
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function parseRequestHistoryEntry(entry) {
  const requestValue = String(entry?.request || '').trim();
  const requestParts = requestValue ? requestValue.split(' | ').map((part) => part.trim()).filter(Boolean) : [];
  const typeLabel = requestParts[0] || 'Unbekannt';
  const periodMatch = requestParts.find((part) => part.includes(' bis '));

  return {
    typeLabel,
    periodLabel: periodMatch || '–',
    approvedByLabel: buildHistoryApprovedByLabel(entry),
  };
}

function buildHistoryApprovedByLabel(entry) {
  const contextValue = String(entry?.context || '').trim();
  if (!contextValue) {
    return '–';
  }

  const plMatch = contextValue.match(/PL:\s*([^|]+)/i);
  const glMatch = contextValue.match(/GL:\s*([^|]+)/i);
  const names = [plMatch?.[1], glMatch?.[1]]
    .map((value) => String(value || '').trim())
    .filter((value) => value && value !== '–');

  if (names.length) {
    return names.join(' / ');
  }

  return contextValue;
}

function formatDateTime(value) {
  if (!value) {
    return '–';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
    const hasPendingControll = reports.some((report) => !String(report.controll || '').trim());
    return {
      profile,
      reports,
      entryCount: reports.length,
      totalMinutes,
      hasSubmission: reports.length > 0,
      hasPendingControll,
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
    handleConfirmReport(reportId);
    return;
  }

  if (trigger.dataset.action === 'delete-report') {
    handleDeleteReport(reportId);
  }
}

function handleAbsencesTableClick(event) {
  if (event.target.closest('a')) {
    return;
  }

  const trigger = event.target.closest('[data-action]');
  if (!trigger) {
    return;
  }

  const requestId = trigger.dataset.requestId;
  if (!requestId) {
    return;
  }

  if (trigger.dataset.action === 'confirm-absence-pl') {
    handleConfirmHolidayRequest(requestId, 'controll_pl', 'PL');
    return;
  }

  if (trigger.dataset.action === 'confirm-absence-gl') {
    handleConfirmHolidayRequest(requestId, 'controll_gl', 'GL');
    return;
  }
}

function handleConfirmationsTableClick(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) {
    return;
  }

  const historyEntryId = trigger.dataset.historyEntryId;
  if (!historyEntryId) {
    return;
  }

  if (trigger.dataset.action === 'download-history-confirmation') {
    exportRequestHistoryPdf(historyEntryId);
    return;
  }

  if (trigger.dataset.action === 'delete-history-entry') {
    handleDeleteHistoryEntry(historyEntryId);
  }
}

function handleSaldoTableClick(event) {
  const trigger = event.target.closest('[data-action="save-saldo-profile"]');
  if (!trigger) {
    return;
  }

  const profileId = trigger.dataset.profileId;
  if (!profileId) {
    return;
  }

  handleSaveSaldoProfile(profileId);
}

async function handleConfirmReport(reportId) {
  if (!reportId || state.isSavingReport) {
    return;
  }

  const controllName = getControllDisplayName();
  if (!controllName) {
    alert('Der Name für die Kontrolle konnte nicht ermittelt werden.');
    return;
  }

  state.isSavingReport = true;
  try {
    const existingReport = state.weeklyReports.find((item) => String(item.id) === String(reportId));
    const wasAlreadyConfirmed = Boolean(String(existingReport?.controll || '').trim());

    if (state.isDemoMode) {
      updateDemoReport(reportId, { controll: controllName });
      if (existingReport && !wasAlreadyConfirmed) {
        applyDemoReportBookingDelta(existingReport, 1);
      }
    } else {
      const { error } = await state.supabase
        .from('weekly_reports')
        .update({ controll: controllName })
        .eq('id', reportId);
      if (error) throw error;
      if (existingReport && !wasAlreadyConfirmed) {
        await applyProfileBookingDelta(existingReport.profile_id, getReportBookingDelta(existingReport, 1));
      }
    }

    await loadData();
  } catch (error) {
    console.error(error);
    alert(`Kontrolle konnte nicht gespeichert werden: ${error.message}`);
  } finally {
    state.isSavingReport = false;
    render();
  }
}

async function handleConfirmHolidayRequest(requestId, fieldName, roleLabel) {
  if (!requestId || state.isSavingAbsence) {
    return;
  }

  const shouldConfirm = window.confirm('Bist du sicher, dass du die Ferien bestätigen möchtest?');
  if (!shouldConfirm) {
    return;
  }

  const approvalName = getApprovalDisplayName();
  if (!approvalName) {
    alert(`Der Name für die Bestätigung ${roleLabel} konnte nicht ermittelt werden.`);
    return;
  }

  state.isSavingAbsence = true;
  try {
    const updates = { [fieldName]: approvalName };
    const request = state.holidayRequests.find((item) => String(item.id) === String(requestId));

    if (state.isDemoMode) {
      updateDemoHolidayRequest(requestId, updates);
      const updatedRequest = demoHolidayRequests.find((item) => String(item.id) === String(requestId));
      if (isHolidayRequestFullyApproved(updatedRequest)) {
        archiveDemoHolidayRequestDecision(updatedRequest, buildApprovedHolidayRequestContext(updatedRequest));
        deleteDemoHolidayRequest(requestId);
      }
    } else {
      let updatedRequest = request ? { ...request, ...updates } : null;
      const { error } = await state.supabase.rpc('approve_holiday_request', {
        p_request_id: requestId,
        p_field_name: fieldName,
        p_approval_name: approvalName,
      });

      if (error) {
        if (!request || !isMissingRpcFunctionError(error, 'approve_holiday_request')) {
          throw error;
        }

        updatedRequest = await approveHolidayRequestWithoutRpc(request, fieldName, approvalName);
      }

      if (request && isHolidayRequestFullyApproved(updatedRequest)) {
        await deleteHolidayRequestAttachmentsSafely(request.attachments);
      }
    }

    await loadData();
  } catch (error) {
    console.error(error);
    alert(`Bestätigung ${roleLabel} konnte nicht gespeichert werden: ${error.message}`);
  } finally {
    state.isSavingAbsence = false;
    render();
  }
}

async function handleRejectHolidayRequest(requestId) {
  if (!requestId || state.isSavingAbsence) {
    return;
  }

  const request = state.holidayRequests.find((item) => String(item.id) === String(requestId));
  if (!request) {
    alert('Das ausgewählte Absenzgesuch wurde nicht gefunden.');
    return;
  }

  const shouldDelete = window.confirm('Soll dieses Absenzgesuch wirklich abgelehnt und gelöscht werden?');
  if (!shouldDelete) {
    return;
  }

  state.isSavingAbsence = true;
  try {
    if (state.isDemoMode) {
      archiveDemoHolidayRequestDecision(request, buildRejectedHolidayRequestContext(request));
      deleteDemoHolidayRequest(requestId);
    } else {
      const rejectionContext = buildRejectedHolidayRequestContext(request);
      const { error } = await state.supabase.rpc('reject_holiday_request', {
        p_request_id: requestId,
        p_context: rejectionContext,
      });

      if (error) {
        if (!isMissingRpcFunctionError(error, 'reject_holiday_request')) {
          throw error;
        }

        await rejectHolidayRequestWithoutRpc(request, rejectionContext);
      }

      await deleteHolidayRequestAttachmentsSafely(request.attachments);
    }

    await loadData();
  } catch (error) {
    console.error(error);
    alert(`Absenzgesuch konnte nicht abgelehnt werden: ${error.message}`);
  } finally {
    state.isSavingAbsence = false;
    render();
  }
}

function openReportEditModal(reportId) {
  const report = state.weeklyReports.find((item) => String(item.id) === String(reportId));
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
    render();
  }
}

async function handleDeleteReport(reportId) {
  if (!reportId || state.isSavingReport) {
    return;
  }

  const report = state.weeklyReports.find((item) => String(item.id) === String(reportId));
  if (!report) {
    alert('Der ausgewählte Rapport wurde nicht gefunden.');
    return;
  }

  const shouldDelete = window.confirm('Soll dieser Wochenrapport wirklich gelöscht werden?');
  if (!shouldDelete) {
    return;
  }

  const wasConfirmed = Boolean(String(report.controll || '').trim());
  state.isSavingReport = true;
  try {
    if (state.isDemoMode) {
      const index = demoWeeklyReports.findIndex((item) => String(item.id) === String(reportId));
      if (index === -1) {
        throw new Error('Demo-Rapport nicht gefunden');
      }
      const [deletedDemoReport] = demoWeeklyReports.splice(index, 1);
      if (wasConfirmed) {
        applyDemoReportBookingDelta(deletedDemoReport, -1);
      }
    } else {
      await deleteWeeklyReportAttachmentsSafely(report.attachments);
      const { error } = await state.supabase.from('weekly_reports').delete().eq('id', reportId);
      if (error) throw error;
      if (wasConfirmed) {
        await applyProfileBookingDelta(report.profile_id, getReportBookingDelta(report, -1));
      }
    }

    await loadData();
  } catch (error) {
    console.error(error);
    alert(`Rapport konnte nicht gelöscht werden: ${error.message}`);
  } finally {
    state.isSavingReport = false;
    render();
  }
}

async function handleSaveSaldoProfile(profileId) {
  if (!profileId || state.isSavingSaldo) {
    return;
  }

  const vacationAllowanceValue = getSaldoInputValue(profileId, 'vacation_allowance_hours');
  const carryoverOvertimeValue = getSaldoInputValue(profileId, 'carryover_overtime_hours');
  const creditedHoursValue = getSaldoInputValue(profileId, 'credited_hours');
  const weeklyHoursValue = getSaldoInputValue(profileId, 'weekly_hours');

  const updates = {
    vacation_allowance_hours: vacationAllowanceValue,
    carryover_overtime_hours: carryoverOvertimeValue,
    credited_hours: creditedHoursValue,
    weekly_hours: weeklyHoursValue > 0 ? weeklyHoursValue : 40,
  };

  state.isSavingSaldo = true;
  try {
    if (state.isDemoMode) {
      const profile = demoProfiles.find((item) => String(item.id) === String(profileId));
      if (!profile) {
        throw new Error('Demo-Profil nicht gefunden');
      }
      Object.assign(profile, updates);
    } else {
      const { error } = await state.supabase.from('app_profiles').update(updates).eq('id', profileId);
      if (error) throw error;
    }

    await loadData();
  } catch (error) {
    console.error(error);
    alert(`Saldo konnte nicht gespeichert werden: ${error.message}`);
  } finally {
    state.isSavingSaldo = false;
    render();
  }
}

function updateDemoReport(reportId, updates) {
  const report = demoWeeklyReports.find((item) => item.id === reportId);
  if (!report) {
    throw new Error('Demo-Rapport nicht gefunden');
  }

  Object.assign(report, updates);
}

function updateDemoHolidayRequest(requestId, updates) {
  const request = demoHolidayRequests.find((item) => item.id === requestId);
  if (!request) {
    throw new Error('Demo-Absenz nicht gefunden');
  }

  Object.assign(request, updates);
}

function deleteDemoHolidayRequest(requestId) {
  const requestIndex = demoHolidayRequests.findIndex((item) => item.id === requestId);
  if (requestIndex === -1) {
    throw new Error('Demo-Absenz nicht gefunden');
  }

  demoHolidayRequests.splice(requestIndex, 1);
}

function archiveDemoHolidayRequestDecision(request, context) {
  if (!request) {
    throw new Error('Demo-Absenz nicht gefunden');
  }

  demoRequestHistory.unshift({
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    profile_id: request.profile_id,
    request: buildHolidayRequestArchiveSummary(request),
    context,
  });
}

function extractFirstName(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return '';
  }

  const [firstName] = normalizedValue.split(/\s+/);
  return firstName || '';
}

function getControllDisplayName() {
  const fullName = extractFirstName(state.currentProfile?.full_name);
  if (fullName) {
    return fullName;
  }

  const userMetadataName = extractFirstName(state.user?.user_metadata?.full_name || state.user?.user_metadata?.name);
  if (userMetadataName) {
    return userMetadataName;
  }

  const emailName = String(state.user?.email || '').trim().split('@')[0];
  return extractFirstName(emailName);
}

function getApprovalDisplayName() {
  const fullName = String(state.currentProfile?.full_name || '').trim();
  if (fullName) {
    return fullName;
  }

  const userMetadataName = String(state.user?.user_metadata?.full_name || state.user?.user_metadata?.name || '').trim();
  if (userMetadataName) {
    return userMetadataName;
  }

  return String(state.user?.email || '').trim().split('@')[0];
}

function buildHolidayRequestArchiveSummary(request) {
  if (!request) {
    return 'Absenzantrag';
  }

  const parts = [
    HOLIDAY_TYPE_LABELS[request.request_type] ?? request.request_type ?? 'Absenzantrag',
    request.start_date && request.end_date ? `${formatDate(request.start_date)} bis ${formatDate(request.end_date)}` : '',
    String(request.notes || '').trim(),
  ].filter(Boolean);

  return parts.join(' | ');
}

function buildApprovedHolidayRequestContext(request) {
  const plLabel = String(request?.controll_pl || '').trim() || '–';
  const glLabel = String(request?.controll_gl || '').trim() || '–';
  return `Bestätigt durch PL: ${plLabel} | GL: ${glLabel}`;
}

function buildRejectedHolidayRequestContext() {
  return 'Abgelehnt und aus der aktuellen Liste entfernt';
}

function isMissingRpcFunctionError(error, functionName) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' || message.includes(`Could not find the function public.${functionName}`);
}

async function insertHolidayRequestHistoryEntry(request, context) {
  const { error } = await state.supabase.from('request_history').insert({
    profile_id: request.profile_id,
    request: buildHolidayRequestArchiveSummary(request),
    context,
  });

  if (error) {
    throw error;
  }
}

async function approveHolidayRequestWithoutRpc(request, fieldName, approvalName) {
  const { data: updatedRequest, error: updateError } = await state.supabase
    .from('holiday_requests')
    .update({ [fieldName]: approvalName })
    .eq('id', request.id)
    .select()
    .single();

  if (updateError) {
    throw updateError;
  }

  if (isHolidayRequestFullyApproved(updatedRequest)) {
    await insertHolidayRequestHistoryEntry(updatedRequest, buildApprovedHolidayRequestContext(updatedRequest));

    const { error: deleteError } = await state.supabase
      .from('holiday_requests')
      .delete()
      .eq('id', updatedRequest.id);

    if (deleteError) {
      throw deleteError;
    }
  }

  return updatedRequest;
}

async function rejectHolidayRequestWithoutRpc(request, context) {
  await insertHolidayRequestHistoryEntry(request, context);

  const { error } = await state.supabase
    .from('holiday_requests')
    .delete()
    .eq('id', request.id);

  if (error) {
    throw error;
  }
}

function renderControllCell(report) {
  const controllValue = String(report.controll || '').trim();
  if (controllValue) {
    return `<div class="status-stack"><span class="pill success">Kontrolliert</span><strong>${escapeHtml(controllValue)}</strong></div>`;
  }

  return `<button class="button button-small button-success" type="button" data-action="confirm-report" data-report-id="${escapeAttribute(report.id)}" ${state.isSavingReport ? 'disabled' : ''}>Bestätigen</button>`;
}

function renderHolidayApprovalCell(request, fieldName, roleLabel) {
  const approvalValue = String(request?.[fieldName] || '').trim();
  if (approvalValue) {
    return `<div class="status-stack compact"><span class="pill success">Bestätigt</span><strong>${escapeHtml(approvalValue)}</strong></div>`;
  }

  return `<button class="button button-small button-success" type="button" data-action="confirm-absence-${escapeAttribute(roleLabel.toLowerCase())}" data-request-id="${escapeAttribute(request.id)}" ${state.isSavingAbsence ? 'disabled' : ''}>Bestätigung ${escapeHtml(roleLabel)}</button>`;
}

function renderHolidayConfirmationCell(request) {
  if (!isHolidayRequestFullyApproved(request)) {
    const hasAnyApproval = Boolean(String(request?.controll_pl || '').trim() || String(request?.controll_gl || '').trim());
    if (hasAnyApproval) {
      return `
        <div class="status-stack compact">
          <span class="subtle-text">PDF verfügbar nach PL- und GL-Bestätigung</span>
          <button class="button button-small button-danger" type="button" data-action="reject-absence-request" data-request-id="${escapeAttribute(request.id)}" ${state.isSavingAbsence ? 'disabled' : ''}>Gesuch ablehnen/löschen</button>
        </div>
      `;
    }

    return `<button class="button button-small button-danger" type="button" data-action="reject-absence-request" data-request-id="${escapeAttribute(request.id)}" ${state.isSavingAbsence ? 'disabled' : ''}>Gesuch ablehnen/löschen</button>`;
  }

  return `<button class="button button-small button-secondary" type="button" data-action="download-absence-confirmation" data-request-id="${escapeAttribute(request.id)}">PDF herunterladen</button>`;
}

function renderHistoryActionsCell(entry) {
  return `
    <div class="table-row-actions">
      <button class="button button-small button-secondary" type="button" data-action="download-history-confirmation" data-history-entry-id="${escapeAttribute(entry.id)}">PDF export</button>
      <button class="button button-small button-danger" type="button" data-action="delete-history-entry" data-history-entry-id="${escapeAttribute(entry.id)}" ${state.isSavingConfirmation ? 'disabled' : ''}>Löschen</button>
    </div>
  `;
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && !elements.reportEditModal.classList.contains('hidden')) {
    closeReportEditModal();
  }
}

function setCurrentPage(page) {
  state.currentPage = page;
  render();
}

async function exportWeekPdf() {
  const filteredReports = getSortedFilteredReports();
  if (!filteredReports.length) {
    alert('Für die gewählte Woche sind keine Rapporte vorhanden.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
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
      await drawAttachmentGalleryPage(pdf, imageAttachments.slice(index, index + 2), {
        profileName: profile.full_name || 'Unbekannt',
        calendarWeek: getWeekLabel(state.selectedWeek),
      });
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

async function exportHolidayConfirmationPdf(requestId) {
  const request = state.holidayRequests.find((item) => String(item.id) === String(requestId));
  if (!request) {
    alert('Die ausgewählte Absenz wurde nicht gefunden.');
    return;
  }

  if (!isHolidayRequestFullyApproved(request)) {
    alert('Das Bestätigungsdokument kann erst heruntergeladen werden, wenn PL und GL bestätigt haben.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const profile = getProfileById(request.profile_id);

  drawHolidayConfirmationPage(pdf, { request, profile });

  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  const imageAttachments = attachments.filter((attachment) => isImageAttachment(attachment) && (attachment.publicUrl || attachment.path));
  const otherAttachments = attachments.filter((attachment) => !isImageAttachment(attachment));

  if (otherAttachments.length) {
    pdf.addPage();
    drawHolidayAttachmentListPage(pdf, { attachments: otherAttachments, request, profile });
  }

  for (let index = 0; index < imageAttachments.length; index += 2) {
    pdf.addPage();
    await drawAttachmentGalleryPage(pdf, imageAttachments.slice(index, index + 2), {
      profileName: profile?.full_name || 'Unbekannt',
      calendarWeek: 'Absenz-Bestätigung',
    });
  }

  pdf.save(buildHolidayConfirmationFileName(request, profile));
}

function buildRequestHistoryConfirmationFileName(entry, profile) {
  const createdDate = String(entry?.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const safeName = String(profile?.full_name || profile?.email || 'mitarbeiter')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `bestaetigung-${safeName || 'mitarbeiter'}-${createdDate}.pdf`;
}

function buildHistoryPdfDetailRows(entry, details, profile) {
  return [
    ['Mitarbeiter', profile?.full_name || profile?.email || 'Unbekannt'],
    ['Typ', details.typeLabel],
    ['Von / Bis', details.periodLabel],
    ['Bestätigt durch', details.approvedByLabel],
    ['Ausgelöst am', formatDateTime(entry.created_at)],
    ['Kontext', String(entry?.context || '').trim() || '–'],
  ];
}

function drawRequestHistoryConfirmationPage(pdf, { entry, details, profile }) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const detailRows = buildHistoryPdfDetailRows(entry, details, profile);
  const requestText = String(entry?.request || '').trim() || '–';

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text('Bestätigung Absenz', margin, 22);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.text('Export aus request_history (Bestätigungen).', margin, 32, {
    maxWidth: contentWidth,
    lineHeightFactor: 1.4,
  });

  pdf.autoTable({
    startY: 42,
    margin: { left: margin, right: margin },
    tableWidth: contentWidth,
    head: [['Feld', 'Wert']],
    body: detailRows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: [215, 0, 21], textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' }, 1: { cellWidth: contentWidth - 42 } },
  });

  const notesY = (pdf.lastAutoTable?.finalY || 92) + 10;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Gesuch', margin, notesY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.rect(margin, notesY + 3, contentWidth, 40);
  pdf.text(requestText, margin + 3, notesY + 10, {
    maxWidth: contentWidth - 6,
    lineHeightFactor: 1.4,
  });
}

function exportRequestHistoryPdf(historyEntryId) {
  const entry = state.requestHistory.find((item) => String(item.id) === String(historyEntryId));
  if (!entry) {
    alert('Der ausgewählte Bestätigungseintrag wurde nicht gefunden.');
    return;
  }

  const details = parseRequestHistoryEntry(entry);
  const profile = getProfileById(entry.profile_id);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  drawRequestHistoryConfirmationPage(pdf, { entry, details, profile });
  pdf.save(buildRequestHistoryConfirmationFileName(entry, profile));
}

async function handleDeleteHistoryEntry(historyEntryId) {
  if (!historyEntryId || state.isSavingConfirmation) {
    return;
  }

  const entry = state.requestHistory.find((item) => String(item.id) === String(historyEntryId));
  if (!entry) {
    alert('Der ausgewählte Bestätigungseintrag wurde nicht gefunden.');
    return;
  }

  const shouldDelete = window.confirm('Soll dieser Bestätigungseintrag wirklich gelöscht werden?');
  if (!shouldDelete) {
    return;
  }

  state.isSavingConfirmation = true;
  try {
    if (state.isDemoMode) {
      const index = demoRequestHistory.findIndex((item) => String(item.id) === String(historyEntryId));
      if (index === -1) {
        throw new Error('Demo-Bestätigung nicht gefunden');
      }
      demoRequestHistory.splice(index, 1);
    } else {
      const { error } = await state.supabase.from('request_history').delete().eq('id', historyEntryId);
      if (error) {
        throw error;
      }
    }

    await loadData();
  } catch (error) {
    console.error(error);
    alert(`Bestätigungseintrag konnte nicht gelöscht werden: ${error.message}`);
  } finally {
    state.isSavingConfirmation = false;
    render();
  }
}

function drawHolidayConfirmationPage(pdf, { request, profile }) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const approvalDate = new Date().toLocaleDateString('de-CH');
  const typeLabel = HOLIDAY_TYPE_LABELS[request.request_type] ?? request.request_type;
  const detailRows = [
    ['Mitarbeiter', profile?.full_name || 'Unbekannt'],
    ['Typ', typeLabel],
    ['Von', formatDate(request.start_date)],
    ['Bis', formatDate(request.end_date)],
    ['Dauer', getHolidayRequestDurationLabel(request)],
    ['Bestätigung PL', String(request.controll_pl || '').trim() || '–'],
    ['Bestätigung GL', String(request.controll_gl || '').trim() || '–'],
    ['Erstellt am', approvalDate],
  ];

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text('Bestätigung Absenz', margin, 22);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  const introText = `Hiermit wird bestätigt, dass die Absenz "${typeLabel}" für ${profile?.full_name || 'den Mitarbeiter'} im Zeitraum vom ${formatDate(request.start_date)} bis ${formatDate(request.end_date)} durch PL und GL freigegeben wurde.`;
  pdf.text(introText, margin, 32, { maxWidth: contentWidth, lineHeightFactor: 1.4 });

  pdf.autoTable({
    startY: 46,
    margin: { left: margin, right: margin },
    tableWidth: contentWidth,
    head: [['Feld', 'Wert']],
    body: detailRows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.2 },
    headStyles: { fillColor: [215, 0, 21], textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' }, 1: { cellWidth: contentWidth - 42 } },
  });

  const notesY = (pdf.lastAutoTable?.finalY || 92) + 10;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Bemerkung', margin, notesY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.rect(margin, notesY + 3, contentWidth, 38);
  pdf.text(request.notes || 'Keine zusätzliche Bemerkung vorhanden.', margin + 3, notesY + 10, {
    maxWidth: contentWidth - 6,
    lineHeightFactor: 1.4,
  });

  const signatureTop = notesY + 52;
  const signatureLineWidth = Math.min(92, contentWidth);
  const signatureLeft = margin + (contentWidth - signatureLineWidth) / 2;
  pdf.line(signatureLeft, signatureTop, signatureLeft + signatureLineWidth, signatureTop);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Unterschrift', signatureLeft, signatureTop + 6);
}

async function deleteHolidayRequestAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length || state.isDemoMode || !state.supabase) {
    return;
  }

  const paths = attachments
    .map((attachment) => String(attachment?.path || '').trim())
    .filter(Boolean);

  if (!paths.length) {
    return;
  }

  const { error } = await state.supabase.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) {
    throw error;
  }
}

async function deleteHolidayRequestAttachmentsSafely(attachments = []) {
  try {
    await deleteHolidayRequestAttachments(attachments);
  } catch (error) {
    console.warn('Absenz-Anhänge konnten nach der Archivierung nicht gelöscht werden.', error);
  }
}

async function deleteWeeklyReportAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length || state.isDemoMode || !state.supabase) {
    return;
  }

  const paths = attachments
    .map((attachment) => String(attachment?.path || '').trim())
    .filter(Boolean);

  if (!paths.length) {
    return;
  }

  const { error } = await state.supabase.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) {
    throw error;
  }
}

async function deleteWeeklyReportAttachmentsSafely(attachments = []) {
  try {
    await deleteWeeklyReportAttachments(attachments);
  } catch (error) {
    console.warn('Rapport-Anhänge konnten nach dem Löschen nicht entfernt werden.', error);
  }
}

function drawHolidayAttachmentListPage(pdf, { attachments, request, profile }) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Anhangsverzeichnis', 15, 18);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`${profile?.full_name || 'Unbekannt'} · ${HOLIDAY_TYPE_LABELS[request.request_type] ?? request.request_type}`, 15, 25);

  const body = attachments.map((attachment) => [
    attachment.name || 'Anhang',
    attachment.mimeType || 'Datei',
    attachment.publicUrl || attachment.path || 'Kein Link verfügbar',
  ]);

  pdf.autoTable({
    startY: 32,
    margin: { left: 15, right: 15 },
    head: [['Datei', 'Typ', 'Quelle']],
    body,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 163, 74], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 34 },
      2: { cellWidth: 98 },
    },
  });
}

function buildHolidayConfirmationFileName(request, profile) {
  const safeName = String(profile?.full_name || 'mitarbeiter')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `bestaetigung-${safeName || 'mitarbeiter'}-${request.start_date}-${request.end_date}.pdf`;
}

function buildWeeklyReportLayout(reports) {
  const regularRows = buildWeeklyMatrixRows(
    reports.filter((report) => !getAbsenceCategory(report.project_name || report.commission_number)),
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
        row.projectName,
        row.commission,
        ...row.days,
        formatHours(row.totalMinutes),
        formatCurrency(row.expenses),
        row.notes.join(' | '),
      ])
    : [];
  while (regularBody.length < 10) {
    regularBody.push(['', '', '', '', '', '', '', '', '', '', '']);
  }

  pdf.autoTable({
    startY: mainTableY,
    margin: { left: marginLeft, right: marginRight },
    tableWidth: contentWidth,
    head: [['Projektname', 'Kom. Nr.', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'Total', 'Spesen', 'Bemerkungen']],
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
      0: { cellWidth: 70 },
      1: { cellWidth: 26 },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 12, halign: 'center' },
      7: { cellWidth: 12, halign: 'center' },
      8: { cellWidth: 14, halign: 'center' },
      9: { cellWidth: 16, halign: 'center' },
      10: { cellWidth: 77 },
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
  const projectWidth = 70;
  const commissionWidth = 26;
  const dayWidth = 12;
  const totalWidth = 14;
  const expensesWidth = 16;
  const notesWidth = contentWidth - projectWidth - commissionWidth - dayWidth * 6 - totalWidth - expensesWidth;
  let x = margin;

  pdf.setLineWidth(0.2);
  pdf.rect(margin, totalsY, contentWidth, 8);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text('Wochentotal', x + 1, totalsY + 5.3);
  x += projectWidth;
  pdf.line(x, totalsY, x, totalsY + 8);
  x += commissionWidth;
  pdf.line(x, totalsY, x, totalsY + 8);

  totals.dailyMinutes.forEach((minutes) => {
    pdf.line(x, totalsY, x, totalsY + 8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(formatHours(minutes), x + dayWidth / 2, totalsY + 5.3, { align: 'center' });
    x += dayWidth;
  });

  pdf.line(x, totalsY, x, totalsY + 8);
  pdf.text(formatHours(totals.totalMinutes), x + totalWidth / 2, totalsY + 5.3, { align: 'center' });
  x += totalWidth;

  pdf.line(x, totalsY, x, totalsY + 8);
  pdf.text(formatCurrency(totals.expenses), x + expensesWidth / 2, totalsY + 5.3, { align: 'center' });
  x += expensesWidth;

  pdf.line(x, totalsY, x, totalsY + 8);
  x += notesWidth;
  pdf.line(x, totalsY, x, totalsY + 8);
}

function drawAbsenceTable(pdf, { margin, y, width, rows }) {
  const labelWidth = 96;
  const dayWidth = 12;
  const totalWidth = 14;
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

async function drawAttachmentGalleryPage(pdf, attachments, { profileName, calendarWeek }) {
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
  pdf.text(`Anhänge · ${profileName} · ${calendarWeek}`, margin, titleY);

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
    const projectName = String(report.project_name || '').trim();
    const commission = String(report.commission_number || '').trim();
    const key = `${projectName}__${commission}`;
    if (!groups.has(key)) {
      groups.set(key, {
        projectName: projectName || 'Ohne Projektname',
        commission: commission || '–',
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
    const absenceSource = report.project_name || report.commission_number;
    const absenceCategory = getAbsenceCategory(absenceSource);
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
    const projectName = String(report.project_name || '').trim();
    const commissionNumber = String(report.commission_number || '').trim();
    if (projectName) row.notes.push(projectName);
    if (!projectName && commissionNumber) row.notes.push(commissionNumber);
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

function isHolidayRequestFullyApproved(request) {
  return Boolean(String(request?.controll_pl || '').trim() && String(request?.controll_gl || '').trim());
}

function getHolidayRequestDurationLabel(request) {
  const start = new Date(`${request.start_date}T00:00:00Z`);
  const end = new Date(`${request.end_date}T00:00:00Z`);
  const diffDays = Math.round((end - start) / 86400000) + 1;
  if (diffDays <= 1) {
    return '1 Tag';
  }
  return `${diffDays} Tage`;
}

function buildWeeklyRemarkLines(reports) {
  const notes = [];
  reports.forEach((report) => {
    if (report.notes) {
      notes.push(`${formatDate(report.work_date)}: ${report.notes}`);
    }

    const nightWorkRemark = buildNightWorkRemark(report);
    if (nightWorkRemark) {
      notes.push(nightWorkRemark);
    }
  });
  return dedupeStrings(notes);
}

function buildNightWorkRemark(report) {
  const overlap = getNightShiftOverlap(report.start_time, report.end_time);
  if (!overlap) {
    return '';
  }

  return `Nachtarbeit ${getWeekdayLabel(report.work_date)}: ${formatTimeLabel(overlap.start)}–${formatTimeLabel(overlap.end)}`;
}

function getNightShiftOverlap(startTime, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const normalizedEndMinutes = endMinutes <= startMinutes ? endMinutes + 24 * 60 : endMinutes;
  const nightWindows = [
    { start: 0, end: 6 * 60 },
    { start: 22 * 60, end: 30 * 60 },
  ];

  const overlapSegments = nightWindows
    .map((window) => ({
      start: Math.max(startMinutes, window.start),
      end: Math.min(normalizedEndMinutes, window.end),
    }))
    .filter((segment) => segment.end > segment.start);

  if (!overlapSegments.length) {
    return null;
  }

  return {
    start: overlapSegments[0].start,
    end: overlapSegments[overlapSegments.length - 1].end,
  };
}

function buildEmptyAbsenceRows() {
  return [
    { label: 'Unfall', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Militär', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Ferien', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Krankheit', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Feiertag', days: Array(6).fill(''), total: '', notes: '' },
    { label: 'Berufsschule', days: Array(6).fill(''), total: '', notes: '' },
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

function parseTimeToMinutes(timeString) {
  const match = String(timeString || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatTimeLabel(totalMinutes) {
  const normalizedMinutes = ((Number(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getWeekdayLabel(dateString) {
  return WEEKDAY_LABELS[getWeekdayIndex(dateString)] || '';
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

function getAvailableReportProfileIds() {
  const profileIds = getReportableProfiles().map((profile) => profile.id);
  if (profileIds.length) {
    return profileIds;
  }

  return [...new Set(state.weeklyReports.map((report) => report.profile_id).filter(Boolean))];
}

function getAvailableAbsenceProfileIds() {
  const profileIds = getAbsenceFilterProfiles().map((profile) => profile.id);
  if (profileIds.length) {
    return profileIds;
  }

  return [...new Set(state.holidayRequests.map((request) => request.profile_id).filter(Boolean))];
}

function getReportableProfiles() {
  return [...state.profiles];
}

function getAbsenceFilterProfiles() {
  return getReportableProfiles();
}

function getMatchingProfiles(profiles, query) {
  const normalizedQuery = `${query || ''}`.trim().toLowerCase();
  return profiles.filter((profile) => `${profile.full_name}`.toLowerCase().includes(normalizedQuery));
}

function getFilteredHolidayRequests() {
  const selectedIds = new Set(state.selectedAbsenceEmployeeIds);
  return [...state.holidayRequests]
    .filter((request) => selectedIds.has(request.profile_id))
    .sort((a, b) => `${b.start_date}`.localeCompare(`${a.start_date}`));
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

function renderSaldoInput(profileId, fieldName, value, step = 0.5) {
  return `<input class="saldo-input" type="number" step="${escapeAttribute(step)}" data-saldo-input="${escapeAttribute(fieldName)}" data-profile-id="${escapeAttribute(profileId)}" value="${escapeAttribute(Number(value || 0).toFixed(2))}" />`;
}

function getSaldoInputValue(profileId, fieldName) {
  const input = document.querySelector(`[data-saldo-input="${fieldName}"][data-profile-id="${profileId}"]`);
  if (!input) {
    return 0;
  }
  return Number(input.value || 0);
}

function getProfileSaldoMetrics(profile, currentIsoWeek = getCurrentIsoWeekNumber()) {
  const vacationAllowanceHours = Number(profile.vacation_allowance_hours || 0);
  const bookedVacationHours = Number(profile.booked_vacation_hours || 0);
  const carryoverOvertimeHours = Number(profile.carryover_overtime_hours || 0);
  const reportedHours = Number(profile.reported_hours || 0);
  const creditedHours = Number(profile.credited_hours || 0);
  const weeklyHours = Number(profile.weekly_hours || 40);
  const expectedHours = currentIsoWeek * weeklyHours;
  const overtimeBalanceHours = carryoverOvertimeHours + creditedHours + (reportedHours - expectedHours);
  const vacationBalanceHours = vacationAllowanceHours - bookedVacationHours;

  return {
    vacationAllowanceHours,
    bookedVacationHours,
    carryoverOvertimeHours,
    reportedHours,
    creditedHours,
    weeklyHours,
    overtimeBalanceHours,
    vacationBalanceHours,
  };
}

function getCurrentIsoWeekNumber() {
  const weekValue = getCurrentWeekValue();
  const [, weekPart] = weekValue.split('-W');
  return Number(weekPart || 1);
}

function getReportBookingDelta(report, multiplier = 1) {
  const hours = Number(report?.total_work_minutes || 0) / 60;
  const isVacation = isVacationReport(report);
  return {
    reportedHoursDelta: hours * multiplier,
    bookedVacationHoursDelta: isVacation ? hours * multiplier : 0,
  };
}

function isVacationReport(report) {
  const text = [report?.commission_number, report?.notes, report?.expense_note]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return text.includes('ferien') || text.includes('fehlen');
}

function applyDemoReportBookingDelta(report, multiplier = 1) {
  if (!report) {
    return;
  }
  const profile = demoProfiles.find((item) => String(item.id) === String(report.profile_id));
  if (!profile) {
    return;
  }

  const delta = getReportBookingDelta(report, multiplier);
  profile.reported_hours = Number(profile.reported_hours || 0) + delta.reportedHoursDelta;
  profile.booked_vacation_hours = Number(profile.booked_vacation_hours || 0) + delta.bookedVacationHoursDelta;
}

async function applyProfileBookingDelta(profileId, delta) {
  if (!profileId || state.isDemoMode || !state.supabase || !delta) {
    return;
  }

  const profile = state.profiles.find((item) => String(item.id) === String(profileId));
  if (!profile) {
    return;
  }

  const updates = {
    reported_hours: Number(profile.reported_hours || 0) + Number(delta.reportedHoursDelta || 0),
    booked_vacation_hours: Number(profile.booked_vacation_hours || 0) + Number(delta.bookedVacationHoursDelta || 0),
  };

  const { error } = await state.supabase.from('app_profiles').update(updates).eq('id', profileId);
  if (error) {
    throw error;
  }
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
