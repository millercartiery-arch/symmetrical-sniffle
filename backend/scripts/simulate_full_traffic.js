
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const MESSAGES = [
    `My living room is about to host the "Nth Tea Party and Chat Championship," and you’re invited as an honored VIP guest.`,
    `My couch is calling out strongly, saying it misses your weight. Come over and "test" it this weekend?`,
    `Taste tester wanted! Just learned a new dish and urgently need a guinea pig. Payment includes full stomach and my friendship. Interested?`,
    `Inside scoop: My place is hosting a private "Who’s the Best Player" tournament with generous prizes (maybe not). You’re officially invited to compete.`,
    `Alert! Alert! My home is under attack by "excessive quietness" and urgently needs your laughter and stories to save it! Come quick!`,
    `I'm having a hot pot and BBQ dinner tomorrow evening and I'd love for you to join me!`,
    `Long time no see. How is your family?`,
    `How is the weather there?`,
    `Do you want to come for dinner tonight? I will make chicken curry`,
    `Today is a good day, how are you today?`,
    `Do you want to come for dinner tonight? I will make apple curry`,
    `We are going camping tomorrow. Would you like to go with us?`,
    `Do you want to come for dinner tonight? I will make chicken tenders`,
    `How are you? Long time no see.`,
    `Do you want to come for dinner tonight? I will be making seafood`,
    `Do you want to come out for dinner tomorrow? I'm making steak`,
    `Let's go for a walk tomorrow, do you want to go?`,
    `Do you want to come for dinner tomorrow? I'll make chicken curry!`,
    `We're going for a run tomorrow. Do you want to go?`,
    `Do you want to come for dinner tomorrow? I'll make hot pot`,
    `How have you been? Have a great day`,
    `Do you want to come out for dinner tomorrow? I'm making seafood`,
    `I have to go shopping tomorrow. If you wish, I will pick you up`,
    `Are you free tomorrow? How about I come pick you up for seafood?`,
    `Hello! Wanna come over tonight? I'm making pasta`,
    `I am making black bone chicken soup and some drinks. Will you come for dinner?`
];

async function main() {
    const config = {
        host: 'localhost',
        port: 3307,
        user: 'root',
        password: '',
        database: 'massmail'
    };

    const conn = await mysql.createConnection(config);

    try {
        console.log("1. Fetching 5 Ready Accounts...");
        const [accounts] = await conn.query("SELECT id, phone FROM accounts WHERE status='Ready' LIMIT 5");
        
        if (accounts.length < 5) {
            console.warn(`Warning: Only found ${accounts.length} ready accounts.`);
        }
        console.log(`Using accounts: ${accounts.map(a => a.phone).join(', ')}`);

        console.log("\n2. Fetching 50 Targets...");
        // Try reading from file first, fallback to DB
        let targets = [];
        try {
            const content = fs.readFileSync(path.resolve('scripts/custom_data.txt'), 'utf8');
            targets = content.split('\n').map(l => l.trim()).filter(l => /^\d{8,}$/.test(l)).slice(0, 50);
        } catch (e) {
            console.log("Could not read custom_data.txt, fetching from DB...");
            const [rows] = await conn.query("SELECT DISTINCT target_phone FROM message_tasks LIMIT 50");
            targets = rows.map(r => r.target_phone);
        }
        console.log(`Found ${targets.length} targets.`);

        console.log("\n3. Queuing REAL Tasks (Pending)...");
        
        // We will insert them as 'Pending' so the Worker picks them up and "Sends" them.
        // We also want to simulate a reply ONLY AFTER it has been sent.
        
        const tasksToTrack = [];

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const account = accounts[i % accounts.length]; // Round-robin
            const msg = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
            const imageUrl = (i % 3 === 0) ? "https://picsum.photos/200/300" : null;

            // Insert as Pending
            const [res] = await conn.execute(
                "INSERT INTO message_tasks (account_id, target_phone, content, media_url, status, created_at) VALUES (?, ?, ?, ?, 'Pending', NOW())",
                [account.id, target, msg, imageUrl]
            );
            
            // Also ensure contact exists
            await conn.execute(
                `INSERT INTO contacts (phone, last_activity, updated_at) 
                 VALUES (?, NOW(), NOW()) 
                 ON DUPLICATE KEY UPDATE last_activity = NOW(), updated_at = NOW()`,
                [target]
            );

            tasksToTrack.push({
                taskId: res.insertId,
                target: target,
                accountId: account.id,
                replied: false
            });
        }

        console.log(`Queued ${tasksToTrack.length} tasks. Waiting for Worker to process...`);

        // Poll for completion and simulate reply
        let completed = 0;
        const startTime = Date.now();

        while (completed < tasksToTrack.length) {
            // Check status of tracked tasks
            // We can check in batches or one by one.
            const [rows] = await conn.query(
                `SELECT id, status FROM message_tasks WHERE id IN (${tasksToTrack.map(t => t.taskId).join(',')})`
            );

            for (const row of rows) {
                const task = tasksToTrack.find(t => t.taskId === row.id);
                if (task && !task.replied && (row.status === 'Sent' || row.status === 'Failed')) {
                    // Task processed!
                    
                    if (row.status === 'Sent') {
                        // Simulate Reply
                        console.log(`Task ${task.taskId} Sent to ${task.target}. Simulating reply...`);
                        
                        const replyMsg = `Reply from ${task.target}: Thanks for the invite!`;
                        await conn.execute(
                            "INSERT INTO message_tasks (account_id, target_phone, content, status, created_at) VALUES (?, ?, ?, 'Received', NOW())",
                            [task.accountId, task.target, replyMsg]
                        );

                        await conn.execute(
                            `UPDATE contacts SET last_activity = NOW(), updated_at = NOW(), unread_count = unread_count + 1 WHERE phone = ?`,
                            [task.target]
                        );
                    } else {
                        console.log(`Task ${task.taskId} Failed. No reply.`);
                    }

                    task.replied = true;
                    completed++;
                }
            }

            if (completed >= tasksToTrack.length) break;
            
            // Timeout safety
            if (Date.now() - startTime > 60000) {
                console.log("Timeout waiting for worker.");
                break;
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        console.log("\nTraffic Generation Complete.");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await conn.end();
    }
}

main();
