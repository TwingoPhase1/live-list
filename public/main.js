
import * as Y from 'https://esm.sh/yjs@13.6.8';
import { WebsocketProvider } from 'https://esm.sh/y-websocket@1.5.0?deps=yjs@13.6.8';
import Quill from 'https://esm.sh/quill@1.3.7';
import { QuillBinding } from 'https://esm.sh/y-quill@0.1.5?deps=yjs@13.6.8';

// Setup Yjs
const doc = new Y.Doc();
const roomId = window.location.pathname.split('/').pop();
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsProvider = new WebsocketProvider(
    `${protocol}//${window.location.host}/yjs`,
    roomId,
    doc
);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
}

const yText = doc.getText('content');

// Status & Presence
const statusDiv = document.getElementById('status');
const presenceDiv = document.getElementById('presence');
const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Init Status
if (window.listData && window.listData.lastModified) {
    statusDiv.textContent = `Last modified: ${formatTime(window.listData.lastModified)}`;
} else {
    statusDiv.textContent = 'Synced';
}

wsProvider.on('status', event => {
    if (event.status === 'connected') {
        statusDiv.style.opacity = '1';
        statusDiv.style.color = 'var(--status-color)';
    } else {
        // Disconnected: Dim only, no red color (User Request)
        statusDiv.style.color = 'var(--status-color)';
        statusDiv.style.opacity = '0.5';
    }
});

const updatePresence = () => {
    const count = wsProvider.awareness.getStates().size || 1;
    presenceDiv.style.display = 'inline-flex';
    presenceDiv.style.visibility = 'visible';
    presenceDiv.textContent = `🟢 ${count} online`;
    presenceDiv.classList.remove('hidden');
};

wsProvider.awareness.on('change', updatePresence);
updatePresence();

// "Saving..." Logic
let saveTimeout;
doc.on('update', () => {
    statusDiv.textContent = 'Saving...';
    // FORCE reset to default color when saving to prevent "Red Flicker" if previously error
    statusDiv.style.color = 'var(--status-color)';

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        statusDiv.textContent = `Saved at ${formatTime(Date.now())}`;
    }, 800);
});

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://cdn.quilljs.com/1.3.6/quill.snow.css';
document.head.appendChild(link);

// Custom Blots
const Embed = Quill.import('blots/embed');
class QtyBlot extends Embed {
    static create(value) {
        const node = super.create();
        node.setAttribute('contenteditable', 'false');
        node.setAttribute('data-value', value);
        node.innerHTML = `<span class="val">${value}</span><div class="controls"><span class="btn-inc">▲</span><span class="btn-dec">▼</span></div>`;
        return node;
    }
    static value(node) { return node.getAttribute('data-value'); }
}
QtyBlot.blotName = 'qty';
QtyBlot.tagName = 'span';
QtyBlot.className = 'qty-badge';
Quill.register(QtyBlot);

