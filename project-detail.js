(function initProjectDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const commission = (params.get('commission') || '').trim();
  const name = (params.get('name') || '').trim();
  const meta = [commission, name].filter(Boolean).join(' · ');

  const projectMetaElement = document.getElementById('projectMeta');
  if (projectMetaElement) {
    projectMetaElement.textContent = meta;
    projectMetaElement.hidden = meta.length === 0;
  }

  const backButton = document.getElementById('backIconButton');
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
