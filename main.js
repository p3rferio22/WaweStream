const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const Store = require('electron-store');
const { createClient } = require('@supabase/supabase-js');

const store = new Store();
let mainWindow;

// --- НАСТРОЙКИ SUPABASE ---
// ВСТАВЬ СВОИ ДАННЫЕ ИЗ SUPABASE (Project Settings -> API)
const SUPABASE_URL = 'https://xlmidqhxspzrliibwotc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsbWlkcWh4c3B6cmxpaWJ3b3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODA3NDQsImV4cCI6MjA5OTQ1Njc0NH0.QKpA2AvwFKrTSomlFpBVBvUeR2PrzEwPjQhlZLCTITE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// --- IPC: АВТОРИЗАЦИЯ EMAIL/ПАРОЛЬ ---
ipcMain.handle('auth-register', async (event, { email, password }) => {
    try {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { success: false, message: error.message };
        if (data.session) store.set('user-session', data.session);
        return { success: true, user: data.user, session: data.session };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

ipcMain.handle('auth-login', async (event, { email, password }) => {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { success: false, message: error.message };
        if (data.session) store.set('user-session', data.session);
        return { success: true, user: data.user, session: data.session };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

ipcMain.handle('auth-logout', async () => {
    await supabase.auth.signOut();
    store.delete('user-session');
    return { success: true };
});

ipcMain.handle('auth-get-session', async () => {
    return store.get('user-session') || null;
});

// --- IPC: АВТОРИЗАЦИЯ GOOGLE ---
ipcMain.handle('auth-google', async () => {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${SUPABASE_URL}/auth/v1/callback` }
        });

        if (error) throw error;

        return new Promise((resolve) => {
            const authWindow = new BrowserWindow({
                width: 500, height: 650, modal: true, parent: mainWindow,
                webPreferences: { nodeIntegration: false }
            });

            authWindow.loadURL(data.url);

            const handleUrl = async (url) => {
                if (url.includes('#access_token=')) {
                    const params = new URLSearchParams(url.split('#')[1]);
                    const access_token = params.get('access_token');
                    const refresh_token = params.get('refresh_token');

                    if (access_token && refresh_token) {
                        const { data: sessionData, error: sessionErr } = await supabase.auth.setSession({ access_token, refresh_token });
                        if (!sessionErr && sessionData.session) {
                            store.set('user-session', sessionData.session);
                            authWindow.close();
                            resolve({ success: true, user: sessionData.user, session: sessionData.session });
                        } else {
                            authWindow.close();
                            resolve({ success: false, message: 'Ошибка установки сессии' });
                        }
                    }
                }
            };

            authWindow.webContents.on('will-redirect', (event, url) => handleUrl(url));
            authWindow.webContents.on('did-navigate', (event, url) => handleUrl(url));
            authWindow.on('closed', () => resolve({ success: false, message: 'Окно закрыто' }));
        });
    } catch (err) {
        return { success: false, message: err.message };
    }
});

// --- IPC: ПРОФИЛЬ ---
ipcMain.handle('profile-get', async (event, userId) => {
    try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
        return error ? null : data;
    } catch (err) { return null; }
});

ipcMain.handle('profile-update', async (event, { userId, username, avatarFilePath }) => {
    try {
        let avatarUrl = null;
        if (avatarFilePath && fs.existsSync(avatarFilePath)) {
            const fileBuffer = fs.readFileSync(avatarFilePath);
            const ext = path.extname(avatarFilePath).toLowerCase();
            const fileName = `${userId}-${Date.now()}${ext}`;

            const { error: uploadErr } = await supabase.storage.from('avatars')
                .upload(fileName, fileBuffer, { contentType: `image/${ext.replace('.', '') || 'jpeg'}`, upsert: true });

            if (uploadErr) throw uploadErr;
            const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
            avatarUrl = publicUrlData.publicUrl;
        }

        const updates = { id: userId, updated_at: new Date() };
        if (username) updates.username = username;
        if (avatarUrl) updates.avatar_url = avatarUrl;

        const { data, error } = await supabase.from('profiles').upsert(updates).select().single();
        if (error) return { success: false, message: error.message };
        return { success: true, profile: data };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

// --- IPC: ОБЩИЕ ТРЕКИ ---
ipcMain.handle('upload-shared-track', async (event, { url, userId }) => {
    try {
        const meta = await youtubedl(url, { dumpSingleJson: true, noCheckCertificates: true, jsRuntimes: 'node' });
        const videoId = meta.id;
        const tempBase = path.join(app.getPath('temp'), `shared_${videoId}_${Date.now()}`);

        await youtubedl(url, { extractAudio: true, audioFormat: 'mp3', output: `${tempBase}.%(ext)s`, noCheckCertificates: true, jsRuntimes: 'node' });
        const mp3File = `${tempBase}.mp3`;
        if (!fs.existsSync(mp3File)) throw new Error('Не удалось подготовить файл');

        const audioBuffer = fs.readFileSync(mp3File);
        const storageFileName = `${videoId}_${Date.now()}.mp3`;

        const { error: audioErr } = await supabase.storage.from('music')
            .upload(storageFileName, audioBuffer, { contentType: 'audio/mpeg', upsert: true });
        if (audioErr) throw audioErr;

        try { fs.unlinkSync(mp3File); } catch (e) {}

        const audioUrl = supabase.storage.from('music').getPublicUrl(storageFileName).data.publicUrl;
        const { error: dbErr } = await supabase.from('tracks').insert([{
            user_id: userId, title: meta.title, artist: meta.uploader || 'Неизвестен',
            audio_url: audioUrl, artwork_url: meta.thumbnail || ''
        }]);

        if (dbErr) throw dbErr;
        return { success: true };
    } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('get-shared-tracks', async () => {
    try {
        const { data, error } = await supabase.from('tracks').select('*, profiles(username, avatar_url)').order('created_at', { ascending: false });
        return error ? [] : (data || []);
    } catch (e) { return []; }
});

// --- IPC: ЛОКАЛЬНЫЕ НАСТРОЙКИ И ОКНА ---
ipcMain.handle('get-settings', () => store.get('app-settings') || { language: 'ru' });
ipcMain.on('save-settings', (event, settings) => store.set('app-settings', settings));
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize', () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); }});
ipcMain.on('window-close', () => mainWindow && mainWindow.close());

// --- IPC: ЛОКАЛЬНАЯ БИБЛИОТЕКА ---
const musicDir = path.join(app.getPath('userData'), 'library');
const playlistsDir = path.join(musicDir, 'playlists');
if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir, { recursive: true });

function getLibraryTracks() {
    if (!fs.existsSync(musicDir)) return [];
    return fs.readdirSync(musicDir).filter(f => f.endsWith('.json')).map(file => {
        try { return JSON.parse(fs.readFileSync(path.join(musicDir, file))); } catch (e) { return null; }
    }).filter(t => t !== null);
}

function getPlaylistsList() {
    if (!fs.existsSync(playlistsDir)) return [];
    return fs.readdirSync(playlistsDir).filter(f => f.endsWith('.json')).map(file => {
        try { const d = JSON.parse(fs.readFileSync(path.join(playlistsDir, file))); return { name: d.name, id: d.id }; } catch (e) { return null; }
    }).filter(p => p !== null);
}

ipcMain.on('download-yt-track', async (event, url) => {
    try {
        const meta = await youtubedl(url, { dumpSingleJson: true, noCheckCertificates: true, jsRuntimes: 'node' });
        const videoId = meta.id;
        const baseFileName = path.join(musicDir, videoId);

        await youtubedl(url, { extractAudio: true, audioFormat: 'mp3', writeThumbnail: true, output: `${baseFileName}.%(ext)s`, noCheckCertificates: true, jsRuntimes: 'node' });
        
        let artworkPath = '';
        if (fs.existsSync(`${baseFileName}.jpg`)) artworkPath = `${baseFileName}.jpg`;
        else if (fs.existsSync(`${baseFileName}.webp`)) artworkPath = `${baseFileName}.webp`;

        fs.writeFileSync(`${baseFileName}.json`, JSON.stringify({ id: videoId, title: meta.title, artist: meta.uploader, audioPath: `${baseFileName}.mp3`, artworkPath }, null, 2));
        event.reply('download-success', getLibraryTracks());
    } catch (error) { event.reply('download-error', error.message); }
});

ipcMain.on('get-library', (event) => event.reply('library-loaded', getLibraryTracks()));
ipcMain.on('create-playlist', (event, name) => {
    const id = Date.now().toString();
    fs.writeFileSync(path.join(playlistsDir, `${id}.json`), JSON.stringify({ id, name, tracks: [] }, null, 2));
    event.reply('playlists-updated', getPlaylistsList());
});
ipcMain.on('get-playlists', (event) => event.reply('playlists-updated', getPlaylistsList()));
ipcMain.on('add-track-to-playlist', (event, { playlistId, trackId }) => {
    const pPath = path.join(playlistsDir, `${playlistId}.json`);
    if (fs.existsSync(pPath)) {
        const data = JSON.parse(fs.readFileSync(pPath));
        if (!data.tracks.includes(trackId)) { data.tracks.push(trackId); fs.writeFileSync(pPath, JSON.stringify(data, null, 2)); }
    }
});
ipcMain.on('get-playlist-tracks', (event, playlistId) => {
    const pPath = path.join(playlistsDir, `${playlistId}.json`);
    if (fs.existsSync(pPath)) {
        const pData = JSON.parse(fs.readFileSync(pPath));
        const filtered = getLibraryTracks().filter(t => pData.tracks.includes(t.id));
        event.reply('playlist-tracks-loaded', { name: pData.name, tracks: filtered });
    }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });