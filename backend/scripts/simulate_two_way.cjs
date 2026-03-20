
const http = require('http');

const CHAT_NUMBERS = [
    '9546266820',
    '8452651377',
    '2297406901',
    '7817559058',
    '5637485426'
];

const OTHER_NUMBERS = [
    '12025550101',
    '12025550102'
];

const API_BASE = 'http://localhost:3000/api';

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api' + path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function simulateChat(targetPhone, index) {
    console.log(`\n--- Simulating Chat with ${targetPhone} ---`);

    // 1. Outbound: System -> Target
    const outboundContent = `Hello ${targetPhone}, this is message ${index + 1} from system.`;
    console.log(`[Outbound] Sending: "${outboundContent}"`);
    
    try {
        const sendRes = await request('POST', '/user/chat/send', {
            peerPhone: targetPhone,
            content: outboundContent
        });
        console.log(`[Outbound] Result:`, sendRes);
    } catch (e) {
        console.error(`[Outbound] Failed:`, e.message);
    }

    // Wait a bit
    await new Promise(r => setTimeout(r, 1000));

    // 2. Inbound: Target -> System
    const inboundContent = `Hi system! I received your message. This is ${targetPhone}.`;
    console.log(`[Inbound] Receiving: "${inboundContent}"`);

    try {
        const inboundRes = await request('POST', '/inbound/tn', {
            phone: targetPhone,
            content: inboundContent,
            externalId: `msg_in_${Date.now()}_${index}`
        });
        console.log(`[Inbound] Result:`, inboundRes);
    } catch (e) {
        console.error(`[Inbound] Failed:`, e.message);
    }
}

async function main() {
    console.log("Starting Two-Way Chat Simulation...");

    // 1. Chat with specific numbers
    console.log("\n>>> Phase 1: Chat Numbers from Desktop File");
    for (let i = 0; i < CHAT_NUMBERS.length; i++) {
        await simulateChat(CHAT_NUMBERS[i], i);
        await new Promise(r => setTimeout(r, 500));
    }

    // 2. Chat with other numbers
    console.log("\n>>> Phase 2: Other Random Numbers");
    for (let i = 0; i < OTHER_NUMBERS.length; i++) {
        await simulateChat(OTHER_NUMBERS[i], i + 5);
        await new Promise(r => setTimeout(r, 500));
    }

    console.log("\nSimulation Complete.");
}

main().catch(console.error);
