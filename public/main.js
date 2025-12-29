const socket = io();
// Socket Connection
const roomId = window.location.pathname.substring(1);

// Security: Handle socket errors (e.g. List not found)
socket.on('error', (msg) => {
    console.error("Socket Error:", msg);
    if (msg === 'List not found') {
        alert("This list does not exist.");
        window.location.href = '/';
    } else if (msg === 'Access Denied') {
        // Redirect to 403 page
        window.location.href = '/403.html'; // Or reload to let server serve it
    }
});

socket.emit('join', roomId);

// UI: Hide Dashboard button if not admin, Handle Share Button
fetch('/api/status')
    .then(r => r.json())
    .then(data => {
        if (!data.authenticated) {
            const navBtn = document.querySelector('.nav-return');
            if (navBtn) navBtn.style.display = 'none';
        } else {
            // Admin is here. Setup Share Button.
            // Admin is here. Setup Share Button.
            const btnShare = document.getElementById('btn-share');
            if (btnShare) {
                btnShare.style.display = 'inline-block';
                // We need to know initial state. socket 'init' gives it.
                btnShare.addEventListener('click', () => {
                    const isPublic = btnShare.textContent.includes('Everyone');
                    const isCurrentlyPublic = btnShare.dataset.public === 'true';

                    fetch('/api/lists/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: roomId, public: !isCurrentlyPublic })
                    }).catch(e => alert("Error toggling share"));
                });
            }

            // Admin is here. Setup History Button.
            const btnHistory = document.getElementById('btn-history');
            if (btnHistory) {
                btnHistory.style.display = 'inline-block';
                btnHistory.addEventListener('click', openHistoryModal);
            }
        }
    })
    .catch(e => console.error("Auth check failed", e));

const editor = document.getElementById('editor');
// Enforce DIV for new lines to prevent merging issues
document.execCommand('defaultParagraphSeparator', false, 'div');

const titleInput = document.getElementById('listTitle'); // Fixed Ref
const statusDiv = document.getElementById('status');
const presenceDiv = document.getElementById('presence');


// Title Update Logic
if (titleInput) {
    titleInput.addEventListener('input', () => {
        const title = titleInput.value;
        document.title = title || 'Live-List';
        socket.emit('updateTitle', { roomId, title });
    });
}

// Admin Title Logic
const adminTitleInput = document.getElementById('adminTitleInput');
const adminTitleContainer = document.getElementById('admin-title-container');

if (adminTitleInput) {
    adminTitleInput.addEventListener('change', () => { // Use change for less spam, or input for realtime
        const adminTitle = adminTitleInput.value;
        // console.log("Updating Admin Title:", adminTitle);
        socket.emit('updateAdminTitle', { roomId, adminTitle });
    });
}

// ...

socket.on('init', (data) => {
    // ...
    if (editor.innerHTML !== data.content) {
        editor.innerHTML = data.content;
    }
    if (data.title) {
        titleInput.value = data.title;
        document.title = data.title;
    }

    // Admin Title (Only present if Admin)
    if (typeof data.adminTitle !== 'undefined') {
        if (adminTitleContainer) adminTitleContainer.style.display = 'block';
        if (adminTitleInput) adminTitleInput.value = data.adminTitle;
    }

    // Update Share Button State
    if (typeof data.public !== 'undefined') {
        updateShareButton(data.public);
    }
});

socket.on('metaUpdate', (data) => {
    // ... (existing)
    if (data.lastModified) console.log("Meta updated");
    if (typeof data.public !== 'undefined') {
        updateShareButton(data.public);
    }
});

function updateShareButton(isPublic) {
    const btnShare = document.getElementById('btn-share');
    if (!btnShare) return;
    btnShare.dataset.public = isPublic; // Store state

    // Force redraw layout
    btnShare.innerHTML = isPublic ? '🌍 Everyone' : '🔒 Admins Only';
    btnShare.title = isPublic ? 'Public (Click to limit to Admins)' : 'Private (Click to share with everyone)';

    // Visual feedback handling is now done via CSS based on dataset
    if (isPublic) {
        btnShare.style.removeProperty('color');
    } else {
        btnShare.style.removeProperty('color');
    }
}

// --- Gamification (Audio) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playPopSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

// --- Sync Logic ---

// Read-Only Check
const urlParams = new URLSearchParams(window.location.search);
const isReadOnly = urlParams.get('view') === 'true';

