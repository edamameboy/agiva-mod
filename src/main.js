const { app, BrowserWindow } = require('electron');
const path = require('path');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow() {
  // Start the existing TikTokBridge server
  require('./server.js');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Junkyard Mod Dashboard",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  // Load the local server URL
  // We use localhost:3000 as configured in server.js DASHBOARD_PORT
  mainWindow.loadURL('http://localhost:3000/dashboard');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', function () {
  // On Windows, quit when all windows are closed
  app.quit();
});

app.on('quit', () => {
  // Force exit to ensure background node server is killed
  process.exit(0);
});
