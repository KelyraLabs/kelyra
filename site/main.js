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
