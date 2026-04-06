const express = require('express');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const port = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend dashboard via HTTP (avoids file:// WebSocket restrictions)
const path = require('path');
app.use(express.static(path.join(__dirname, '../web')));

// --- Database Configuration ---
const db = new sqlite3.Database('./motor_data.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('✅ Connected to SQLite database.');
});

// Create table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        temperature REAL,
        current REAL,
        vibration REAL,
        voltage REAL,
        power REAL,
        rpm INTEGER,
        status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add columns if they don't exist (for upgrading existing database)
    db.run(`ALTER TABLE telemetry ADD COLUMN voltage REAL`, () => { });
    db.run(`ALTER TABLE telemetry ADD COLUMN power REAL`, () => { });
});

// --- HTTP + WebSocket Server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track connected browser clients
let wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log(`🌐 Browser client connected via WebSocket. Total: ${wsClients.size}`);

    ws.on('close', () => {
        wsClients.delete(ws);
        console.log(`🔌 Browser client disconnected. Total: ${wsClients.size}`);
    });

    ws.on('error', (err) => {
        console.error('WebSocket client error:', err.message);
        wsClients.delete(ws);
    });
});

// Broadcast to all connected browser clients
function broadcast(data) {
    const payload = JSON.stringify(data);
    wsClients.forEach(ws => {
        if (ws.readyState === 1) { // OPEN
            ws.send(payload);
        }
    });
}

// --- MQTT Background Processor ---
const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const MQTT_TOPIC = 'motor/data';

const mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: 'motor_server_' + Math.random().toString(16).substr(2, 8),
    keepalive: 60,
    reconnectPeriod: 3000
});

mqttClient.on('connect', () => {
    console.log('✅ Backend connected to MQTT Broker');
    mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (err) console.error('MQTT subscribe error:', err);
        else console.log(`📡 Subscribed to topic: ${MQTT_TOPIC}`);
    });
});

mqttClient.on('message', (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        console.log(`📦 Received: ${message.toString()}`);

        // Anomaly detection / health status
        const status = data.temperature > 60 || data.vibration > 0.8 ? 'Critical' :
            data.temperature > 45 || data.vibration > 0.4 ? 'Warning' : 'Healthy';

        // Store in DB
        const sql = `INSERT INTO telemetry (temperature, current, vibration, rpm, voltage, power, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        db.run(sql, [data.temperature, data.current, data.vibration, data.rpm, data.voltage, data.power, status], (err) => {
            if (err) console.error('Database insert error:', err.message);
        });

        // 🔥 Relay to all connected browser clients instantly via WebSocket
        broadcast({ ...data, status, timestamp: new Date().toISOString() });

    } catch (e) {
        console.error('Failed to process MQTT message:', e.message);
    }
});

mqttClient.on('reconnect', () => console.log('🔄 Reconnecting to MQTT...'));
mqttClient.on('error', (err) => console.error('❌ MQTT error:', err.message));

// --- REST API Endpoints ---
app.get('/api/history', (req, res) => {
    const limit = req.query.limit || 50;
    db.all(`SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT ?`, [limit], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows.reverse());
    });
});

app.get('/api/latest', (req, res) => {
    db.get(`SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT 1`, [], (err, row) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(row || {});
    });
});

app.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as count, AVG(temperature) as avgTemp, 
            AVG(current) as avgCurrent, AVG(vibration) as avgVib, 
            AVG(voltage) as avgVoltage, AVG(power) as avgPower,
            AVG(rpm) as avgRpm FROM telemetry`, [], (err, row) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(row || {});
    });
});

// --- Start Server ---
server.listen(port, () => {
    console.log(`\n🚀 Server running at http://localhost:${port}`);
    console.log(`🔌 WebSocket relay active at ws://localhost:${port}`);
    console.log(`📊 API endpoints: /api/latest  /api/history  /api/stats\n`);
});
