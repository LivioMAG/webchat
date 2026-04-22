const CONFIG_PATH = './supabase-config.json';

const state = { supabase: null, contactId: '', contact: null };
const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  state.contactId = getContactId();
  if (!state.contactId) {
    showAlert('Kontakt-ID fehlt.', true);
    return;
  }

  try {
    await initializeSupabase();
    await loadContact();
    render();
  } catch (error) {
    showAlert(error.message || 'Kontakt konnte nicht geladen werden.', true);
  }
}

function cacheElements() {
  elements.contactTitle = document.getElementById('contactTitle');
  elements.contactMeta = document.getElementById('contactMeta');
  elements.contactInfo = document.getElementById('contactInfo');
  elements.backButton = document.getElementById('backButton');
  elements.alert = document.getElementById('alert');
}

function bindEvents() {
  elements.backButton?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = './index.html';
  });
}

function getContactId() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get('id') || '').trim();
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

async function loadContact() {
  const { data, error } = await state.supabase
    .from('crm_contacts')
    .select('*')
    .eq('id', state.contactId)
    .single();
  if (error) throw error;
  state.contact = data;
}

function render() {
  const contact = state.contact;
  if (!contact) return;
  const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Kontakt';
  elements.contactTitle.textContent = name;
  elements.contactMeta.textContent = contact.company_name || '–';
  elements.contactInfo.innerHTML = [
    ['Kategorie', contact.category || '–'],
    ['Firma', contact.company_name || '–'],
    ['Vorname', contact.first_name || '–'],
    ['Nachname', contact.last_name || '–'],
    ['Strasse', contact.street || '–'],
    ['Ort', contact.city || '–'],
    ['PLZ', contact.postal_code || '–'],
    ['Telefon', contact.phone || '–'],
    ['E-Mail', contact.email || '–'],
  ].map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function showAlert(message, isError = false) {
  if (!elements.alert) return;
  elements.alert.textContent = message;
  elements.alert.classList.remove('hidden');
  elements.alert.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
