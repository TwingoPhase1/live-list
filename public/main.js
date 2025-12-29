
import * as Y from 'https://esm.sh/yjs@13.6.8';
import { WebsocketProvider } from 'https://esm.sh/y-websocket@1.5.0';
import Quill from 'https://esm.sh/quill@1.3.7';
import { QuillBinding } from 'https://esm.sh/y-quill@0.1.5';

// Setup Yjs
const doc = new Y.Doc();
// Path: /LIST_ID
const roomId = window.location.pathname.split('/').pop();
const wsProvider = new WebsocketProvider(
    `ws://${window.location.host}/yjs`,
    roomId,
    doc
);

const yText = doc.getText('content');

// Status & Presence
const statusDiv = document.getElementById('status');
const presenceDiv = document.getElementById('presence');

wsProvider.on('status', event => {
    statusDiv.textContent = event.status; // 'connected' or 'disconnected'
    if (event.status === 'connected') {
        statusDiv.style.opacity = '0';
    } else {
        statusDiv.style.opacity = '1';
    }
});

// Awareness
wsProvider.awareness.on('change', () => {
    const count = wsProvider.awareness.getStates().size;
    presenceDiv.textContent = `🟢 ${count} online`;
    presenceDiv.classList.remove('hidden');
});

// Add Quill CSS dynamically
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://cdn.quilljs.com/1.3.6/quill.snow.css';
document.head.appendChild(link);

// Initialize Quill (Bubbles/Hidden)
const quill = new Quill('#editor', {
    theme: 'bubble',
    modules: {
        toolbar: false
    },
    placeholder: 'Start typing your list here...'
});

// Bind Yjs
const binding = new QuillBinding(yText, quill, wsProvider.awareness);

// Custom Button Logic (Map our buttons to Quill API)
const btnBullet = document.getElementById('btn-bullet');
const btnCheck = document.getElementById('btn-check');
const btnQty = document.getElementById('btn-qty');

if (btnBullet) {
    btnBullet.onclick = () => {
        const range = quill.getSelection();
        if (range) quill.insertText(range.index, "➖ ");
    }
}
if (btnCheck) {
    btnCheck.onclick = () => {
        const range = quill.getSelection();
        if (range) quill.insertText(range.index, "⬜ ");
    }
}
if (btnQty) {
    btnQty.onclick = () => {
        // Simple text representation for now to match CRDT
        const range = quill.getSelection();
        if (range) quill.insertText(range.index, "[1] ");
    }
}

// Style Overrides
const style = document.createElement('style');
style.innerHTML = `
    .ql-container { font-family: 'Inter', sans-serif; font-size: 1rem; }
    .ql-editor { padding: 0; }
    .ql-tooltip { display: none !important; }
`;
document.head.appendChild(style);
