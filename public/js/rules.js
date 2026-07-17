document.addEventListener('DOMContentLoaded', () => {
  const buttons = Array.from(document.querySelectorAll('[data-language]'));
  const content = Array.from(document.querySelectorAll('[data-content]'));
  const translatedElements = Array.from(document.querySelectorAll('[data-pt][data-en]'));
  const page = document.documentElement;
  const queryLanguage = new URLSearchParams(window.location.search).get('lang');
  const savedLanguage = window.localStorage.getItem('o-jogo-language');
  const initialLanguage = queryLanguage === 'en' || (!queryLanguage && savedLanguage === 'en') ? 'en' : 'pt';

  function setLanguage(language) {
    const isEnglish = language === 'en';
    page.lang = isEnglish ? 'en' : 'pt-BR';

    buttons.forEach(button => {
      const active = button.dataset.language === language;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    content.forEach(section => {
      section.classList.toggle('is-hidden', section.dataset.content !== language);
    });

    translatedElements.forEach(element => {
      element.innerHTML = isEnglish ? element.dataset.en : element.dataset.pt;
    });

    window.localStorage.setItem('o-jogo-language', language);
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => setLanguage(button.dataset.language));
  });

  setLanguage(initialLanguage);
});
