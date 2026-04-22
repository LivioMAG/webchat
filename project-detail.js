document.addEventListener('DOMContentLoaded', () => {
  const backButton = document.getElementById('backIconButton');
  backButton?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = './index.html';
  });
});
