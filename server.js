const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(__dirname, 'users.json');
const LISTS_INDEX_FILE = path.join(__dirname, 'lists-index.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Index Management ---
// Optimization: Keep a persistent index of list metadata to avoid reading all files on dashboard load.
let listsIndex = [];

// Initialize Index
// Initialize Index (Smart Sync)
function loadOrRebuildIndex() {
    let indexMap = new Map();

    // 1. Try to load existing index
    if (fs.existsSync(LISTS_INDEX_FILE)) {
        try {
            const rawIndex = JSON.parse(fs.readFileSync(LISTS_INDEX_FILE, 'utf8'));
            rawIndex.forEach(item => indexMap.set(item.id, item));
        } catch (e) {
            console.error("[INDEX] Corrupt index, starting fresh.");
        }
    }

    // 2. Scan Disk for truth
    const files = fs.readdirSync(DATA_DIR);
    const diskIds = new Set();
    let changed = false;

    // 3. Add/Update from Disk
    for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const id = f.replace('.json', '');
        diskIds.add(id);

        // If not in index, read it (Discovery)
        if (!indexMap.has(id)) {
            try {
                const filePath = path.join(DATA_DIR, f);
                const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                indexMap.set(id, {
                    id: content.id || id,
                    title: content.title || id,
                    adminTitle: content.adminTitle || null,
                    lastModified: content.lastModified || Date.now(),
                    public: content.public !== false,
                    size: fs.statSync(filePath).size
                });
                console.log(`[INDEX] Discovered new/restored list: ${id}`);
                changed = true;
            } catch (e) {
                console.error(`[INDEX] Skipping corrupt file ${f}`);
            }
        }
    }

    // 4. Remove ghosts (In index but not on disk)
    for (const id of indexMap.keys()) {
        if (!diskIds.has(id)) {
            console.log(`[INDEX] Removing ghost entry: ${id}`);
            indexMap.delete(id);
            changed = true;
        }
    }

    // 5. Finalize
    listsIndex = Array.from(indexMap.values());
    if (changed) {
        console.log(`[INDEX] Sync complete. Saving ${listsIndex.length} lists.`);
        saveIndex();
    } else {
        console.log(`[INDEX] Loaded ${listsIndex.length} lists. Index properly synced.`);
    }
}

// rebuildIndex is no longer needed separate, logic merged above.
// function rebuildIndex() { ... } DELETED

function saveIndex() {
    fs.promises.writeFile(LISTS_INDEX_FILE, JSON.stringify(listsIndex)).catch(e => console.error("Index save failed", e));
}

// Helper to update index entry
function updateIndex(id, metadata) {
    const idx = listsIndex.findIndex(i => i.id === id);
    if (idx !== -1) {
        // Merge updates
        listsIndex[idx] = { ...listsIndex[idx], ...metadata };
    } else {
        // New entry
        listsIndex.push(metadata);
    }
    saveIndex();
}

function removeFromIndex(id) {
    listsIndex = listsIndex.filter(i => i.id !== id);
    saveIndex();
}

loadOrRebuildIndex();

app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);

// Share session with Socket.IO
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ... (Auth Middleware & Routes same) ...

// API: Toggle Public/Private
app.post('/api/lists/toggle', isAuthenticated, async (req, res) => {
    const { id, public: isPublic } = req.body;
    let listData = getListData(id);

    if (!listData) return res.status(404).json({ error: "List not found" });

    listData.public = isPublic;
    listData.lastModified = Date.now();

    // Save
    await saveToDisk(id, listData);

    // Update Index
    updateIndex(id, { public: isPublic, lastModified: listData.lastModified });

    // Notify room (to update UI)
    io.to(id).emit('metaUpdate', { public: isPublic });

    res.json({ success: true, public: isPublic });
});

// API: Rename Admin Title (Private)
app.post('/api/lists/rename-admin', isAuthenticated, async (req, res) => {
    const { id, adminTitle } = req.body;
    let listData = getListData(id);

    if (!listData) return res.status(404).json({ error: "List not found" });

    listData.adminTitle = adminTitle;

    // Save
    await saveToDisk(id, listData);

    // Update Index (Visible only to Admin)
    updateIndex(id, { adminTitle: adminTitle });

    res.json({ success: true });
});

// API: Dynamic Manifest
app.get('/api/manifest/:id', (req, res) => {
    const listId = req.params.id;
    const listData = getListData(listId);

    if (!listData) {
        return res.status(404).json({ error: "List not found" });
    }

    // Access Check (Match list access logic)
    const isAdmin = req.session && req.session.user;
    const isPublic = listData.public !== false;

    if (!isPublic && !isAdmin) {
        return res.status(403).json({ error: "Access Denied" });
    }

    const title = listData.title || "Live-List";

    const manifest = {
        "name": title,
        "short_name": title.length > 12 ? title.substring(0, 12) + "..." : title,
        "description": `List: ${title}`,
        "start_url": `/${listId}`,
        "scope": `/${listId}`, // RESTRICT SCOPE: Only capture this specific URL
        "id": `/${listId}`, // Unique ID for PWA differentiation
        "display": "standalone",
        "background_color": "#f4f4f5",
        "theme_color": "#f4f4f5",
        "icons": [
            {
                "src": "/icon.png",
                "sizes": "512x512",
                "type": "image/png"
            }
        ]
    };

    res.json(manifest);
});

