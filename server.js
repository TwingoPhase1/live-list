const express = require('express');
const http = require('http');

const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const WebSocket = require('ws');
/*
  Try to require y-websocket utils. 
  Note: If y-websocket is ESM only in newer versions, this might need dynamic import or a workaround. 
  For standard usage, we'll try standard require. If it fails, we might need a fallback.
  However, since we are in a CommonJS file, we hope for the best.
*/
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const map = require('lib0/map');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/yjs')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    }
});

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(__dirname, 'users.json');
const LISTS_INDEX_FILE = path.join(__dirname, 'lists-index.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Index Management ---
let listsIndex = [];
function loadOrRebuildIndex() {
    let indexMap = new Map();
    if (fs.existsSync(LISTS_INDEX_FILE)) {
        try {
            const rawIndex = JSON.parse(fs.readFileSync(LISTS_INDEX_FILE, 'utf8'));
            rawIndex.forEach(item => indexMap.set(item.id, item));
        } catch (e) { }
    }
    const files = fs.readdirSync(DATA_DIR);
    const diskIds = new Set();
    let changed = false;
    for (const f of files) {
        if (f.endsWith('.yjs')) {
            const id = f.replace('.yjs', '');
            diskIds.add(id);
            // YJS binary files are opaque, we rely on index for metadata. 
            continue;
        }

        if (!f.endsWith('.json')) continue;


        const id = f.replace('.json', '');
        diskIds.add(id);
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
                changed = true;
                console.log(`[INDEX] Discovered: ${id}`);
            } catch (e) { }
        }
    }
    for (const id of indexMap.keys()) {
        if (!diskIds.has(id)) {
            indexMap.delete(id);
            changed = true;
        }
    }
    listsIndex = Array.from(indexMap.values());
    if (changed) saveIndex();
    else console.log(`[INDEX] Loaded ${listsIndex.length} lists.`);
}

function saveIndex() {
    fs.promises.writeFile(LISTS_INDEX_FILE, JSON.stringify(listsIndex)).catch(e => console.error("Index save failed", e));
}
function updateIndex(id, metadata) {
    const idx = listsIndex.findIndex(i => i.id === id);
    if (idx !== -1) listsIndex[idx] = { ...listsIndex[idx], ...metadata };
    else listsIndex.push(metadata);
    saveIndex();
}
function removeFromIndex(id) {
    listsIndex = listsIndex.filter(i => i.id !== id);
    saveIndex();
}
loadOrRebuildIndex();

// --- Yjs Logic ---
const docs = new Map();
// Helpers
const loadDoc = async (docname) => {
    const filePath = path.join(DATA_DIR, `${docname}.yjs`);
    if (fs.existsSync(filePath)) {
        try {
            return new Uint8Array(await fs.promises.readFile(filePath));
        } catch (e) { console.error("Load failed", e); }
    }
    return null;
};
const saveDoc = async (docname, doc) => {
    const filePath = path.join(DATA_DIR, `${docname}.yjs`);
    const update = Y.encodeStateAsUpdate(doc);
    await fs.promises.writeFile(filePath, Buffer.from(update));
    // Update Index for Dashboard
    updateIndex(docname, {
        lastModified: Date.now(),
        size: update.length
    });
};
const yWriteCache = new Map();
function scheduleYSave(docName, doc) {
    if (yWriteCache.has(docName)) clearTimeout(yWriteCache.get(docName));
    const timer = setTimeout(() => {
        saveDoc(docName, doc);
        manageHistory(docName, doc); // Hook for history
    }, 2000);
    yWriteCache.set(docName, timer);
}