if (isReadOnly) {
    editor.setAttribute('contenteditable', 'false');
    titleInput.setAttribute('disabled', 'true'); // Disable Title
    document.querySelector('.toolbar').style.display = 'none';
    statusDiv.textContent = '🔒 Read-Only Mode';
    statusDiv.style.opacity = '1';
    document.body.classList.add('read-only');
}

function updateLastModified(ts) {
    if (!ts) return;
    const date = new Date(ts);
    const timeStr = date.toLocaleTimeString();
    if (!isReadOnly) {
        statusDiv.textContent = `Last modified: ${timeStr}`;
        statusDiv.style.opacity = '1';
        setTimeout(() => { if (statusDiv.textContent.includes('Last')) statusDiv.style.opacity = '0.5'; }, 2000);
    }
}

socket.on('init', (data) => {
    editor.innerHTML = data.content; // Use innerHTML
    if (data.title) {
        titleInput.value = data.title;
        document.title = `${data.title} | Live-List`;
    }

    if (!isReadOnly) {
        statusDiv.textContent = 'Connected. Synced.';
        setTimeout(() => { statusDiv.style.opacity = '0'; }, 2000);
    }
    // Update metadata if present
    if (data.lastModified) {
        updateLastModified(data.lastModified);
    }
    updatePlaceholders(); // Verify placeholders on load
});

socket.on('metaUpdate', (data) => {
    updateLastModified(data.lastModified);
});

socket.on('userCount', (count) => {
    presenceDiv.classList.remove('hidden');
    presenceDiv.textContent = `🟢 ${count} online`;
});

socket.on('sync', (data) => {
    // Save cursor position (Best effort for ContentEditable)
    const savedSel = saveSelection(editor);

    editor.innerHTML = data.content;

    // Restore cursor
    restoreSelection(editor, savedSel);

    if (!isReadOnly) {
        statusDiv.style.opacity = '1';
        statusDiv.textContent = 'Updated';
        setTimeout(() => { statusDiv.style.opacity = '0'; }, 2000);
    }

    // Optional: play sound on remote update? No, might be annoying.
    updatePlaceholders(); // Check placeholders after remote sync
});



function emitUpdate() {
    const content = editor.innerHTML;
    socket.emit('update', { roomId, content });

    statusDiv.style.opacity = '1';
    statusDiv.textContent = 'Saving...';
}

// --- Cursor Management (Complex for ContentEditable) ---
// Cursor Management
// Save char offset relative to text content

function saveSelection(containerEl) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(containerEl);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    return { start, end: start + range.toString().length };
}



