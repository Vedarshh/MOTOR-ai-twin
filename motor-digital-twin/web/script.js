import { calculateHealth } from './lib/health.js';

const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC = 'motor/data';

// --- Initialize Chart.js ---
const ctx = document.getElementById('performanceChart').getContext('2d');
const performanceChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'RPM',
                data: [],
                borderColor: '#a78bfa',
                backgroundColor: 'rgba(167, 139, 250, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                yAxisID: 'y'
            },
            {
                label: 'Temp (°C)',
                data: [],
                borderColor: '#fb7185',
                backgroundColor: 'rgba(251, 113, 133, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                yAxisID: 'y1'
            }
        ]
    },
    options: {
        responsive: true,
        plugins: {
            legend: { position: 'top', labels: { color: '#94a3b8' } }
        },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            y: { position: 'left', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            y1: { position: 'right', grid: { display: false }, ticks: { color: '#94a3b8' } }
        }
    }
});

// --- API Configuration ---
const API_URL = 'http://localhost:5000/api';

// --- Alert Configuration ---
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 60000; // 1 minute

// Request Notification Permission
if ("Notification" in window) {
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}

// --- MQTT Connection ---
const statusIndicator = document.getElementById('status');
const statusText = statusIndicator.querySelector('.status-text');

// Connect options
const options = {
    keepalive: 60,
    clientId: 'web_monitor_' + Math.random().toString(16).substr(2, 8),
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
};

const client = mqtt.connect(MQTT_BROKER, options);

client.on('connect', () => {
    console.log('Connected to HiveMQ');
    statusIndicator.className = 'status-indicator connected';
    statusText.textContent = 'Connected';

    // Load historical data before listening to live feed
    fetchHistory();

    client.subscribe(MQTT_TOPIC);
});

client.on('error', (err) => {
    console.error('MQTT Error:', err);
    client.end();
});

client.on('offline', () => {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Reconnecting...';
});

// --- Receive Logic ---
client.on('message', (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        updateDashboard(data);
    } catch (e) {
        console.error('Failed to parse telemetry JSON:', e);
    }
});

function updateDashboard(data) {
    // 1. Update Numeric Values
    updateValue('temp', data.temperature);
    updateValue('current', data.current);
    updateValue('vibration', data.vibration);
    updateValue('rpm', data.rpm);

    // 2. Health Monitoring Integration
    const health = calculateHealth(data);
    updateHealthUI(health);

    // 3. Visual & System Alerts
    handleAlerts(health);

    // 4. Update Charts (Max 20 points)
    const timestamp = new Date().toLocaleTimeString();

    performanceChart.data.labels.push(timestamp);
    performanceChart.data.datasets[0].data.push(data.rpm);
    performanceChart.data.datasets[1].data.push(data.temperature);

    if (performanceChart.data.labels.length > 20) {
        performanceChart.data.labels.shift();
        performanceChart.data.datasets[0].data.shift();
        performanceChart.data.datasets[1].data.shift();
    }
    performanceChart.update('none'); // Update without animation for performance
}

function handleAlerts(health) {
    const appContainer = document.querySelector('.app-container');

    if (health.status === 'Critical') {
        appContainer.classList.add('critical-mode');

        // Browser notification (Debounced)
        const now = Date.now();
        if (now - lastNotificationTime > NOTIFICATION_COOLDOWN) {
            sendNotification("CRITICAL MOTOR ALERT", `Health: ${health.score}% - ${health.issues.join(', ')}`);
            lastNotificationTime = now;
        }
    } else {
        appContainer.classList.remove('critical-mode');
    }
}

function sendNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: '⚡' });
    }
}

async function fetchHistory() {
    try {
        const response = await fetch(`${API_URL}/history?limit=20`);
        const history = await response.json();

        if (history.length > 0) {
            // Clear current chart
            performanceChart.data.labels = [];
            performanceChart.data.datasets[0].data = [];
            performanceChart.data.datasets[1].data = [];

            // Populate from DB
            history.forEach(point => {
                const time = new Date(point.timestamp).toLocaleTimeString();
                performanceChart.data.labels.push(time);
                performanceChart.data.datasets[0].data.push(point.rpm);
                performanceChart.data.datasets[1].data.push(point.temperature);
            });

            // Update the latest values to the UI too
            const latest = history[history.length - 1];
            updateValue('temp', latest.temperature);
            updateValue('current', latest.current);
            updateValue('vibration', latest.vibration);
            updateValue('rpm', latest.rpm);

            performanceChart.update();
        }
    } catch (e) {
        console.warn('Backend not available for history fetching:', e.message);
    }
}

function updateHealthUI(health) {
    const healthVal = document.getElementById('val-health');
    const healthBadge = document.getElementById('status-badge');
    const healthCard = document.getElementById('card-health');
    const healthFill = healthCard.querySelector('.fill');
    const alertList = document.getElementById('alert-list');

    // Update Score
    healthVal.textContent = `${health.score}%`;
    healthBadge.textContent = health.status;

    // Update Badge & Card Class
    healthBadge.className = `status-badge ${health.status.toLowerCase()}`;
    healthCard.className = `metric-card status-${health.status.toLowerCase()}`;

    // Update Fill Bar
    healthFill.style.width = `${health.score}%`;
    healthFill.style.background = health.status === 'Critical' ? 'var(--status-red)' :
        health.status === 'Warning' ? '#fbbf24' : 'var(--accent-emerald)';

    // Update Alerts
    if (health.issues.length > 0) {
        alertList.innerHTML = health.issues.map(issue => `
            <div class="alert-item">
                <span>${issue}</span>
                <span class="time">${new Date().toLocaleTimeString()}</span>
            </div>
        `).join('');
    } else {
        alertList.innerHTML = `
            <div class="empty-alerts" style="text-align: center; color: var(--text-secondary); font-size: 0.8rem; padding: 1rem;">
                No active alerts. System nominal.
            </div>
        `;
    }
}

function updateValue(key, value) {
    const el = document.getElementById(`val-${key}`);
    const card = document.getElementById(`card-${key}`);
    const fill = card.querySelector('.fill');

    if (value !== undefined && value !== null) {
        el.textContent = value;

        // Calculate progress percentage (Rough estimates for visualization)
        let percent = 0;
        if (key === 'temp') percent = (value / 100) * 100;
        if (key === 'current') percent = (value / 5) * 100;
        if (key === 'vibration') percent = (value / 1) * 100;
        if (key === 'rpm') percent = (value / 3000) * 100;

        fill.style.width = Math.min(Math.max(percent, 0), 100) + '%';
    }
}
