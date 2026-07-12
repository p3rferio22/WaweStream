const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Окна
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // Авторизация
    register: (credentials) => ipcRenderer.invoke('auth-register', credentials),
    login: (credentials) => ipcRenderer.invoke('auth-login', credentials),
    loginWithGoogle: () => ipcRenderer.invoke('auth-google'),
    logout: () => ipcRenderer.invoke('auth-logout'),
    getSession: () => ipcRenderer.invoke('auth-get-session'),

    // Профиль
    getProfile: (userId) => ipcRenderer.invoke('profile-get', userId),
    updateProfile: (data) => ipcRenderer.invoke('profile-update', data),

    // Общие треки
    uploadSharedTrack: (data) => ipcRenderer.invoke('upload-shared-track', data),
    getSharedTracks: () => ipcRenderer.invoke('get-shared-tracks'),

    // Локальная библиотека
    getLibrary: () => ipcRenderer.send('get-library'),
    downloadYoutube: (url) => ipcRenderer.send('download-yt-track', url),
    onLibraryLoaded: (callback) => ipcRenderer.on('library-loaded', (event, data) => callback(data)),
    onDownloadSuccess: (callback) => ipcRenderer.on('download-success', (event, data) => callback(data)),
    onDownloadError: (callback) => ipcRenderer.on('download-error', (event, err) => callback(err)),

    // Плейлисты
    createPlaylist: (name) => ipcRenderer.send('create-playlist', name),
    getPlaylists: () => ipcRenderer.send('get-playlists'),
    addTrackToPlaylist: (playlistId, trackId) => ipcRenderer.send('add-track-to-playlist', { playlistId, trackId }),
    getPlaylistTracks: (playlistId) => ipcRenderer.send('get-playlist-tracks', playlistId),
    onPlaylistsUpdated: (callback) => ipcRenderer.on('playlists-updated', (event, data) => callback(data)),
    onPlaylistTracksLoaded: (callback) => ipcRenderer.on('playlist-tracks-loaded', (event, data) => callback(data)),

    // Настройки
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.send('save-settings', settings)
});