// ... (Socket Logic) ...

io.on('connection', (socket) => {
    // ... 

    socket.on('join', (roomId) => {
        // SECURITY: Verify list exists via centralized helper
        const listData = getListData(roomId);

        if (!listData) {
            socket.emit('error', 'List not found');
            return;
        }

        const session = socket.request.session;
        const isAdmin = session && session.user;
        const isPublic = listData.public !== false;

        if (!isPublic && !isAdmin) {
            console.log(`[SOCKET DENIED] Private List ${roomId}`);
            socket.emit('error', 'Access Denied');
            socket.disconnect();
            return;
        }

        socket.join(roomId);

        // Include public status in init
        // SECURITY: Do NOT send adminTitle here unless we specifically want to (usually we don't need it in the list view)
        // If we did, we'd need to check isAdmin again.
        socket.emit('init', {
            content: listData.content,
            lastModified: listData.lastModified,
            title: listData.title || '',
            public: isPublic
        });

        const count = getRoomCount(roomId);
        io.to(roomId).emit('userCount', count);
        log(`User joined room ${roomId}. Total: ${count}.`);
    });

    socket.on('updateTitle', ({ roomId, title }) => {
        // Security Check
        let listData = getListData(roomId);
        if (!listData) return;

        // AUTH CHECK: Must be Admin or List must be Public
        const session = socket.request.session;
        const isAdmin = session && session.user;
        const isPublic = listData.public !== false;

        if (!isPublic && !isAdmin) {
            console.log(`[WRITE DENIED] User tried to update title of private list ${roomId}`);
            return;
        }

        socket.to(roomId).emit('syncTitle', { title });

        listData.title = title;
        listData.lastModified = Date.now();

        // Broadcast metadata update
        io.to(roomId).emit('metaUpdate', { lastModified: listData.lastModified });

        // Update Index
        updateIndex(roomId, { title: title, lastModified: listData.lastModified });

        // Schedule Save
        scheduleWrite(roomId, listData);
    });

    socket.on('update', ({ roomId, content }) => {
        // Security Check
        let listData = getListData(roomId);
        if (!listData) return;

        // AUTH CHECK: Must be Admin or List must be Public
        const session = socket.request.session;
        const isAdmin = session && session.user;
        const isPublic = listData.public !== false;

        if (!isPublic && !isAdmin) {
            console.log(`[WRITE DENIED] User tried to update content of private list ${roomId}`);
            return;
        }

        socket.to(roomId).emit('sync', { content });

        listData.history.push({ ts: Date.now(), content: content });
        if (listData.history.length > 50) listData.history.shift();

        listData.content = content;
        listData.lastModified = Date.now();

        io.to(roomId).emit('metaUpdate', { lastModified: listData.lastModified });

        // Update Index
        updateIndex(roomId, { lastModified: listData.lastModified, size: JSON.stringify(listData).length });

        // Schedule Save
        scheduleWrite(roomId, listData);
    });

    socket.on('disconnecting', () => {
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                const count = getRoomCount(roomId) - 1;
                io.to(roomId).emit('userCount', count);
            }
        }
    });

    // ...
});

// Auth Middleware
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        const accept = req.headers['accept'];
        if (req.path.startsWith('/api') || req.xhr || (accept && accept.includes('json'))) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login');
        }
    }
}

// --- Routes ---

// Admin / Dashboard Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});



// --- User Cache ---
let usersCache = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) { console.error("Failed to load users", e); }
}

// Auth API
app.get('/api/status', (req, res) => {
    const userCount = Object.keys(usersCache).length;
    res.json({
        initialized: userCount > 0,
        authenticated: !!req.session.user
    });
});