// History Management (Optimized)
const HISTORY_DIR = path.join(DATA_DIR, 'history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR);

async function manageHistory(docName, doc) {
    const historyPath = path.join(HISTORY_DIR, `${docName}.json`);
    const currentText = doc.getText('content').toString();
    const now = Date.now();

    // Load existing metadata or init
    let history = [];
    try {
        if (fs.existsSync(historyPath)) {
            history = JSON.parse(await fs.promises.readFile(historyPath, 'utf8'));
        }
    } catch (e) { }

    // OPTIMIZATION: Strategy
    // 1. Always save if empty (first save)
    // 2. Otherwise, debounce:
    //    - At least 10 minutes between saves OR
    //    - If content changed by > 20% ? (Simpler: just Time-based for now to avoid CPU diffing)

    const lastEntry = history[history.length - 1];
    const MIN_INTERVAL = 10 * 60 * 1000; // 10 Minutes

    let shouldSave = false;

    if (!lastEntry) {
        shouldSave = true;
    } else {
        // Time check
        if (now - lastEntry.timestamp > MIN_INTERVAL) {
            // Content check: Don't save if identical
            if (lastEntry.content !== currentText) {
                shouldSave = true;
            }
        }
    }

    if (shouldSave && currentText.trim().length > 0) {
        history.push({ timestamp: now, content: currentText });
        // Cap history size (e.g. 50 entries)
        if (history.length > 50) history.shift();

        await fs.promises.writeFile(historyPath, JSON.stringify(history));
        console.log(`[HISTORY] Saved snapshot for ${docName}`);
    }
}

const send = (conn, m) => {
    if (conn.readyState !== WebSocket.OPEN) { conn.close(); return; }
    try { conn.send(m); } catch (e) { conn.close(); }
};

const getYDoc = (docname, gc = true) => {
    return map.setIfUndefined(docs, docname, () => {
        const doc = new Y.Doc({ gc });
        doc.loaded = false;
        doc.conns = new Map();
        doc.awareness = new awarenessProtocol.Awareness(doc);
        doc.awareness.setLocalState(null);
        doc.on('update', (update, origin, doc) => {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 0);
            syncProtocol.writeUpdate(encoder, update);
            const message = encoding.toUint8Array(encoder);
            doc.conns.forEach((_, conn) => send(conn, message));
            if (doc.loaded) scheduleYSave(docname, doc);
        });
        loadDoc(docname).then(update => {
            if (update) Y.applyUpdate(doc, update);
            doc.loaded = true;
        });
        doc.awareness.on('update', ({ added, updated, removed }, origin) => {
            const changedClients = added.concat(updated).concat(removed);
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 1);
            awarenessProtocol.writeAwarenessUpdate(encoder, doc.awareness, changedClients);
            const buff = encoding.toUint8Array(encoder);
            doc.conns.forEach((_, conn) => send(conn, buff));
        });
        return doc;
    });
};

const messageListener = (conn, doc, message) => {
    try {
        const encoder = encoding.createEncoder();
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        switch (messageType) {
            case 0:
                encoding.writeVarUint(encoder, 0);
                syncProtocol.readSyncMessage(decoder, encoder, doc, null);
                if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
                break;
            case 1:
                awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
                break;
        }
    } catch (err) { doc.emit('error', [err]); }
};

wss.on('connection', (conn, req) => {
    conn.binaryType = 'arraybuffer';
    try {
        const docName = req.url.slice(1).split('?')[0].replace('yjs/', '');
        const doc = getYDoc(docName);
        doc.conns.set(conn, new Set());
        conn.on('message', message => messageListener(conn, doc, new Uint8Array(message)));
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeSyncStep1(encoder, doc);
        send(conn, encoding.toUint8Array(encoder));
        const awarenessStates = doc.awareness.getStates();
        if (awarenessStates.size > 0) {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 1);
            awarenessProtocol.writeAwarenessUpdate(encoder, doc.awareness, Array.from(awarenessStates.keys()));
            send(conn, encoding.toUint8Array(encoder));
        }
        conn.on('close', () => {
            doc.conns.delete(conn);
            awarenessProtocol.removeAwarenessStates(doc.awareness, [doc.awareness.clientID], null);
        });
    } catch (e) { conn.close(); }
});
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

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
    // TODO: Implement via Yjs awareness if needed

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

    const historyPath = path.join(HISTORY_DIR, `${listId}.json`);
    let history = [];
    if (fs.existsSync(historyPath)) {
        try {
            history = JSON.parse(await fs.promises.readFile(historyPath, 'utf8'));
        } catch (e) { }
    }
    // Reverse for UI (Newest first)
    res.json(history.slice().reverse());
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

                // Generate Description (Strip HTML)
                let description = "A collaborative list on Live-List.";
                if (isPublic && listData.content) {
                    // Simple regex strip (sufficient for basic previews)
                    const plainText = listData.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    description = plainText.substring(0, 150) + (plainText.length > 150 ? '...' : '');
                } else if (!isPublic) {
                    description = "🔒 Private List";
                }

                // Replace Manifest & Title
                let modifiedHtml = html.replace(
                    '<link rel="manifest" href="/manifest.json">',
                    `<link rel="manifest" href="/api/manifest/${listId}">`
                );

                modifiedHtml = modifiedHtml.replace(
                    '<title>Live-List</title>',
                    `<title>${title}</title>`
                );

                // Inject Open Graph Tags
                const ogTags = `
    <meta property="og:type" content="website">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description.replace(/"/g, '&quot;')}">
    <meta property="og:url" content="${req.protocol}://${req.get('host')}/${listId}">
    <meta property="og:site_name" content="Live-List">
                `;

                // Insert before </head>
                modifiedHtml = modifiedHtml.replace('</head>', `${ogTags}</head>`);

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
    // Check disk directly


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