// Init Quill
const quill = new Quill('#editor', {
    theme: 'bubble',
    modules: {
        toolbar: false,
        clipboard: {
            matchVisual: false
        },
        keyboard: {
            bindings: {
                tab: {
                    key: 9,
                    handler: function (range, context) {
                        this.quill.format('indent', '+1');
                    }
                },
                'shift+tab': {
                    key: 9,
                    shiftKey: true,
                    handler: function (range, context) {
                        this.quill.format('indent', '-1');
                    }
                },
                'enter': {
                    key: 13,
                    handler: function (range, context) {
                        // Custom List Continuation Logic (Dashes Only)
                        const [line, offset] = this.quill.getLine(range.index);
                        const lineText = line.domNode.textContent;

                        // Check for dashes only (User Request: "pas pour les case")
                        const dashMatch = lineText.match(/^➖\s/);

                        if (dashMatch) {
                            const prefix = "➖ ";

                            // 1. If line is JUST the prefix (empty list item), delete it to exit list
                            if (lineText.trim() === prefix.trim()) {
                                this.quill.deleteText(range.index - lineText.length, lineText.length);
                                // Default enter behavior will happen? No, we need to manually insert newline if we want connection? 
                                // Actually, if we delete the prefix, we just want a clean newline? 
                                // GDocs behavior: Hit enter on empty bullet -> Bullet removed, cursor behaves like normal text on SAME line? 
                                // Or does it move down? Usually removes indentation/bullet on same line.
                                return false; // Prevent default newline if we want to stay on line? 
                                // Let's just remove text and let default execution happen? 
                                // Quills default enter splits lines. 
                                // Let's simplify: Delete line content, leaving empty line.
                            }

                            // 2. Normal Continuation
                            this.quill.insertText(range.index, '\n' + prefix, 'user');
                            this.quill.setSelection(range.index + prefix.length + 1);
                            return false; // Prevent default Enter
                        }
                        return true; // Propagate to default handler
                    }
                },
                'bold': {
                    key: 'B',
                    shortKey: true,
                    handler: function (range, context) {
                        this.quill.format('bold', !context.format.bold);
                    }
                },
                'italic': {
                    key: 'I',
                    shortKey: true,
                    handler: function (range, context) {
                        this.quill.format('italic', !context.format.italic);
                    }
                },
                'underline': {
                    key: 'U',
                    shortKey: true,
                    handler: function (range, context) {
                        this.quill.format('underline', !context.format.underline);
                    }
                },
                'strikethrough': {
                    key: 'S',
                    shortKey: true,
                    shiftKey: true,
                    handler: function (range, context) {
                        this.quill.format('strike', !context.format.strike);
                    }
                }
            }
        }
    },
    placeholder: 'Start typing your list here...'
});



// FIX: Backspace handling for blocks (Global Listener)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
        const range = quill.getSelection();
        if (range && range.length === 0) { // Has focus and is caret
            const [line, offset] = quill.getLine(range.index);

            if (offset === 0) {
                const fmt = quill.getFormat(range); // Use range object for better context

                if (fmt['header'] || fmt['blockquote'] || fmt['code-block'] || fmt['list']) {
                    e.preventDefault();
                    e.stopImmediatePropagation();

                    // Use explicit formatLine to ensure it applies to the block
                    const currentIndex = range.index;
                    setTimeout(() => {
                        quill.formatLine(currentIndex, 1, 'header', false);
                        quill.formatLine(currentIndex, 1, 'blockquote', false);
                        quill.formatLine(currentIndex, 1, 'code-block', false);
                        quill.formatLine(currentIndex, 1, 'list', false);
                        quill.update('user');
                    }, 1);
                }
            }
        }
    }
}, true); // Capture phase on document

// Track last valid selection to handle button clicks gracefully
let lastSelection = null;
quill.on('selection-change', (range) => {
    if (range) lastSelection = range;
});

