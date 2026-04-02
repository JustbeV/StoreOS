export function createHashRouter({ sections, defaultSection, canAccessSection, onSectionChange }) {
  function normalizeHash(hash) {
    const raw = (hash || '').replace(/^#\/?/, '').trim();
    return raw || defaultSection;
  }

  function resolveSection(name) {
    if (!sections.includes(name)) return defaultSection;
    if (canAccessSection && !canAccessSection(name)) return defaultSection;
    return name;
  }

  function renderSection(name, updateHash = true) {
    const targetName = resolveSection(name);

    sections.forEach(section => {
      const el = document.getElementById(`${section}Section`);
      if (el) el.style.display = section === targetName ? 'block' : 'none';
    });

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-section="${targetName}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (updateHash) {
      const nextHash = `#/${targetName}`;
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
    }

    if (onSectionChange) onSectionChange(targetName);
    return targetName;
  }

  function syncFromLocation() {
    renderSection(normalizeHash(window.location.hash), false);
  }

  function start() {
    window.addEventListener('hashchange', syncFromLocation);
    syncFromLocation();
  }

  return {
    start,
    showSection(name) {
      return renderSection(name, true);
    },
    syncFromLocation,
  };
}
