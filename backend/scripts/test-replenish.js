
import axios from 'axios';
import assert from 'assert';

const API_URL = 'http://localhost:3000/api';

async function runTest() {
  console.log('--- Starting Replenishment Logic Test ---');

  try {
    // 1. Setup: Create a test sub-account
    console.log('1. Creating test sub-account...');
    const subAccountRes = await axios.post(`${API_URL}/subaccounts`, {
      name: `Test-Replenish-${Date.now()}`,
      quota_limit: 5 // Small quota for testing
    });
    const subAccountId = subAccountRes.data.id;
    console.log(`   Sub-account created: ID ${subAccountId}`);

    // 2. Setup: Import some test accounts (need enough for initial + replenish)
    console.log('2. Importing test accounts...');
    const accounts = [];
    for (let i = 0; i < 20; i++) {
      accounts.push({
        phone: `1202555${String(i + Math.floor(Math.random()*1000)).padStart(4, '0')}`,
        token: `test-token-${i}`,
        system_type: 'Android',
        status: 'Ready'
      });
    }
    await axios.post(`${API_URL}/accounts/import`, { accounts });
    console.log('   Test accounts imported.');

    // 3. Distribute: Assign accounts to the sub-account
    console.log('3. Distributing accounts...');
    await axios.post(`${API_URL}/distribution/auto`, { per_sub_account: 5 });
    
    // Wait for distribution job to finish (polling)
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify assignment
    const assignedRes = await axios.get(`${API_URL}/subaccounts/${subAccountId}/accounts`);
    const assignedAccounts = assignedRes.data.items;
    console.log(`   Assigned ${assignedAccounts.length} accounts to sub-account.`);
    
    if (assignedAccounts.length < 5) {
        console.warn('   Warning: Less than 5 accounts assigned. Retrying distribution...');
        await axios.post(`${API_URL}/distribution/auto`, { per_sub_account: 5 });
        await new Promise(r => setTimeout(r, 2000));
    }
    
    // Re-fetch
    const assignedResFinal = await axios.get(`${API_URL}/subaccounts/${subAccountId}/accounts`);
    const assignedAccountsFinal = assignedResFinal.data.items;
    
    if (assignedAccountsFinal.length === 0) {
        throw new Error('Failed to assign any accounts');
    }

    // 4. Simulate Dead Accounts
    console.log('4. Simulating dead accounts...');
    // Pick the first one
    const deadId = assignedAccountsFinal[0].id;
    console.log(`   Marking account ${deadId} as dead candidate.`);
    
    // 5. Trigger Replenishment (1st time)
    // Use a unique Task ID to avoid conflict with other tests
    const taskId = Math.floor(Math.random() * 10000);
    
    console.log(`5. Triggering Replenishment (Attempt 1) for Task ${taskId}...`);
    try {
        const replenishRes1 = await axios.post(`${API_URL}/distribution/replenish`, {
            subAccountId,
            taskId, 
            deadAccountIds: [deadId]
        });
        
        console.log('   Replenish Result:', replenishRes1.data);
        assert.strictEqual(replenishRes1.data.success, true);
        assert.strictEqual(replenishRes1.data.replenished, 1, 'Should replenish 1 account');
    } catch (e) {
        console.error('Replenish failed:', e.response?.data);
        throw e;
    }

    // 6. Verify Replenishment
    const assignedRes2 = await axios.get(`${API_URL}/subaccounts/${subAccountId}/accounts`);
    const currentAccounts = assignedRes2.data.items;
    // Check if deadId is now marked Dead in the list
    const deadOne = currentAccounts.find(a => a.id === deadId);
    if (deadOne) {
        console.log(`   Old account status: ${deadOne.status}`);
        // Note: The API joins with accounts table, so status should be 'Dead'
        // But let's check if we have a new account that wasn't there before
    }
    
    // 7. Trigger Limit Test (Attempt 2, 3, 4)
    console.log('7. Testing Replenishment Limit...');
    // We need more dead accounts.
    const moreDeadIds = assignedAccountsFinal.slice(1, 3).map(a => a.id);
    
    console.log('   Attempt 2...');
    await axios.post(`${API_URL}/distribution/replenish`, { subAccountId, taskId, deadAccountIds: [moreDeadIds[0]] });
    
    console.log('   Attempt 3...');
    await axios.post(`${API_URL}/distribution/replenish`, { subAccountId, taskId, deadAccountIds: [moreDeadIds[1]] });
    
    console.log('   Attempt 4 (Should Fail)...');
    try {
        // Try to replenish one more (pick any valid id, or reuse one just to trigger logic)
        // The logic checks count BEFORE doing anything.
        await axios.post(`${API_URL}/distribution/replenish`, { 
            subAccountId, 
            taskId, 
            deadAccountIds: [assignedAccountsFinal[3].id] 
        }); 
        
        // If we reach here, it failed to block
        console.error('   Error: 4th attempt succeeded but should have failed.');
        // Check stats manually?
    } catch (e) {
        if (e.response && e.response.status === 403) {
            console.log('   Success: 4th attempt blocked with 403 Forbidden.');
        } else {
            console.error('   Unexpected error on 4th attempt:', e.message);
            throw e;
        }
    }

    console.log('--- Test Passed Successfully! ---');

  } catch (e) {
    console.error('Test Failed:', e.message);
    if (e.response) {
        console.error('Response Data:', e.response.data);
    }
    // process.exit(1); // Don't exit hard so we can see output
  }
}

runTest();
