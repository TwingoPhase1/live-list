# Live-List ⚡

> **High-performance real-time collaborative list application.**  
> Powered by **Y.js (CRDTs)** and **WebSockets** for seamless, conflict-free editing.

---

## 🌟 Features

- **Real-Time Sync**: Instant updates across all connected devices using generic WebSocket protocol.
- **Conflict-Free (CRDT)**: Built on [Y.js](https://github.com/yjs/yjs) to handle concurrent edits without data loss or cursor jumping.
- **Audio Gamification**: Satisfying sound effects for interactions (pop, snap, ding) to enhance user engagement.
- **Privacy-First**: 
  - Lists are **private by default**.
  - **Admin Mode**: Claim ownership of a list to manage permissions.
  - **Public/Private Toggle**: Share strictly when you want to.
  - *Note: List titles can be renamed by anyone with access to foster collaboration.*
- **Persistent Storage**: Changes are autosaved to disk (binary `.yjs` format) and synced efficiently.
- **Responsive UI**: Mobile-optimized interface with PWA support (Manifest included).

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- NPM or Yarn

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/live-list.git
    cd live-list
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Start the server**
    ```bash
    npm start
    ```
    *Server runs on port `3001` by default.*

4.  **Access the App**
    Open `http://localhost:3001` in your browser.

## 🛠️ Technology Stack

- **Backend**: Node.js, Express, `ws` (WebSocket)
- **Synchronization**: Y.js, `y-protocols`, `y-websocket` implementation
- **Frontend**: Vanilla JS (ES Modules), Quill (Rich Text - Lite), CSS Variables
- **Persistence**: File-system based (custom binary `.yjs` storage)

## 📂 Project Structure

```
├── data/               # Persistent storage (ignored by Git)
│   └── history/        # Incremental history snapshots
├── public/             # Static frontend assets
│   ├── list.html       # Main editor interface
│   ├── main.js         # Y.js client logic
│   └── style.css       # Global styles
├── server.js           # Express + WebSocket server
└── lists-index.json    # Metadata index (ignored by Git)
```

## 🔐 Security Features

- **Session Management**: `express-session` with `cookie-parser`.
- **Password Hashing**: `bcryptjs` for admin accounts.
- **Access Control**: Server-side validation for private lists before establishing WebSocket connections.

## 📝 License

This project is licensed under the MIT License.

## 🤝 Credits

Developed with the assistance of:
- **Gemini 3 Pro**
- **Nano Banana**
