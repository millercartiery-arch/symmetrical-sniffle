import dotenv from 'dotenv';
dotenv.config();
const { pool } = await import('./dist/shared/db.js');
import bcrypt from 'bcrypt';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { baseName: 'testsub', password: 'subpassword', count: 1, parentUserId: undefined };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        let [key, val] = arg.split('=');
        key = key.replace(/^--/, '');
        if (val === undefined) {
            const next = args[i + 1];
            if (next && !next.startsWith('--')) {
                val = next;
                i++;
            } else {
                val = '';
            }
        }
        if (key === 'baseName') opts.baseName = val;
        if (key === 'password') opts.password = val;
        if (key === 'count') opts.count = Math.max(1, Math.min(1000, parseInt(val, 10) || 1));
        if (key === 'parentUserId') opts.parentUserId = val ? parseInt(val, 10) : undefined;
    }
    return opts;
}

async function verifySubAccountCreation() {
    const { baseName, password, count, parentUserId: parentFromArg } = parseArgs();
    const conn = await pool.getConnection();
    try {
        console.log('Attempting to verify sub-account creation...');

        let parentUserId = parentFromArg;
        if (!parentUserId) {
            const [users] = await conn.execute('SELECT id FROM users LIMIT 1');
            if (users.length === 0) {
                const hashedPassword = await bcrypt.hash('testpassword', 10);
                const [result] = await conn.execute(
                    'INSERT INTO users (username, password) VALUES (?, ?)',
                    ['testuser', hashedPassword]
                );
                parentUserId = result.insertId;
                console.log(`Created parent user with ID: ${parentUserId}`);
            } else {
                parentUserId = users[0].id;
                console.log(`Using existing parent user with ID: ${parentUserId}`);
            }
        } else {
            console.log(`Using provided parent user ID: ${parentUserId}`);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        console.log(`Creating ${count} sub-account(s) with baseName: ${baseName}`);

        const subAccountNames = [];
        for (let i = 0; i < count; i++) {
            subAccountNames.push(`${baseName}${i + 1}`);
        }

        const values = subAccountNames.map(name => [parentUserId, name, hashedPassword]);
        
        await conn.beginTransaction();
        const [insertResult] = await conn.query(
            `INSERT INTO sub_accounts (parent_user_id, name, password) VALUES ?`,
            [values]
        );
        await conn.commit();
        console.log(`Successfully created ${insertResult.affectedRows} sub-account(s).`);

        const [subAccounts] = await conn.execute(
            'SELECT id, name, password FROM sub_accounts WHERE parent_user_id = ? AND name LIKE ?',
            [parentUserId, `${baseName}%`]
        );

        if (subAccounts.length > 0) {
            console.log('Sub-accounts found:');
            for (const subAccount of subAccounts) {
                console.log(`  ID: ${subAccount.id}, Name: ${subAccount.name}`);
                const passwordMatch = await bcrypt.compare(password, subAccount.password);
                console.log(`  Password matches: ${passwordMatch}`);
            }
            console.log('Sub-account creation verification successful!');
        } else {
            console.error('Sub-account creation verification failed: No sub-accounts found.');
        }

    } catch (error) {
        await conn.rollback();
        console.error('Error during sub-account creation verification:', error.message);
    } finally {
        conn.release();
        pool.end(); // Close the connection pool after verification
    }
}

verifySubAccountCreation();
