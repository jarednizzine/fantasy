const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./fantasyforge.db');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'cryptojared9@gmail.com',
        pass: 'Theclash99!!'
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        isAdmin INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0,
        verificationToken TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, username TEXT, team TEXT, wins INTEGER, losses INTEGER, adp REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY, name TEXT, createdBy TEXT, status TEXT DEFAULT 'open')`);
    db.run(`CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY,
        owner TEXT,
        name TEXT,
        roster TEXT DEFAULT '[]',
        draftId INTEGER
    )`);

    db.run("INSERT OR IGNORE INTO users (username, email, password, isAdmin, verified) VALUES ('admin', 'admin@fantasyforge.com', 'admin', 1, 1)");
});

// ======================== AUTH ========================
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    const token = crypto.randomBytes(32).toString('hex');

    db.run(`INSERT INTO users (username, email, password, verificationToken) VALUES (?,?,?,?)`,
        [username, email, password, token], async (err) => {
            if (err) return res.status(400).json({ error: "Username or email taken" });

            const verifyUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'}/verify?token=${token}`;

            await transporter.sendMail({
                from: '"FantasyForge" <no-reply@fantasyforge.com>',
                to: email,
                subject: "Verify your FantasyForge Account",
                html: `<h2>Welcome!</h2><p>Click to verify:</p><a href="${verifyUrl}" style="background:#22d3ee;color:black;padding:12px 24px;border-radius:9999px;text-decoration:none;">Verify Email</a>`
            });

            res.json({ success: true, message: "Check your email to verify your account" });
        });
});

app.get('/verify', (req, res) => {
    const { token } = req.query;
    db.run("UPDATE users SET verified = 1, verificationToken = NULL WHERE verificationToken = ?", [token], function() {
        res.send(`<h2 style="text-align:center;margin-top:100px;">✅ Email Verified!<br><a href="/">Go to FantasyForge</a></h2>`);
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE (username = ? OR email = ?) AND password = ?", [username, username, password], (err, user) => {
        if (!user || !user.verified) return res.status(401).json({ error: "Invalid or unverified account" });
        res.json({ success: true, user: { username: user.username, isAdmin: !!user.isAdmin } });
    });
});

// ======================== TEAM CREATION ========================
app.post('/api/teams', (req, res) => {
    const { owner, name, roster } = req.body;
    db.run("INSERT INTO teams (owner, name, roster) VALUES (?,?,?)",
        [owner, name, JSON.stringify(roster || [])], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        });
});

app.get('/api/teams/:owner', (req, res) => {
    db.all("SELECT * FROM teams WHERE owner = ?", [req.params.owner], (err, rows) => {
        res.json(rows.map(t => ({ ...t, roster: JSON.parse(t.roster) })));
    });
});

// Other routes (players, drafts, bulk import, socket.io) - keep from previous version
// ...

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`FantasyForge running on port ${PORT}`));
