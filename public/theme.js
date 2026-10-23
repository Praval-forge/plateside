try { document.documentElement.dataset.theme = localStorage.getItem('pl_theme') === 'light' ? 'light' : 'dark'; } catch (e) { document.documentElement.dataset.theme = 'dark'; }