function restoreSelection(containerEl, savedSel) {
    if (!savedSel) return;
    const charIndex = savedSel.start;
    const range = document.createRange();
    range.setStart(containerEl, 0);
    range.collapse(true);

    const nodeStack = [containerEl];
    let node, foundStart = false, stop = false;
    let charCount = 0;

    // Traverse DOM to find text node at charIndex
    while (!stop && (node = nodeStack.pop())) {
        if (node.nodeType === 3) {
            const nextCharCount = charCount + node.length;
            if (!foundStart && charIndex >= charCount && charIndex <= nextCharCount) {
                range.setStart(node, charIndex - charCount);
                range.collapse(true); // Just collapse to start for simplicity
                foundStart = true;
                stop = true;
            }
            charCount = nextCharCount;
        } else {
            let i = node.childNodes.length;
            while (i--) {
                nodeStack.push(node.childNodes[i]);
            }
        }
    }

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

// --- Markdown Shortcuts (Notion-like) ---
editor.addEventListener('input', (e) => {
    // Check patterns only if last char was space
    if (e.data === ' ') {
        checkMarkdownShortcuts();
    }
    emitUpdate();
});

function checkMarkdownShortcuts() {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;

    const node = sel.anchorNode;
    // We only care about text nodes
    if (node.nodeType !== 3) return;

    const text = node.textContent;
    const offset = sel.anchorOffset;

    // Look at text BEFORE cursor
    const beforeRaw = text.substring(0, offset);

    // Patterns -> Replacements
    // 1. Dash "- " -> "➖ "
    if (beforeRaw.endsWith('- ')) {
        replaceShortcut(node, offset, 2, '➖ ');
        return;
    }

    // 2. Checkbox "[] " -> "⬜ "
    if (beforeRaw.endsWith('[] ')) {
        replaceShortcut(node, offset, 3, '⬜ ');
        return;
    }

    // 3. Headings "# " -> H1, "## " -> H2, "### " -> H3
    if (beforeRaw.endsWith('# ')) {
        const match = beforeRaw.match(/^[\s\u00A0]*(#+) $/);
        if (match) {
            const level = match[1].length;
            if (level <= 3) {
                // Remove the hashes from the current text node first
                // logic: we are at the end of the hashes.
                // We want to remove the chars causing the trigger.
                const range = document.createRange();
                range.setStart(node, offset - (level + 1));
                range.setEnd(node, offset);
                range.deleteContents();

                // Now we have the clean content.
                // We MUST find the block container and swap it.
                // If we don't swap the container, we get nested tags or line-height issues.
                let block = node.parentNode;

                // Climb up until we hit the Editor root or a main block (DIV/P)
                while (block && block.parentNode !== editor && block !== editor) {
                    block = block.parentNode;
                }

                // If for some reason we are at the editor root (orphan text), wrap it
                if (block === editor) {
                    // This shouldn't happen with defaultParagraphSeparator='div', but just in case
                    // We need to wrap the node and its siblings? 
                    // Let's assume the node itself is the target to convert if it's direct child.
                    block = node;
                }

                if (block) {
                    const newHeader = document.createElement('H' + level);
                    newHeader.setAttribute('data-placeholder', 'Heading ' + level);
                    newHeader.classList.add('is-empty');

                    // Move all children from the old block to the new header
                    if (block.nodeType === 3) { // It was a text node
                        newHeader.appendChild(block.cloneNode(true));
                        block.replaceWith(newHeader);
                    } else {
                        // It was a DIV/P
                        // If the block only contained the text node we just emptied, it might be effectively empty now.
                        while (block.firstChild) {
                            newHeader.appendChild(block.firstChild);
                        }
                        block.replaceWith(newHeader);
                    }

                    // CRITICAL FIX: If header is empty (no text), add a BR to hold the line/cursor
                    // This prevents the cursor from "escaping" the H1 tag
                    if (newHeader.textContent.trim() === '') {
                        // Ensure it has a BR if empty
                        if (!newHeader.querySelector('br')) {
                            const br = document.createElement('br');
                            newHeader.appendChild(br);
                        }
                    }

                    // Restore Cursor at the START of the new header (before the BR if exists, or at text start)
                    const sel = window.getSelection();
                    const newRange = document.createRange();
                    newRange.selectNodeContents(newHeader);
                    newRange.collapse(true); // Collapse to START to be safe? Or End?
                    // If we have <br>, end is after <br>? Start is before.
                    // Let's try collapsing to Start, which is 0.

                    sel.removeAllRanges();
                    sel.addRange(newRange);

                    updatePlaceholders();
                }
                return;
            }
        }
    }

    // 4. Quantity "[1] " -> [ 1 ] Badge
    const qtyMatch = beforeRaw.match(/\[(\d+)\] $/);
    if (qtyMatch) {
        const num = qtyMatch[1];
        const length = qtyMatch[0].length;
        const range = document.createRange();
        range.setStart(node, offset - length);
        range.setEnd(node, offset);
        range.deleteContents();
        const badgeHtml = `<span class="qty-badge" contenteditable="false"><span class="val">${num}</span><span class="controls"><span class="btn-inc">▲</span><span class="btn-dec">▼</span></span></span>&nbsp;`;
        insertHtmlAtCursor(badgeHtml);
        return;
    }

    // --- Inline Formatting (Bold, Italic, Strike, Code) ---
    // Look for matching pairs before cursor. 
    // We need to check if we just typed the closing char and a space.
    // Actually, usually users type "**bold** " (space triggers it).

    // Bold: **text** 
    const boldMatch = beforeRaw.match(/\*\*([^\*]+)\*\* $/);
    if (boldMatch) {
        applyInlineFormat(node, offset, boldMatch, 'bold');
        return;
    }

    // Italic: *text* 
    const italicMatch = beforeRaw.match(/\*([^\*]+)\* $/);
    if (italicMatch) {
        applyInlineFormat(node, offset, italicMatch, 'italic');
        return;
    }

    // Strikethrough: ~~text~~
    const strikeMatch = beforeRaw.match(/~~([^~]+)~~ $/);
    if (strikeMatch) {
        applyInlineFormat(node, offset, strikeMatch, 'strikeThrough');
        return;
    }

    // Code: `text`
    const codeMatch = beforeRaw.match(/`([^`]+)` $/);
    if (codeMatch) {
        // execCommand 'fontName' -> monospace? Or insert HTML.
        // Let's use custom replacement to wrap in <code>
        const text = codeMatch[1];
        const matchLen = codeMatch[0].length;

        const range = document.createRange();
        range.setStart(node, offset - matchLen);
        range.setEnd(node, offset);
        range.deleteContents();

        // Insert coded font style
        // We can use execCommand('fontName', false, 'monospace') but creating a span/code tag is better styling.
        const codeHtml = `<code style="background:rgba(0,0,0,0.1); padding:2px 4px; border-radius:4px; font-family:monospace;">${text}</code>&nbsp;`;
        insertHtmlAtCursor(codeHtml);
        return;
    }
}

function applyInlineFormat(node, offset, match, command) {
    const text = match[1];
    const matchLen = match[0].length;

    // Select the raw markdown text (e.g. **foo** )
    const range = document.createRange();
    range.setStart(node, offset - matchLen);
    range.setEnd(node, offset); // Includes the trailing space

    // Delete it
    range.deleteContents(); // Cursor is now at split point

    // Insert simple text
    // We need to insert text, select it, then execCommand
    // BUT execCommand acts on selection.

    // Create a temporary span for insertion to avoid merging issues?
    // Simpler: execCommand('insertText', false, text + ' '); then select back and bold?
    // or:
    document.execCommand('insertHTML', false, `<span>${text}</span>&nbsp;`);

    // Select the inserted text (minus the space) to format it
    // This is tricky because insertHTML might merge nodes.
    // Alternative: Use <b> tag injection directly.

    // RE-DO: Just inject the formatted HTML directly.
    let html = '';
    if (command === 'bold') html = `<b>${text}</b>&nbsp;`;
    if (command === 'italic') html = `<i>${text}</i>&nbsp;`;
    if (command === 'strikeThrough') html = `<s>${text}</s>&nbsp;`;

    // Undo the previous insertHTML attempt logic above? No, let's rewrite the logic block.
    // We deleted contents. Now just insert properly.
    insertHtmlAtCursor(html);
}

function replaceShortcut(node, cursorOffset, lengthToRemove, newText) {
    const text = node.textContent;
    const start = cursorOffset - lengthToRemove;
    const before = text.substring(0, start);
    const after = text.substring(cursorOffset);

    node.textContent = before + newText + after;

    // Restore cursor position
    const sel = window.getSelection();
    const range = document.createRange();
    // New cursor pos = start + newText.length
    range.setStart(node, start + newText.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

// --- Smart Features ---

const btnBullet = document.getElementById('btn-bullet');
const btnCheck = document.getElementById('btn-check');
const btnQty = document.getElementById('btn-qty');


// Cursor Persistence Logic
let savedRange = null;

document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    // Only save if selection is inside the editor
    if (sel.rangeCount > 0) {
        let node = sel.anchorNode;
        if (editor.contains(node)) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }
    }
});

// Robust Insert Function
function insertHtmlAtCursor(html) {
    editor.focus();

    // Attempt to restore saved range if current selection is invalid (e.g. focus lost)
    const sel = window.getSelection();
    if ((!sel.rangeCount || !editor.contains(sel.anchorNode)) && savedRange) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
    }

    // 1. Try Standard execCommand (Most reliable for preservation of undo stack)
    // Note: 'insertHTML' is supported in almost all browsers for contenteditable
    const success = document.execCommand('insertHTML', false, html);

    if (!success) {
        // 2. Fallback: Manual Range Manipulation
        console.warn("execCommand failed, using range fallback");
        if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();

            const el = document.createElement("div");
            el.innerHTML = html;
            let frag = document.createDocumentFragment(), node, lastNode;
            while ((node = el.firstChild)) {
                lastNode = frag.appendChild(node);
            }
            range.insertNode(frag);

            // Move cursor after
            if (lastNode) {
                range.setStartAfter(lastNode);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        } else {
            // 3. Last Resort: Append to end

            const el = document.createElement("div");
            el.innerHTML = html;
            let frag = document.createDocumentFragment(), node;
            while ((node = el.firstChild)) frag.appendChild(node);

            // Check if last child is a block (div) to append INSIDE it
            if (editor.lastElementChild && editor.lastElementChild.nodeName === 'DIV') {
                // Clean up trailing BR
                const targetDiv = editor.lastElementChild;
                if (targetDiv.lastElementChild && targetDiv.lastElementChild.nodeName === 'BR') {
                    targetDiv.lastElementChild.remove();
                }
                targetDiv.appendChild(frag);
                // Move cursor to end of that div
                const range = document.createRange();
                range.selectNodeContents(targetDiv);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                editor.appendChild(frag);
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }

    normalizeListStructure();
    emitUpdate();
}

// Helper: Merge orphans (inline elements directly in root after a block) back into the block
function normalizeListStructure() {
    let node = editor.firstChild;
    while (node) {
        const next = node.nextSibling;

        // If current is DIV and next is SPAN (Badge) or Text 
        if (node.nodeName === 'DIV' && next) {
            const isOrphan = (next.nodeName === 'SPAN' && next.classList.contains('qty-badge')) ||
                (next.nodeType === 3 && next.textContent.trim() !== ''); // Text with something

            if (isOrphan) {
                console.log("Normalizing orphan node into previous DIV", next);
                // Move next inside node
                // Remove trailing BR from DIV if present before appending
                if (node.lastChild && node.lastChild.nodeName === 'BR') {
                    node.lastChild.remove();
                }
                node.appendChild(next);
                // Update cursor if it was in the moved node? 
                // (Browser handles selection inside moved nodes usually, but let's be safe)

                // Restart loop or re-check same node? 
                // next is now gone (moved). current `node` stays.
                // We should continue checking `node`'s new nextSibling
                continue;
            }
        }
        node = next;
    }
}

// Button Logic - Dual Listener Pattern
// 1. 'mousedown': Prevent Default to STOP focus loss (Keep cursor in editor)
// 2. 'click': Trigger the action
const buttons = [btnBullet, btnCheck, btnQty];
buttons.forEach(btn => {
    if (btn) {
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
            if (btn === btnBullet) insertHtmlAtCursor('➖&nbsp;');
            if (btn === btnCheck) insertHtmlAtCursor('⬜&nbsp;');
            if (btn === btnQty) {
                const badgeHtml = `<span class="qty-badge" contenteditable="false"><span class="val">1</span><span class="controls"><span class="btn-inc">▲</span><span class="btn-dec">▼</span></span></span>&nbsp;`;
                insertHtmlAtCursor(badgeHtml);
            }
        });
    }
});

// Event Delegation for Interactions
editor.addEventListener('click', (e) => {
    const target = e.target;

    // 1. Checkbox Toggle Logic (Clicking text characters)
    const sel = window.getSelection();
    if (sel.isCollapsed && sel.anchorNode.nodeType === 3) {
        const node = sel.anchorNode;
        const text = node.textContent;
        const offset = sel.anchorOffset;

        // Check character BEFORE cursor (most common)
        if (offset > 0) {
            const char = text[offset - 1];
            if (char === '⬜' || char === '✅') {
                const newChar = char === '⬜' ? '✅' : '⬜';
                const before = text.substring(0, offset - 1);
                const after = text.substring(offset);
                node.textContent = before + newChar + after;

                // Restore cursor
                const range = document.createRange();
                range.setStart(node, offset);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);

                if (newChar === '✅') playPopSound();
                emitUpdate();
                return;
            }
        }

        // Check character AFTER cursor (rare, left-side click)
        if (offset < text.length) {
            const char = text[offset];
            if (char === '⬜' || char === '✅') {
                const newChar = char === '⬜' ? '✅' : '⬜';
                const before = text.substring(0, offset);
                const after = text.substring(offset + 1);
                node.textContent = before + newChar + after;

                // Restore cursor
                const range = document.createRange();
                range.setStart(node, offset); // Cursor stays before char
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);

                if (newChar === '✅') playPopSound();
                emitUpdate();
                return;
            }
        }
    }

    // 2. Quantity Badge Logic (Stacked)
    const badge = target.closest('.qty-badge');
    if (badge) {
        if (target.classList.contains('btn-inc')) {
            const valSpan = badge.querySelector('.val');
            let val = parseInt(valSpan.innerText);
            valSpan.innerText = val + 1;
            emitUpdate();
            e.stopPropagation();
            return;
        }
        else if (target.classList.contains('btn-dec')) {
            const valSpan = badge.querySelector('.val');
            let val = parseInt(valSpan.innerText);
            if (val > 0) valSpan.innerText = val - 1;
            emitUpdate();
            e.stopPropagation();
            return;
        }
    }
});



// Scroll to change Quantity
editor.addEventListener('wheel', (e) => {
    const target = e.target;
    // Find closest badge
    const badge = target.closest('.qty-badge');

    if (badge) {
        e.preventDefault(); // Stop page scrolling
        const valSpan = badge.querySelector('.val');
        let val = parseInt(valSpan.innerText);

        // Check direction
        if (e.deltaY < 0) {
            // Scroll Up -> Increment
            val++;
        } else {
            // Scroll Down -> Decrement
            if (val > 0) val--;
        }

        valSpan.innerText = val;
        emitUpdate();
    }
}, { passive: false }); // Passive: false required to preventDefault

// Auto-continue (Simpler logic for contenteditable: Enter creates <div> by default)
editor.addEventListener('keydown', (e) => {
    // Indentation Support (Tab / Shift+Tab)
    if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
            document.execCommand('outdent');
        } else {
            document.execCommand('indent');
        }
        emitUpdate();
        return;
    }

    if (e.key === 'Backspace') {
        // Fix: If backspacing in an EMPTY header, convert to paragraph (DIV)
        // because browsers sometimes get stuck in H1s.
        const sel = window.getSelection();
        if (sel.rangeCount) {
            let block = sel.anchorNode;
            while (block && !['H1', 'H2', 'H3', 'DIV', 'P'].includes(block.nodeName) && block !== editor) {
                block = block.parentNode;
            }

            if (block && ['H1', 'H2', 'H3'].includes(block.nodeName)) {
                // Check if it is effectively empty
                // We trim newlines too just in case
                const text = block.innerText.replace(/\n/g, '').trim();

                if (text === '') {
                    // Empty header -> Backspace -> Convert to DIV (Paragraph) MANUAL SWAP
                    e.preventDefault();

                    const newDiv = document.createElement('div');
                    newDiv.appendChild(document.createElement('br')); // Anchor for cursor

                    block.replaceWith(newDiv);

                    // Restore cursor to the new div
                    const range = document.createRange();
                    range.setStart(newDiv, 0);
                    range.collapse(true);
                    const s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(range);

                    updatePlaceholders();
                    return;
                }
            }
        }
    }

    if (e.key === 'Enter') {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;

        // Force 'div' creation instead of 'br' or text merging - CRITICAL for block formatting
        if (!e.shiftKey) {
            // Check if we are in a bullet list item that needs handling
            let blockEl = sel.anchorNode;
            while (blockEl && blockEl.nodeName !== 'DIV' && blockEl !== editor) {
                blockEl = blockEl.parentNode;
            }
            let currentLineText = "";
            if (blockEl && blockEl !== editor) {
                currentLineText = blockEl.innerText || blockEl.textContent;
            } else {
                if (sel.anchorNode.nodeType === 3) currentLineText = sel.anchorNode.textContent;
                else currentLineText = sel.anchorNode.innerText || "";
            }

            const match = currentLineText.match(/^(➖|⬜|✅)[\s\u00A0]/);
            if (match) {
                // Existing Dash logic (keep this)
                const prefix = match[1];
                const textContent = currentLineText.replace(/[\s\u00A0]*$/, '');
                if (textContent === prefix) {
                    e.preventDefault();
                    document.execCommand('delete');
                    emitUpdate();
                    return;
                }

                // For bullet points, we also want clean behavior
                // But let's let the below logic handle the split, then insert prefix?
                // The existing setTimeout logic below is a bit hacky but works for keeping prefix.
                // WE MUST PRESERVE the existing bullet logic behavior while ensuring BLOCK SPLIT.

                // Let's rely on standard logic for bullets + setTimeout prefix injection
                // BUT if we rely on browser default Enter, we get inconsistent blocks.
                // Let's force insertParagraph here too, then inject prefix.
                e.preventDefault();
                document.execCommand('insertParagraph');

                setTimeout(() => {
                    const s = window.getSelection();
                    if (s.rangeCount) {
                        let newPrefix = prefix;
                        if (newPrefix === '✅') newPrefix = '⬜';
                        document.execCommand('insertText', false, newPrefix + ' ');
                        try {
                            // Cleanup BR
                            const node = s.anchorNode;
                            const block = node.nodeType === 3 ? node.parentNode : node;
                            if (block.nodeName === 'DIV' && block.lastElementChild && block.lastElementChild.nodeName === 'BR') {
                                block.lastElementChild.remove();
                            }
                        } catch (e) { }
                        playPopSound();
                        emitUpdate();
                    }
                }, 0);
                return;
            }

            // Normal Enter (No bullet) -> FORCE DIV
            // Check if we are in a Heading
            let parentBlock = sel.anchorNode;
            while (parentBlock && !['H1', 'H2', 'H3', 'DIV', 'P'].includes(parentBlock.nodeName) && parentBlock !== editor) {
                parentBlock = parentBlock.parentNode;
            }

            if (parentBlock && ['H1', 'H2', 'H3'].includes(parentBlock.nodeName)) {
                // Break out of Heading into a plain DIV
                e.preventDefault();
                // Standard execCommand 'insertParagraph' might duplicate H1 in some browsers.
                // Let's force a DefaultParagraphSeparator command first? 
                // Or manually insert.

                // Try formatBlock 'DIV' on the new line? 
                // Reliable way: execCommand('insertParagraph') then formatBlock('DIV')
                document.execCommand('insertParagraph');
                document.execCommand('formatBlock', false, 'div');

                // Also ensure the new div is clean (no styles)
            } else {
                e.preventDefault();
                document.execCommand('insertParagraph');
            }
            emitUpdate();
            return;
        }
    }
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
    });
}

// --- History Logic ---
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');
const closeHistoryBtn = document.getElementById('close-history');

if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
        historyModal.classList.add('hidden');
    });
}

// Close on click outside
if (historyModal) {
    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) {
            historyModal.classList.add('hidden');
        }
    });
}

function openHistoryModal() {
    historyModal.classList.remove('hidden');
    loadHistory();
}

async function loadHistory() {
    historyList.innerHTML = '<div class="loading-history">Loading history...</div>';

    try {
        const res = await fetch(`/api/lists/${roomId}/history`);
        if (!res.ok) throw new Error("Failed to load");
        const history = await res.json();

        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">No history available yet.</div>';
            return;
        }

        renderHistory(history);
    } catch (e) {
        historyList.innerHTML = '<div class="error-state">Failed to load history.</div>';
    }
}

function renderHistory(items) {
    historyList.innerHTML = '';

    items.forEach(item => {
        // item = { ts, content }
        const date = new Date(item.ts);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();

        // Render full HTML content for review
        const previewContent = item.content ? item.content : '<em style="color:var(--secondary-text)">Empty list</em>';

        // Render history item
        const div = document.createElement('div');
        div.className = 'history-item';
        div.style.cursor = 'pointer'; // Make it look clickable
        div.innerHTML = `
            <div class="history-meta">
                <div class="history-time">${dateStr}</div>
                <div class="history-preview">${previewContent}</div>
            </div>
            <button class="btn-restore">Restore</button>
        `;

        // Click on item to show diff
        div.addEventListener('click', (e) => {
            // Avoid triggering if restore button was clicked
            if (e.target.classList.contains('btn-restore')) return;
            showDiff(item.content, item.ts);
        });

        // Restore Handler
        div.querySelector('.btn-restore').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent diff modal
            if (confirm("Restore this version? current changes will be overwritten.")) {
                restoreVersion(item.content);
            }
        });

        historyList.appendChild(div);
    });
}

function showDiff(oldContent, ts) {
    const diffModal = document.getElementById('diff-modal');
    const diffContent = document.getElementById('diff-content');
    const closeDiff = document.getElementById('close-diff');
    const restoreDiffBtn = document.getElementById('btn-restore-diff');

    // Get current content from editor
    const currentContent = editor.innerHTML;

    // Calculate Diff
    // Use jsdiff logic. We assume window.Diff is available.
    if (!window.Diff) {
        alert("Diff library not loaded.");
        return;
    }

    // Convert HTML to simple text if we want word diff, or diff chars.
    // However, user likely wants to see HTML changes if they are editing HTML.
    // Diff.diffWords is good for text.

    const diff = Diff.diffWords(currentContent, oldContent);

    // Generate HTML
    const fragment = document.createDocumentFragment();
    diff.forEach((part) => {
        // green for additions (in oldContent but not current? Wait. OLD vs CURRENT.
        // Usually we want to see what 'oldContent' looks like compared to 'current'.
        // If we want to see what changed *to get to* current, we diff old -> current.
        // But here we are viewing "Old Version". So maybe we want to see "What is in THIS version".
        // Let's visualize: We are viewing a past state.
        // Standard git diff view: Red = removed (was in A, not in B), Green = added (in B, not in A).
        // If we treat "Current" as B and "History" as A.
        // If I removed a paragraph in Current, it IS in History. So in History view it should look like "This exists here".
        // Actually, "Compare Selected (A) vs Current (B)"
        // If I deleted text in B, it implies it WAS present in A.
        // Showing "What is different":
        // RED: Things present in Current but NOT in Selected (Added later) -> Wait, logic flip.
        // GREEN: Things present in Selected but NOT in Current (Deleted later).
        // Ideally we want to see the "Selected Version" but highlighted.
        // Let's just diff them standardly: A=Current, B=Selected.
        // If part.added (in Selected, not Current) -> Green (It exists in this version).
        // If part.removed (in Current, not Selected) -> Red (It exists in live, but NOT here).
        // Let's stick to standard "Diff A to B" where A=Current, B=Selected.
        // part.added = present in B (Selected) -> Green.
        // part.removed = present in A (Current) -> Red.

        const span = document.createElement('span');
        if (part.added) {
            span.className = 'diff-ins';
            span.appendChild(document.createTextNode(part.value));
        } else if (part.removed) {
            span.className = 'diff-del';
            span.appendChild(document.createTextNode(part.value));
        } else {
            span.appendChild(document.createTextNode(part.value));
        }
        fragment.appendChild(span);
    });

    diffContent.innerHTML = '';
    diffContent.appendChild(fragment);

    // Show Modal
    diffModal.classList.remove('hidden');

    // Restore Button Logic
    restoreDiffBtn.onclick = () => {
        if (confirm("Restore this version? current changes will be overwritten.")) {
            restoreVersion(oldContent);
            diffModal.classList.add('hidden');
        }
    };

    // Close logic
    closeDiff.onclick = () => diffModal.classList.add('hidden');
    // Click outside
    diffModal.onclick = (e) => {
        if (e.target === diffModal) diffModal.classList.add('hidden');
    };
}

function restoreVersion(content) {
    editor.innerHTML = content;
    emitUpdate(); // Save to server
    historyModal.classList.add('hidden');
    statusDiv.textContent = 'Restored & Saved';
    statusDiv.style.opacity = '1';
    setTimeout(() => { statusDiv.style.opacity = '0'; }, 3000);
}

// --- Docmost-style Placeholder Logic ---
function updatePlaceholders() {
    const headings = editor.querySelectorAll('h1, h2, h3');
    headings.forEach(h => {
        const text = h.innerText.replace(/\n/g, '').trim();
        if (!h.hasAttribute('data-placeholder')) {
            const level = h.tagName.substring(1);
            h.setAttribute('data-placeholder', 'Heading ' + level);
        }
        if (text === '') {
            h.classList.add('is-empty');
        } else {
            h.classList.remove('is-empty');
        }
    });
}

editor.addEventListener('input', () => {
    checkMarkdownShortcuts();
    saveHistory();
    updatePlaceholders();
});
editor.addEventListener('keyup', updatePlaceholders);
editor.addEventListener('click', updatePlaceholders);
editor.addEventListener('focus', updatePlaceholders, true);

// --- Mobile Swipe Support (Indent/Outdent) ---
let touchStartX = 0;
let touchStartY = 0;

editor.addEventListener('touchstart', (e) => {
    if (e.changedTouches.length > 0) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }
}, { passive: true });

editor.addEventListener('touchend', (e) => {
    if (e.changedTouches.length > 0) {
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;

        handleSwipeGesture(touchStartX, touchStartY, touchEndX, touchEndY);
    }
});

function handleSwipeGesture(startX, startY, endX, endY) {
    const diffX = endX - startX;
    const diffY = endY - startY;

    // Thresholds
    const minSwipeDistance = 50; // Minimum px to count as swipe
    const maxVerticalVariance = 30; // Maximum vertical movement allowed (to avoid scrolling triggers)

    if (Math.abs(diffX) > minSwipeDistance && Math.abs(diffY) < maxVerticalVariance) {
        if (diffX > 0) {
            // Swipe Right -> Indent
            document.execCommand('indent');
            console.log("Swiped Right: Indent");
        } else {
            // Swipe Left -> Outdent
            document.execCommand('outdent');
            console.log("Swiped Left: Outdent");
        }
        emitUpdate();
    }
}