// MARKDOWN LOGIC via TEXT-CHANGE (Most Robust Method)
quill.on('text-change', (delta, oldDelta, source) => {
    if (source !== 'user') return;

    // Check if the insertion was a space
    // Standard typing: delta = { retain: N, insert: " " }
    // Or at start: delta = { insert: " " }

    // Check if the insertion was a space OR a paste (longer string)
    let index = 0;
    let shouldCheck = false;
    let checkIndex = -1;

    delta.ops.forEach(op => {
        if (op.retain) {
            index += op.retain;
        } else if (op.insert) {
            if (typeof op.insert === 'string') {
                // Trigger on Space OR if it looks like a paste (checking end of insert)
                if (op.insert === ' ' || op.insert.endsWith(' ') || op.insert.length > 1) {
                    shouldCheck = true;
                    // Check the end of the insertion point
                    checkIndex = index + op.insert.length;
                }
            }
            index += op.insert.length || 1;
        }
    });

    if (shouldCheck && checkIndex !== -1) {
        const index = checkIndex;
        // logical cursor position after space

        const [line, offset] = quill.getLine(index);
        const lineStart = index - offset;
        const textLen = offset;

        if (textLen < 1) return;

        const textBefore = quill.getText(lineStart, textLen);

        // --- Helpers ---
        const replaceLineStart = (len, fmt) => {
            // Delete the trigger text first
            quill.deleteText(lineStart, len + 1); // delete trigger + space

            // If it's a simple text replacement (symbol), insert immediately
            if (typeof fmt === 'string') {
                quill.insertText(lineStart, fmt);
            }
            // If it's a Block Format (Header, List, etc.), wait for Yjs/DOM to settle
            else if (typeof fmt === 'object') {
                setTimeout(() => {
                    // Force a selection update to ensure Quill state is clean
                    const s = quill.getSelection();
                    quill.formatLine(lineStart, 1, fmt.format, fmt.value);
                    if (s) quill.setSelection(s);
                }, 50); // Increased delay to 50ms to prevent "reading 'emit'" crash
            }
        };

        // NEW: Replace Suffix (for stacking tools)
        // Replaces text ending at the current cursor position (index)
        const replaceSuffix = (len, str) => {
            const startPos = index - len; // Start of the trigger text
            quill.deleteText(startPos, len + 1); // delete trigger + space
            quill.insertText(startPos, str + ""); // Insert emoji + space 
        };

        const replaceInline = (regex, format, value = true) => {
            const match = textBefore.match(regex);
            if (match) {
                const fullMatch = match[0];
                const innerText = match[1];
                const matchLen = fullMatch.length;
                const matchIndex = index - matchLen;

                setTimeout(() => {
                    quill.deleteText(matchIndex, matchLen + 1); // delete **word** + space
                    quill.insertText(matchIndex, innerText, format, value);
                    // Critical Fix: Insert space with NO formatting to stop the leak
                    quill.insertText(matchIndex + innerText.length, ' ', format, false);
                    // Double safety: Remove format at cursor
                    quill.format(format, false);
                    quill.setSelection(matchIndex + innerText.length + 1);
                }, 0);
                return true;
            }
            return false;
        };

        // --- Line Triggers & Switching ---

        // Checkboxes: "[] " - Allow stacking (match at end)
        // Match start of line OR space, followed by []
        const boxMatch = textBefore.match(/(?:^|\s)(\[\])$/);
        if (boxMatch) {
            playSound('snap'); // Trigger Snap sound
            return replaceSuffix(2, "⬜ ");
        }

        // Checked Box: "[x] "
        const checkedMatch = textBefore.match(/(?:^|\s)(\[x\])$/);
        if (checkedMatch) {
            return replaceSuffix(3, "✅ ");
        }

        // Dash Bullet: "- "
        const dashMatch = textBefore.match(/(?:^|\s)(-)$/);
        if (dashMatch) {
            return replaceSuffix(1, "➖ ");
        }

        // Standard Block Triggers (Headers, Quotes, etc.) - Regex with space check
        // Because 'textBefore' includes the space/trigger now? 
        // Logic: logic cursor is AFTER the inserted text.
        // If we pasted "# Title", checkIndex is at end.
        // textBefore for "# Title" would be "# Title".
        // We need to check the START of the line.

        const lineText = textBefore;

        // Headers: "# ", "## ", "### "
        if (/^#\s$/.test(lineText)) return replaceLineStart(2, { format: 'header', value: 1 }); // Typed "# "
        if (/^##\s$/.test(lineText)) return replaceLineStart(3, { format: 'header', value: 2 });
        if (/^###\s$/.test(lineText)) return replaceLineStart(4, { format: 'header', value: 3 });

        // If pasted "# Title", lineText is "# Title" (or subset if textLen limited)
        // But 'replaceLineStart' relies on deleting 'len'.
        // Let's check regex against the START of lineText.

        if (lineText.startsWith('# ')) return replaceLineStart(1, { format: 'header', value: 1 });
        if (lineText.startsWith('## ')) return replaceLineStart(2, { format: 'header', value: 2 });
        if (lineText.startsWith('### ')) return replaceLineStart(3, { format: 'header', value: 3 });
        if (lineText.startsWith('> ')) return replaceLineStart(1, { format: 'blockquote', value: true });
        if (lineText.startsWith('1. ')) return replaceLineStart(2, { format: 'list', value: 'ordered' });
        if (lineText.startsWith('* ')) return replaceLineStart(1, { format: 'list', value: 'bullet' });

        // Horizontal Rule (Strict Line Start)
        if (textBefore === '---') {
            setTimeout(() => {
                quill.deleteText(lineStart, 4);
                quill.insertText(lineStart, "─────────────────");
            }, 0);
            return;
        }

        // Code Block
        if (textBefore === '```') return replaceLineStart(3, { format: 'code-block', value: true });

        // --- Inline Triggers ---
        if (replaceInline(/\*\*([^*]+)\*\*$/, 'bold')) return;
        if (replaceInline(/\*([^*]+)\*$/, 'italic')) return;
        if (replaceInline(/~~([^~]+)~~$/, 'strike')) return;
        if (replaceInline(/`([^`]+)`$/, 'code')) return;

        // Links
        const linkMatch = textBefore.match(/\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
            const fullMatch = linkMatch[0];
            const text = linkMatch[1];
            const url = linkMatch[2];
            const matchLen = fullMatch.length;
            const matchIndex = index - matchLen;

            setTimeout(() => {
                quill.deleteText(matchIndex, matchLen + 1);
                quill.insertText(matchIndex, text, 'link', url);
                quill.insertText(matchIndex + text.length, ' ');
                quill.setSelection(matchIndex + text.length + 1);
            }, 0);
            return;
        }

        // Qty Badge (legacy support - switchable?)
        // Allow stacking: match at end of string
        const qtyMatch = textBefore.match(/(?:^|\s)\[(\d+)\]$/);
        if (qtyMatch) {
            const numText = qtyMatch[1];
            const fullLen = numText.length + 2; // [ + num + ]

            setTimeout(() => {
                const sPos = index - fullLen;
                quill.deleteText(sPos, fullLen + 1);
                quill.insertEmbed(sPos, 'qty', parseInt(numText));
                quill.insertText(sPos + 1, ' ');
                quill.setSelection(sPos + 2); // Correct cursor position: After badge + space
                playSound('ding'); // Ding!
            }, 0);
            return;
        }
    }
});


// --- Gamification (Audio) ---
// Lazy-load AudioContext to comply with browser autoplay policies
let audioCtx = null;

const initAudio = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
};

const playSound = (type = 'pop') => {
    if (!audioCtx) initAudio();
    if (!audioCtx) return; // Fallback

    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    if (type === 'pop') { // Check
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === 'inc') { // Qty Up
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.linearRampToValueAtTime(600, t + 0.1);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === 'dec') { // Qty Down
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.linearRampToValueAtTime(200, t + 0.1);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === 'ding') { // New Qty
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
    } else if (type === 'snap') { // Insert Checkbox (Crisp Click)
        osc.type = 'square';
        osc.frequency.setValueAtTime(1500, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.05);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.start(t);
        osc.stop(t + 0.05);
    } else if (type === 'unpop') { // Uncheck (Soft Release)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.linearRampToValueAtTime(100, t + 0.1);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    }

    osc.connect(gain);
    gain.connect(audioCtx.destination);
};

// Initialize Audio on first interaction
document.addEventListener('click', initAudio, { once: true });
document.addEventListener('keydown', initAudio, { once: true });


// Interactivity
document.querySelector('#editor').addEventListener('click', (e) => {
    // Qty
    if (e.target.classList.contains('btn-inc') || e.target.classList.contains('btn-dec')) {
        const badge = e.target.closest('.qty-badge');
        if (!badge) return;
        const blot = Quill.find(badge);
        if (!blot) return;
        let currentVal = parseInt(badge.getAttribute('data-value'));
        if (isNaN(currentVal)) currentVal = 1;
        const index = quill.getIndex(blot);

        if (e.target.classList.contains('btn-inc')) {
            currentVal++;
            playSound('inc');
        } else {
            currentVal--;
            if (currentVal < 0) currentVal = 0;
            playSound('dec');
        }
        quill.deleteText(index, 1);
        quill.insertEmbed(index, 'qty', currentVal);
        quill.setSelection(index + 1);
        return;
    }

    // Checkbox
    const range = quill.getSelection();
    if (range) {
        // Simple toggle check
        const cursor = range.index;
        const lookBack = Math.max(0, cursor - 2);
        const text = quill.getText(lookBack, 5);
        if (text.includes('⬜')) {
            const pos = lookBack + text.indexOf('⬜');
            // toggle
            quill.deleteText(pos, 2);
            quill.insertText(pos, "✅ ");
            quill.setSelection(pos + 2);
            playSound('pop');
        } else if (text.includes('✅')) {
            const pos = lookBack + text.indexOf('✅');
            quill.deleteText(pos, 2);
            quill.insertText(pos, "⬜ ");
            quill.setSelection(pos + 2);
            playSound('unpop'); // New Sound
        }
    }
});

const binding = new QuillBinding(yText, quill, wsProvider.awareness);

// Toolbar Buttons
const btnBullet = document.getElementById('btn-bullet');
const btnCheck = document.getElementById('btn-check');
const btnQty = document.getElementById('btn-qty');
const handleToolbarBtn = (btn, action) => {
    if (!btn) return;
    btn.onmousedown = (e) => {
        e.preventDefault(); // Prevent focus loss

        let range = quill.getSelection();
        if (!range && lastSelection) {
            range = lastSelection;
            // Optionally re-focus to show cursor
            quill.setSelection(range.index, range.length);
        }

        if (range) {
            action(range.index);
        } else {
            // No selection, focusing editor at end...
            quill.focus();
            const len = quill.getLength();
            quill.setSelection(len, 0);
            action(len);
        }
    };
};

if (btnBullet) handleToolbarBtn(btnBullet, (idx) => quill.insertText(idx, "➖ "));
if (btnCheck) handleToolbarBtn(btnCheck, (idx) => {
    quill.insertText(idx, "⬜ ");
    playSound('snap'); // Insertion Sound
});
if (btnQty) handleToolbarBtn(btnQty, (idx) => {
    quill.insertEmbed(idx, 'qty', 1);
    quill.insertText(idx + 1, ' ');
    quill.setSelection(idx + 2); // Set cursor AFTER [1] + space
    playSound('ding');
});

// --- UI Visibility ---
const btnHistory = document.getElementById('btn-history');
const btnShare = document.getElementById('btn-share');
const btnAdmin = document.getElementById('btn-admin-title');
const navReturn = document.querySelector('.nav-return');

// 1. DEFAULT: HIDE ALL BUTTONS
if (btnHistory) btnHistory.style.display = 'none';
if (btnShare) btnShare.style.display = 'none';
if (btnAdmin) btnAdmin.style.display = 'none';
if (navReturn) navReturn.style.display = 'none';

// 2. ONLY SHOW IF ADMIN
if (window.listData && window.listData.isAdmin) {
    if (navReturn) navReturn.style.display = 'inline-flex';
    if (btnHistory) btnHistory.style.display = 'flex';
    if (btnShare) btnShare.style.display = 'flex';

    // Share Logic
    if (btnShare) {
        const isPublic = window.listData.public;
        btnShare.setAttribute('data-public', isPublic);
        btnShare.innerText = isPublic ? 'Everyone 🌎' : 'Private 🔒';
        btnShare.onclick = async () => {
            const newState = !window.listData.public;
            try {
                await fetch('/api/lists/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: roomId, public: newState })
                });
                window.location.reload();
            } catch (e) { }
        };
    }

    // History Logic
    if (btnHistory) {
        btnHistory.onclick = async () => {
            const historyModal = document.getElementById('history-modal');
            historyModal.classList.remove('hidden');
            const list = document.getElementById('history-list');
            list.innerHTML = 'Loading...';
            try {
                const res = await fetch(`/api/lists/${roomId}/history`);
                const data = await res.json();
                list.innerHTML = '';
                if (!data.length) list.innerHTML = 'No history.';
                data.forEach(entry => {
                    const d = document.createElement('div');
                    d.style.padding = '10px'; d.style.borderBottom = '1px solid #eee'; d.style.cursor = 'pointer';
                    d.innerHTML = `<b>${new Date(entry.timestamp).toLocaleString()}</b><br><small>${entry.content.substring(0, 50)}</small>`;
                    d.onclick = () => {
                        if (confirm("Append?")) {
                            quill.insertText(quill.getLength(), "\n\n--- RESTORED ---\n" + entry.content);
                            historyModal.classList.add('hidden');
                        }
                    };
                    list.appendChild(d);
                });
            } catch (e) { list.innerHTML = 'Error'; }
        };
        document.getElementById('close-history').onclick = () => document.getElementById('history-modal').classList.add('hidden');
    }

    // Admin Tag Logic
    if (btnAdmin) {
        btnAdmin.style.display = 'flex';
        btnAdmin.innerText = window.listData.adminTitle ? `🏷️ ${window.listData.adminTitle}` : `🏷️`;
        btnAdmin.onclick = async () => {
            const newTitle = prompt("Set Admin Title (Tags):", window.listData.adminTitle || "");
            if (newTitle !== null) {
                try {
                    await fetch('/api/lists/rename-admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: roomId, adminTitle: newTitle })
                    });
                    window.location.reload();
                } catch (e) { }
            }
        };
    }
}

// --- Title Sync Logic ---
const titleInput = document.getElementById('listTitle');
if (titleInput && window.listData) {
    // Initialize Title
    if (window.listData.title) titleInput.value = window.listData.title;

    titleInput.addEventListener('change', async () => {
        const newTitle = titleInput.value.trim();
        if (!newTitle) return;

        try {
            const res = await fetch('/api/lists/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: roomId, title: newTitle })
            });
            if (res.ok) {
                document.title = newTitle; // Update browser tab
                statusDiv.textContent = 'Title Saved.';
                setTimeout(() => statusDiv.textContent = 'Synced', 2000);
            } else {
                statusDiv.textContent = 'Error saving title.';
            }
        } catch (e) {
            console.error(e);
            statusDiv.textContent = 'Error saving title.';
        }
    });
}

// --- Mobile Swipe for Indentation ---
let touchStartX = 0;
let touchStartY = 0;
const editor = document.getElementById('editor');

editor.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

editor.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;

    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Check for horizontal swipe dominance (X > Y) and threshold
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        if (diffX > 0) {
            // Swipe Right -> Indent
            quill.format('indent', '+1');
        } else {
            // Swipe Left -> Outdent
            quill.format('indent', '-1');
        }
    }
}, { passive: true });


// Injected CSS
const style = document.createElement('style');
// Fix: Ensure placeholder perfectly overlaps cursor position (5px padding = 5px pos)
// Fix: Qty Badge Layout & Visibility (Show on Hover Only)
// Fix: Mobile Admin Layout
style.innerHTML = `
.ql-container{font-family:'Inter',sans-serif;font-size:1rem}
.ql-editor{
    padding: 5px 15px 15px 5px !important; 
    line-height: 1.6;
    color: var(--text-color);
    position: relative; 
    user-select: text !important;
    -webkit-user-select: text !important;
}
.ql-editor.ql-blank::before {
    left: 5px !important;
    top: 5px !important; 
    right: 15px !important; 
    font-style: normal;
    color: var(--secondary-text); 
    opacity: 0.6;
    pointer-events: none; 
}
.ql-editor p{margin:0}
.ql-tooltip{display:none!important}

/* Qty Badge Enhancements */
.qty-badge {
    display: inline-flex !important;
    align-items: center;
    vertical-align: middle;
    margin: 0 4px;
    padding: 0 4px;
    position: relative;
    border: 1px solid transparent; 
    border-radius: 4px;
    transition: background-color 0.2s, border-color 0.2s;
}
.qty-badge:hover {
    background-color: var(--nav-bg);
    border-color: var(--status-color);
}
.qty-badge .val {
    margin-right: 2px;
}
.qty-badge .controls {
    display: none !important; /* HIDDEN BY DEFAULT */
    flex-direction: column;
    margin-left: 2px;
    vertical-align: middle;
}
.qty-badge:hover .controls {
    display: inline-flex !important; /* SHOW ON HOVER */
}
.qty-badge .btn-inc, .qty-badge .btn-dec {
    font-size: 0.6em;
    line-height: 0.8;
    cursor: pointer;
    opacity: 0.5;
    padding: 2px;
}
.qty-badge .btn-inc:hover, .qty-badge .btn-dec:hover {
    opacity: 1;
    font-weight: bold;
    color: var(--text-color);
}

/* Mobile Tweaks */
@media (max-width: 640px) {
    .qty-badge .controls {
        display: inline-flex !important; /* Always show on mobile (no hover) */
        opacity: 0.5;
    }
    .status-bar {
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .nav-admin, .nav-share, .nav-history {
        font-size: 0.75rem; 
        padding: 4px 8px; /* Smaller buttons on mobile to fit */
    }
}
`;
document.head.appendChild(style);
