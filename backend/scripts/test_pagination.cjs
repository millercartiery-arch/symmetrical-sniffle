
const http = require('http');

function getTasks(page) {
    const url = `http://localhost:3000/api/tasks?page=${page}&limit=10`;
    console.log(`Fetching ${url}...`);
    http.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                console.log(`Page ${page}: Total=${json.total}, Items=${json.items?.length}`);
                if (json.items && json.items.length > 0) {
                    console.log(`First item ID: ${json.items[0].id}`);
                }
            } catch (e) {
                console.error("Parse error", e);
            }
        });
    });
}

getTasks(1);
setTimeout(() => getTasks(2), 1000);
