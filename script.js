const MASTER_ADMIN_EMAIL = 'admin@maraschow.cn';
const STORAGE_BUCKET = 'weekly-attachments';
const CONFIG_PATH = './supabase-config.json';
const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const HOLIDAY_TYPE_LABELS = {
  ferien: 'Ferien',
  militaer: 'Militär',
  zivildienst: 'Zivildienst',
  unfall: 'Unfall',
  krankheit: 'Krankheit',
};
const ABSENCE_TYPES = new Set(['ferien', 'militaer', 'zivildienst', 'unfall', 'krankheit', 'feiertag']);

const ADMIN_SQL_SNIPPET = `-- Master-Admin für admin@maraschow.cn
create or replace function public.is_master_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = '${MASTER_ADMIN_EMAIL}';
$$;

alter table public.app_profiles enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.holiday_requests enable row level security;

create policy "master admin full access app_profiles"
on public.app_profiles
for all
using (public.is_master_admin() or auth.uid() = id)
with check (public.is_master_admin() or auth.uid() = id);

create policy "master admin full access weekly_reports"
on public.weekly_reports
for all
using (public.is_master_admin() or auth.uid() = profile_id)
with check (public.is_master_admin() or auth.uid() = profile_id);

create policy "master admin full access holiday_requests"
on public.holiday_requests
for all
using (public.is_master_admin() or auth.uid() = profile_id)
with check (public.is_master_admin() or auth.uid() = profile_id);

create policy "master admin bucket read"
on storage.objects
for select
using (
  bucket_id = '${STORAGE_BUCKET}' and (
    public.is_master_admin() or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "master admin bucket write"
on storage.objects
for all
using (
  bucket_id = '${STORAGE_BUCKET}' and (
    public.is_master_admin() or auth.uid()::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = '${STORAGE_BUCKET}' and (
    public.is_master_admin() or auth.uid()::text = split_part(name, '/', 1)
  )
);`;

