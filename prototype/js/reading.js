/* 文章的渐进增强；无脚本时保留原始段落、表格和代码。文案来自页面模板。 */
document.addEventListener('DOMContentLoaded', () => {
  const template = document.querySelector('#reading-code-template');
  document.querySelectorAll('.reading-body').forEach(body => {
    body.querySelectorAll('table').forEach(table => {
      const wrap = document.createElement('div');
      wrap.className = 'reading-table';
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      if (table.caption) wrap.setAttribute('aria-label', table.caption.textContent);
      table.before(wrap);
      wrap.append(table);
    });
    body.querySelectorAll('pre').forEach((pre, index) => {
      const code = pre.querySelector('code');
      if (!code || !template) return;
      const source = code.textContent;
      const block = document.createElement('div');
      block.className = 'reading-code';
      const tools = template.content.firstElementChild.cloneNode(true);
      tools.querySelector('[data-reading-language]').textContent = code.className.match(/language-([\w-]+)/)?.[1] || pre.dataset.language || '';
      const copy = tools.querySelector('[data-reading-copy]');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(source);
          copy.textContent = copy.dataset.done;
        } catch {
          copy.textContent = copy.dataset.failed;
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
      const toggle = tools.querySelector('[data-reading-toggle]');
      const threshold = parseInt(getComputedStyle(document.body).getPropertyValue('--reading-code-lines'), 10);
      if (source.split('\n').length > threshold) {
        pre.id ||= `reading-code-${index}`;
        toggle.setAttribute('aria-controls', pre.id);
        block.classList.add('is-collapsed');
        toggle.addEventListener('click', () => {
          const collapsed = block.classList.toggle('is-collapsed');
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.textContent = collapsed ? toggle.dataset.expand : toggle.dataset.collapse;
        });
      } else toggle.hidden = true;
      pre.before(block);
      block.append(tools, pre);
      if (pre.hasAttribute('data-line-numbers')) {
        const lines = source.split('\n');
        code.replaceChildren();
        lines.forEach((line, number) => {
          const label = document.createElement('span');
          label.className = 'reading-line-number';
          label.setAttribute('aria-hidden', 'true');
          label.textContent = String(number + 1);
          code.append(label, document.createTextNode(line + (number < lines.length - 1 ? '\n' : '')));
        });
      }
    });
    body.querySelectorAll('img').forEach(image => {
      function failed() {
        if (image.nextElementSibling?.classList.contains('reading-image-error')) return;
        const note = document.createElement('span');
        note.className = 'reading-image-error';
        note.textContent = image.alt;
        image.after(note);
        image.hidden = true;
      }
      image.addEventListener('error', failed);
      if (image.complete && !image.naturalWidth) failed();
    });
  });
});