app.post('/api/register', async (req, res) => {
    if (Object.keys(usersCache).length > 0) {
        return res.status(403).json({ error: "Registration disabled" });
    }

    const { username, password } = req.body;

    if (usersCache[username]) return res.status(400).json({ error: "User exists" });

    const hash = await bcrypt.hash(password, 10);
    usersCache[username] = { hash };

    // Async save
    fs.promises.writeFile(USERS_FILE, JSON.stringify(usersCache)).catch(e => console.error("Error saving users", e));

    req.session.user = username;
    res.json({ success: true, redirect: '/dashboard' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    // Use Cache
    const user = usersCache[username];

    if (user && await bcrypt.compare(password, user.hash)) {
        req.session.user = username;
        res.json({ success: true, redirect: '/dashboard' });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Dashboard API - OPTIMIZED O(1)
app.get('/api/lists', isAuthenticated, (req, res) => {
    // Serve from memory index
    res.json(listsIndex);
});

app.post('/api/lists/create', isAuthenticated, async (req, res) => {
    const id = nanoid(10);
    const initialData = {
        id,
        created: Date.now(),
        lastModified: Date.now(),
        content: '',
        history: [],
        title: 'New List',
        public: false // Private by default
    };

    try {
        await fs.promises.writeFile(path.join(DATA_DIR, `${id}.json`), JSON.stringify(initialData));

        // Update Index
        updateIndex(id, {
            id,
            title: 'New List',
            adminTitle: null,
            lastModified: initialData.lastModified,
            public: false,
            size: JSON.stringify(initialData).length
        });

        res.json({ id, redirect: '/' + id });
    } catch (e) {
        console.error("Create failed", e);
        res.status(500).json({ error: "Create failed" });
    }
});

app.get('/api/lists/:id/history', isAuthenticated, async (req, res) => {
    const listId = req.params.id;
    // Security check: Only admins can view history
    if (!req.session.user) {
        return res.status(403).json({ error: "Access Denied" });
    }

    const listData = getListData(listId);
    if (!listData) return res.status(404).json({ error: "List not found" });

    // Reverse history so newest is first
    const history = (listData.history || []).slice().reverse();
    res.json(history);
});

app.post('/api/lists/delete', isAuthenticated, async (req, res) => {
    const { id } = req.body;

    if (!id) {
        return res.status(400).json({ error: "No ID" });
    }

    const filePath = path.join(DATA_DIR, `${id}.json`);

    try {
        await fs.promises.unlink(filePath);
        console.log(`[DELETE] Deleted list: ${id}`);

        // Remove from index
        removeFromIndex(id);

        res.json({ success: true });
    } catch (e) {
        // If file doesn't exist, consider it success (idempotent)
        if (e.code === 'ENOENT') {
            removeFromIndex(id); // Ensure index is clean even if file missing
            return res.json({ success: true });
        }
        console.error("Delete failed:", e);
        res.status(500).json({ error: "Delete failed: " + e.message });
    }
});

// Dashboard (Home) - Protected
app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Redirect /dashboard to / to avoid duplication
app.get('/dashboard', (req, res) => {
    res.redirect('/');
});

// Serve list.html for any other route (Dynamic List ID)
// MUST BE LAST ROUTE to avoid intercepting /login, /api, etc.
// Serve list.html for any other route (Dynamic List ID)
// MUST BE LAST ROUTE to avoid intercepting /login, /api, etc.
app.get('/:id', (req, res) => {
    if (req.params.id === 'favicon.ico') return res.status(404).end();

    const listId = req.params.id;
    const listData = getListData(listId);

    if (listData) {
        // Access Control: Public OR Admin
        const isAdmin = req.session && req.session.user;
        const isPublic = listData.public !== false;

        if (isPublic || isAdmin) {
            // Server-side inject manifest and title
            fs.readFile(path.join(__dirname, 'public', 'list.html'), 'utf8', (err, html) => {
                if (err) return res.status(500).send("Error loading page");

                const title = listData.title || "Live-List";

                // Replace Manifest
                let modifiedHtml = html.replace(
                    '<link rel="manifest" href="/manifest.json">',
                    `<link rel="manifest" href="/api/manifest/${listId}">`
                );

                // Replace Title
                modifiedHtml = modifiedHtml.replace(
                    '<title>Live-List</title>',
                    `<title>${title}</title>`
                );

                res.send(modifiedHtml);
            });
        } else {
            console.log(`[ACCESS DENIED] Private List ${listId}`);
            res.status(403).sendFile(path.join(__dirname, 'public', '404.html'));
        }
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
});

// Helper to get room count
function getRoomCount(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);
    return room ? room.size : 0;
}

// --- Persistence Layer (Write-Behind Cache) ---
const writeCache = new Map(); // Stores { roomId, data, timer }
const WRITE_DELAY = 2000; // 2 seconds debounce

function scheduleWrite(roomId, listData) {
    if (writeCache.has(roomId)) {
        clearTimeout(writeCache.get(roomId).timer);
    }

    const timer = setTimeout(() => {
        saveToDisk(roomId, listData);
        writeCache.delete(roomId);
    }, WRITE_DELAY);

    writeCache.set(roomId, { data: listData, timer });
}

async function saveToDisk(roomId, listData) {
    const filePath = path.join(DATA_DIR, `${roomId}.json`);
    try {
        await fs.promises.writeFile(filePath, JSON.stringify(listData));
        log(`Saved ${roomId} to disk.`);
    } catch (e) {
        console.error(`Error saving ${roomId}:`, e);
    }
}

// Helper to get data (Cache or Disk)
// SECURITY: Returns NULL if list does not exist (Strict Mode)
function getListData(roomId) {
    if (writeCache.has(roomId)) {
        return writeCache.get(roomId).data;
    }

    const filePath = path.join(DATA_DIR, `${roomId}.json`);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) { }
    }

    // Default: Return NULL to indicate not found
    return null;
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
