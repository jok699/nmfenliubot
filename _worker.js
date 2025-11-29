// worker.js - 修复数据库表结构和遮罩开关功能
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        console.log(`Request: ${request.method} ${pathname}`);

        // 检查环境变量是否设置
        if (!env.BOT_TOKEN || env.BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
            return new Response(JSON.stringify({
                success: false,
                error: 'BOT_TOKEN环境变量未正确设置',
                instructions: '请在Cloudflare Worker的环境变量中设置BOT_TOKEN'
            }, null, 2), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 处理webhook设置和数据库初始化（合并功能）
        if (pathname === '/webhook') {
            if (request.method === 'GET') {
                return await setupWebhookAndInit(request, env);
            } else if (request.method === 'POST') {
                return await handleUpdate(request, env);
            }
        }
        
        // 测试机器人token
        if (pathname === '/test' && request.method === 'GET') {
            return await testBotToken(env);
        }
        
        // 删除webhook
        if (pathname === '/delete-webhook' && request.method === 'GET') {
            return await deleteWebhook(env);
        }
        
        // 获取webhook信息
        if (pathname === '/webhook-info' && request.method === 'GET') {
            return await getWebhookInfo(env);
        }

        // 显示设置指南
        if (pathname === '/setup' && request.method === 'GET') {
            return showSetupGuide(request, env);
        }

        // 数据库迁移端点
        if (pathname === '/migrate' && request.method === 'GET') {
            return await migrateDatabase(env);
        }

        // 默认响应
        return new Response(`Telegram Bot is running!

可用端点:
GET  /setup - 设置指南
GET  /test - 测试Bot Token
GET  /webhook - 设置webhook并初始化数据库
POST /webhook - Telegram webhook端点
GET  /delete-webhook - 删除webhook
GET  /webhook-info - 获取webhook信息
GET  /migrate - 数据库迁移
        `.trim(), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    },
};

function showSetupGuide(request, env) {
    const webhookUrl = `${new URL(request.url).origin}/webhook`;
    
    const guide = `# Telegram Bot 设置指南

## 1. 环境变量设置
在Cloudflare Worker中设置以下环境变量：
- BOT_TOKEN: 您的Telegram Bot Token
- ADMIN_IDS: 管理员用户ID（多个用逗号分隔）

## 2. 数据库设置
绑定D1数据库，绑定名称为 "DB"

## 3. 初始化步骤
只需访问一次即可完成所有设置：
访问: ${new URL(request.url).origin}/webhook

## 4. 当前配置状态
- BOT_TOKEN: ${env.BOT_TOKEN ? '✅ 已设置' : '❌ 未设置'}
- ADMIN_IDS: ${env.ADMIN_IDS ? '✅ 已设置' : '❌ 未设置'} 
- 数据库: ${env.DB ? '✅ 已绑定' : '❌ 未绑定'}
- Webhook URL: ${webhookUrl}

## 5. 开始使用
在Telegram中向您的机器人发送 /start

## 6. 故障排除
如果遇到问题，请检查：
1. Bot Token是否正确
2. 机器人是否通过 @BotFather 创建
3. 环境变量是否已保存并部署
4. 数据库是否正确绑定`;

    return new Response(guide, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

async function testBotToken(env) {
    try {
        const testUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`;
        console.log('Testing Bot Token...');
        
        const response = await fetch(testUrl);
        const result = await response.json();
        
        console.log('Bot test result:', JSON.stringify(result));
        
        if (result.ok) {
            return new Response(JSON.stringify({
                success: true,
                message: 'Bot Token 有效！',
                bot_info: {
                    id: result.result.id,
                    username: result.result.username,
                    first_name: result.result.first_name
                },
                token_preview: `${env.BOT_TOKEN.substring(0, 10)}...`
            }, null, 2), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } else {
            return new Response(JSON.stringify({
                success: false,
                error: `Bot Token 无效: ${result.description || 'Unknown error'}`,
                token_preview: `${env.BOT_TOKEN.substring(0, 10)}...`,
                troubleshooting: [
                    '检查Bot Token是否正确',
                    '确保机器人已通过@BotFather创建',
                    '检查Token格式是否正确'
                ]
            }, null, 2), {
                status: 400,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: `测试失败: ${error.message}`,
            token_preview: env.BOT_TOKEN ? `${env.BOT_TOKEN.substring(0, 10)}...` : '未设置'
        }, null, 2), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

// 新增：数据库迁移函数
async function migrateDatabase(env) {
    try {
        console.log('Starting database migration...');
        
        let migrationSteps = [];
        
        // 检查 media_channel 表是否存在 spoiler_enabled 列
        try {
            const testResult = await env.DB.prepare('SELECT spoiler_enabled FROM media_channel LIMIT 1').first();
            console.log('✅ spoiler_enabled column exists');
            migrationSteps.push('✅ spoiler_enabled 列已存在');
        } catch (error) {
            if (error.message.includes('no such column: spoiler_enabled')) {
                console.log('❌ spoiler_enabled column missing, adding it...');
                
                // 添加缺失的列
                try {
                    await env.DB.prepare(`
                        ALTER TABLE media_channel ADD COLUMN spoiler_enabled BOOLEAN DEFAULT true
                    `).run();
                    console.log('✅ Added spoiler_enabled column to media_channel table');
                    migrationSteps.push('✅ 已添加 spoiler_enabled 列到 media_channel 表');
                    
                    // 更新现有记录的默认值
                    const updateResult = await env.DB.prepare(`
                        UPDATE media_channel SET spoiler_enabled = true WHERE spoiler_enabled IS NULL
                    `).run();
                    console.log('✅ Updated existing records with default spoiler_enabled value');
                    migrationSteps.push(`✅ 已更新现有记录，设置默认遮罩状态，影响 ${updateResult.changes} 条记录`);
                } catch (alterError) {
                    console.error('Error adding column:', alterError);
                    migrationSteps.push(`❌ 添加列失败: ${alterError.message}`);
                }
            } else {
                console.error('Unexpected error checking column:', error);
                migrationSteps.push(`❌ 检查列时出现意外错误: ${error.message}`);
            }
        }
        
        return new Response(JSON.stringify({
            success: true,
            message: 'Database migration completed',
            steps: migrationSteps
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Migration error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function setupWebhookAndInit(request, env) {
    try {
        const webhookUrl = `${new URL(request.url).origin}/webhook`;
        console.log('Setting webhook to:', webhookUrl);
        
        // 先测试token是否有效
        const testUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`;
        const testResponse = await fetch(testUrl);
        const testResult = await testResponse.json();
        
        if (!testResult.ok) {
            return new Response(JSON.stringify({
                success: false,
                error: `Bot Token无效: ${testResult.description}`,
                token_preview: `${env.BOT_TOKEN.substring(0, 10)}...`,
                suggestion: '请检查BOT_TOKEN环境变量是否正确设置'
            }, null, 2), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 初始化数据库
        const initResult = await initDatabase(env);
        if (!initResult.success) {
            return new Response(JSON.stringify({
                success: false,
                error: `数据库初始化失败: ${initResult.error}`,
                suggestion: '请检查D1数据库是否正确绑定'
            }, null, 2), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 运行数据库迁移以确保表结构正确
        console.log('Running database migration...');
        const migrateResult = await migrateDatabase(env);
        const migrateData = await migrateResult.json();
        console.log('Migration result:', migrateData);

        // 设置webhook
        const setupUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
        console.log('Setup URL:', setupUrl);
        
        const response = await fetch(setupUrl);
        const result = await response.json();
        
        console.log('Webhook setup result:', JSON.stringify(result));

        return new Response(JSON.stringify({
            success: result.ok,
            message: result.ok ? 
                '✅ 系统初始化完成！Webhook设置成功，数据库已初始化。' : 
                `Webhook设置失败: ${result.description}`,
            webhook_url: webhookUrl,
            bot_info: testResult.result,
            database_init: initResult.message,
            migration: migrateData,
            details: result
        }, null, 2), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        console.error('Webhook setup error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            webhook_url: `${new URL(request.url).origin}/webhook`,
            troubleshooting: '检查网络连接和Bot Token格式'
        }, null, 2), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

async function initDatabase(env) {
    try {
        if (!env.DB) {
            return {
                success: false,
                error: '数据库未绑定'
            };
        }

        // 测试数据库连接
        try {
            const testResult = await env.DB.prepare('SELECT 1 as test').first();
            console.log('Database connection test:', testResult);
        } catch (testError) {
            console.error('Database connection test failed:', testError);
            return {
                success: false,
                error: '数据库连接测试失败: ' + testError.message
            };
        }

        // 创建用户设置表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS userset (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                selected_channel TEXT,
                anonymous BOOLEAN DEFAULT true,
                editing_channel TEXT,
                pinned_message_id INTEGER,
                pinned_channel_id TEXT,
                is_admin_mode BOOLEAN DEFAULT false,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        // 创建频道选项表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS channel_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                row_number INTEGER NOT NULL,
                position INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        // 创建管理员设置表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS adminset (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                button_name TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        // 创建多媒体频道设置表 - 确保包含 spoiler_enabled 列
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS media_channel (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL UNIQUE,
                spoiler_enabled BOOLEAN DEFAULT true,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        // 检查是否已有频道数据
        const existingChannels = await env.DB.prepare('SELECT COUNT(*) as count FROM channel_options').first();
        
        if (existingChannels.count === 0) {
            // 插入默认频道选项
            const defaultChannels = [
                { name: '频道A', channel_id: 'channel_a', row: 1, pos: 0 },
                { name: '频道B', channel_id: 'channel_b', row: 1, pos: 1 },
                { name: '频道C', channel_id: 'channel_c', row: 1, pos: 2 },
                { name: '频道D', channel_id: 'channel_d', row: 2, pos: 0 },
                { name: '频道E', channel_id: 'channel_e', row: 2, pos: 1 },
                { name: '频道F', channel_id: 'channel_f', row: 2, pos: 2 },
            ];

            for (const channel of defaultChannels) {
                await env.DB.prepare(`
                    INSERT INTO channel_options (name, channel_id, row_number, position)
                    VALUES (?, ?, ?, ?)
                `).bind(channel.name, channel.channel_id, channel.row, channel.pos).run();
            }
        }

        // 检查是否已有媒体频道数据，如果没有则插入默认记录
        const existingMediaChannel = await env.DB.prepare('SELECT COUNT(*) as count FROM media_channel').first();
        
        if (existingMediaChannel.count === 0) {
            console.log('Inserting default media channel record...');
            try {
                await env.DB.prepare(`
                    INSERT INTO media_channel (channel_id, spoiler_enabled)
                    VALUES (?, ?)
                `).bind('default_media_channel', true).run();
                console.log('✅ Default media channel record inserted successfully');
            } catch (insertError) {
                console.error('❌ Failed to insert default media channel record:', insertError);
            }
        } else {
            console.log('Media channel record already exists');
        }

        return {
            success: true,
            message: '数据库表结构已创建并填充默认频道数据'
        };
    } catch (error) {
        console.error('Database init error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function deleteWebhook(env) {
    try {
        const deleteUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`;
        const response = await fetch(deleteUrl);
        const result = await response.json();
        
        return new Response(JSON.stringify({
            success: result.ok,
            message: result.description || 'Webhook已删除'
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function getWebhookInfo(env) {
    try {
        const infoUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getWebhookInfo`;
        const response = await fetch(infoUrl);
        const result = await response.json();
        
        return new Response(JSON.stringify({
            success: result.ok,
            webhook_info: result.result
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleUpdate(request, env) {
    try {
        const update = await request.json();
        console.log('Received update:', JSON.stringify(update));
        
        if (update.message) {
            await handleMessage(update.message, env);
        } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query, env);
        }
        
        return new Response('OK');
    } catch (error) {
        console.error('Error handling update:', error);
        return new Response('Error', { status: 500 });
    }
}

async function handleMessage(message, env) {
    try {
        const chatId = message.chat.id;
        const text = message.text || '';
        const userId = message.from.id;
        
        console.log(`Message from ${userId}: ${text}`);
        
        // 忽略机器人自己发送的消息和置顶消息事件
        if (message.from.is_bot) {
            console.log('Ignoring message from bot');
            return;
        }
        
        if (message.pinned_message) {
            console.log('Ignoring pinned message event');
            return;
        }
        
        // 检查是否是管理员
        const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
        const isAdmin = adminIds.includes(userId);
        
        // 检查用户是否在管理员模式下
        const userMode = await getUserMode(userId, env);
        
        // 检查广播模式
        if (isAdmin && !userMode) {
            const broadcastMode = await env.DB.prepare(
                'SELECT editing_channel FROM userset WHERE user_id = ? AND editing_channel = "broadcast_mode"'
            ).bind(userId).first();
            
            if (broadcastMode) {
                console.log('Admin in broadcast mode, broadcasting message to all users');
                await handleBroadcastMessage(chatId, message, env);
                return;
            }
        }
        
        // 处理 /start 命令 - 最优先
        if (text === '/start') {
            console.log('Processing /start command');
            
            console.log(`User ${userId} is admin: ${isAdmin}, in user mode: ${userMode}`);
            
            if (isAdmin && !userMode) {
                await showAdminMainMenu(chatId, env);
            } else {
                await showUserChannelSelection(chatId, env, userId);
            }
            return;
        }
        
        // 检查编辑状态（管理员功能）
        let editingInfo = null;
        try {
            editingInfo = await env.DB.prepare(
                'SELECT editing_channel FROM userset WHERE user_id = ?'
            ).bind(userId).first();
        } catch (dbError) {
            console.error('Database error checking editing state:', dbError);
        }
        
        if (editingInfo && editingInfo.editing_channel) {
            if (editingInfo.editing_channel === 'media_channel_setup') {
                await handleMediaChannelSetup(chatId, text, userId, env);
                return;
            } else if (editingInfo.editing_channel !== 'broadcast_mode') {
                await handleChannelEdit(chatId, text, userId, env);
                return;
            }
        }
        
        // 检查用户是否有持久化设置
        const userSettings = await getUserSettings(userId, env);
        
        // 只有当用户已经完成设置（选择了频道和匿名状态）时才处理消息
        if (userSettings && userSettings.selected_channel && userSettings.anonymous !== undefined) {
            console.log('User has complete settings, processing message');
            await handleUserMessage(chatId, message, env);
            return;
        }
        
        // 如果上面的条件不满足，显示相应菜单
        console.log('User settings incomplete or other condition, showing menu');
        
        if (isAdmin && !userMode) {
            await showAdminMainMenu(chatId, env);
        } else {
            await showUserChannelSelection(chatId, env, userId);
        }
        
    } catch (error) {
        console.error('Error in handleMessage:', error);
        try {
            await sendMessage(chatId, '系统错误，请稍后重试。', env, null);
        } catch (e) {
            console.error('Failed to send error message:', e);
        }
    }
}

// 处理用户消息（优化匿名消息处理）
async function handleUserMessage(chatId, message, env) {
    const userId = message.from.id;
    const user = message.from;
    const text = message.text || '';
    
    const userSettings = await getUserSettings(userId, env);
    if (!userSettings || !userSettings.selected_channel) {
        await sendMessage(chatId, '请先选择频道和发言方式。', env, null);
        return;
    }
    
    const channelId = userSettings.selected_channel;
    const channelName = await getChannelName(channelId, env);
    
    try {
        // 1. 文字消息 - 发送到指定频道
        if (message.text) {
            let messageText = text;
            
            // 只有在非匿名模式下才添加用户信息
            if (!userSettings.anonymous) {
                // 构建用户显示名称
                let displayName = '';
                if (user.username) {
                    displayName = `@${user.username}`;
                } else if (user.first_name) {
                    displayName = user.first_name;
                    if (user.last_name) {
                        displayName += ` ${user.last_name}`;
                    }
                } else {
                    displayName = '用户';
                }
                messageText += `<b> —— 来自 ${displayName} (ID: ${userId})</b>`;
            }
            
            const sentMessage = await sendMessage(channelId, messageText, env, null);
            
            if (sentMessage && sentMessage.ok) {
                const modeText = userSettings.anonymous ? '匿名' : '实名';
                await sendMessage(chatId, `✅ 消息已${modeText}发送到${channelName}！`, env, null);
            } else {
                await sendMessage(chatId, `❌ 发送到 ${channelName} 失败。`, env, null);
            }
            return;
        }
        
        // 2. 语音消息 - 发送到指定频道
        if (message.voice) {
            let caption = message.caption || '';
            
            // 只有在非匿名模式下才添加用户信息
            if (!userSettings.anonymous) {
                let displayName = '';
                if (user.username) {
                    displayName = `@${user.username}`;
                } else if (user.first_name) {
                    displayName = user.first_name;
                    if (user.last_name) {
                        displayName += ` ${user.last_name}`;
                    }
                } else {
                    displayName = '用户';
                }
                caption += `<b>—— 来自 ${displayName} (ID: ${userId})</b>`;
            }
            
            const sentVoice = await sendVoice(channelId, message.voice.file_id, caption, env);
            
            if (sentVoice && sentVoice.ok) {
                const modeText = userSettings.anonymous ? '匿名' : '实名';
                await sendMessage(chatId, `✅ 语音消息已${modeText}发送到${channelName}！`, env, null);
            } else {
                await sendMessage(chatId, `❌ 发送到 ${channelName} 失败。`, env, null);
            }
            return;
        }
        
        // 3. 视频消息（包括在线录制的视频）- 转发到多媒体频道
        if (message.video || message.video_note) {
            const mediaChannel = await getMediaChannel(env);
            if (!mediaChannel) {
                await sendMessage(chatId, '❌ 多媒体频道未设置，无法转发视频内容。', env, null);
                return;
            }
            
            // 检查遮罩是否启用
            const spoilerEnabled = await isSpoilerEnabled(env);
            
            // 处理普通视频
            if (message.video) {
                const originalCaption = message.caption || '';
                let caption = originalCaption;
                
                // 只有在非匿名模式下才添加用户信息
                if (!userSettings.anonymous) {
                    let displayName = '';
                    if (user.username) {
                        displayName = `@${user.username}`;
                    } else if (user.first_name) {
                        displayName = user.first_name;
                        if (user.last_name) {
                            displayName += ` ${user.last_name}`;
                        }
                    } else {
                        displayName = '用户';
                    }
                    caption += `<b> from ${displayName} #${channelName}</b>`;
                }
                
                let forwardResult;
                if (spoilerEnabled) {
                    forwardResult = await sendVideoWithSpoiler(mediaChannel, message.video.file_id, caption, env);
                } else {
                    forwardResult = await sendVideo(mediaChannel, message.video.file_id, caption, env);
                }
                
                if (forwardResult && forwardResult.ok) {
                    const maskText = spoilerEnabled ? '已添加遮罩并' : '';
                    await sendMessage(chatId, `✅ 视频${maskText}发送成功！`, env, null);
                } else {
                    await sendMessage(chatId, `❌ 发送失败。`, env, null);
                }
                return;
            }
            
            // 处理在线录制的视频（video_note）
            if (message.video_note) {
                let caption = '';
                
                // 只有在非匿名模式下才添加用户信息
                if (!userSettings.anonymous) {
                    let displayName = '';
                    if (user.username) {
                        displayName = `@${user.username}`;
                    } else if (user.first_name) {
                        displayName = user.first_name;
                        if (user.last_name) {
                            displayName += ` ${user.last_name}`;
                        }
                    } else {
                        displayName = '用户';
                    }
                    caption = `<b> from ${displayName} #${channelName}</b>`;
                }
                
                let forwardResult;
                if (spoilerEnabled) {
                    forwardResult = await sendVideoNoteWithSpoiler(mediaChannel, message.video_note.file_id, caption, env);
                } else {
                    forwardResult = await sendVideoNote(mediaChannel, message.video_note.file_id, caption, env);
                }
                
                if (forwardResult && forwardResult.ok) {
                    const maskText = spoilerEnabled ? '已添加遮罩并' : '';
                    await sendMessage(chatId, `✅ 视频消息${maskText}发送成功！`, env, null);
                } else {
                    await sendMessage(chatId, `❌ 发送失败。`, env, null);
                }
                return;
            }
        }
        
        // 4. 图片消息 - 转发到多媒体频道
        if (message.photo) {
            const mediaChannel = await getMediaChannel(env);
            if (!mediaChannel) {
                await sendMessage(chatId, '❌ 多媒体频道未设置，无法转发图片内容。', env, null);
                return;
            }
            
            // 检查遮罩是否启用
            const spoilerEnabled = await isSpoilerEnabled(env);
            
            const photo = message.photo[message.photo.length - 1]; // 获取最高质量图片
            const originalCaption = message.caption || '';
            let caption = originalCaption;
            
            // 只有在非匿名模式下才添加用户信息
            if (!userSettings.anonymous) {
                let displayName = '';
                if (user.username) {
                    displayName = `@${user.username}`;
                } else if (user.first_name) {
                    displayName = user.first_name;
                    if (user.last_name) {
                        displayName += ` ${user.last_name}`;
                    }
                } else {
                    displayName = '用户';
                }
                caption += `<b> from ${displayName} #${channelName}</b>`;
            }
            
            let forwardResult;
            if (spoilerEnabled) {
                forwardResult = await sendPhotoWithSpoiler(mediaChannel, photo.file_id, caption, env);
            } else {
                forwardResult = await sendPhoto(mediaChannel, photo.file_id, caption, env);
            }
            
            if (forwardResult && forwardResult.ok) {
                const maskText = spoilerEnabled ? '已添加遮罩并' : '';
                await sendMessage(chatId, `✅ 图片${maskText}发送成功！`, env, null);
            } else {
                await sendMessage(chatId, `❌ 发送失败。`, env, null);
            }
            return;
        }
        
        // 5. 贴纸消息 - 直接截断不发送
        if (message.sticker) {
            await sendMessage(chatId, '❌ 贴纸消息暂不支持发送。', env, null);
            return;
        }
        
        // 6. 其他不支持的消息类型
        await sendMessage(chatId, '❌ 不支持的消息类型。', env, null);
        
    } catch (error) {
        console.error('Error handling user message:', error);
        await sendMessage(chatId, '❌ 发送失败，请稍后重试。', env, null);
    }
}

// 检查遮罩是否启用
async function isSpoilerEnabled(env) {
    try {
        const result = await env.DB.prepare(
            'SELECT spoiler_enabled FROM media_channel LIMIT 1'
        ).first();
        
        console.log('Current spoiler status from DB:', result ? result.spoiler_enabled : 'no record');
        return result ? result.spoiler_enabled : true; // 默认启用
    } catch (error) {
        console.error('Error checking spoiler status:', error);
        return true; // 默认启用
    }
}

// 彻底修复：切换遮罩状态
async function toggleSpoiler(env) {
    try {
        console.log('Starting toggleSpoiler function...');
        
        // 获取当前状态
        const currentStatus = await isSpoilerEnabled(env);
        const newStatus = !currentStatus;
        
        console.log(`Toggling spoiler from ${currentStatus} to ${newStatus}`);
        
        // 首先检查是否有记录
        const existingRecord = await env.DB.prepare(
            'SELECT id, channel_id FROM media_channel LIMIT 1'
        ).first();
        
        console.log('Existing media channel record:', existingRecord);
        
        if (existingRecord) {
            // 更新现有记录
            console.log('Updating existing record...');
            const result = await env.DB.prepare(`
                UPDATE media_channel 
                SET spoiler_enabled = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(newStatus, existingRecord.id).run();
            
            console.log('Update result:', result);
            
            if (result.success) {
                console.log(`✅ Successfully updated spoiler status to: ${newStatus}`);
            } else {
                console.log('❌ Failed to update record');
            }
        } else {
            // 插入新记录
            console.log('No existing record, inserting new record...');
            try {
                const insertResult = await env.DB.prepare(`
                    INSERT INTO media_channel (channel_id, spoiler_enabled, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `).bind('default_media_channel', newStatus).run();
                
                console.log('Insert result:', insertResult);
                
                if (insertResult.success) {
                    console.log(`✅ Successfully inserted new record with spoiler status: ${newStatus}`);
                } else {
                    console.log('❌ Failed to insert new record');
                }
            } catch (insertError) {
                console.error('Error inserting new record:', insertError);
            }
        }
        
        // 验证更新是否成功
        const updatedStatus = await isSpoilerEnabled(env);
        console.log(`Final spoiler status after toggle: ${updatedStatus}`);
        
        return updatedStatus;
    } catch (error) {
        console.error('Error in toggleSpoiler:', error);
        // 出错时返回当前状态
        const currentStatus = await isSpoilerEnabled(env);
        return currentStatus;
    }
}

// 发送带遮罩的图片
async function sendPhotoWithSpoiler(chatId, photo, caption, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`;
        
        const body = {
            chat_id: chatId,
            photo: photo,
            has_spoiler: true  // 添加spoiler遮罩
        };
        
        if (caption) {
            body.caption = caption;
            body.parse_mode = 'HTML';
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending photo with spoiler:', error);
        return { ok: false };
    }
}

// 发送带遮罩的视频
async function sendVideoWithSpoiler(chatId, video, caption, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVideo`;
        
        const body = {
            chat_id: chatId,
            video: video,
            has_spoiler: true  // 添加spoiler遮罩
        };
        
        if (caption) {
            body.caption = caption;
            body.parse_mode = 'HTML';
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending video with spoiler:', error);
        return { ok: false };
    }
}

// 发送带遮罩的视频笔记
async function sendVideoNoteWithSpoiler(chatId, videoNote, caption, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVideoNote`;
        
        const body = {
            chat_id: chatId,
            video_note: videoNote,
            has_spoiler: true  // 添加spoiler遮罩
        };
        
        if (caption) {
            body.caption = caption;
            body.parse_mode = 'HTML';
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending video note with spoiler:', error);
        return { ok: false };
    }
}

// 获取多媒体频道
async function getMediaChannel(env) {
    try {
        const result = await env.DB.prepare(
            'SELECT channel_id FROM media_channel LIMIT 1'
        ).first();
        
        return result ? result.channel_id : null;
    } catch (error) {
        console.error('Error getting media channel:', error);
        return null;
    }
}

// 获取用户模式（管理员模式还是普通用户模式）
async function getUserMode(userId, env) {
    try {
        const result = await env.DB.prepare(
            'SELECT is_admin_mode FROM userset WHERE user_id = ?'
        ).bind(userId).first();
        
        return result ? result.is_admin_mode : false;
    } catch (error) {
        console.error('Error getting user mode:', error);
        return false;
    }
}

// 广播消息给所有用户 - 支持所有类型消息
async function handleBroadcastMessage(chatId, message, env) {
    try {
        const userId = message.from.id;
        
        // 获取所有用户
        let users;
        try {
            users = await env.DB.prepare(
                'SELECT user_id FROM userset WHERE user_id != ?'
            ).bind(userId).all();
        } catch (dbError) {
            console.error('Database error fetching users for broadcast:', dbError);
            await sendMessage(chatId, '❌ 无法加载用户数据', env, null);
            return;
        }
        
        let successCount = 0;
        let failCount = 0;
        
        // 向所有用户发送广播消息
        if (users && users.results && users.results.length > 0) {
            for (const user of users.results) {
                try {
                    // 使用新的copyMessage函数支持所有消息类型
                    const broadcastResult = await copyMessage(user.user_id, message, env);
                    if (broadcastResult && broadcastResult.ok) {
                        successCount++;
                    } else {
                        failCount++;
                        console.error('Broadcast failed for user:', user.user_id, broadcastResult);
                    }
                } catch (error) {
                    failCount++;
                    console.error('Broadcast error for user:', user.user_id, error);
                }
            }
        }
        
        // 清除广播模式
        await env.DB.prepare(`
            UPDATE userset SET editing_channel = NULL 
            WHERE user_id = ?
        `).bind(userId).run();
        
        // 发送广播结果
        const resultMessage = `📢 广播完成！\n\n成功发送给: ${successCount} 个用户\n发送失败: ${failCount} 个用户`;
        await sendMessage(chatId, resultMessage, env, null);
        
        // 返回管理员菜单
        await showAdminMainMenu(chatId, env);
        
    } catch (error) {
        console.error('Error handling broadcast:', error);
        await sendMessage(chatId, '❌ 广播过程中发生错误', env, null);
    }
}

// 增强的复制消息函数，支持所有Telegram消息类型和HTML实体
async function copyMessage(chatId, originalMessage, env) {
    try {
        // 处理文本消息（支持HTML格式和回复标记）
        if (originalMessage.text) {
            const entities = originalMessage.entities || [];
            const replyMarkup = originalMessage.reply_markup || null;
            
            // 如果有实体，使用HTML格式发送以保留链接和格式
            if (entities.length > 0) {
                const formattedText = applyEntitiesToText(originalMessage.text, entities);
                return await sendMessage(chatId, formattedText, env, replyMarkup, 'HTML');
            } else {
                return await sendMessage(chatId, originalMessage.text, env, replyMarkup, null);
            }
        }
        
        // 处理照片（支持多图和相册）
        if (originalMessage.photo) {
            const photo = originalMessage.photo[originalMessage.photo.length - 1]; // 获取最高质量图片
            const caption = originalMessage.caption || '';
            const captionEntities = originalMessage.caption_entities || [];
            const replyMarkup = originalMessage.reply_markup || null;
            
            let formattedCaption = caption;
            if (captionEntities.length > 0) {
                formattedCaption = applyEntitiesToText(caption, captionEntities);
                return await sendPhoto(chatId, photo.file_id, formattedCaption, env, replyMarkup, 'HTML');
            } else {
                return await sendPhoto(chatId, photo.file_id, caption, env, replyMarkup, null);
            }
        }
        
        // 处理视频
        if (originalMessage.video) {
            const caption = originalMessage.caption || '';
            const captionEntities = originalMessage.caption_entities || [];
            const replyMarkup = originalMessage.reply_markup || null;
            
            let formattedCaption = caption;
            if (captionEntities.length > 0) {
                formattedCaption = applyEntitiesToText(caption, captionEntities);
                return await sendVideo(chatId, originalMessage.video.file_id, formattedCaption, env, replyMarkup, 'HTML');
            } else {
                return await sendVideo(chatId, originalMessage.video.file_id, caption, env, replyMarkup, null);
            }
        }
        
        // 处理音频
        if (originalMessage.audio) {
            const caption = originalMessage.caption || '';
            const captionEntities = originalMessage.caption_entities || [];
            const replyMarkup = originalMessage.reply_markup || null;
            
            let formattedCaption = caption;
            if (captionEntities.length > 0) {
                formattedCaption = applyEntitiesToText(caption, captionEntities);
                return await sendAudio(chatId, originalMessage.audio.file_id, formattedCaption, env, replyMarkup, 'HTML');
            } else {
                return await sendAudio(chatId, originalMessage.audio.file_id, caption, env, replyMarkup, null);
            }
        }
        
        // 处理语音
        if (originalMessage.voice) {
            const caption = originalMessage.caption || '';
            const captionEntities = originalMessage.caption_entities || [];
            const replyMarkup = originalMessage.reply_markup || null;
            
            let formattedCaption = caption;
            if (captionEntities.length > 0) {
                formattedCaption = applyEntitiesToText(caption, captionEntities);
                return await sendVoice(chatId, originalMessage.voice.file_id, formattedCaption, env, replyMarkup, 'HTML');
            } else {
                return await sendVoice(chatId, originalMessage.voice.file_id, caption, env, replyMarkup, null);
            }
        }
        
        // 处理贴纸
        if (originalMessage.sticker) {
            const replyMarkup = originalMessage.reply_markup || null;
            return await sendSticker(chatId, originalMessage.sticker.file_id, env, replyMarkup);
        }
        
        // 处理动画（GIF）
        if (originalMessage.animation) {
            const caption = originalMessage.caption || '';
            const captionEntities = originalMessage.caption_entities || [];
            const replyMarkup = originalMessage.reply_markup || null;
            
            let formattedCaption = caption;
            if (captionEntities.length > 0) {
                formattedCaption = applyEntitiesToText(caption, captionEntities);
                return await sendAnimation(chatId, originalMessage.animation.file_id, formattedCaption, env, replyMarkup, 'HTML');
            } else {
                return await sendAnimation(chatId, originalMessage.animation.file_id, caption, env, replyMarkup, null);
            }
        }
        
        // 处理视频笔记
        if (originalMessage.video_note) {
            const replyMarkup = originalMessage.reply_markup || null;
            return await sendVideoNote(chatId, originalMessage.video_note.file_id, '', env, replyMarkup);
        }
        
        // 处理联系人
        if (originalMessage.contact) {
            const replyMarkup = originalMessage.reply_markup || null;
            return await sendContact(
                chatId, 
                originalMessage.contact.phone_number, 
                originalMessage.contact.first_name, 
                originalMessage.contact.last_name, 
                originalMessage.contact.vcard,
                env,
                replyMarkup
            );
        }
        
        // 处理位置
        if (originalMessage.location) {
            const replyMarkup = originalMessage.reply_markup || null;
            return await sendLocation(
                chatId,
                originalMessage.location.latitude,
                originalMessage.location.longitude,
                originalMessage.location.live_period,
                originalMessage.location.heading,
                originalMessage.location.proximity_alert_radius,
                env,
                replyMarkup
            );
        }
        
        // 处理投票
        if (originalMessage.poll) {
            const replyMarkup = originalMessage.reply_markup || null;
            return await sendPoll(
                chatId,
                originalMessage.poll.question,
                originalMessage.poll.options.map(opt => opt.text),
                originalMessage.poll.is_anonymous,
                originalMessage.poll.type,
                originalMessage.poll.allows_multiple_answers,
                originalMessage.poll.correct_option_id,
                originalMessage.poll.explanation,
                originalMessage.poll.explanation_entities,
                originalMessage.poll.open_period,
                originalMessage.poll.close_date,
                originalMessage.poll.is_closed,
                env,
                replyMarkup
            );
        }
        
        // 处理媒体组（多图/多媒体消息）
        if (originalMessage.media_group_id) {
            console.log('Media group detected:', originalMessage.media_group_id);
            // 对于媒体组，我们发送第一张图片作为代表
            // 注意：完整的媒体组处理需要更复杂的逻辑来收集所有部分
            if (originalMessage.photo) {
                const photo = originalMessage.photo[originalMessage.photo.length - 1];
                const caption = originalMessage.caption || '';
                const captionEntities = originalMessage.caption_entities || [];
                
                let formattedCaption = caption;
                if (captionEntities.length > 0) {
                    formattedCaption = applyEntitiesToText(caption, captionEntities);
                    return await sendPhoto(chatId, photo.file_id, formattedCaption, env, null, 'HTML');
                } else {
                    return await sendPhoto(chatId, photo.file_id, caption, env, null, null);
                }
            }
        }
        
        // 默认返回文本消息
        return await sendMessage(chatId, '📢 广播消息', env, null);
        
    } catch (error) {
        console.error('Error copying message:', error);
        return { ok: false };
    }
}

// 应用实体到文本，保留超链接和格式
function applyEntitiesToText(text, entities) {
    if (!entities || entities.length === 0) {
        return text;
    }
    
    let result = '';
    let lastIndex = 0;
    
    // 按偏移量排序实体
    const sortedEntities = [...entities].sort((a, b) => a.offset - b.offset);
    
    for (const entity of sortedEntities) {
        const { offset, length, type, url } = entity;
        const entityText = text.substring(offset, offset + length);
        
        // 添加实体前的文本
        if (offset > lastIndex) {
            result += escapeHtml(text.substring(lastIndex, offset));
        }
        
        // 根据实体类型添加格式
        switch (type) {
            case 'bold':
                result += `<b>${escapeHtml(entityText)}</b>`;
                break;
            case 'italic':
                result += `<i>${escapeHtml(entityText)}</i>`;
                break;
            case 'code':
                result += `<code>${escapeHtml(entityText)}</code>`;
                break;
            case 'pre':
                result += `<pre>${escapeHtml(entityText)}</pre>`;
                break;
            case 'text_link':
                result += `<a href="${escapeHtml(url)}">${escapeHtml(entityText)}</a>`;
                break;
            case 'text_mention':
                result += `<a href="tg://user?id=${entity.user.id}">${escapeHtml(entityText)}</a>`;
                break;
            case 'underline':
                result += `<u>${escapeHtml(entityText)}</u>`;
                break;
            case 'strikethrough':
                result += `<s>${escapeHtml(entityText)}</s>`;
                break;
            default:
                result += escapeHtml(entityText);
                break;
        }
        
        lastIndex = offset + length;
    }
    
    // 添加剩余文本
    if (lastIndex < text.length) {
        result += escapeHtml(text.substring(lastIndex));
    }
    
    return result;
}

// HTML转义函数
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 增强的发送消息函数，支持HTML实体和回复标记
async function sendMessage(chatId, text, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
        
        const body = {
            chat_id: chatId,
            text: text
        };
        
        // 设置解析模式
        if (parseMode) {
            body.parse_mode = parseMode;
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        
        if (!result.ok) {
            console.error('Telegram API error:', result);
        }
        return result;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

// 增强的发送图片函数
async function sendPhoto(chatId, photo, caption, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`;
        
        const body = {
            chat_id: chatId,
            photo: photo
        };
        
        if (caption) {
            body.caption = caption;
            if (parseMode) {
                body.parse_mode = parseMode;
            }
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending photo:', error);
        return { ok: false };
    }
}

// 增强的发送视频函数
async function sendVideo(chatId, video, caption, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVideo`;
        
        const body = {
            chat_id: chatId,
            video: video
        };
        
        if (caption) {
            body.caption = caption;
            if (parseMode) {
                body.parse_mode = parseMode;
            }
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending video:', error);
        return { ok: false };
    }
}

// 增强的发送文档函数
async function sendDocument(chatId, document, caption, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`;
        
        const body = {
            chat_id: chatId,
            document: document
        };
        
        if (caption) {
            body.caption = caption;
            if (parseMode) {
                body.parse_mode = parseMode;
            }
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending document:', error);
        return { ok: false };
    }
}

// 增强的发送音频函数
async function sendAudio(chatId, audio, caption, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`;
        
        const body = {
            chat_id: chatId,
            audio: audio
        };
        
        if (caption) {
            body.caption = caption;
            if (parseMode) {
                body.parse_mode = parseMode;
            }
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending audio:', error);
        return { ok: false };
    }
}

// 增强的发送语音函数
async function sendVoice(chatId, voice, caption, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVoice`;
        
        const body = {
            chat_id: chatId,
            voice: voice
        };
        
        if (caption) {
            body.caption = caption;
            if (parseMode) {
                body.parse_mode = parseMode;
            }
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending voice:', error);
        return { ok: false };
    }
}

// 发送贴纸函数
async function sendSticker(chatId, sticker, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendSticker`;
        
        const body = {
            chat_id: chatId,
            sticker: sticker
        };
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending sticker:', error);
        return { ok: false };
    }
}

// 发送动画函数
async function sendAnimation(chatId, animation, caption, env, replyMarkup = null, parseMode = 'HTML') {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAnimation`;
        
        const body = {
            chat_id: chatId,
            animation: animation
        };
        
        if (caption) {
            body.caption = caption;
            if (parseMode) {
                body.parse_mode = parseMode;
            }
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending animation:', error);
        return { ok: false };
    }
}

// 发送视频笔记函数
async function sendVideoNote(chatId, videoNote, caption = '', env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVideoNote`;
        
        const body = {
            chat_id: chatId,
            video_note: videoNote
        };
        
        if (caption) {
            body.caption = caption;
            body.parse_mode = 'HTML';
        }
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending video note:', error);
        return { ok: false };
    }
}

// 发送联系人函数
async function sendContact(chatId, phoneNumber, firstName, lastName = null, vcard = null, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendContact`;
        
        const body = {
            chat_id: chatId,
            phone_number: phoneNumber,
            first_name: firstName
        };
        
        if (lastName) body.last_name = lastName;
        if (vcard) body.vcard = vcard;
        if (replyMarkup) body.reply_markup = replyMarkup;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending contact:', error);
        return { ok: false };
    }
}

// 发送位置函数
async function sendLocation(chatId, latitude, longitude, livePeriod = null, heading = null, proximityAlertRadius = null, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendLocation`;
        
        const body = {
            chat_id: chatId,
            latitude: latitude,
            longitude: longitude
        };
        
        if (livePeriod) body.live_period = livePeriod;
        if (heading) body.heading = heading;
        if (proximityAlertRadius) body.proximity_alert_radius = proximityAlertRadius;
        if (replyMarkup) body.reply_markup = replyMarkup;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending location:', error);
        return { ok: false };
    }
}

// 发送投票函数
async function sendPoll(chatId, question, options, isAnonymous = true, type = 'regular', allowsMultipleAnswers = false, correctOptionId = null, explanation = null, explanationEntities = null, openPeriod = null, closeDate = null, isClosed = false, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPoll`;
        
        const body = {
            chat_id: chatId,
            question: question,
            options: JSON.stringify(options),
            is_anonymous: isAnonymous,
            type: type
        };
        
        if (allowsMultipleAnswers) body.allows_multiple_answers = allowsMultipleAnswers;
        if (correctOptionId !== null) body.correct_option_id = correctOptionId;
        if (explanation) body.explanation = explanation;
        if (explanationEntities) body.explanation_entities = JSON.stringify(explanationEntities);
        if (openPeriod) body.open_period = openPeriod;
        if (closeDate) body.close_date = closeDate;
        if (isClosed) body.is_closed = isClosed;
        if (replyMarkup) body.reply_markup = replyMarkup;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error sending poll:', error);
        return { ok: false };
    }
}

// 获取用户设置
async function getUserSettings(userId, env) {
    try {
        const settings = await env.DB.prepare(
            'SELECT selected_channel, anonymous, pinned_message_id, pinned_channel_id FROM userset WHERE user_id = ?'
        ).bind(userId).first();
        
        return settings;
    } catch (error) {
        console.error('Error getting user settings:', error);
        return null;
    }
}

// 管理员主菜单
async function showAdminMainMenu(chatId, env) {
    try {
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '我要发言', callback_data: 'user_mode' }
                ],
                [
                    { text: '我要广播', callback_data: 'broadcast_mode' }
                ],
                [
                    { text: '管理面板', callback_data: 'admin_panel' }
                ]
            ]
        };
        
        await sendMessage(chatId, '👑 管理员面板\n请选择操作：', env, keyboard);
    } catch (error) {
        console.error('Error showing admin menu:', error);
        await sendMessage(chatId, '显示菜单时出错，请重试。', env, null);
    }
}

async function showUserChannelSelection(chatId, env, userId = null) {
    try {
        let channels;
        try {
            channels = await env.DB.prepare(
                'SELECT * FROM channel_options ORDER BY row_number, position'
            ).all();
        } catch (dbError) {
            console.error('Database error fetching channels:', dbError);
            await sendMessage(chatId, '❌ 无法加载频道数据，请稍后重试。', env, null);
            return;
        }
        
        if (!channels || !channels.results || channels.results.length === 0) {
            await sendMessage(chatId, '❌ 频道数据未初始化，请先访问 /webhook 初始化系统', env, null);
            return;
        }
        
        // 获取用户当前选择状态
        let userCurrentSelection = null;
        let userAnonymous = true;
        
        if (userId) {
            const userSettings = await getUserSettings(userId, env);
            if (userSettings) {
                userCurrentSelection = userSettings.selected_channel;
                userAnonymous = userSettings.anonymous;
            }
        }
        
        // 构建正确的内联键盘结构
        const keyboard = { inline_keyboard: [] };
        
        // 第一行频道（3个）- 每行3个按钮
        const row1Channels = channels.results.filter(c => c.row_number === 1);
        if (row1Channels.length > 0) {
            const row1 = [];
            for (const channel of row1Channels) {
                const isSelected = userCurrentSelection === channel.channel_id;
                const buttonText = isSelected ? `✅ ${channel.name}` : `⚪ ${channel.name}`;
                row1.push({
                    text: buttonText,
                    callback_data: `select_channel_${channel.channel_id}`
                });
            }
            keyboard.inline_keyboard.push(row1);
        }
        
        // 第二行频道（3个）- 每行3个按钮
        const row2Channels = channels.results.filter(c => c.row_number === 2);
        if (row2Channels.length > 0) {
            const row2 = [];
            for (const channel of row2Channels) {
                const isSelected = userCurrentSelection === channel.channel_id;
                const buttonText = isSelected ? `✅ ${channel.name}` : `⚪ ${channel.name}`;
                row2.push({
                    text: buttonText,
                    callback_data: `select_channel_${channel.channel_id}`
                });
            }
            keyboard.inline_keyboard.push(row2);
        }
        
        // 第三行匿名/实名选项 - 2个按钮在一行
        const anonymousText = userAnonymous ? '✅ 我要匿名' : '⚪ 我要匿名';
        const realnameText = !userAnonymous ? '✅ 我要实名' : '⚪ 我要实名';
        
        keyboard.inline_keyboard.push([
            { text: anonymousText, callback_data: 'set_anonymous_true' },
            { text: realnameText, callback_data: 'set_anonymous_false' }
        ]);
        
        let message = '📢 请选择频道和发言方式：\n\n';
        if (userCurrentSelection) {
            const channelName = await getChannelName(userCurrentSelection, env);
            const modeText = userAnonymous ? '匿名' : '实名';
            message += `当前设置：${channelName} (${modeText})\n\n`;
        }
        message += '💡 选择后设置将自动保存，直接输入消息即可发送到所选频道\n\n';
        message += '📝 支持的消息类型：文字、表情、语音\n';
        message += '🎬 图片和视频将自动添加遮罩后转发\n';
        message += '❌ 贴纸消息暂不支持发送';
        
        await sendMessage(chatId, message, env, keyboard);
    } catch (error) {
        console.error('Error showing channel selection:', error);
        await sendMessage(chatId, '系统错误，请稍后重试。', env, null);
    }
}

async function handleCallbackQuery(callbackQuery, env) {
    try {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;
        const messageId = callbackQuery.message.message_id;
        
        console.log(`Callback from ${userId}: ${data}`);
        
        const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
        const isAdmin = adminIds.includes(userId);
        
        // 检查用户模式
        const userMode = await getUserMode(userId, env);
        
        if (isAdmin && !userMode) {
            await handleAdminCallback(chatId, data, userId, messageId, env);
        } else {
            await handleUserCallback(chatId, userId, data, messageId, env);
        }
        
        await answerCallbackQuery(callbackQuery.id, env);
    } catch (error) {
        console.error('Error handling callback:', error);
        await answerCallbackQuery(callbackQuery.id, '操作失败', env);
    }
}

// 管理员回调处理（彻底修复遮罩开关功能）
async function handleAdminCallback(chatId, data, userId, messageId, env) {
    try {
        console.log('Admin callback data:', data);
        
        switch (data) {
            case 'user_mode':
                // 管理员切换到用户模式
                await env.DB.prepare(`
                    INSERT INTO userset (user_id, is_admin_mode, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id) DO UPDATE SET
                    is_admin_mode = excluded.is_admin_mode,
                    updated_at = excluded.updated_at
                `).bind(userId, true).run();
                
                await sendMessage(chatId, '🔓 您已切换到用户模式。现在您可以像普通用户一样选择频道和发言。', env, null);
                await showUserChannelSelection(chatId, env, userId);
                break;
            case 'broadcast_mode':
                // 设置广播模式
                await env.DB.prepare(`
                    INSERT INTO userset (user_id, editing_channel, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id) DO UPDATE SET
                    editing_channel = excluded.editing_channel,
                    updated_at = excluded.updated_at
                `).bind(userId, 'broadcast_mode').run();
                
                await sendMessage(chatId, '📢 广播模式已激活！\n\n请发送任何类型的消息（文字、图片、视频、文件、贴纸、按钮消息等），消息将发送给所有用户。', env, null);
                break;
            case 'admin_panel':
                await showChannelManagementPanel(chatId, env);
                break;
            case 'media_settings':
                await showMediaSettings(chatId, env, userId);
                break;
            case 'set_media_channel':
                await startMediaChannelSetup(chatId, userId, env);
                break;
            case 'view_media_channel':
                await viewMediaChannel(chatId, env);
                break;
            case 'toggle_spoiler':
                console.log('Toggle spoiler callback received');
                const newStatus = await toggleSpoiler(env);
                console.log(`Toggle spoiler completed, new status: ${newStatus}`);
                await sendMessage(chatId, `✅ 图片视频遮罩已${newStatus ? '开启' : '关闭'}！`, env, null);
                // 重新显示设置界面以更新状态显示
                await showMediaSettings(chatId, env, userId);
                break;
            case 'back_to_main':
                await showAdminMainMenu(chatId, env);
                break;
            case 'back_to_admin':
                // 从用户模式返回管理员模式
                await env.DB.prepare(`
                    UPDATE userset SET is_admin_mode = false 
                    WHERE user_id = ?
                `).bind(userId).run();
                
                await showAdminMainMenu(chatId, env);
                break;
            default:
                if (data.startsWith('edit_channel_')) {
                    const channelId = data.replace('edit_channel_', '');
                    await startChannelEdit(chatId, channelId, userId, env);
                }
        }
    } catch (error) {
        console.error('Error in admin callback:', error);
        await sendMessage(chatId, '管理员操作失败，请重试。', env, null);
    }
}

// 频道管理面板
async function showChannelManagementPanel(chatId, env) {
    try {
        let channels;
        try {
            channels = await env.DB.prepare(
                'SELECT * FROM channel_options ORDER BY row_number, position'
            ).all();
        } catch (dbError) {
            console.error('Database error fetching channels for management:', dbError);
            await sendMessage(chatId, '❌ 无法加载频道数据', env, null);
            return;
        }
        
        if (!channels || !channels.results || channels.results.length === 0) {
            await sendMessage(chatId, '❌ 没有可管理的频道', env, null);
            return;
        }
        
        let message = '⚙️ 频道管理面板\n\n当前频道设置：\n';
        const keyboard = { inline_keyboard: [] };
        
        channels.results.forEach((channel, index) => {
            message += `\n${index + 1}. ${channel.name} → ${channel.channel_id}`;
        });
        
        message += '\n\n点击要编辑的频道：';
        
        const row1Channels = channels.results.filter(c => c.row_number === 1);
        const row2Channels = channels.results.filter(c => c.row_number === 2);
        
        // 第一行编辑按钮
        if (row1Channels.length > 0) {
            const row1 = [];
            for (const channel of row1Channels) {
                row1.push({
                    text: `✏️ ${channel.name}`,
                    callback_data: `edit_channel_${channel.id}`
                });
            }
            keyboard.inline_keyboard.push(row1);
        }
        
        // 第二行编辑按钮
        if (row2Channels.length > 0) {
            const row2 = [];
            for (const channel of row2Channels) {
                row2.push({
                    text: `✏️ ${channel.name}`,
                    callback_data: `edit_channel_${channel.id}`
                });
            }
            keyboard.inline_keyboard.push(row2);
        }
        
        // 第三行：多媒体设置按钮和返回按钮
        keyboard.inline_keyboard.push([
            { text: '🎬 多媒体设置', callback_data: 'media_settings' },
            { text: '↩️ 返回主菜单', callback_data: 'back_to_main' }
        ]);
        
        await sendMessage(chatId, message, env, keyboard);
    } catch (error) {
        console.error('Error showing management panel:', error);
        await sendMessage(chatId, '❌ 显示管理面板时出错', env, null);
    }
}

// 显示多媒体设置（修复遮罩开关显示）
async function showMediaSettings(chatId, env, userId) {
    try {
        // 强制重新获取最新状态
        const mediaChannel = await getMediaChannel(env);
        const spoilerEnabled = await isSpoilerEnabled(env);
        
        console.log(`Current media settings - Channel: ${mediaChannel}, Spoiler: ${spoilerEnabled}`);
        
        let message = '🎬 多媒体频道设置\n\n';
        if (mediaChannel && mediaChannel !== 'default_media_channel') {
            message += `当前多媒体频道：${mediaChannel}\n`;
        } else {
            message += '❌ 未设置多媒体频道\n';
        }
        
        message += `图片视频遮罩：${spoilerEnabled ? '✅ 已开启' : '❌ 已关闭'}\n\n`;
        message += '多媒体频道用于接收用户发送的图片和视频内容。';
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📝 设置多媒体频道', callback_data: 'set_media_channel' }
                ],
                [
                    { 
                        text: spoilerEnabled ? '🔓 关闭遮罩' : '🔒 开启遮罩', 
                        callback_data: 'toggle_spoiler' 
                    }
                ],
                [
                    { text: '👁️ 查看当前设置', callback_data: 'view_media_channel' }
                ],
                [
                    { text: '↩️ 返回管理面板', callback_data: 'admin_panel' }
                ]
            ]
        };
        
        await sendMessage(chatId, message, env, keyboard);
    } catch (error) {
        console.error('Error showing media settings:', error);
        await sendMessage(chatId, '❌ 显示设置时出错', env, null);
    }
}

// 开始设置多媒体频道
async function startMediaChannelSetup(chatId, userId, env) {
    try {
        await env.DB.prepare(`
            INSERT INTO userset (user_id, editing_channel, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
            editing_channel = excluded.editing_channel,
            updated_at = excluded.updated_at
        `).bind(userId, 'media_channel_setup').run();
        
        await sendMessage(chatId, 
            '📝 设置多媒体频道\n\n请输入多媒体频道的ID（格式：-1001234567890）：\n\n注意：请确保机器人已添加到该频道并具有发送消息的权限。', 
            env, null
        );
    } catch (error) {
        console.error('Error starting media channel setup:', error);
        await sendMessage(chatId, '❌ 开始设置时出错', env, null);
    }
}

// 处理多媒体频道设置
async function handleMediaChannelSetup(chatId, text, userId, env) {
    try {
        const channelId = text.trim();
        
        // 验证频道ID格式（Telegram频道ID通常以-100开头）
        if (!channelId.startsWith('-100') || channelId.length < 10) {
            await sendMessage(chatId, '❌ 频道ID格式错误！请输入正确的频道ID（格式：-1001234567890）', env, null);
            return;
        }
        
        // 保存到数据库
        await env.DB.prepare(`
            INSERT INTO media_channel (channel_id, spoiler_enabled, updated_at)
            VALUES (?, true, CURRENT_TIMESTAMP)
            ON CONFLICT(channel_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            updated_at = excluded.updated_at
        `).bind(channelId).run();
        
        // 清除编辑状态
        await env.DB.prepare(`
            UPDATE userset SET editing_channel = NULL 
            WHERE user_id = ?
        `).bind(userId).run();
        
        await sendMessage(chatId, `✅ 多媒体频道设置成功！\n\n频道ID: ${channelId}`, env, null);
        
        // 返回多媒体设置
        await showMediaSettings(chatId, env, userId);
        
    } catch (error) {
        console.error('Error handling media channel setup:', error);
        await sendMessage(chatId, '❌ 设置多媒体频道时出错', env, null);
    }
}

// 查看多媒体频道
async function viewMediaChannel(chatId, env) {
    try {
        const mediaChannel = await getMediaChannel(env);
        const spoilerEnabled = await isSpoilerEnabled(env);
        
        if (mediaChannel) {
            let message = `📋 当前多媒体频道设置：\n\n`;
            message += `频道ID: ${mediaChannel}\n`;
            message += `图片视频遮罩: ${spoilerEnabled ? '✅ 已开启' : '❌ 已关闭'}`;
            await sendMessage(chatId, message, env, null);
        } else {
            await sendMessage(chatId, '❌ 未设置多媒体频道', env, null);
        }
        
        // 返回多媒体设置
        await showMediaSettings(chatId, env, null);
    } catch (error) {
        console.error('Error viewing media channel:', error);
        await sendMessage(chatId, '❌ 查看多媒体频道时出错', env, null);
    }
}

// 管理员编辑功能
async function startChannelEdit(chatId, channelId, userId, env) {
    try {
        console.log('Starting channel edit for ID:', channelId);
        
        // 使用 UPSERT 操作
        try {
            await env.DB.prepare(`
                INSERT INTO userset (user_id, editing_channel, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                editing_channel = excluded.editing_channel,
                updated_at = excluded.updated_at
            `).bind(userId, channelId).run();
        } catch (dbError) {
            console.error('Failed to set edit state:', dbError);
            return;
        }
        
        // 根据ID查询频道信息
        let currentChannel;
        try {
            currentChannel = await env.DB.prepare(
                'SELECT * FROM channel_options WHERE id = ?'
            ).bind(parseInt(channelId)).first();
        } catch (dbError) {
            console.error('Database error fetching channel:', dbError);
            await sendMessage(chatId, '❌ 无法加载频道信息', env, null);
            return;
        }
        
        if (!currentChannel) {
            await sendMessage(chatId, '❌ 找不到要编辑的频道', env, null);
            return;
        }
        
        await sendMessage(chatId, 
            `📝 编辑频道选项\n\n当前设置：\n名称: ${currentChannel.name}\n频道ID: ${currentChannel.channel_id}\n\n请输入新的名称和频道ID，格式：\n"名字 频道ID"\n\n例如：\n"新闻频道 -1001234567890"`, 
            env, null
        );
        
    } catch (error) {
        console.error('Error starting channel edit:', error);
        await sendMessage(chatId, '❌ 开始编辑时出错: ' + error.message, env, null);
    }
}

// 频道编辑处理函数
async function handleChannelEdit(chatId, text, userId, env) {
    try {
        console.log('Handling channel edit with text:', text);
        
        let editingInfo;
        try {
            editingInfo = await env.DB.prepare(
                'SELECT editing_channel FROM userset WHERE user_id = ?'
            ).bind(userId).first();
        } catch (dbError) {
            console.error('Database error fetching edit state:', dbError);
            await sendMessage(chatId, '❌ 无法获取编辑状态', env, null);
            return;
        }
        
        if (!editingInfo || !editingInfo.editing_channel) {
            await sendMessage(chatId, '❌ 编辑会话已过期，请重新开始', env, null);
            return;
        }
        
        const channelId = editingInfo.editing_channel;
        const parts = text.split(' ');
        
        if (parts.length < 2) {
            await sendMessage(chatId, '❌ 格式错误！请使用格式："名字 频道ID"\n\n例如："新闻频道 -1001234567890"', env, null);
            return;
        }
        
        const name = parts[0];
        const newChannelId = parts.slice(1).join(' ');
        
        console.log(`Updating channel ${channelId} to: ${name} -> ${newChannelId}`);
        
        try {
            await env.DB.prepare(`
                UPDATE channel_options 
                SET name = ?, channel_id = ?
                WHERE id = ?
            `).bind(name, newChannelId, parseInt(channelId)).run();
            
            // 清除编辑状态
            await env.DB.prepare(`
                UPDATE userset SET editing_channel = NULL 
                WHERE user_id = ?
            `).bind(userId).run();
            
            await sendMessage(chatId, `✅ 频道选项更新成功！\n\n新名称: ${name}\n新频道ID: ${newChannelId}`, env, null);
            
            // 返回管理面板
            await showChannelManagementPanel(chatId, env);
            
        } catch (dbError) {
            console.error('Database error updating channel:', dbError);
            await sendMessage(chatId, '❌ 更新频道时数据库错误: ' + dbError.message, env, null);
        }
        
    } catch (error) {
        console.error('Error handling channel edit:', error);
        await sendMessage(chatId, '❌ 更新频道选项时出错: ' + error.message, env, null);
    }
}

// 用户回调处理
async function handleUserCallback(chatId, userId, data, messageId, env) {
    try {
        console.log('User callback data:', data);
        
        if (data.startsWith('select_channel_')) {
            const channelId = data.replace('select_channel_', '');
            await handleUserChannelSelection(chatId, userId, channelId, messageId, env);
        } else if (data.startsWith('set_anonymous_')) {
            const anonymous = data.replace('set_anonymous_', '') === 'true';
            await handleUserAnonymousSelection(chatId, userId, anonymous, messageId, env);
        } else if (data === 'restart_setup') {
            // 处理重新设置
            await showUserChannelSelection(chatId, env, userId);
        } else if (data === 'back_to_admin') {
            // 从用户模式返回管理员模式
            const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
            const isAdmin = adminIds.includes(userId);
            
            if (isAdmin) {
                await env.DB.prepare(`
                    UPDATE userset SET is_admin_mode = false 
                    WHERE user_id = ?
                `).bind(userId).run();
                
                await showAdminMainMenu(chatId, env);
            }
        }
    } catch (error) {
        console.error('Error in user callback:', error);
        await answerCallbackQuery(callbackQuery.id, '操作失败', env);
    }
}

// handleUserChannelSelection 函数
async function handleUserChannelSelection(chatId, userId, channelId, messageId, env) {
    try {
        // 使用 UPSERT 操作立即保存频道选择
        await env.DB.prepare(`
            INSERT INTO userset (user_id, selected_channel, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
            selected_channel = excluded.selected_channel,
            updated_at = excluded.updated_at
        `).bind(userId, channelId).run();
        
        // 检查是否已经设置了匿名状态
        const userSettings = await getUserSettings(userId, env);
        if (userSettings && userSettings.anonymous !== undefined) {
            // 如果已经完成所有设置，直接置顶当前面板消息
            await pinCurrentPanelMessage(chatId, messageId, userId, env);
        } else {
            // 如果还没有完成设置，更新当前消息
            await editUserSelectionMessage(chatId, messageId, env, userId);
        }
        
    } catch (dbError) {
        console.error('Database error saving channel selection:', dbError);
        await answerCallbackQuery(callbackQuery.id, '选择失败，请重试', env);
    }
}

// handleUserAnonymousSelection 函数
async function handleUserAnonymousSelection(chatId, userId, anonymous, messageId, env) {
    try {
        // 检查是否已选择频道
        const userSettings = await getUserSettings(userId, env);
        
        if (!userSettings || !userSettings.selected_channel) {
            await answerCallbackQuery(callbackQuery.id, '请先选择频道', env);
            return;
        }
        
        // 更新匿名设置
        await env.DB.prepare(`
            UPDATE userset SET anonymous = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).bind(anonymous, userId).run();
        
        // 直接置顶当前面板消息
        await pinCurrentPanelMessage(chatId, messageId, userId, env);
        
    } catch (dbError) {
        console.error('Database error updating anonymous setting:', dbError);
        await answerCallbackQuery(callbackQuery.id, '设置失败，请重试', env);
    }
}

// pinCurrentPanelMessage 函数 - 确保只保留最新的置顶消息
async function pinCurrentPanelMessage(chatId, messageId, userId, env) {
    try {
        const userSettings = await getUserSettings(userId, env);
        if (!userSettings || !userSettings.selected_channel) {
            console.log('User settings not complete, skipping pin');
            return;
        }
        
        const channelName = await getChannelName(userSettings.selected_channel, env);
        const modeText = userSettings.anonymous ? '匿名' : '实名';
        
        // 更新消息内容为完成状态
        let message = `🎉 设置完成！\n\n`;
        message += `📢 当前频道：${channelName}\n`;
        message += `👤 发言模式：${modeText}\n\n`;
        message += `💡 现在您可以开始输入消息，消息将自动发送到所选频道。\n\n`;
        message += `📝 支持的消息类型：文字、表情、语音\n`;
        message += `🎬 图片和视频将自动添加遮罩后转发\n`;
        message += `❌ 贴纸消息暂不支持发送`;
        
        // 构建键盘
        const keyboard = { 
            inline_keyboard: [
                [
                    { text: '🔄 重新设置', callback_data: 'restart_setup' }
                ]
            ]
        };
        
        // 检查是否是管理员在用户模式下
        const adminIds = env.ADMIN_IDS ? env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
        const isAdmin = adminIds.includes(userId);
        const userMode = await getUserMode(userId, env);
        
        if (isAdmin && userMode) {
            keyboard.inline_keyboard.push([
                { text: '↩️ 返回管理员模式', callback_data: 'back_to_admin' }
            ]);
        }
        
        // 更新消息内容
        await editMessage(chatId, messageId, message, env, keyboard);
        
        // 先取消所有旧的置顶消息，再置顶新的
        await cleanupAllPinnedMessages(userId, chatId, env);
        
        // 在私聊中置顶当前这条面板消息
        try {
            await pinChannelMessage(chatId, messageId, env);
            
            // 存储当前置顶消息的信息
            await storePinnedMessageInfo(userId, chatId, messageId, env);
            
        } catch (pinError) {
            console.error('Error pinning message:', pinError);
            // 即使不能置顶，也存储消息信息
            await storePinnedMessageInfo(userId, chatId, messageId, env);
        }
        
    } catch (error) {
        console.error('Error pinning current panel message:', error);
    }
}

// 清理所有旧的置顶消息
async function cleanupAllPinnedMessages(userId, currentChatId, env) {
    try {
        // 获取用户之前的所有置顶消息信息
        const userInfo = await env.DB.prepare(`
            SELECT pinned_message_id, pinned_channel_id 
            FROM userset 
            WHERE user_id = ? AND pinned_message_id IS NOT NULL
        `).bind(userId).first();
        
        if (userInfo && userInfo.pinned_message_id && userInfo.pinned_channel_id) {
            const oldMessageId = userInfo.pinned_message_id;
            const oldChatId = userInfo.pinned_channel_id;
            
            // 只有在同一个聊天才取消置顶旧消息
            if (oldChatId === currentChatId.toString()) {
                console.log(`Unpinning old message ${oldMessageId} in chat ${oldChatId}`);
                try {
                    await unpinChannelMessage(oldChatId, oldMessageId, env);
                } catch (error) {
                    console.error('Error unpinning old message:', error);
                }
            }
        }
    } catch (error) {
        console.error('Error cleaning up old pinned messages:', error);
    }
}

// 只在用户还没有完成设置时才调用的编辑函数
async function editUserSelectionMessage(chatId, messageId, env, userId) {
    try {
        const userSettings = await getUserSettings(userId, env);
        if (!userSettings) {
            return;
        }

        let channels;
        try {
            channels = await env.DB.prepare(
                'SELECT * FROM channel_options ORDER BY row_number, position'
            ).all();
        } catch (dbError) {
            console.error('Database error fetching channels:', dbError);
            return;
        }
        
        if (!channels || !channels.results || channels.results.length === 0) {
            return;
        }

        const userCurrentSelection = userSettings.selected_channel;
        const userAnonymous = userSettings.anonymous !== undefined ? userSettings.anonymous : true;
        
        // 如果用户还没有完成设置，显示选择界面
        let message = '📢 请选择频道和发言方式：\n\n';
        if (userCurrentSelection) {
            const channelName = await getChannelName(userCurrentSelection, env);
            message += `已选择频道：${channelName}\n\n`;
        }
        message += '💡 选择后设置将自动保存，直接输入消息即可发送到所选频道\n\n';
        message += '📝 支持的消息类型：文字、表情、语音\n';
        message += '🎬 图片和视频将自动添加遮罩后转发\n';
        message += '❌ 贴纸消息暂不支持发送';
        
        // 构建正确的内联键盘结构
        const keyboard = { inline_keyboard: [] };
        
        // 第一行频道（3个）- 每行3个按钮
        const row1Channels = channels.results.filter(c => c.row_number === 1);
        if (row1Channels.length > 0) {
            const row1 = [];
            for (const channel of row1Channels) {
                const isSelected = userCurrentSelection === channel.channel_id;
                const buttonText = isSelected ? `✅ ${channel.name}` : `⚪ ${channel.name}`;
                row1.push({
                    text: buttonText,
                    callback_data: `select_channel_${channel.channel_id}`
                });
            }
            keyboard.inline_keyboard.push(row1);
        }
        
        // 第二行频道（3个）- 每行3个按钮
        const row2Channels = channels.results.filter(c => c.row_number === 2);
        if (row2Channels.length > 0) {
            const row2 = [];
            for (const channel of row2Channels) {
                const isSelected = userCurrentSelection === channel.channel_id;
                const buttonText = isSelected ? `✅ ${channel.name}` : `⚪ ${channel.name}`;
                row2.push({
                    text: buttonText,
                    callback_data: `select_channel_${channel.channel_id}`
                });
            }
            keyboard.inline_keyboard.push(row2);
        }
        
        // 第三行匿名/实名选项 - 2个按钮在一行
        const anonymousText = userAnonymous ? '✅ 我要匿名' : '⚪ 我要匿名';
        const realnameText = !userAnonymous ? '✅ 我要实名' : '⚪ 我要实名';
        
        keyboard.inline_keyboard.push([
            { text: anonymousText, callback_data: 'set_anonymous_true' },
            { text: realnameText, callback_data: 'set_anonymous_false' }
        ]);
        
        // 编辑原有消息
        await editMessage(chatId, messageId, message, env, keyboard);
        
    } catch (error) {
        console.error('Error editing user selection message:', error);
    }
}

// 编辑消息函数
async function editMessage(chatId, messageId, text, env, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`;
        
        const body = {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML'
        };
        
        if (replyMarkup) {
            body.reply_markup = replyMarkup;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        
        if (!result.ok) {
            console.error('Telegram API edit error:', result);
        }
        return result;
    } catch (error) {
        console.error('Error editing message:', error);
        throw error;
    }
}

async function getChannelName(channelId, env) {
    try {
        const channel = await env.DB.prepare(
            'SELECT name FROM channel_options WHERE channel_id = ?'
        ).bind(channelId).first();
        return channel ? channel.name : '未知频道';
    } catch (error) {
        return '未知频道';
    }
}

// 置顶频道消息
async function pinChannelMessage(chatId, messageId, env) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/pinChatMessage`;
        
        const body = {
            chat_id: chatId,
            message_id: messageId,
            disable_notification: true
        };
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        
        if (!result.ok) {
            console.error('Failed to pin message:', result);
        }
        return result;
    } catch (error) {
        console.error('Error pinning message:', error);
        return { ok: false, error: error.message };
    }
}

// 取消置顶消息
async function unpinChannelMessage(chatId, messageId, env) {
    try {
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/unpinChatMessage`;
        
        const body = {
            chat_id: chatId,
            message_id: messageId
        };
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error unpinning message:', error);
        throw error;
    }
}

// 存储置顶消息信息
async function storePinnedMessageInfo(userId, chatId, messageId, env) {
    try {
        await env.DB.prepare(`
            UPDATE userset 
            SET pinned_message_id = ?, pinned_channel_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).bind(messageId, chatId.toString(), userId).run();
        
    } catch (error) {
        console.error('Error storing pinned message info:', error);
    }
}

async function answerCallbackQuery(callbackQueryId, env, text = '') {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
    
    const body = {
        callback_query_id: callbackQueryId
    };
    
    if (text) {
        body.text = text;
    }
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error answering callback:', error);
        throw error;
    }
}
