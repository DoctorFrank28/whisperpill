// Bootstrap i18n condiviso da pill.js, settings.js e setup.js (caricato prima
// di ciascuno via <script>). Espone window.t()/applyTranslations() globali.

window.I18N = { lang: "it", dicts: { it: {}, en: {} } };

window.t = function t(key, vars) {
  const dict = window.I18N.dicts[window.I18N.lang] || window.I18N.dicts.it;
  let str = dict[key] ?? window.I18N.dicts.it[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.split(`{${k}}`).join(v);
    }
  }
  return str;
};

window.applyTranslations = function applyTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = window.t(el.getAttribute("data-i18n"));
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = window.t(el.getAttribute("data-i18n-title"));
  });
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = window.t(el.getAttribute("data-i18n-html"));
  });
};

// Promessa risolta quando il dizionario e' pronto: gli script che devono
// generare testo dinamico subito possono attendere window.i18nReady.
window.i18nReady = window.whisperPill.getI18n().then((i18n) => {
  window.I18N = i18n;
  window.applyTranslations();
  return i18n;
});

window.whisperPill.onI18nChanged((i18n) => {
  window.I18N = i18n;
  window.applyTranslations();
  if (typeof window.onLanguageChanged === "function") window.onLanguageChanged();
});
