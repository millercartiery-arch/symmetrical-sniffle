
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

async function main() {
    // 1. Read and Parse Data
    const filePath = path.resolve('scripts/custom_data.txt');
    console.log(`Reading data from ${filePath}...`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    const targets = [];
    const messages = [];

    // Simple heuristic: if it looks like a phone number (digits > 8), it's a target.
    // Otherwise it's a message.
    for (const line of lines) {
        if (/^\d{8,}$/.test(line)) {
            targets.push(line);
        } else {
            messages.push(line);
        }
    }

    console.log(`Parsed ${targets.length} targets and ${messages.length} messages.`);

    if (targets.length === 0 || messages.length === 0) {
        console.error("Missing targets or messages.");
        return;
    }

    // 2. Connect to DB
    const config = {
        host: 'localhost',
        port: 3307,
        user: 'root',
        password: '',
        database: 'massmail'
    };
    const conn = await mysql.createConnection(config);

    try {
        // 3. Create Campaign
        const campaignName = `Test Send ${new Date().toISOString()}`;
        console.log(`Creating Campaign: ${campaignName}`);
        
        const [res] = await conn.query(
            "INSERT INTO campaigns (name, content, total_targets, status) VALUES (?, ?, ?, 'Processing')",
            [campaignName, "Random Rotation", targets.length]
        );
        const campaignId = res.insertId;
        console.log(`Campaign ID: ${campaignId}`);

        // 4. Create Tasks
        console.log("Generating tasks...");
        const taskValues = targets.map(target => {
            // Pick random message
            const msg = messages[Math.floor(Math.random() * messages.length)];
            return [campaignId, target, msg, null, 'Pending'];
        });

        // Bulk insert
        if (taskValues.length > 0) {
            await conn.query(
                "INSERT INTO message_tasks (campaign_id, target_phone, content, media_url, status) VALUES ?",
                [taskValues]
            );
        }

        console.log(`Successfully queued ${taskValues.length} tasks.`);
        console.log("Worker should pick these up shortly.");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await conn.end();
    }
}

main().catch(console.error);
