/**
 * Motor Health Algorithm
 * Analyzes telemetry and returns health score + status
 */

const THRESHOLDS = {
    temp: { warning: 45, critical: 65 },
    vibration: { warning: 0.4, critical: 0.9 },
    current: { warning: 2.5, critical: 4.5 }
};

export function calculateHealth(doc) {
    let scores = [];
    let issues = [];

    // 1. Temperature Check
    let tempScore = 100;
    if (doc.temperature > THRESHOLDS.temp.critical) {
        tempScore = 0;
        issues.push("Critical Overheating");
    } else if (doc.temperature > THRESHOLDS.temp.warning) {
        tempScore = 50;
        issues.push("High Temperature Warning");
    }
    scores.push(tempScore);

    // 2. Vibration Check
    let vibScore = 100;
    if (doc.vibration > THRESHOLDS.vibration.critical) {
        vibScore = 0;
        issues.push("Extreme Mechanical Vibration");
    } else if (doc.vibration > THRESHOLDS.vibration.warning) {
        vibScore = 50;
        issues.push("High Vibration Detected");
    }
    scores.push(vibScore);

    // 3. Current Check (Load)
    let currScore = 100;
    if (doc.current > THRESHOLDS.current.critical) {
        currScore = 0;
        issues.push("Severe Current Overload");
    } else if (doc.current > THRESHOLDS.current.warning) {
        currScore = 50;
        issues.push("Abnormal Current Consumption");
    }
    scores.push(currScore);

    // Calculate Average Health
    const healthValue = Math.round(scores.reduce((a, b) => a + b) / scores.length);

    // Determine Status
    let status = "Healthy";
    if (healthValue < 40) status = "Critical";
    else if (healthValue < 80) status = "Warning";

    return {
        score: healthValue,
        status: status,
        issues: issues
    };
}
