
import fs from 'fs';
import path from 'path';

async function main() {
    const filePath = 'c:\\Users\\carti\\Desktop\\测试包.txt';
    const apiUrl = 'http://localhost:3000/api';

    console.log(`Reading file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    console.log(`Found ${lines.length} lines.`);

    const accounts = lines.map((line, index) => {
        try {
            return JSON.parse(line.trim());
        } catch (e) {
            console.error(`Failed to parse line ${index + 1}:`, e.message);
            return null;
        }
    }).filter(a => a);

    console.log(`Parsed ${accounts.length} valid JSON objects.`);

    if (accounts.length === 0) {
        console.error("No valid accounts found.");
        return;
    }

    // 1. Import Accounts
    console.log("Importing accounts...");
    try {
        const res = await fetch(`${apiUrl}/tn-accounts/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accounts })
        });
        const data = await res.json();
        console.log("Import Response:", JSON.stringify(data, null, 2));

        if (!data.success) {
            console.error("Import failed.");
            return;
        }
    } catch (e) {
        console.error("Import Request Failed:", e.message);
        return;
    }

    // 2. Create Campaign
    console.log("Creating Campaign...");
    try {
        const targets = accounts.slice(0, 5).map(a => a.phone).join('\n');
        
        const res = await fetch(`${apiUrl}/user/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: "Test Import Campaign",
                content: "Hello from Test Script",
                targets: targets
            })
        });
        const data = await res.json();
        console.log("Campaign Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Campaign Request Failed:", e.message);
    }
}

main().catch(console.error);
