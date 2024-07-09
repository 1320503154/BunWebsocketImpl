// 导入 SQLite 数据库模块
import { Database } from 'bun:sqlite';
// 导入 serve 模块，用于创建服务器
import { serve } from 'bun';
// 导入 path 模块，用于处理文件路径
import { join } from 'path';

// 初始化 SQLite 数据库，文件名为 chat.sqlite
const db = new Database('chat.sqlite');
// 创建 messages 表，如果不存在的话
db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  sender TEXT, 
  receiver TEXT, 
  content TEXT, 
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP 
)`);

// 存储活动的 WebSocket 连接
const activeConnections = new Map();

// 创建服务器，监听端口 3000
const server:any = serve({
  port: 3000, // 服务器监听的端口
  async fetch(req) { // 处理 HTTP 请求
    const url = new URL(req.url); // 获取请求的 URL
    
    // 处理 WebSocket 升级请求
    if (url.pathname === '/chat') {
      const username = url.searchParams.get('username'); // 获取 URL 参数中的用户名
      if (!username) {
        return new Response('Username is required', { status: 400 }); // 如果没有提供用户名，返回错误响应
      }
      
      const success = server.upgrade(req, { data: { username } }); // 升级请求为 WebSocket 连接
      return success
        ? undefined // 如果升级成功，不返回响应
        : new Response('WebSocket upgrade failed', { status: 500 }); // 如果升级失败，返回错误响应
    }
    
    // 处理图片上传
    if (url.pathname === '/upload' && req.method === 'POST') {
      const formData = await req.formData(); // 获取表单数据
      const file = formData.get('image'); // 获取上传的文件
      if (file instanceof File) { // 如果文件存在
        const arrayBuffer = await file.arrayBuffer(); // 获取文件的数组缓冲区
        const buffer = Buffer.from(arrayBuffer); // 将数组缓冲区转换为 Buffer 对象
        const filename = `${Date.now()}-${file.name}`; // 生成唯一的文件名
        await Bun.write(join(import.meta.dir, 'uploads', filename), buffer); // 将文件写入指定路径
        return new Response(JSON.stringify({ filename }), {
          headers: { 'Content-Type': 'application/json' }, // 返回文件名的 JSON 响应
        });
      }
      return new Response('No file uploaded', { status: 400 }); // 如果没有文件上传，返回错误响应
    }

    // 处理静态文件请求
    if (url.pathname.startsWith('/uploads/')) {
      const filePath = join(import.meta.dir, url.pathname); // 构建文件路径
      const file = Bun.file(filePath); // 获取文件
      return new Response(file); // 返回文件响应
    }

    // 提供前端页面
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const file = Bun.file(join(import.meta.dir, 'index.html')); // 获取前端页面文件
      return new Response(file); // 返回前端页面响应
    }

    return new Response('Not found', { status: 404 }); // 处理未找到的请求，返回 404 响应
  },
  websocket: {
    open(ws) { // 当 WebSocket 连接打开时
      const { username } = ws.data; // 获取连接的用户名
      console.log(`${username} connected`); // 输出连接信息
      activeConnections.set(username, ws); // 将连接存储到活动连接中
      broadcastMessage(server, `${username} joined the chat`); // 广播用户加入消息
    },
    message(ws, message) { // 当 WebSocket 接收到消息时
      const { username } = ws.data; // 获取连接的用户名
      const data = JSON.parse(message); // 解析消息内容
      
      if (data.type === 'chat') { // 如果消息类型为聊天
        if (data.receiver) {
          // 发送私人消息
          sendPrivateMessage(username, data.receiver, data.content);
        } else {
          // 发送公共消息
          broadcastMessage(server, `${username}: ${data.content}`);
        }
        // 保存消息到数据库
        db.run('INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)', 
          [username, data.receiver || null, data.content]);
      } else if (data.type === 'image') { // 如果消息类型为图片
        // 处理图片消息
        const imageUrl = `/uploads/${data.filename}`;
        if (data.receiver) {
          sendPrivateMessage(username, data.receiver, `[Image] ${imageUrl}`);
        } else {
          broadcastMessage(server, `${username} sent an image: [Image] ${imageUrl}`);
        }
        // 保存图片消息到数据库
        db.run('INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)', 
          [username, data.receiver || null, `[Image] ${imageUrl}`]);
      } else if (data.type === 'get_history') { // 如果消息类型为获取历史记录
        // 发送历史记录
        sendMessageHistory(username, data.receiver);
      }
    },
    close(ws) { // 当 WebSocket 连接关闭时
      const { username } = ws.data; // 获取连接的用户名
      console.log(`${username} disconnected`); // 输出断开连接信息
      activeConnections.delete(username); // 从活动连接中删除连接
      broadcastMessage(server, `${username} left the chat`); // 广播用户离开消息
    },
  },
});

// 广播消息给所有连接的客户端
function broadcastMessage(server, message) {
  for (const ws of activeConnections.values()) { // 遍历所有活动连接
    ws.send(JSON.stringify({
      type: 'chat', // 消息类型为聊天
      content: message // 消息内容
    }));
  }
}

// 发送私人消息
function sendPrivateMessage(sender, receiver, content) {
  const receiverWs = activeConnections.get(receiver); // 获取接收者的 WebSocket 连接
  if (receiverWs) {
    receiverWs.send(JSON.stringify({
      type: 'private', // 消息类型为私人消息
      sender, // 发送者
      content // 消息内容
    }));
  }
  // 同时发送给发送者
  const senderWs = activeConnections.get(sender); // 获取发送者的 WebSocket 连接
  if (senderWs) {
    senderWs.send(JSON.stringify({
      type: 'private', // 消息类型为私人消息
      receiver, // 接收者
      content // 消息内容
    }));
  }
}

// 发送消息历史记录
function sendMessageHistory(username, receiver) {
  const ws = activeConnections.get(username); // 获取用户的 WebSocket 连接
  if (ws) {
    console.log('In index.ts receiver::: ', receiver); // 打印接收者信息
    console.log('In index.ts username::: ', username); // 打印用户名
    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
      ORDER BY timestamp ASC
      LIMIT 100
    `).all(username, receiver, receiver, username); // 查询消息历史记录
    
    ws.send(JSON.stringify({
      type: 'history', // 消息类型为历史记录
      messages // 历史消息内容
    }));
  }
}

// 服务器启动信息
console.log(`Server running on http://localhost:${server.port}`); // 输出服务器启动信息
