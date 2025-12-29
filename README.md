<div align="center">

# ⚡ Live-List Collaborative

**Zero-friction, real-time collaborative lists for everyone.**  
*Instant sync. No signup required. Mobile friendly.*

[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--Time-010101?style=for-the-badge&logo=socket.io)](https://socket.io/)
[![License](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)](LICENSE)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Configuration](#-configuration)

</div>

---

## 🚀 Overview

**Live-List** is a lightweight, high-performance web application designed for instant collaboration. Whether you're planning a trip, sharing a grocery list, or brainstorming ideas, Live-List keeps everyone in sync without the hassle of accounts or complicated setups.

It features a Notion-like editing experience with markdown shortcuts, ensuring you stay in the flow.

## ✨ Features

- **🔄 Real-Time Synchronization**: Changes appear instantly on all connected devices using WebSockets.
- **📱 Touch Optimized**:
    - **Swipe Right** ➡️ to Indent.
    - **Swipe Left** ⬅️ to Outdent.
- **⚡ Smart Typing (Markdown)**:
    - `- ` creates a bullet point `➖`.
    - `[] ` creates a checkbox `⬜` (Click to toggle `✅`).
    - `# ` makes a Header.
    - `[1] ` creates a reactive Quantity Badge `[ 1 ]`.
- **👥 Presence Indicators**: See how many people are currently collaborating with you.
- **🔒 Privacy First**: Lists are private by default. Admins can choose to share them publicly.
- **🛡️ Admin Dashboard**: Centralized control to manage all active lists.

## 🛠️ Installation

Get your own instance running in seconds.

### Prerequisites
- Node.js (v14+)
- npm

### Quick Start

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/live-list-collaborative.git
    cd live-list-collaborative
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run the server**
    ```bash
    npm start
    ```
    > The app will be live at `http://localhost:3001`

## 🎮 Usage

### For Users
1.  **Create**: Open the app and click "New List" (or navigate to a random URL).
2.  **Edit**: Just start typing! Use shortcuts like `- ` for lists.
3.  **Share**: Send the URL to your friends (if the list is public).

### For Admins
1.  Navigate to `/login` to access the admin panel.
2.  Default registration is open for the **first user only**.
3.  Use the Dashboard to view, delete, or change the privacy of any list.

## ⚙️ Configuration

Create a `.env` file in the root directory to customize your instance:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the server listens on. | `3001` |
| `SESSION_SECRET` | Secret string for session cookies. | `dev-secret...` |
| `NODE_ENV` | Set to `production` for security. | `development` |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## ❤️ Credits

- **Code & Logic**: Gemini 3 Pro
- **Visuals & Design**: Nano Banana

---

<div align="center">
  <sub>Built with ❤️ using Node.js and Socket.IO</sub>
</div>
