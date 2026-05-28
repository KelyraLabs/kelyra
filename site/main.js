const buttons = document.querySelectorAll('[data-copy]');

for (const button of buttons) {
  const original = button.innerHTML;
  button.addEventListener('click', async () => {
    const text = button.getAttribute('data-copy') || '';
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      setTimeout(() => {
        button.innerHTML = original;
      }, 1400);
    } catch {
      button.textContent = 'Select';
      setTimeout(() => {
        button.innerHTML = original;
      }, 1400);
    }
  });
}

const announcementClose = document.querySelector('.announcement button');

announcementClose?.addEventListener('click', () => {
  document.querySelector('.announcement')?.remove();
});

const menuToggle = document.querySelector('[data-menu-toggle]');
const siteHeader = document.querySelector('.site-header');
const siteNav = document.querySelector('[data-site-nav]');

function setMenuOpen(open) {
  siteHeader?.classList.toggle('is-menu-open', open);
  document.body.classList.toggle('menu-open', open);
  menuToggle?.setAttribute('aria-expanded', String(open));
  menuToggle?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

menuToggle?.addEventListener('click', () => {
  setMenuOpen(!siteHeader?.classList.contains('is-menu-open'));
});

siteNav?.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('a')) setMenuOpen(false);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenuOpen(false);
});

const demoTabs = document.querySelectorAll('[data-demo-tab]');
const demoPanels = document.querySelectorAll('[data-demo-panel]');

for (const tab of demoTabs) {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('data-demo-tab');
    for (const item of demoTabs) item.classList.toggle('active', item === tab);
    for (const panel of demoPanels) {
      panel.classList.toggle('active', panel.getAttribute('data-demo-panel') === target);
    }
  });
}

const revealTargets = document.querySelectorAll('.band, .terminal-shell, .entry-grid article, .proof-tile, .flow article');

for (const target of revealTargets) {
  target.classList.add('reveal');
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  for (const target of revealTargets) observer.observe(target);
} else {
  for (const target of revealTargets) target.classList.add('is-visible');
}
