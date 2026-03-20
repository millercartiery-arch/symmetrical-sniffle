
const http = require('http');

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
                    console.log("Raw response:", data);
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function main() {
    console.log("1. Fetching conversations...");
    const convs = await request('GET', '/user/chat/conversations?limit=5');
    
    if (!convs.data || convs.data.length === 0) {
        console.log("No conversations found to test.");
        return;
    }

    const target = convs.data[0];
    console.log(`Target phone: ${target.phone}, Pinned: ${target.pinned}, Banned: ${target.banned}`);

    console.log("\n2. Pinning conversation...");
    await request('POST', `/user/chat/conversations/${target.phone}/pin`, { pinned: true });
    
    console.log("3. Verifying Pin...");
    const convs2 = await request('GET', '/user/chat/conversations?limit=5');
    const target2 = convs2.data.find(c => c.phone === target.phone);
    console.log(`Target phone: ${target2.phone}, Pinned: ${target2.pinned} (Expected: 1/true)`);

    console.log("\n4. Banning conversation...");
    await request('POST', `/user/chat/conversations/${target.phone}/ban`, { banned: true });
    
    console.log("5. Verifying Ban...");
    const convs3 = await request('GET', '/user/chat/conversations?limit=5');
    const target3 = convs3.data.find(c => c.phone === target.phone);
    console.log(`Target phone: ${target3.phone}, Banned: ${target3.banned} (Expected: 1/true)`);

    console.log("\n6. Cleaning up (Unpin, Unban)...");
    await request('POST', `/user/chat/conversations/${target.phone}/pin`, { pinned: false });
    await request('POST', `/user/chat/conversations/${target.phone}/ban`, { banned: false });
    
    console.log("Done.");
}

main().catch(console.error);
