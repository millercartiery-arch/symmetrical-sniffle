#!/usr/bin/env node
/**
 * 数据库迁移脚本 - 添加多租户支持
 * 
 * 为所有主要表添加 tenant_id 字段
 * 默认将所有现有数据设置为租户 1
 */

import mysql from 'mysql2/promise';

async function main() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3307,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: 'massmail'
    };

    try {
        console.log('📡 连接到数据库...');
        const conn = await mysql.createConnection(config);

        console.log('\n✏️ 开始添加多租户支持...\n');

        // 1. 添加 tenant_id 到 users 表
        console.log('[1/5] 更新 users 表...');
        try {
            await conn.query(`
                ALTER TABLE users ADD COLUMN tenant_id INT DEFAULT 1 NOT NULL
            `);
            console.log('✅ 已添加 tenant_id 到 users 表');
        } catch (e: any) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('⏭️ tenant_id 已存在于 users 表');
            } else {
                throw e;
            }
        }

        // 2. 添加 tenant_id 到 accounts 表
        console.log('\n[2/5] 更新 accounts 表...');
        try {
            await conn.query(`
                ALTER TABLE accounts ADD COLUMN tenant_id INT DEFAULT 1 NOT NULL
            `);
            console.log('✅ 已添加 tenant_id 到 accounts 表');
        } catch (e: any) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('⏭️ tenant_id 已存在于 accounts 表');
            } else {
                throw e;
            }
        }

        // 3. 添加 tenant_id 到 campaigns 表
        console.log('\n[3/5] 更新 campaigns 表...');
        try {
            await conn.query(`
                ALTER TABLE campaigns ADD COLUMN tenant_id INT DEFAULT 1 NOT NULL
            `);
            console.log('✅ 已添加 tenant_id 到 campaigns 表');
        } catch (e: any) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('⏭️ tenant_id 已存在于 campaigns 表');
            } else {
                throw e;
            }
        }

        // 4. 添加 tenant_id 到 message_tasks 表
        console.log('\n[4/5] 更新 message_tasks 表...');
        try {
            await conn.query(`
                ALTER TABLE message_tasks ADD COLUMN tenant_id INT DEFAULT 1 NOT NULL
            `);
            console.log('✅ 已添加 tenant_id 到 message_tasks 表');
        } catch (e: any) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('⏭️ tenant_id 已存在于 message_tasks 表');
            } else {
                throw e;
            }
        }

        // 5. 添加 tenant_id 到 audit_logs 表
        console.log('\n[5/5] 更新 audit_logs 表...');
        try {
            await conn.query(`
                ALTER TABLE audit_logs ADD COLUMN tenant_id INT DEFAULT 1 NOT NULL
            `);
            console.log('✅ 已添加 tenant_id 到 audit_logs 表');
        } catch (e: any) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('⏭️ tenant_id 已存在于 audit_logs 表');
            } else {
                throw e;
            }
        }

        // 添加索引以优化租户查询性能
        console.log('\n📊 添加索引以优化性能...');
        const tables = ['users', 'accounts', 'campaigns', 'message_tasks', 'audit_logs'];
        for (const table of tables) {
            try {
                await conn.query(`
                    ALTER TABLE ${table} ADD INDEX idx_tenant_id (tenant_id)
                `);
                console.log(`✅ 已在 ${table} 表添加 tenant_id 索引`);
            } catch (e: any) {
                if (e.code === 'ER_DUP_KEYNAME') {
                    console.log(`⏭️ ${table} 表中 tenant_id 索引已存在`);
                } else {
                    // 某些错误可以忽略
                    console.log(`⚠️ ${table} 表: ${e.message}`);
                }
            }
        }

        console.log('\n✅ 多租户迁移完成！');
        console.log('   - 所有现有数据已设置为租户 ID 1');
        console.log('   - 新的行将自动获得租户 ID');
        console.log('   - 已为所有 tenant_id 列添加索引\n');

        await conn.end();
    } catch (err: any) {
        console.error('❌ 迁移失败：', err.message);
        process.exit(1);
    }
}

main().catch(console.error);
