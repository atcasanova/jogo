// file: public/js/replays.js
function renderReplays(listEl, replays) {
  listEl.innerHTML = '';
  replays.forEach(r => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/replays/${encodeURIComponent(r.file)}`;
    link.textContent = r.file;
    li.appendChild(link);
    if (r.players) {
      const span = document.createElement('span');
      span.textContent = ' - ' + r.players.join(', ');
      li.appendChild(span);
    }
    listEl.appendChild(li);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { renderReplays };
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('replays-list');
    if (!listEl) return;
    fetch('/replays')
      .then(res => res.json())
      .then(files => Promise.all(
        files.map(f =>
          fetch(`/replays/${encodeURIComponent(f.file)}`)
            .then(r => r.json())
            .then(data => ({ file: f.file, players: data.players }))
            .catch(() => ({ file: f.file }))
        )
      ))
      .then(replays => renderReplays(listEl, replays))
      .catch(err => console.error('Failed to load replays', err));
  });
}
