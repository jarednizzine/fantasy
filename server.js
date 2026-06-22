const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend

// Database Setup
const db = new sqlite3.Database('./fantasyforge.db');

db.serialize(() => {
    // Users Table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        isAdmin INTEGER DEFAULT 0
    )`);

    // Players Table
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        username TEXT,
        team TEXT,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        adp REAL DEFAULT 999.0
    )`);

    // Drafts Table
    db.run(`CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        createdBy TEXT,
        status TEXT DEFAULT 'open',
        maxTeams INTEGER DEFAULT 12,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Teams Table
    db.run(`CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY,
        owner TEXT,
        name TEXT,
        roster TEXT DEFAULT '[]',
        draftId INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create default admin
    db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (username, password, isAdmin) VALUES ('admin', 'admin', 1)");
            console.log("✅ Default admin created (admin / admin)");
        }
    });
});

// ======================== API ROUTES ========================

// Auth
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], function(err) {
        if (err) return res.status(400).json({ error: "Username already taken" });
        res.json({ success: true, username });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT username, isAdmin FROM users WHERE username = ? AND password = ?", 
        [username, password], (err, user) => {
        if (!user) return res.status(401).json({ error: "Invalid credentials" });
        res.json({ success: true, user });
    });
});

// Players
app.get('/api/players', (req, res) => {
    db.all("SELECT * FROM players ORDER BY adp ASC", [], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/players', (req, res) => {
    const { username, team, wins, losses, adp } = req.body;
    db.run("INSERT INTO players (username, team, wins, losses, adp) VALUES (?,?,?,?,?)",
        [username, team || "Independent", wins || 0, losses || 0, adp || 999],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        });
});

app.post('/api/bulk-players', (req, res) => {
    const playerList = req.body.players;
    if (!Array.isArray(playerList)) return res.status(400).json({ error: "Invalid data" });

    const stmt = db.prepare("INSERT INTO players (username, team, wins, losses, adp) VALUES (?,?,?,?,?)");
    let added = 0;

    playerList.forEach(p => {
        stmt.run(
            p.username,
            p.team || "Independent",
            p.wins || 0,
            p.losses || 0,
            p.adp || 999
        );
        added++;
    });

    stmt.finalize();
    res.json({ success: true, added });
});

// Drafts
app.get('/api/drafts', (req, res) => {
    db.all("SELECT * FROM drafts ORDER BY createdAt DESC", [], (err, rows) => res.json(rows));
});

app.post('/api/drafts', (req, res) => {
    const { name, createdBy } = req.body;
    db.run("INSERT INTO drafts (name, createdBy) VALUES (?,?)", [name, createdBy], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
});

// Teams
app.post('/api/teams', (req, res) => {
    const { owner, name, roster, draftId } = req.body;
    db.run("INSERT INTO teams (owner, name, roster, draftId) VALUES (?,?,?,?)",
        [owner, name, JSON.stringify(roster || []), draftId || null],
        function(err) {
            res.json({ id: this.lastID, success: true });
        });
});

app.get('/api/teams/:owner', (req, res) => {
    db.all("SELECT * FROM teams WHERE owner = ?", [req.params.owner], (err, rows) => {
        const teams = rows.map(t => ({
            ...t,
            roster: JSON.parse(t.roster)
        }));
        res.json(teams);
    });
});

// ======================== SOCKET.IO - LIVE DRAFT ========================
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);

    socket.on('joinDraft', (draftId) => {
        socket.join(`draft-${draftId}`);
        console.log(`User joined draft: ${draftId}`);
    });

    socket.on('makePick', ({ draftId, playerId, username }) => {
        io.to(`draft-${draftId}`).emit('playerPicked', {
            playerId,
            pickedBy: username,
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 FantasyForge Server running on http://localhost:${PORT}`);
    console.log(`📁 Make sure your frontend is in the "public" folder`);
});