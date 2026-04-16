(function initProjectDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const commission = (params.get('commission') || '').trim();
  const name = (params.get('name') || '').trim();
  const meta = [commission, name].filter(Boolean).join(' · ') || 'Keine Projektdaten übergeben';

  const projectMetaElement = document.getElementById('projectMeta');
  if (projectMetaElement) {
    projectMetaElement.textContent = meta;
  }

  const backButton = document.getElementById('backButton');
  if (backButton) {
    backButton.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = './index.html';
    });
  }
})();
