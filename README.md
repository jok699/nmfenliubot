Telegram 匿名分流机器人

这是一个基于 Cloudflare Workers 和 D1 数据库的 Telegram 机器人，支持匿名消息转发、多媒体内容处理、管理员广播等功能。
功能特性
用户功能

    ✅ 选择频道和发言方式（匿名/实名）

    ✅ 文字消息转发

    ✅ 语音消息转发

    ✅ 图片/视频自动添加遮罩转发

    ✅ 设置持久化（置顶面板）

管理员功能

    ✅ 用户模式发言

    ✅ 广播模式（向所有用户发送消息）

    ✅ 频道管理（编辑频道名称和ID）

    ✅ 多媒体频道设置

    ✅ 遮罩开关控制

    ✅ 支持所有消息类型广播

部署步骤
第一步：准备工作

    创建 Telegram 机器人

        在 Telegram 中搜索 @BotFather

        发送 /newbot 创建新机器人

        记下生成的 Bot Token

    获取管理员用户ID

        在 Telegram 中搜索 @userinfobot

        向它发送任意消息，获取你的 用户ID

第二步：Cloudflare 设置

    创建 Cloudflare 账户（如未有）

        访问 cloudflare.com

        注册并登录账户

    创建 Worker

        进入 Workers & Pages 控制台

        点击 "Create application"

        选择 "Create Worker"

        输入 Worker 名称（如 my-telegram-bot）

    创建 D1 数据库

        在 Worker 控制台，进入 "D1" 页面

        点击 "Create database"

        输入数据库名称（如 bot-db）

        选择位置（推荐就近区域）

    绑定数据库到 Worker

        进入你的 Worker

        点击 "Settings" → "Variables"

        在 "D1 Database Bindings" 点击 "Add binding"

        变量名称输入：DB

        选择刚才创建的数据库

第三步：配置环境变量

在 Worker 的 "Settings" → "Variables" 中设置：

    BOT_TOKEN

        值：你的 Telegram Bot Token

        格式：1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

    ADMIN_IDS

        值：管理员用户ID，多个用逗号分隔

        格式：6034072975,1234567890

第四步：部署代码

    替换 Worker 代码

        进入 Worker 的 "Edit code" 页面

        删除默认代码

        粘贴提供的完整代码

        点击 "Save and Deploy"

    初始化数据库

        访问：https://你的worker域名.workers.dev/webhook

        应该看到成功消息

        检查日志确认数据库表创建成功

    运行数据库迁移（如果需要）

        访问：https://你的worker域名.workers.dev/migrate

        确保所有表结构正确

第五步：设置 Webhook

    自动设置（推荐）

        上一步访问 /webhook 时已自动设置

    手动验证

        访问：https://你的worker域名.workers.dev/webhook-info

        确认 webhook 状态正常

使用说明
基础使用

    启动机器人

        在 Telegram 中找到你的机器人

        发送 /start

    普通用户流程
    text

/start → 选择频道 → 选择匿名/实名 → 开始发送消息

管理员流程
text

/start → 管理员面板 → 选择功能

管理员功能详解
1. 用户模式

    像普通用户一样选择频道发言

    用于测试用户功能

2. 广播模式

    向所有注册用户发送消息

    支持所有消息类型（文字、图片、视频、文件等）

    发送任意消息即可广播

3. 管理面板

    编辑频道：修改频道名称和实际频道ID

    多媒体设置：

        设置多媒体频道（用于接收图片/视频）

        开启/关闭遮罩功能

4. 遮罩功能

    开启：图片和视频自动添加模糊遮罩

    关闭：直接显示原图/视频

    在多媒体设置中切换

消息处理规则
消息类型	处理方式
文字消息	发送到选定频道
语音消息	发送到选定频道
图片消息	转发到多媒体频道（可选遮罩）
视频消息	转发到多媒体频道（可选遮罩）
贴纸消息	不支持发送
其他类型	不支持发送
频道设置

    默认频道

        系统预设6个频道（频道A-F）

        可在管理面板中编辑

    实际频道ID格式

        必须是 Telegram 频道/群组ID

        格式：-1001234567890

        机器人必须在该频道有发送权限
        
