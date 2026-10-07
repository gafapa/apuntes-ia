// Proceso principal de Electron: arranca el servidor local y abre la ventana.
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import { crearServidor } from '../server/index';

let ventana: BrowserWindow | null = null;
let servidor: Awaited<ReturnType<typeof crearServidor>> | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });
  app.whenReady().then(iniciar).catch((e) => {
    dialog.showErrorBox('Apuntes IA no ha podido arrancar', String(e?.stack ?? e));
    app.quit();
  });
}

async function iniciar() {
  Menu.setApplicationMenu(null);
  servidor = await crearServidor({
    archivoAjustes: path.join(app.getPath('userData'), 'ajustes.json'),
    carpetaDatosPorDefecto: path.join(app.getPath('documents'), 'Apuntes IA'),
    dirEstatico: path.join(__dirname, '..', 'dist-web'),
    dirBin: app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'resources-bin', { win32: 'win', darwin: 'mac' }[process.platform as string] ?? 'linux'),
    version: app.getVersion(),
    instalarActualizacion: () => autoUpdater.quitAndInstall(),
  });

  ventana = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Apuntes IA',
    backgroundColor: '#0f1117',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  ventana.once('ready-to-show', () => ventana?.show());

  // Los enlaces externos se abren en el navegador del sistema
  const urlApp = servidor.url;
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(urlApp)) shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(urlApp)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  // F12 / Ctrl+Shift+I para depurar, Ctrl+R para recargar
  ventana.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      ventana?.webContents.toggleDevTools();
    } else if (input.control && input.key.toLowerCase() === 'r') {
      ventana?.webContents.reload();
    }
  });

  await ventana.loadURL(urlApp);
  comprobarActualizaciones();
}

/** Busca versiones nuevas en GitHub Releases y las descarga en segundo plano. */
function comprobarActualizaciones() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => servidor?.avisarActualizacion('disponible', i.version));
  autoUpdater.on('update-downloaded', (i) => servidor?.avisarActualizacion('descargada', i.version));
  autoUpdater.on('error', (e) => console.warn('Actualizaciones:', e?.message ?? e));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

app.on('window-all-closed', () => app.quit());

let cerrando = false;
app.on('before-quit', (e) => {
  if (cerrando || !servidor) return;
  e.preventDefault();
  cerrando = true;
  servidor.cerrar().finally(() => app.quit());
});
