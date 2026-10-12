// Apply the saved theme before rendering, without requiring inline script permissions.
try {
  const savedTheme = localStorage.getItem('tema');
  const dark = savedTheme ? savedTheme === 'oscuro' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch {}