const demoProfiles = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'admin@maraschow.cn',
    full_name: 'Master Admin',
    role_label: 'Administration',
    underscore_admin: true,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'michael@example.com',
    full_name: 'Michael Gerber',
    role_label: 'Monteur',
    underscore_admin: false,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'sandra@example.com',
    full_name: 'Sandra Bühler',
    role_label: 'Monteurin',
    underscore_admin: false,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'pascal@example.com',
    full_name: 'Pascal Frei',
    role_label: 'Monteur',
    underscore_admin: false,
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
  isDemoMode: false,
  hasAdminAccess: false,
  configReady: false,
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
  elements.currentWeekButton = document.getElementById('currentWeekButton');
  elements.exportPdfButton = document.getElementById('exportPdfButton');
  elements.reloadButton = document.getElementById('reloadButton');
  elements.logoutButton = document.getElementById('logoutButton');
  elements.reportsTableBody = document.getElementById('reportsTableBody');
  elements.absencesTableBody = document.getElementById('absencesTableBody');
  elements.reportCount = document.getElementById('reportCount');
  elements.totalHours = document.getElementById('totalHours');
  elements.totalExpenses = document.getElementById('totalExpenses');
  elements.missingReports = document.getElementById('missingReports');
  elements.submissionList = document.getElementById('submissionList');
  elements.missingList = document.getElementById('missingList');
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
  elements.weekPicker.addEventListener('change', async (event) => {
    state.selectedWeek = event.target.value;
    await loadData();
  });
  elements.currentWeekButton.addEventListener('click', async () => {
    state.selectedWeek = getCurrentWeekValue();
    elements.weekPicker.value = state.selectedWeek;
    await loadData();
  });
  elements.exportPdfButton.addEventListener('click', exportWeekPdf);
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
    setConnectionBadge('Supabase verbunden');
  } catch (error) {
    console.warn(error);
    state.isDemoMode = true;
    setConnectionBadge('Demo-Modus (ohne Supabase)', true);
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
  if (!state.session?.user) {
    return;
  }

  state.user = state.session.user;
  state.hasAdminAccess = false;
  await loadData();

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user ?? null;
    state.hasAdminAccess = false;
    if (state.user) {
      await loadData();
    } else {
      resetAppState();
      render();
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.emailInput.value.trim().toLowerCase();
  const password = elements.passwordInput.value;

  if (state.isDemoMode) {
    const demoProfile = demoProfiles.find((profile) => profile.email === email) ?? demoProfiles[0];
    state.user = { id: demoProfile.id, email: demoProfile.email };
    state.currentProfile = demoProfile;
    state.hasAdminAccess = hasUnderscoreAdminAccess(demoProfile);
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
  state.hasAdminAccess = false;
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
    state.currentProfile = currentProfile;
    state.hasAdminAccess = hasUnderscoreAdminAccess(currentProfile);

    if (!state.hasAdminAccess) {
      state.profiles = [];
      state.weeklyReports = [];
      state.holidayRequests = [];
      elements.dataTimestamp.textContent = 'Kein Zugriff – underscore_admin ist nicht aktiviert';
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
    elements.dataTimestamp.textContent = `Letzte Aktualisierung: ${new Date().toLocaleString('de-CH')}`;
    render();
  } catch (error) {
    console.error(error);
    alert(`Daten konnten nicht geladen werden: ${error.message}`);
  }
}

async function fetchCurrentProfile() {
  const { data, error } = await state.supabase
    .from('app_profiles')
    .select('*')
    .eq('id', state.user.id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function loadDemoData() {
  const isAdmin = state.hasAdminAccess;
  state.currentProfile = demoProfiles.find((profile) => profile.id === state.user.id) ?? demoProfiles[0];
  if (!isAdmin) {
    state.profiles = [];
    state.weeklyReports = [];
    state.holidayRequests = [];
    elements.dataTimestamp.textContent = 'Kein Zugriff – underscore_admin ist nicht aktiviert';
    return;
  }

  state.profiles = demoProfiles;

  const weekRange = getWeekRange(state.selectedWeek);
  const reports = demoWeeklyReports.filter((report) => report.work_date >= weekRange.start && report.work_date <= weekRange.end);
  state.weeklyReports = reports;
  state.holidayRequests = [...demoHolidayRequests];
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
    return;
  }

  renderSidebar();
  renderPages();
  renderReportStats();
  renderReportsTable();
  renderSubmissionLists();
  renderAbsenceTable();
}

function renderSidebar() {
  const profile = state.currentProfile;
  elements.userName.textContent = profile?.full_name ?? state.user.email;
  elements.userRole.textContent = profile?.role_label ?? 'Benutzer';
  elements.userBadge.textContent = state.hasAdminAccess ? 'Underscore Admin' : 'Kein Zugriff';
}

function renderPages() {
  const pageTitles = {
    reports: 'Wochenrapporte',
    absences: 'Ferien & Absenzen',
    security: 'Admin / Security',
  };

  elements.pageTitle.textContent = pageTitles[state.currentPage];

  for (const [key, page] of Object.entries(elements.pages)) {
    page.classList.toggle('hidden', key !== state.currentPage);
  }

  elements.navTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.page === state.currentPage);
  });
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

function renderReportsTable() {
  if (!state.weeklyReports.length) {
    elements.reportsTableBody.innerHTML = `<tr><td colspan="8">Keine Rapporte in dieser Woche gefunden.</td></tr>`;
    return;
  }

  const sorted = [...state.weeklyReports].sort((a, b) => `${a.work_date}${a.start_time}`.localeCompare(`${b.work_date}${b.start_time}`));
  elements.reportsTableBody.innerHTML = sorted
    .map((report) => {
      const profile = getProfileById(report.profile_id);
      return `
        <tr>
          <td>${escapeHtml(profile?.full_name ?? 'Unbekannt')}</td>
          <td>${formatDate(report.work_date)}</td>
          <td>${escapeHtml(report.commission_number || '–')}</td>
          <td>${escapeHtml(report.start_time || '–')} – ${escapeHtml(report.end_time || '–')}</td>
          <td>${formatMinutes(report.total_work_minutes)}</td>
          <td>${formatCurrency(Number(report.expenses_amount || 0) + Number(report.other_costs_amount || 0))}</td>
          <td>${escapeHtml(report.notes || report.expense_note || '–')}</td>
          <td>${renderAttachmentLinks(report.attachments)}</td>
        </tr>
      `;
    })
    .join('');
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
  const groups = groupReportsByProfile(state.weeklyReports);
  const submittedItems = getReportableProfiles().map((profile) => {
    const count = groups.get(profile.id)?.length ?? 0;
    return `
      <li>
        <div>
          <strong>${escapeHtml(profile.full_name)}</strong>
          <div class="subtle-text">${escapeHtml(profile.role_label || 'Profil')}</div>
        </div>
        <span class="pill ${count > 0 ? 'success' : 'warning'}">${count > 0 ? `${count} Einträge` : 'Keine Abgabe'}</span>
      </li>
    `;
  });

  const missingItems = getMissingProfiles().map(
    (profile) => `
      <li>
        <div>
          <strong>${escapeHtml(profile.full_name)}</strong>
          <div class="subtle-text">${escapeHtml(profile.email)}</div>
        </div>
        <span class="pill warning">Fehlt</span>
      </li>
    `,
  );

  elements.submissionList.innerHTML = submittedItems.join('') || '<li>Keine Profile vorhanden.</li>';
  elements.missingList.innerHTML = missingItems.join('') || '<li>Alle Profile haben abgegeben.</li>';
}

function setCurrentPage(page) {
  state.currentPage = page;
  renderPages();
}

async function exportWeekPdf() {
  if (!state.weeklyReports.length) {
    alert('Für die gewählte Woche sind keine Rapporte vorhanden.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const grouped = groupReportsByProfile(state.weeklyReports);
  const weekRange = getWeekRange(state.selectedWeek);
  let firstSection = true;

  for (const profile of getReportableProfiles().filter((item) => grouped.has(item.id))) {
    const reports = grouped.get(profile.id) ?? [];
    if (!firstSection) pdf.addPage();
    firstSection = false;

    const absencesForProfile = reports.filter((report) => ABSENCE_TYPES.has(String(report.commission_number || '').toLowerCase()));
    const normalReports = reports.filter((report) => !ABSENCE_TYPES.has(String(report.commission_number || '').toLowerCase()));

    pdf.setFontSize(18);
    pdf.text(`Wochenrapport: ${profile.full_name}`, 14, 18);
    pdf.setFontSize(10);
    pdf.text(`Kalenderwoche: ${getWeekLabel(state.selectedWeek)} | Zeitraum: ${formatDate(weekRange.start)} - ${formatDate(weekRange.end)}`, 14, 24);
    pdf.text(`E-Mail: ${profile.email} | Rolle: ${profile.role_label || 'Mitarbeiter'}`, 14, 29);

    const tableRows = buildWeeklyMatrixRows(normalReports);
    pdf.autoTable({
      startY: 35,
      head: [['Kommissionsnummer', ...WEEKDAY_LABELS, 'Spesen', 'Bemerkungen']],
      body: tableRows.length ? tableRows : [['Keine regulären Rapportzeilen', '', '', '', '', '', '', '', '', '']],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    let nextY = pdf.lastAutoTable.finalY + 8;
    if (absencesForProfile.length) {
      const absenceRows = buildWeeklyMatrixRows(absencesForProfile);
      pdf.setFontSize(12);
      pdf.text('Absenzen', 14, nextY);
      pdf.autoTable({
        startY: nextY + 3,
        head: [['Absenz', ...WEEKDAY_LABELS, 'Spesen', 'Bemerkungen']],
        body: absenceRows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [180, 83, 9] },
      });
      nextY = pdf.lastAutoTable.finalY + 8;
    }

    const attachments = reports.flatMap((report) => Array.isArray(report.attachments) ? report.attachments : []);
    if (attachments.length) {
      pdf.setFontSize(11);
      pdf.text('Anhänge', 14, Math.min(nextY, 280));
      for (const attachment of attachments) {
        pdf.addPage();
        pdf.setFontSize(14);
        pdf.text(`${profile.full_name} - ${attachment.name || 'Anhang'}`, 14, 18);
        pdf.setFontSize(10);
        pdf.text(attachment.publicUrl || attachment.path || 'Kein Pfad vorhanden', 14, 24, { maxWidth: 180 });
        if (isImageAttachment(attachment)) {
          try {
            const dataUrl = await fileToDataUrl(attachment.publicUrl);
            const imageProps = pdf.getImageProperties(dataUrl);
            const pageWidth = 180;
            const ratio = imageProps.height / imageProps.width;
            const imageHeight = Math.min(pageWidth * ratio, 240);
            pdf.addImage(dataUrl, imageProps.fileType || 'JPEG', 15, 32, pageWidth, imageHeight);
          } catch (error) {
            pdf.text('Bild konnte nicht geladen werden. Link siehe oben.', 14, 34);
          }
        } else {
          pdf.text('Nicht-Bild-Anhang: Bitte über den gespeicherten Link öffnen.', 14, 34);
        }
      }
    }
  }

  pdf.addPage();
  pdf.setFontSize(18);
  pdf.text('Fehlende Wochenrapporte', 14, 18);
  pdf.setFontSize(10);
  pdf.text(`Kalenderwoche ${getWeekLabel(state.selectedWeek)}`, 14, 24);
  const missingRows = getMissingProfiles().map((profile) => [profile.full_name, profile.email, profile.role_label || 'Profil']);
  pdf.autoTable({
    startY: 30,
    head: [['Mitarbeiter', 'E-Mail', 'Rolle']],
    body: missingRows.length ? missingRows : [['Alle Mitarbeiter haben abgegeben.', '', '']],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [22, 163, 74] },
  });

  pdf.save(`wochenrapport-${state.selectedWeek}.pdf`);
}

function buildWeeklyMatrixRows(reports) {
  const groups = new Map();

  reports.forEach((report) => {
    const key = report.commission_number || 'Ohne Kommission';
    if (!groups.has(key)) {
      groups.set(key, {
        commission: key,
        days: Array(7).fill(''),
        expenses: 0,
        notes: [],
      });
    }

    const current = groups.get(key);
    const dayIndex = getWeekdayIndex(report.work_date);
    const workedHours = report.total_work_minutes > 0 ? `${(Number(report.total_work_minutes) / 60).toFixed(2)} h` : '–';
    current.days[dayIndex] = current.days[dayIndex]
      ? `${current.days[dayIndex]} | ${workedHours}`
      : workedHours;
    current.expenses += Number(report.expenses_amount || 0) + Number(report.other_costs_amount || 0);
    if (report.notes) current.notes.push(report.notes);
    if (report.expense_note) current.notes.push(`Spesen: ${report.expense_note}`);
  });

  return [...groups.values()].map((group) => [
    group.commission,
    ...group.days,
    formatCurrency(group.expenses),
    group.notes.join(' | '),
  ]);
}

function getMissingProfiles() {
  const groups = groupReportsByProfile(state.weeklyReports);
  return getReportableProfiles().filter((profile) => !groups.has(profile.id));
}

function getReportableProfiles() {
  return state.profiles.filter((profile) => !hasUnderscoreAdminAccess(profile));
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
  return weekValue.replace('-W', ' / KW ');
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

function hasUnderscoreAdminAccess(profile) {
  return Boolean(profile?.underscore_admin);
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
