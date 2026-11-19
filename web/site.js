/* Parque das Águas · comportamentos compartilhados (sem dependências)
   - Menu do celular
   - Lightbox para ampliar pranchas e renders (img[data-zoom])
   - Comparador antes/depois (.compare)                                  */
'use strict';
(() => {
  // ---------- Menu do celular ----------
  const header = document.querySelector('.site-header');
  const toggle = header?.querySelector('.menu-toggle');
  if (toggle) {
    const setOpen = open => {
      header.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!header.classList.contains('is-open')));
    header.querySelectorAll('.site-nav a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  }

  // ---------- Lightbox ----------
  const zoomables = document.querySelectorAll('img[data-zoom]');
  if (zoomables.length) {
    const dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.innerHTML = '<button class="lightbox-close" type="button" aria-label="Fechar">×</button><img alt=""><p></p>';
    document.body.append(dialog);
    const big = dialog.querySelector('img');
    const caption = dialog.querySelector('p');
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    zoomables.forEach(img => {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'Ampliar: ' + img.alt);
      const open = () => {
        big.src = img.dataset.zoom || img.currentSrc || img.src;
        big.alt = img.alt;
        caption.textContent = img.closest('figure')?.querySelector('figcaption')?.textContent || '';
        dialog.showModal();
      };
      img.addEventListener('click', open);
      img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // ---------- Comparador antes/depois ----------
  // A imagem "depois" fica por cima e é recortada com clip-path.
  // O <input type=range> invisível dá suporte a teclado e leitor de tela.
  document.querySelectorAll('.compare').forEach(box => {
    const range = box.querySelector('input[type=range]');
    const set = v => box.style.setProperty('--pos', v + '%');
    range.addEventListener('input', () => set(range.value));
    set(range.value);
  });
})();
