
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

async function main() {
    // 1. Read Data
    const filePath = path.resolve('scripts/custom_data.txt');
    console.log(`Reading data from ${filePath}...`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    const targets = [];
    const messages = [];

    for (const line of lines) {
        if (/^\d{8,}$/.test(line)) {
            targets.push(line);
        } else {
            messages.push(line);
        }
    }

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
        // 3. Get Ready Accounts
        const [accounts] = await conn.query("SELECT id, phone FROM accounts WHERE status = 'Ready'");
        if (accounts.length === 0) {
            console.error("No ready accounts found.");
            return;
        }

        // 4. Create Campaign
        const campaignName = `Test Send x2 ${new Date().toISOString()}`;
        console.log(`Creating Campaign: ${campaignName}`);
        
        const [res] = await conn.query(
            "INSERT INTO campaigns (name, content, total_targets, status) VALUES (?, ?, ?, 'Processing')",
            [campaignName, "Round Robin x2", targets.length * 2]
        );
        const campaignId = res.insertId;

        // 5. Generate Tasks (2 per account, round robin targets)
        console.log("Generating tasks...");
        const taskValues = [];
        let targetIndex = 0;
        
        for (const account of accounts) {
            for (let i = 0; i < 2; i++) {
                const target = targets[targetIndex % targets.length];
                targetIndex++;
                
                const msg = messages[Math.floor(Math.random() * messages.length)];
                // Add an image every other message for testing
                const mediaUrl = (i % 2 === 0) ? "https://picsum.photos/200/300" : null;

                taskValues.push([campaignId, target, msg, mediaUrl, 'Pending', account.id]);
            }
        }

        if (taskValues.length > 0) {
            await conn.query(
                "INSERT INTO message_tasks (campaign_id, target_phone, content, media_url, status, account_id) VALUES ?",
                [taskValues]
            );
        }

        console.log(`Successfully queued ${taskValues.length} tasks.`);
        console.log(`Used ${accounts.length} accounts, sending 2 messages each.`);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await conn.end();
    }
}

main().catch(console.error);
